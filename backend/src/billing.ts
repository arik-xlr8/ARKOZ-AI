import { z } from "zod";
import { GeminiJsonClient } from "./gemini.js";
import {
  PythonForecastProvider,
  type ForecastProvider,
  type ForecastRequest,
} from "./forecast.js";

export interface BillingPoint {
  month: string;
  label: string;
  consumption: number;
  unitPrice: number;
  amount: number;
  lower?: number;
  upper?: number;
}

export interface BillingCategory {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
  unit: string;
  color: string;
  history: BillingPoint[];
  forecast: BillingPoint[];
  share: number;
  changePercent: number;
}

export interface BillingNarrative {
  provider: "gemini" | "deterministic";
  summary: string;
  keyDrivers: string[];
  recommendedActions: string[];
  fallbackReason?: string;
}

export interface BillingForecast {
  seed: number;
  currency: "TRY";
  generatedAt: string;
  model: string;
  forecastFallbackReason?: string;
  historyMonths: number;
  modelContextMonths: number;
  forecastMonths: number;
  categories: BillingCategory[];
  historyTotals: BillingPoint[];
  outlook: BillingPoint[];
  lastMonthTotal: number;
  nextMonthTotal: number;
  nextMonthLower: number;
  nextMonthUpper: number;
  changePercent: number;
  averageMonthlyTotal: number;
  electricityShare: number;
  annualEstimate: number;
  analysis: BillingNarrative;
}

export const billingScenarioAdjustmentsSchema = z
  .object({
    electricity: z.number().finite().min(-100).max(500),
    fuel: z.number().finite().min(-100).max(500),
    "raw-material": z.number().finite().min(-100).max(500),
    water: z.number().finite().min(-100).max(500),
  })
  .strict();

export type BillingScenarioAdjustments = z.infer<
  typeof billingScenarioAdjustmentsSchema
>;

export interface BillingScenarioPoint {
  month: string;
  label: string;
  consumption: number;
  baselineUnitPrice: number;
  scenarioUnitPrice: number;
  baselineAmount: number;
  scenarioAmount: number;
  difference: number;
}

export interface BillingScenarioCategory {
  id: keyof BillingScenarioAdjustments;
  label: string;
  shortLabel: string;
  icon: string;
  unit: string;
  color: string;
  adjustmentPercent: number;
  baselineTotal: number;
  scenarioTotal: number;
  difference: number;
  points: BillingScenarioPoint[];
}

export interface BillingScenarioTotalPoint {
  month: string;
  label: string;
  baselineAmount: number;
  scenarioAmount: number;
  difference: number;
}

export interface BillingScenario {
  seed: number;
  currency: "TRY";
  month: string;
  label: string;
  model: string;
  forecastMonths: number;
  baselineTotal: number;
  scenarioTotal: number;
  difference: number;
  changePercent: number;
  categories: BillingScenarioCategory[];
  outlook: BillingScenarioTotalPoint[];
  analysis: BillingNarrative;
}

interface CategoryConfig {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
  unit: string;
  color: string;
  baseConsumption: number;
  baseUnitPrice: number;
  noise: number;
  uncertainty: number;
  seasonal: (month: number) => number;
}

interface BillingEvidence extends Omit<BillingForecast, "analysis"> {}

export interface BillingAnalysisProvider {
  analyze(evidence: BillingEvidence): Promise<BillingNarrative>;
}

export interface BillingScenarioAnalysisProvider {
  analyze(
    scenario: Omit<BillingScenario, "analysis">,
  ): Promise<BillingNarrative>;
}

const visibleHistoryMonths = 18;
const modelContextMonths = 48;
const forecastMonths = 6;
const modelIntervalMs = 30 * 24 * 60 * 60 * 1_000;

