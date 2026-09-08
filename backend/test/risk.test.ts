import { test } from "node:test";
import assert from "node:assert/strict";
import { MockFactoryData } from "../src/data.js";
import { RiskEngine, healthScore, thresholdCrossing } from "../src/risk.js";
import { trendForecast } from "../src/forecast.js";
function evaluate(data: MockFactoryData, id: string) {
  const m = data.machines.find((m) => m.id === id)!;
  return new RiskEngine().evaluate(
    id,
    m.sensors.map((config) => {
      const history = data.history(id, config.metric);
      return {
        config,
        history,
        forecast: {
          machineId: id,
          metric: config.metric,
          model: "test",
          forecast: trendForecast(history, 16),
        },
      };
    }),
  );
}
test("normal seed contains low and medium risk, recovered spike is low", () => {
  const d = new MockFactoryData();
  d.reset(true);
  assert.equal(evaluate(d, "kiln-main-motor").riskLevel, "LOW");
  assert.equal(evaluate(d, "cement-mill-2").riskLevel, "MEDIUM");
  assert.equal(evaluate(d, "crusher").riskLevel, "LOW");
});
test("active normal operation advances changing readings without raising risk", () => {
  const d = new MockFactoryData();
  d.activate("normal");
  const before = d.history("kiln-main-motor", "vibration").at(-1)!.value;
  assert.equal(d.running, true);
  for (let i = 0; i < 32; i++) d.advance();
  const after = d.history("kiln-main-motor", "vibration").at(-1)!.value;
  assert.notEqual(after, before);
  assert.equal(d.step, 32);
  for (const machine of d.machines)
    assert.equal(evaluate(d, machine.id).riskLevel, "LOW", machine.name);
});
test("bearing scenario progresses low to warning to high and overheating critical", () => {
  const d = new MockFactoryData();
  d.activate("bearing");
  const states = new Set();
  for (let i = 0; i < 20; i++) {
    states.add(evaluate(d, "kiln-main-motor").riskLevel);
    d.advance();
  }
  assert.ok(states.has("LOW"));
  assert.ok(states.has("MEDIUM"));
  assert.ok(states.has("HIGH"));
  d.activate("overheating");
  for (let i = 0; i < 28; i++) d.advance();
  assert.equal(evaluate(d, "kiln-id-fan").riskLevel, "CRITICAL");
});
test("autonomous operation surfaces risks over multi-day production", () => {
  const d = new MockFactoryData();
  d.activateAutonomous(20260908);
  for (let i = 0; i < 10 * 96; i++) d.advance();
  const elevated = d.machines
    .map((machine) => evaluate(d, machine.id))
    .filter((risk) => risk.riskLevel !== "LOW");
  assert.ok(elevated.length >= 2);
  assert.ok(
    elevated.some(
      (risk) => risk.riskLevel === "HIGH" || risk.riskLevel === "CRITICAL",
    ),
  );
  assert.equal(d.completedDays, 10);
});
test("health score bounded and worsens with severity and corroborating sensors", () => {
  assert.equal(healthScore("LOW", 0), 94);
  assert.ok(healthScore("HIGH", 2) < healthScore("HIGH", 1));
  assert.equal(healthScore("CRITICAL", 100), 0);
});
test("threshold crossing uses actual samples including already exceeded and never crossed", () => {
  const h = [{ timestamp: "2026-09-08T00:00:00Z", value: 4 }],
    f = [
      { timestamp: "2026-09-08T01:00:00Z", value: 5 },
      { timestamp: "2026-09-08T02:00:00Z", value: 6 },
    ];
  assert.equal(thresholdCrossing(h, f, 5.5), f[1].timestamp);
  assert.equal(thresholdCrossing(h, f, 7), null);
  assert.equal(thresholdCrossing(h, f, 3), h[0].timestamp);
});
