import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BillingService,
  billingNarrativeSchema,
  billingScenarioNarrativeSchema,
  type BillingAnalysisProvider,
  type BillingScenarioAnalysisProvider,
} from "../src/billing.js";
import type { ForecastProvider, ForecastRequest } from "../src/forecast.js";

const captured: ForecastRequest[][] = [];
const timesFm: ForecastProvider = {
  async forecast(machineId, metric, history, horizon) {
    const last = history.at(-1)!;
    const interval =
      Date.parse(last.timestamp) - Date.parse(history.at(-2)!.timestamp);
    return {
      machineId,
      metric,
      model: "timesfm-2.5",
      forecast: Array.from({ length: horizon }, (_, index) => ({
        timestamp: new Date(
          Date.parse(last.timestamp) + interval * (index + 1),
        ).toISOString(),
        value: last.value * (1 + (index + 1) * 0.006),
      })),
    };
  },
  async forecastMany(requests) {
    captured.push(requests);
    return Promise.all(
      requests.map((request) =>
        this.forecast(
          request.machineId,
          request.metric,
          request.history,
          request.horizon,
        ),
      ),
    );
  },
};

const gemini: BillingAnalysisProvider = {
  async analyze(evidence) {
    return {
      provider: "gemini",
      summary: `${evidence.outlook[0].label} TimesFM tahmini yorumlandı.`,
      keyDrivers: ["Elektrik gider payı değerlendirildi."],
      recommendedActions: ["Bütçe aralığını kontrol edin."],
    };
  },
};

const scenarioGemini: BillingScenarioAnalysisProvider = {
  async analyze(scenario) {
    return {
      provider: "gemini",
      summary: `${scenario.label} doğrulanmış senaryo yorumu.`,
      keyDrivers: ["Birim fiyat etkileri değerlendirildi."],
      recommendedActions: ["Tarife varsayımlarını kontrol edin."],
    };
  },
};

test("billing sends seeded consumption and unit-price series to TimesFM", async () => {
  captured.length = 0;
  const service = new BillingService(timesFm, gemini);
  const reference = "2026-09-08T16:15:00.000Z";
  const first = await service.forecast(20260908, reference);
  const repeated = await service.forecast(20260908, reference);
  const changed = await service.forecast(20260909, reference);

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first.historyTotals, changed.historyTotals);
  assert.equal(first.historyTotals.length, 18);
  assert.equal(first.modelContextMonths, 48);
  assert.equal(first.outlook.length, 6);
  assert.equal(first.categories.length, 4);
  assert.equal(first.outlook[0].month, "2026-09");
  assert.equal(first.model, "timesfm-2.5");
  assert.equal(first.analysis.provider, "gemini");

  const requests = captured[0];
  assert.equal(requests.length, 8);
  assert.ok(requests.every((request) => request.history.length === 48));
  assert.ok(requests.every((request) => request.horizon === 6));
  assert.deepEqual(
    new Set(requests.map((request) => request.metric)),
    new Set(["consumption", "unit-price"]),
  );
  const intervals = requests[0].history
    .slice(1)
    .map(
      (point, index) =>
        Date.parse(point.timestamp) -
        Date.parse(requests[0].history[index].timestamp),
    );
  assert.equal(new Set(intervals).size, 1);
});

test("TimesFM billing outputs reconcile and expose a bounded interval", async () => {
  const result = await new BillingService(timesFm, gemini).forecast(
    424242,
    "2026-09-08T16:15:00.000Z",
  );
  result.historyTotals.forEach((total, index) =>
    assert.equal(
      total.amount,
      result.categories.reduce(
        (sum, category) => sum + category.history[index].amount,
        0,
      ),
    ),
  );
  result.outlook.forEach((total, index) =>
    assert.equal(
      total.amount,
      result.categories.reduce(
        (sum, category) => sum + category.forecast[index].amount,
        0,
      ),
    ),
  );
  assert.ok(result.nextMonthLower < result.nextMonthTotal);
  assert.ok(result.nextMonthUpper > result.nextMonthTotal);
  assert.ok(result.electricityShare > 30);
  assert.ok(result.electricityShare < 60);
  assert.ok(result.annualEstimate > result.nextMonthTotal * 10);
});