const categories: CategoryConfig[] = [
  {
    id: "electricity",
    label: "Elektrik",
    shortLabel: "Elektrik",
    icon: "fa-solid fa-bolt",
    unit: "kWh",
    color: "#e0002a",
    baseConsumption: 4_800_000,
    baseUnitPrice: 3.15,
    noise: 0.055,
    uncertainty: 0.075,
    seasonal: (month) => 1 + 0.055 * Math.cos(((month - 1) / 12) * Math.PI * 2),
  },
  {
    id: "fuel",
    label: "Doğal gaz ve yakıt",
    shortLabel: "Gaz / yakıt",
    icon: "fa-solid fa-fire-flame-curved",
    unit: "Sm³",
    color: "#c45d22",
    baseConsumption: 620_000,
    baseUnitPrice: 14.8,
    noise: 0.07,
    uncertainty: 0.095,
    seasonal: (month) => 1 + 0.11 * Math.cos(((month - 1) / 12) * Math.PI * 2),
  },
  {
    id: "raw-material",
    label: "Hammadde ve katkı",
    shortLabel: "Hammadde",
    icon: "fa-solid fa-mountain",
    unit: "ton",
    color: "#53565d",
    baseConsumption: 13_000,
    baseUnitPrice: 740,
    noise: 0.065,
    uncertainty: 0.085,
    seasonal: (month) => 1 + 0.035 * Math.sin(((month + 1) / 12) * Math.PI * 2),
  },
  {
    id: "water",
    label: "Su",
    shortLabel: "Su",
    icon: "fa-solid fa-droplet",
    unit: "m³",
    color: "#347e9f",
    baseConsumption: 58_000,
    baseUnitPrice: 32,
    noise: 0.045,
    uncertainty: 0.065,
    seasonal: (month) => 1 + 0.07 * Math.sin(((month - 2) / 12) * Math.PI * 2),
  },
];

const round = (value: number, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const bounded = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function monthDate(reference: Date, offset: number) {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + offset, 1),
  );
}

function monthPoint(date: Date) {
  return {
    month: date.toISOString().slice(0, 7),
    label: new Intl.DateTimeFormat("tr-TR", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    })
      .format(date)
      .replace(".", ""),
  };
}

function categoryHistory(
  config: CategoryConfig,
  reference: Date,
  random: () => number,
) {
  return Array.from(
    { length: modelContextMonths },
    (_, index): BillingPoint => {
      const date = monthDate(reference, index - modelContextMonths);
      const productionLoad =
        0.93 +
        index * 0.0022 +
        0.035 * Math.sin(((date.getUTCMonth() + 3) / 12) * Math.PI * 2);
      const consumptionNoise = 1 + (random() - 0.5) * 2 * config.noise;
      const consumption = Math.max(
        0,
        config.baseConsumption *
          productionLoad *
          config.seasonal(date.getUTCMonth()) *
          consumptionNoise,
      );
      const unitPrice =
        config.baseUnitPrice *
        0.55 *
        1.0125 ** index *
        (1 + (random() - 0.5) * 0.018);
      return {
        ...monthPoint(date),
        consumption: round(consumption, config.id === "raw-material" ? 1 : 0),
        unitPrice: round(unitPrice, 3),
        amount: round(consumption * unitPrice),
      };
    },
  );
}

function regularModelSeries(values: number[]) {
  const start = Date.UTC(2022, 0, 1);
  return values.map((value, index) => ({
    timestamp: new Date(start + index * modelIntervalMs).toISOString(),
    value,
  }));
}

async function forecastMany(
  provider: ForecastProvider,
  requests: ForecastRequest[],
) {
  if (provider.forecastMany) return provider.forecastMany(requests);
  return Promise.all(
    requests.map((request) =>
      provider.forecast(
        request.machineId,
        request.metric,
        request.history,
        request.horizon,
      ),
    ),
  );
}

const narrativeText = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => !/<[^>]*>/.test(value), "HTML is not allowed");
const qualitativeNarrativeText = narrativeText.refine(
  (value) => !/[\d%₺]/u.test(value),
  "Numerical claims are assembled from verified evidence",
);
const summaryNarrativeText = qualitativeNarrativeText.refine(
  (value) =>
    !/(?:artış|artma|artan|azalış|azalma|azalan|düşüş|düşen|yükseliş|yükselen|elektrik|yakıt|doğal gaz|hammadde|\bsu\b)/iu.test(
      value,
    ),
  "Category and direction claims are assembled from verified evidence",
);

export const billingNarrativeSchema = z
  .object({
    summary: summaryNarrativeText,
    driverCategoryIds: z
      .array(z.enum(["electricity", "fuel", "raw-material", "water"]))
      .min(1)
      .max(4)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Drivers must be unique",
      ),
    recommendedActions: z
      .array(qualitativeNarrativeText.max(500))
      .min(1)
      .max(4),
  })
  .strict();

