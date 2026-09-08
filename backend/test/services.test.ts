import { test } from "node:test";
import assert from "node:assert/strict";
import { MockFactoryData } from "../src/data.js";
import { FactoryService } from "../src/factory.js";
import {
  PythonForecastProvider,
  trendForecast,
  type ForecastProvider,
} from "../src/forecast.js";
import { DeterministicAnalysisProvider } from "../src/analysis.js";
import { FactoryCopilot } from "../src/copilot.js";
const forecast: ForecastProvider = {
  async forecast(machineId, metric, history, horizon) {
    return {
      machineId,
      metric,
      forecast: trendForecast(history, horizon),
      model: "test-trend",
    };
  },
};
test("alert acknowledgment survives refresh, severity escalation reopens, baseline resolves", async () => {
  const data = new MockFactoryData(),
    service = new FactoryService(data, forecast);
  data.activate("bearing");
  for (let i = 0; i < 16; i++) data.advance();
  await service.getCurrentRisks();
  const alert = service.alerts.get("kiln-main-motor:vibration")!;
  assert.equal(alert.severity, "HIGH");
  service.alerts.save({ ...alert, status: "ACKNOWLEDGED" });
  service.invalidate();
  await service.getCurrentRisks();
  assert.equal(service.alerts.get(alert.id)!.status, "ACKNOWLEDGED");
  for (let i = 0; i < 12; i++) data.advance();
  service.invalidate();
  await service.getCurrentRisks();
  assert.equal(service.alerts.get(alert.id)!.status, "OPEN");
  assert.equal(service.alerts.get(alert.id)!.severity, "CRITICAL");
  data.reset();
  service.invalidate();
  await service.getCurrentRisks();
  assert.equal(service.alerts.get(alert.id)!.status, "RESOLVED");
});
test("copilot explains approved live measurements and history and ranks fleet priorities", async () => {
  const data = new MockFactoryData(),
    service = new FactoryService(data, forecast);
  data.activate("bearing");
  for (let i = 0; i < 16; i++) data.advance();
  const copilot = new FactoryCopilot(
    service,
    new DeterministicAnalysisProvider(),
  );
  const reply = await copilot.chat("Fırın Ana Motoru neden yüksek riskli?");
  assert.match(reply.answer, /5,94/);
  assert.match(reply.answer, /2026-07-11/);
  assert.equal(reply.sources[0].machineId, "kiln-main-motor");
  const ranked = await copilot.chat(
    "Bugün hangi ekipmanları kontrol etmeliyim?",
  );
  assert.match(ranked.answer, /1\. Fırın Ana Motoru/);
});
test("Python outage uses named API fallback and preserves forecast contract", async () => {
  const old = process.env.FORECAST_SERVICE_URL;
  process.env.FORECAST_SERVICE_URL = "http://127.0.0.1:1";
  try {
    const d = new MockFactoryData();
    const result = await new PythonForecastProvider().forecast(
      "kiln-main-motor",
      "vibration",
      d.history("kiln-main-motor", "vibration"),
      16,
    );
    assert.match(result.model, /API fallback/);
    assert.equal(result.forecast.length, 16);
    assert.equal(
      Date.parse(result.forecast[0].timestamp) - Date.parse(d.now),
      900000,
    );
    assert.ok(result.forecast.every((p) => Number.isFinite(p.value)));
  } finally {
    if (old === undefined) delete process.env.FORECAST_SERVICE_URL;
    else process.env.FORECAST_SERVICE_URL = old;
  }
});

test("TimesFM transport sends only the supported 1024-point context", async () => {
  const originalFetch = globalThis.fetch;
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const history = Array.from({ length: 2_100 }, (_, index) => ({
    timestamp: new Date(start + index * 900_000).toISOString(),
    value: 10 + index / 1_000,
  }));
  let sent: {
    requests: Array<{ timestamps: string[]; values: number[] }>;
  } | null = null;
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body));
    const last = history.at(-1)!;
    return new Response(
      JSON.stringify({
        forecasts: [
          {
            machineId: "machine",
            metric: "vibration",
            model: "timesfm-2.5",
            forecast: [
              {
                timestamp: new Date(
                  Date.parse(last.timestamp) + 900_000,
                ).toISOString(),
                value: 12.1,
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const result = await new PythonForecastProvider().forecast(
      "machine",
      "vibration",
      history,
      1,
    );
    assert.equal(result.model, "timesfm-2.5");
    assert.equal(sent!.requests[0].values.length, 1_024);
    assert.equal(sent!.requests[0].timestamps[0], history.at(-1_024)!.timestamp);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