test("Gemini billing schema rejects unverified numerical claims", () => {
  assert.throws(() =>
    billingNarrativeSchema.parse({
      summary: "Elektrik gideri %12 artacak.",
      driverCategoryIds: ["electricity"],
      recommendedActions: ["Tarifeyi kontrol edin."],
    }),
  );
  assert.doesNotThrow(() =>
    billingNarrativeSchema.parse({
      summary:
        "Tahmin bütçe planında belirsizlik aralığıyla değerlendirilmelidir.",
      driverCategoryIds: ["electricity", "fuel"],
      recommendedActions: ["Tarife varsayımlarını kontrol edin."],
    }),
  );
});

test("billing scenario applies signed unit-price assumptions to the TimesFM baseline", async () => {
  const service = new BillingService(timesFm, gemini, scenarioGemini);
  const forecast = await service.forecast(424242, "2026-09-08T16:15:00.000Z");
  const result = await service.scenario(forecast, {
    electricity: 20,
    fuel: -10,
    "raw-material": 0,
    water: 5,
  });

  assert.equal(result.model, "timesfm-2.5");
  assert.equal(result.month, forecast.outlook[0].month);
  assert.equal(result.forecastMonths, 6);
  assert.equal(result.outlook.length, 6);
  assert.equal(
    result.baselineTotal,
    forecast.outlook.reduce((sum, point) => sum + point.amount, 0),
  );
  assert.equal(result.analysis.provider, "gemini");
  assert.equal(
    result.scenarioTotal,
    result.categories.reduce(
      (sum, category) => sum + category.scenarioTotal,
      0,
    ),
  );
  assert.equal(result.difference, result.scenarioTotal - result.baselineTotal);

  const electricity = result.categories.find(
    (category) => category.id === "electricity",
  )!;
  const fuel = result.categories.find((category) => category.id === "fuel")!;
  const rawMaterial = result.categories.find(
    (category) => category.id === "raw-material",
  )!;
  assert.equal(electricity.adjustmentPercent, 20);
  assert.equal(electricity.points.length, 6);
  assert.equal(
    electricity.points[0].scenarioUnitPrice,
    Math.round(electricity.points[0].baselineUnitPrice * 1.2 * 1_000) / 1_000,
  );
  assert.ok(electricity.scenarioTotal > electricity.baselineTotal);
  assert.ok(fuel.scenarioTotal < fuel.baselineTotal);
  assert.equal(rawMaterial.scenarioTotal, rawMaterial.baselineTotal);
  electricity.points.slice(1).forEach((point, index) => {
    const previous = electricity.points[index];
    const baselineTrend = point.baselineUnitPrice / previous.baselineUnitPrice;
    assert.equal(
      point.scenarioUnitPrice,
      Math.round(previous.scenarioUnitPrice * baselineTrend * 1_000) / 1_000,
    );
  });
  result.outlook.forEach((point, index) =>
    assert.equal(
      point.scenarioAmount,
      result.categories.reduce(
        (sum, category) => sum + category.points[index].scenarioAmount,
        0,
      ),
    ),
  );
});

test("Gemini billing scenario schema rejects numerical claims", () => {
  assert.throws(() =>
    billingScenarioNarrativeSchema.parse({
      summary: "Elektrik senaryosu %20 artış gösteriyor.",
      focusCategoryIds: ["electricity"],
      recommendedActions: ["Tarifeyi kontrol edin."],
    }),
  );
  assert.doesNotThrow(() =>
    billingScenarioNarrativeSchema.parse({
      summary: "Bu varsayım bütçe esnekliği açısından izlenmelidir.",
      focusCategoryIds: ["electricity", "fuel"],
      recommendedActions: ["Tedarikçi tekliflerini karşılaştırın."],
    }),
  );
});