export const billingScenarioNarrativeSchema = z
  .object({
    summary: qualitativeNarrativeText.max(900),
    focusCategoryIds: z
      .array(z.enum(["electricity", "fuel", "raw-material", "water"]))
      .min(1)
      .max(4)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Focus categories must be unique",
      ),
    recommendedActions: z
      .array(qualitativeNarrativeText.max(500))
      .min(1)
      .max(4),
  })
  .strict();

export class DeterministicBillingAnalysisProvider implements BillingAnalysisProvider {
  async analyze(evidence: BillingEvidence): Promise<BillingNarrative> {
    const notable = [...evidence.categories].sort(
      (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent),
    )[0];
    const direction = evidence.changePercent >= 0 ? "artış" : "azalış";
    return {
      provider: "deterministic",
      summary: `${evidence.outlook[0].label} toplam gideri ${Math.round(evidence.nextMonthTotal).toLocaleString("tr-TR")} ₺ olarak öngörülüyor; bu değer önceki aya göre %${Math.abs(evidence.changePercent).toLocaleString("tr-TR")} ${direction} anlamına geliyor.`,
      keyDrivers: [
        `Elektriğin tahmini toplam içindeki payı %${evidence.electricityShare.toLocaleString("tr-TR")}.`,
        `${notable.label} kalemindeki aylık değişim %${notable.changePercent.toLocaleString("tr-TR")}.`,
      ],
      recommendedActions: [
        "Tahmin aralığını bütçe planında alt ve üst senaryo olarak değerlendirin.",
        "Tüketim ve birim fiyat varsayımlarını dönem kapanmadan satın alma kayıtlarıyla doğrulayın.",
      ],
    };
  }
}

export class GeminiBillingAnalysisProvider implements BillingAnalysisProvider {
  private fallback = new DeterministicBillingAnalysisProvider();
  private client: GeminiJsonClient;

  constructor(key: string) {
    this.client = new GeminiJsonClient(key);
  }

  async analyze(evidence: BillingEvidence): Promise<BillingNarrative> {
    try {
      const result = await this.client.generate(
        billingNarrativeSchema,
        "You interpret a cement plant's simulated monthly cost forecast. Write every user-facing string in concise Turkish. Treat supplied TimesFM evidence as authoritative. Do not write any digits, percentages, currency symbols, amounts, units, dates, or numeric claims; the application adds verified numbers separately. In summary, do not name an expense category and do not describe an increase, decrease, rise, or fall; explain only how the forecast should be interpreted. Select important expense categories only through driverCategoryIds. In recommendedActions, suggest evidence-based review or budgeting actions without asserting causes. Never invent a tariff, invoice, production event, saving, contract term, or causal claim. Clearly treat the result as a forecast rather than a certain bill. No HTML.",
        {
          period: evidence.outlook[0].month,
          currency: evidence.currency,
          forecastModel: evidence.model,
          forecastFallbackReason: evidence.forecastFallbackReason,
          previousTotal: evidence.lastMonthTotal,
          predictedTotal: evidence.nextMonthTotal,
          predictedRange: {
            lower: evidence.nextMonthLower,
            upper: evidence.nextMonthUpper,
          },
          monthlyChangePercent: evidence.changePercent,
          annualEstimate: evidence.annualEstimate,
          categories: evidence.categories.map((category) => ({
            name: category.label,
            unit: category.unit,
            predictedConsumption: category.forecast[0].consumption,
            predictedUnitPrice: category.forecast[0].unitPrice,
            predictedAmount: category.forecast[0].amount,
            sharePercent: category.share,
            monthlyChangePercent: category.changePercent,
          })),
          sixMonthOutlook: evidence.outlook.map((point) => ({
            month: point.month,
            amount: point.amount,
            lower: point.lower,
            upper: point.upper,
          })),
        },
        Math.max(
          1_000,
          Number(process.env.GEMINI_BILLING_TIMEOUT_MS ?? 25_000),
        ),
      );
      const changeDirection = evidence.changePercent >= 0 ? "artış" : "azalış";
      const verifiedSummary = `${evidence.outlook[0].label} toplam gideri ${Math.round(evidence.nextMonthTotal).toLocaleString("tr-TR")} ₺ olarak öngörülüyor; önceki aya göre %${Math.abs(evidence.changePercent).toLocaleString("tr-TR")} ${changeDirection} bekleniyor. Tahmin aralığı ${Math.round(evidence.nextMonthLower).toLocaleString("tr-TR")}–${Math.round(evidence.nextMonthUpper).toLocaleString("tr-TR")} ₺. ${result.summary}`;
      const byId = new Map(
        evidence.categories.map((category) => [category.id, category]),
      );
      const keyDrivers = result.driverCategoryIds.map((id) => {
        const category = byId.get(id)!;
        const direction = category.changePercent >= 0 ? "artış" : "azalış";
        return `${category.label}: toplam gider içinde %${category.share.toLocaleString("tr-TR")} pay; önceki aya göre %${Math.abs(category.changePercent).toLocaleString("tr-TR")} ${direction}.`;
      });
      return {
        provider: "gemini",
        summary: verifiedSummary,
        keyDrivers,
        recommendedActions: result.recommendedActions,
      };
    } catch (error) {
      console.warn(
        "Gemini billing analysis unavailable or invalid:",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      );
      return {
        ...(await this.fallback.analyze(evidence)),
        fallbackReason:
          "Gemini fatura yorumu alınamadı veya doğrulanamadı; kural tabanlı açıklama kullanılıyor.",
      };
    }
  }
}

