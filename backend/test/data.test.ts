import { test } from "node:test";
import assert from "node:assert/strict";
import { MockFactoryData, scenarioOffset } from "../src/data.js";
test("seven-day data are repeatable, varied and include a recovered spike", () => {
  const a = new MockFactoryData(),
    b = new MockFactoryData();
  a.reset(true);
  b.reset(true);
  assert.equal(a.machines.length, 10);
  assert.deepEqual(
    a.history("crusher", "vibration"),
    b.history("crusher", "vibration"),
  );
  assert.equal(a.history("crusher", "vibration").length, 673);
  assert.ok(
    Math.max(...a.history("crusher", "vibration").map((p) => p.value)) > 6,
  );
  assert.ok(a.history("crusher", "vibration").at(-1)!.value < 4);
});
test("scenario evolves correlated sensors and leaves other assets normal", () => {
  const a = new MockFactoryData();
  a.activate("bearing");
  for (let i = 0; i < 24; i++) a.advance();
  assert.ok(a.history("kiln-main-motor", "vibration").at(-1)!.value > 7);
  assert.ok(
    a.history("kiln-main-motor", "bearingTemperature").at(-1)!.value > 85,
  );
  assert.ok(a.history("raw-mill", "vibration").at(-1)!.value < 4);
  assert.equal(scenarioOffset("normal", "vibration", 30), 0);
  a.reset();
  assert.equal(a.step, 0);
});
test("autonomous factory creates repeatable faults and process effects", () => {
  const a = new MockFactoryData(),
    b = new MockFactoryData();
  a.activateAutonomous(424242);
  b.activateAutonomous(424242);
  for (let i = 0; i < 360; i++) {
    a.advance();
    b.advance();
  }
  assert.deepEqual(
    a.history("kiln-main-motor", "vibration"),
    b.history("kiln-main-motor", "vibration"),
  );
  assert.deepEqual(a.simulationEvents, b.simulationEvents);
  const onset = a.simulationEvents.find((event) => event.type === "FAULT_ONSET");
  const impact = a.simulationEvents.find(
    (event) => event.type === "PROCESS_IMPACT",
  );
  assert.ok(onset, "a hidden degradation must start without manual injection");
  assert.ok(impact, "a fault must propagate through the process graph");
  const before = a.conditions.find(
    (condition) => condition.machineId === onset.machineId,
  )!;
  assert.notEqual(before.stage, "HEALTHY");
  const wear = before.wear;
  a.completeMaintenance(onset.machineId, "Rulman kontrolü");
  const after = a.conditions.find(
    (condition) => condition.machineId === onset.machineId,
  )!;
  assert.equal(after.stage, "MAINTAINED");
  assert.ok(after.wear < wear);
  const maintainedMachine = a.machines.find(
    (machine) => machine.id === onset.machineId,
  )!;
  assert.equal(maintainedMachine.lastMaintenanceDate, a.now.slice(0, 10));
  assert.equal(maintainedMachine.maintenanceHistory.at(-1)!.title, "Rulman kontrolü");
  assert.ok(
    a.simulationEvents.some((event) => event.type === "MAINTENANCE_EFFECT"),
  );
  a.activateAutonomous(424242);
  assert.equal(
    a.machines.find((machine) => machine.id === onset.machineId)!
      .lastMaintenanceDate,
    "2026-07-11",
  );
});

test("autonomous seeds vary fault targets and propagate through multiple process stages", () => {
  const a = new MockFactoryData();
  const b = new MockFactoryData();
  a.activateAutonomous(111111);
  b.activateAutonomous(222222);
  for (let i = 0; i < 1_400; i++) {
    a.advance();
    b.advance();
  }
  const targetsA = a.simulationEvents
    .filter((event) => event.type === "FAULT_ONSET")
    .map((event) => event.machineId);
  const targetsB = b.simulationEvents
    .filter((event) => event.type === "FAULT_ONSET")
    .map((event) => event.machineId);
  assert.equal(new Set(targetsA).size, 5);
  assert.equal(new Set(targetsB).size, 5);
  assert.notDeepEqual(targetsA, targetsB);
  assert.ok(
    a.simulationEvents.some(
      (event) =>
        event.type === "PROCESS_IMPACT" &&
        event.description.split("→").length >= 3,
    ),
    "an upstream disturbance must reach a second downstream stage",
  );
});

test("accumulated wear has a visible sensor effect and maintenance reduces it", () => {
  const maintained = new MockFactoryData();
  const comparison = new MockFactoryData();
  maintained.activateAutonomous(515151);
  comparison.activateAutonomous(515151);
  for (let i = 0; i < 1_400; i++) {
    maintained.advance();
    comparison.advance();
  }
  const directTargets = new Set(
    maintained.simulationEvents
      .filter((event) => event.type === "FAULT_ONSET")
      .map((event) => event.machineId),
  );
  const machine = maintained.machines.find(
    (candidate) =>
      !directTargets.has(candidate.id) &&
      candidate.sensors.some((sensor) => sensor.metric === "vibration"),
  )!;
  maintained.completeMaintenance(machine.id, "Yıpranma kontrolü");
  maintained.advance();
  comparison.advance();
  assert.ok(
    comparison.history(machine.id, "vibration").at(-1)!.value >
      maintained.history(machine.id, "vibration").at(-1)!.value,
  );
});
