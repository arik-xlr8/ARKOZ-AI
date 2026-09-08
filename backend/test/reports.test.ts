import { test } from "node:test";
import assert from "node:assert/strict";
import { MockFactoryData } from "../src/data.js";
import { FactoryService } from "../src/factory.js";
import { trendForecast, type ForecastProvider } from "../src/forecast.js";
import {
  dailyNarrativeSchema,
  DeterministicDailyAnalysisProvider,
  futureThresholdCrossing,
  ReportService,
} from "../src/reports.js";

test("daily outlook separates an existing exceedance from a future crossing", () => {
  const forecast = [
    { timestamp: "2026-09-09T00:15:00.000Z", value: 7 },
    { timestamp: "2026-09-09T00:30:00.000Z", value: 9 },
  ];
  assert.equal(futureThresholdCrossing(8.5, 8, forecast), null);
  assert.equal(
    futureThresholdCrossing(7, 8, forecast),
    "2026-09-09T00:30:00.000Z",
  );
});

const forecast: ForecastProvider = {
  async forecast(machineId, metric, history, horizon) {
    return {
      machineId,
      metric,
      model: "test-trend",
      forecast: trendForecast(history, horizon),
    };
  },
};

test("daily report schema rejects uncontrolled or incomplete output", () => {
  assert.equal(
    dailyNarrativeSchema.safeParse({
      summary: "Fabrika izleniyor.",
      outlook: "Yeni eşik aşımı beklenmiyor.",
      recommendedFocus: ["Rutin izlemeyi sürdürün."],
    }).success,
    true,
  );
  assert.equal(
    dailyNarrativeSchema.safeParse({
      summary: "<b>unsafe</b>",
      outlook: "x",
      recommendedFocus: [],
    }).success,
    false,
  );
  assert.equal(
    dailyNarrativeSchema.safeParse({
      summary: "Makine emniyetli sınırlar içinde.",
      outlook: "Kesin bozulma bekleniyor.",
      recommendedFocus: ["İzleyin."],
    }).success,
    false,
  );
  for (const unsafe of [
    "Makine kesin olarak arızalanacak.",
    "Bu koşul güvenlidir ve üretici onaylıdır.",
    "Arıza kaçınılmaz görünüyor.",
  ])
    assert.equal(
      dailyNarrativeSchema.safeParse({
        summary: unsafe,
        outlook: "İzlemeye devam edin.",
        recommendedFocus: ["Kontrol planlayın."],
      }).success,
      false,
    );
});

test("autonomous day boundaries create reports and risk transition events", async () => {
  const data = new MockFactoryData();
  data.activateAutonomous(20260908);
  const factory = new FactoryService(data, forecast);
  const reports = new ReportService(
    factory,
    new DeterministicDailyAnalysisProvider(),
  );
  reports.reset(data.runId);
  reports.observe(await factory.getCurrentRisks(), data.now, 1);

  for (let step = 1; step <= 2 * 96; step++) {
    data.advance();
    if (step % 4 === 0) {
      factory.invalidate();
      reports.observe(await factory.getCurrentRisks(), data.now, data.day);
    }
    if (step % 96 === 0) {
      factory.invalidate();
      await reports.generateDaily(step / 96, data.now);
    }
  }

  assert.equal(reports.dailyReports().length, 2);
  const latest = reports.latest()!;
  assert.equal(latest.day, 2);
  assert.equal(latest.provider, "deterministic");
  assert.match(latest.summary, /2\. gün/);
  assert.ok(latest.criticalAssets.length > 0);
  assert.ok(
    reports.riskEvents().some((event) => event.toRisk !== "LOW"),
    "risk changes must be recorded independently of the LLM",
  );
});

test("risk-event history ignores short flapping around a threshold", async () => {
  const data = new MockFactoryData();
  data.activateAutonomous(20260908);
  const factory = new FactoryService(data, forecast);
  const reports = new ReportService(
    factory,
    new DeterministicDailyAnalysisProvider(),
  );
  reports.reset(data.runId);
  const baseline = await factory.getCurrentRisks();
  reports.observe(baseline, data.now, 1);
  const elevated = baseline.map((asset, index) =>
    index === 0 ? { ...asset, riskLevel: "MEDIUM" as const } : asset,
  );
  for (let index = 0; index < 3; index += 1)
    reports.observe(elevated, new Date(Date.parse(data.now) + index * 900_000).toISOString(), 1);
  reports.observe(baseline, new Date(Date.parse(data.now) + 3 * 900_000).toISOString(), 1);
  assert.equal(reports.riskEvents().length, 0);
  for (let index = 0; index < 4; index += 1)
    reports.observe(elevated, new Date(Date.parse(data.now) + (4 + index) * 900_000).toISOString(), 1);
  assert.equal(reports.riskEvents().length, 1);
});