const createBillingAnalysisProvider = (): BillingAnalysisProvider =>
  process.env.GEMINI_API_KEY
    ? new GeminiBillingAnalysisProvider(process.env.GEMINI_API_KEY)
    : new DeterministicBillingAnalysisProvider();

export class DeterministicBillingScenarioAnalysisProvider implements BillingScenarioAnalysisProvider {
  async analyze(
    scenario: Omit<BillingScenario, "analysis">,
  ): Promise<BillingNarrative> {
    const changed = scenario.categories
      .filter((category) => category.adjustmentPercent !== 0)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    const direction =
      scenario.difference > 0
        ? "artırıyor"
        : scenario.difference < 0
          ? "azaltıyor"
          : "değiştirmiyor";
    const keyDrivers = changed.length
      ? changed.map((category) => {
          const assumption = category.adjustmentPercent > 0 ? "zam" : "indirim";
          const categoryDirection =
            category.difference >= 0 ? "artış" : "azalış";
          return `${category.label}: %${Math.abs(category.adjustmentPercent).toLocaleString("tr-TR")} ${assumption} varsayımı, ${Math.abs(category.difference).toLocaleString("tr-TR")} ₺ ${categoryDirection} etkisi oluşturdu.`;
        })
      : [
          "Birim fiyat varsayımları değiştirilmedi; senaryo baz tahminle aynı kaldı.",
        ];
    return {
      provider: "deterministic",
      summary: `${scenario.label} senaryosu altı aylık ${Math.round(scenario.scenarioTotal).toLocaleString("tr-TR")} ₺ toplam gider gösteriyor. Bu değer TimesFM baz tahminini ${Math.abs(Math.round(scenario.difference)).toLocaleString("tr-TR")} ₺ ${direction}.`,
      keyDrivers,
      recommendedActions: [
        "Birim fiyat varsayımlarını güncel tarife ve tedarikçi teklifleriyle karşılaştırın.",
        "Senaryo farkını gelecek dönem bütçesinde risk payı olarak değerlendirin.",
      ],
    };
  }
}

export class GeminiBillingScenarioAnalysisProvider implements BillingScenarioAnalysisProvider {
  private fallback = new DeterministicBillingScenarioAnalysisProvider();
  private client: GeminiJsonClient;

  constructor(key: string) {
    this.client = new GeminiJsonClient(key);
  }

  async analyze(
    scenario: Omit<BillingScenario, "analysis">,
  ): Promise<BillingNarrative> {
    try {
      const result = await this.client.generate(
        billingScenarioNarrativeSchema,
        "You interpret a six-month what-if cost scenario built on a cement plant's TimesFM forecast. Each entered adjustment is a one-time unit-price shift in the first forecast month; later scenario prices carry that adjusted value forward using TimesFM's month-to-month price trend. Write every user-facing string in concise Turkish. Treat every supplied number as authoritative. Do not write digits, percentages, currency symbols, amounts, units, or dates; the application adds verified numerical claims. Do not invent tariffs, contracts, production events, causes, or savings. Explain the budget meaning of the assumptions and suggest checks. Select relevant categories only through focusCategoryIds. Clearly describe this as a scenario, not a certain future bill. No HTML.",
        {
          period: {
            start: scenario.month,
            label: scenario.label,
            months: scenario.forecastMonths,
          },
          currency: scenario.currency,
          forecastModel: scenario.model,
          baselineTotal: scenario.baselineTotal,
          scenarioTotal: scenario.scenarioTotal,
          difference: scenario.difference,
          changePercent: scenario.changePercent,
          categories: scenario.categories.map((category) => ({
            id: category.id,
            name: category.label,
            unit: category.unit,
            unitPriceAdjustmentPercent: category.adjustmentPercent,
            baselineTotal: category.baselineTotal,
            scenarioTotal: category.scenarioTotal,
            difference: category.difference,
            months: category.points.map((point) => ({
              month: point.month,
              predictedConsumption: point.consumption,
              baselineUnitPrice: point.baselineUnitPrice,
              assumedUnitPrice: point.scenarioUnitPrice,
              baselineAmount: point.baselineAmount,
              scenarioAmount: point.scenarioAmount,
              difference: point.difference,
            })),
          })),
          sixMonthOutlook: scenario.outlook,
        },
        Math.max(
          1_000,
          Number(process.env.GEMINI_BILLING_TIMEOUT_MS ?? 25_000),
        ),
      );
      const direction =
        scenario.difference > 0
          ? "artırıyor"
          : scenario.difference < 0
            ? "azaltıyor"
            : "değiştirmiyor";
      const byId = new Map(
        scenario.categories.map((category) => [category.id, category]),
      );
      const changedIds = new Set(
        scenario.categories
          .filter((category) => category.adjustmentPercent !== 0)
          .map((category) => category.id),
      );
      const focusIds = result.focusCategoryIds.filter((id) =>
        changedIds.has(id),
      );
      const verifiedImpact =
        scenario.difference === 0
          ? "Girilen varsayımlar TimesFM baz tahminini değiştirmiyor."
          : `Girilen varsayımlar toplamı ${Math.abs(Math.round(scenario.difference)).toLocaleString("tr-TR")} ₺, yani %${Math.abs(scenario.changePercent).toLocaleString("tr-TR")} ${direction}.`;
      return {
        provider: "gemini",
        summary: `${scenario.label} senaryosu altı aylık ${Math.round(scenario.scenarioTotal).toLocaleString("tr-TR")} ₺ toplam gider gösteriyor. TimesFM baz tahmini ${Math.round(scenario.baselineTotal).toLocaleString("tr-TR")} ₺. ${verifiedImpact} ${result.summary}`,
        keyDrivers: changedIds.size
          ? (focusIds.length ? focusIds : [...changedIds].slice(0, 2)).map(
              (id) => {
                const category = byId.get(id)!;
                const assumption =
                  category.adjustmentPercent > 0 ? "zam" : "indirim";
                const categoryDirection =
                  category.difference >= 0 ? "artış" : "azalış";
                return `${category.label}: %${Math.abs(category.adjustmentPercent).toLocaleString("tr-TR")} ${assumption} varsayımı, ${Math.abs(category.difference).toLocaleString("tr-TR")} ₺ ${categoryDirection} etkisi.`;
              },
            )
          : [
              "Birim fiyat varsayımları değiştirilmedi; senaryo baz tahminle aynı kaldı.",
            ],
        recommendedActions: result.recommendedActions,
      };
    } catch (error) {
      console.warn(
        "Gemini billing scenario analysis unavailable or invalid:",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      );
      return {
        ...(await this.fallback.analyze(scenario)),
        fallbackReason:
          "Gemini senaryo yorumu alınamadı veya doğrulanamadı; kural tabanlı açıklama kullanılıyor.",
      };
    }
  }
}

const createBillingScenarioAnalysisProvider =
  (): BillingScenarioAnalysisProvider =>
    process.env.GEMINI_API_KEY
      ? new GeminiBillingScenarioAnalysisProvider(process.env.GEMINI_API_KEY)
      : new DeterministicBillingScenarioAnalysisProvider();

export class BillingService {
  constructor(
    private forecaster: ForecastProvider = new PythonForecastProvider(),
    private analyst: BillingAnalysisProvider = createBillingAnalysisProvider(),
    private scenarioAnalyst: BillingScenarioAnalysisProvider = createBillingScenarioAnalysisProvider(),
  ) {}

  async scenario(
    forecast: BillingForecast,
    rawAdjustments: BillingScenarioAdjustments,
  ): Promise<BillingScenario> {
    const adjustments = billingScenarioAdjustmentsSchema.parse(rawAdjustments);
    const scenarioCategories: BillingScenarioCategory[] =
      forecast.categories.map((category) => {
        const id = category.id as keyof BillingScenarioAdjustments;
        const adjustmentPercent = adjustments[id];
        let previousBaselineUnitPrice = category.forecast[0].unitPrice;
        let previousScenarioUnitPrice = round(
          previousBaselineUnitPrice * (1 + adjustmentPercent / 100),
          3,
        );
        const points = category.forecast.map(
          (baseline, index): BillingScenarioPoint => {
            const priceTrend =
              index === 0 ? 1 : baseline.unitPrice / previousBaselineUnitPrice;
            const scenarioUnitPrice =
              index === 0
                ? previousScenarioUnitPrice
                : round(previousScenarioUnitPrice * priceTrend, 3);
            const scenarioAmount = round(
              baseline.consumption * scenarioUnitPrice,
            );
            previousBaselineUnitPrice = baseline.unitPrice;
            previousScenarioUnitPrice = scenarioUnitPrice;
            return {
              month: baseline.month,
              label: baseline.label,
              consumption: baseline.consumption,
              baselineUnitPrice: baseline.unitPrice,
              scenarioUnitPrice,
              baselineAmount: baseline.amount,
              scenarioAmount,
              difference: scenarioAmount - baseline.amount,
            };
          },
        );
        const baselineTotal = points.reduce(
          (sum, point) => sum + point.baselineAmount,
          0,
        );
        const scenarioTotal = points.reduce(
          (sum, point) => sum + point.scenarioAmount,
          0,
        );
        return {
          id,
          label: category.label,
          shortLabel: category.shortLabel,
          icon: category.icon,
          unit: category.unit,
          color: category.color,
          adjustmentPercent,
          baselineTotal,
          scenarioTotal,
          difference: scenarioTotal - baselineTotal,
          points,
        };
      });
    const outlook = forecast.outlook.map(
      (baseline, index): BillingScenarioTotalPoint => {
        const scenarioAmount = scenarioCategories.reduce(
          (sum, category) => sum + category.points[index].scenarioAmount,
          0,
        );
        return {
          month: baseline.month,
          label: baseline.label,
          baselineAmount: baseline.amount,
          scenarioAmount,
          difference: scenarioAmount - baseline.amount,
        };
      },
    );
    const baselineTotal = outlook.reduce(
      (sum, point) => sum + point.baselineAmount,
      0,
    );
    const scenarioTotal = scenarioCategories.reduce(
      (sum, category) => sum + category.scenarioTotal,
      0,
    );
    const withoutAnalysis = {
      seed: forecast.seed,
      currency: forecast.currency,
      month: forecast.outlook[0].month,
      label: `${forecast.outlook[0].label} – ${forecast.outlook.at(-1)!.label}`,
      model: forecast.model,
      forecastMonths: forecast.outlook.length,
      baselineTotal,
      scenarioTotal,
      difference: scenarioTotal - baselineTotal,
      changePercent: round((scenarioTotal / baselineTotal - 1) * 100, 1),
      categories: scenarioCategories,
      outlook,
    } satisfies Omit<BillingScenario, "analysis">;
    return {
      ...withoutAnalysis,
      analysis: await this.scenarioAnalyst.analyze(withoutAnalysis),
    };
  }

  async forecast(
    seed: number,
    referenceTimestamp: string,
  ): Promise<BillingForecast> {
    const referenceValue = new Date(referenceTimestamp);
    if (Number.isNaN(referenceValue.getTime()))
      throw new Error("Geçersiz fatura referans tarihi");
    const reference = new Date(
      Date.UTC(
        referenceValue.getUTCFullYear(),
        referenceValue.getUTCMonth(),
        1,
      ),
    );
    const random = mulberry32(seed);
    const historyByCategory = categories.map((config) => ({
      config,
      history: categoryHistory(config, reference, random),
    }));
    const requests = historyByCategory.flatMap(({ config, history }) => [
      {
        machineId: `billing:${config.id}`,
        metric: "consumption",
        history: regularModelSeries(history.map((point) => point.consumption)),
        horizon: forecastMonths,
      },
      {
        machineId: `billing:${config.id}`,
        metric: "unit-price",
        history: regularModelSeries(history.map((point) => point.unitPrice)),
        horizon: forecastMonths,
      },
    ]);
    const modelForecasts = await forecastMany(this.forecaster, requests);
    const generated = historyByCategory.map(
      ({ config, history }, categoryIndex) => {
        const consumptionForecast = modelForecasts[categoryIndex * 2];
        const priceForecast = modelForecasts[categoryIndex * 2 + 1];
        const last = history.at(-1)!;
        const forecast = Array.from(
          { length: forecastMonths },
          (_, index): BillingPoint => {
            const date = monthDate(reference, index);
            const consumption = round(
              bounded(
                consumptionForecast.forecast[index].value,
                last.consumption * 0.45,
                last.consumption * 1.7,
              ),
              config.id === "raw-material" ? 1 : 0,
            );
            const unitPrice = round(
              bounded(
                priceForecast.forecast[index].value,
                last.unitPrice * 0.5,
                last.unitPrice * 2,
              ),
              3,
            );
            const amount = round(consumption * unitPrice);
            const interval = config.uncertainty * Math.sqrt(index + 1);
            return {
              ...monthPoint(date),
              consumption,
              unitPrice,
              amount,
              lower: round(amount * (1 - interval)),
              upper: round(amount * (1 + interval)),
            };
          },
        );
        return { config, history, forecast };
      },
    );
    const visibleHistory = generated.map((category) => ({
      ...category,
      history: category.history.slice(-visibleHistoryMonths),
    }));
    const historyTotals = Array.from(
      { length: visibleHistoryMonths },
      (_, index): BillingPoint => ({
        ...monthPoint(monthDate(reference, index - visibleHistoryMonths)),
        consumption: 0,
        unitPrice: 0,
        amount: visibleHistory.reduce(
          (sum, category) => sum + category.history[index].amount,
          0,
        ),
      }),
    );
    const outlook = Array.from(
      { length: forecastMonths },
      (_, index): BillingPoint => ({
        ...monthPoint(monthDate(reference, index)),
        consumption: 0,
        unitPrice: 0,
        amount: generated.reduce(
          (sum, category) => sum + category.forecast[index].amount,
          0,
        ),
        lower: generated.reduce(
          (sum, category) => sum + category.forecast[index].lower!,
          0,
        ),
        upper: generated.reduce(
          (sum, category) => sum + category.forecast[index].upper!,
          0,
        ),
      }),
    );
    const lastMonthTotal = historyTotals.at(-1)!.amount;
    const nextMonthTotal = outlook[0].amount;
    const responseCategories: BillingCategory[] = visibleHistory.map(
      ({ config, history, forecast }) => ({
        id: config.id,
        label: config.label,
        shortLabel: config.shortLabel,
        icon: config.icon,
        unit: config.unit,
        color: config.color,
        history,
        forecast,
        share: round((forecast[0].amount / nextMonthTotal) * 100, 1),
        changePercent: round(
          (forecast[0].amount / history.at(-1)!.amount - 1) * 100,
          1,
        ),
      }),
    );
    const modelNames = [...new Set(modelForecasts.map((item) => item.model))];
    const fallbackReasons = [
      ...new Set(
        modelForecasts
          .map((item) => item.fallbackReason)
          .filter((reason): reason is string => !!reason),
      ),
    ];
    const evidence: BillingEvidence = {
      seed,
      currency: "TRY",
      generatedAt: reference.toISOString(),
      model: modelNames.join(" + "),
      forecastFallbackReason: fallbackReasons.length
        ? fallbackReasons.join("; ")
        : undefined,
      historyMonths: visibleHistoryMonths,
      modelContextMonths,
      forecastMonths,
      categories: responseCategories,
      historyTotals,
      outlook,
      lastMonthTotal,
      nextMonthTotal,
      nextMonthLower: outlook[0].lower!,
      nextMonthUpper: outlook[0].upper!,
      changePercent: round((nextMonthTotal / lastMonthTotal - 1) * 100, 1),
      averageMonthlyTotal: round(
        mean(historyTotals.slice(-12).map((point) => point.amount)),
      ),
      electricityShare:
        responseCategories.find((category) => category.id === "electricity")
          ?.share ?? 0,
      annualEstimate: round(
        outlook.reduce((sum, point) => sum + point.amount, 0) * 2,
      ),
    };
    return { ...evidence, analysis: await this.analyst.analyze(evidence) };
  }
}
