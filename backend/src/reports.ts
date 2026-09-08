import { z } from "zod";
import { GeminiJsonClient, isAllowedAdvisoryText } from "./gemini.js";
import { tr, formatNumber as n } from "./locale.js";
import { PROCESS_LINKS } from "./autonomous.js";
import { rank } from "./risk.js";
import type { FactoryService } from "./factory.js";
import type {
  Asset,
  DailyReport,
  ReportAsset,
  RiskEventReport,
  RiskLevel,
} from "./domain.js";

const reportText = z
  .string()
  .min(1)
  .max(3000)
  .refine((value) => !/<[^>]*>/.test(value), "HTML is not allowed")
  .refine(
    isAllowedAdvisoryText,
    "Failure certainty and safety certification are not allowed",
  );

export const dailyNarrativeSchema = z
  .object({
    summary: reportText,
    outlook: reportText,
    recommendedFocus: z.array(reportText.max(500)).min(1).max(6),
  })
  .strict();

type DailyNarrative = z.infer<typeof dailyNarrativeSchema> & {
  provider: string;
  fallbackReason?: string;
};

interface DailyEvidence {
  day: number;
  timestamp: string;
  plantHealth: number;
  assets: {
    machineId: string;
    machine: string;
    riskLevel: RiskLevel;
    healthScore: number;
    signals: {
      label: string;
      unit: string;
      current: number;
      baseline: number;
      change24h: number;
      ratePerHour: number;
      forecast24hPeak: number;
      warning: number;
      critical: number;
      currentlyAboveWarning: boolean;
      predictedThresholdCrossing: string | null;
      model: string;
    }[];
  }[];
  recentRiskEvents: RiskEventReport[];
  processLinks: { from: string; to: string }[];
}

export interface DailyAnalysisProvider {
  analyze(evidence: DailyEvidence): Promise<DailyNarrative>;
}

export const futureThresholdCrossing = (
  current: number,
  warning: number,
  forecast: { timestamp: string; value: number }[],
) =>
  current < warning
    ? (forecast.find((point) => point.value >= warning)?.timestamp ?? null)
    : null;

const focusFor = (asset: DailyEvidence["assets"][number]) => {
  const leading = [...asset.signals].sort((a, b) => {
    const aRatio = a.current / Math.max(a.warning, 0.01);
    const bRatio = b.current / Math.max(b.warning, 0.01);
    return bRatio - aRatio;
  })[0];
  if (!leading) return `${asset.machine} için rutin durum izlemeyi sürdürün.`;
  const inspection = leading.label.toLocaleLowerCase("tr-TR").includes("titreşim")
    ? "rulman, yağlama ve hizalama kontrolü"
    : leading.label.toLocaleLowerCase("tr-TR").includes("sıcak")
      ? "soğutma ve yağlama kontrolü"
      : leading.label.toLocaleLowerCase("tr-TR").includes("güç") ||
          leading.label.toLocaleLowerCase("tr-TR").includes("akım")
        ? "proses yükü ve tahrik kontrolü"
        : "sensör ve proses koşulu doğrulaması";
  return `${asset.machine}: ${leading.label} eğilimi için ${inspection} planlayın.`;
};

export class DeterministicDailyAnalysisProvider
  implements DailyAnalysisProvider
{
  async analyze(evidence: DailyEvidence): Promise<DailyNarrative> {
    const attention = evidence.assets.filter(
      (asset) => asset.riskLevel !== "LOW" || asset.signals.some((signal) => signal.predictedThresholdCrossing),
    );
    const high = evidence.assets.filter(
      (asset) => rank[asset.riskLevel] >= rank.HIGH,
    );
    const crossings = attention.flatMap((asset) =>
      asset.signals
        .filter((signal) => signal.predictedThresholdCrossing)
        .map((signal) => ({ asset, signal })),
    );
    return {
      provider: "deterministic",
      summary: attention.length
        ? `${evidence.day}. gün sonunda ${attention.length} ekipman inceleme gerektiriyor; ${high.length} ekipman yüksek veya kritik riskte. Fabrika sağlık puanı ${evidence.plantHealth}/100.`
        : `${evidence.day}. gün sonunda yükselmiş risk saptanmadı. Fabrika sağlık puanı ${evidence.plantHealth}/100 ve rutin izleme sürüyor.`,
      outlook: crossings.length
        ? crossings
            .slice(0, 4)
            .map(
              ({ asset, signal }) =>
                `${asset.machine} ${signal.label} için simüle uyarı eşiğinin ${new Date(signal.predictedThresholdCrossing!).toLocaleString("tr-TR")} civarında aşılması öngörülüyor.`,
            )
            .join(" ")
        : "Önümüzdeki 24 saatlik sensör tahminlerinde yeni bir uyarı eşiği aşımı görülmüyor; mevcut yüksek riskler izlenmeye devam edilmelidir.",
      recommendedFocus: (attention.length ? attention : evidence.assets.slice(0, 1))
        .slice(0, 5)
        .map(focusFor),
    };
  }
}

export class GeminiDailyAnalysisProvider implements DailyAnalysisProvider {
  private fallback = new DeterministicDailyAnalysisProvider();
  private client: GeminiJsonClient;
  constructor(key: string) {
    this.client = new GeminiJsonClient(key);
  }
  async analyze(evidence: DailyEvidence): Promise<DailyNarrative> {
    try {
      const narrative = await this.client.generate(
        dailyNarrativeSchema,
        "You write a concise daily cement plant condition-monitoring report from approved structured evidence. Always write every value in Turkish. Focus on noteworthy changes instead of listing every normal sensor. Numerical risk levels, sensor values and threshold-crossing times are authoritative. currentlyAboveWarning describes an existing exceedance; predictedThresholdCrossing is reserved for a new future crossing. Explain the next 24 hours, prioritize critical systems and give inspection recommendations. Thresholds are simulated configuration; never call them safe, certified, reliable or manufacturer limits. State possible causes only as hypotheses. Never say that a machine will certainly fail and never invent a failure date, measurement, internal coefficient or control action. Do not reveal or assume hidden simulator state. No HTML.",
        evidence,
      );
      return { ...narrative, provider: "gemini" };
    } catch (error) {
      console.warn(
        "Gemini daily report unavailable or invalid:",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      );
      return {
        ...(await this.fallback.analyze(evidence)),
        fallbackReason:
          "Gemini günlük raporu alınamadı veya doğrulanamadı; kural tabanlı rapor gösteriliyor.",
      };
    }
  }
}

export const createDailyAnalysisProvider = (): DailyAnalysisProvider =>
  process.env.GEMINI_API_KEY
    ? new GeminiDailyAnalysisProvider(process.env.GEMINI_API_KEY)
    : new DeterministicDailyAnalysisProvider();

export class ReportService {
  private daily = new Map<string, DailyReport>();
  private events = new Map<string, RiskEventReport>();
  private previousRisks = new Map<string, RiskLevel>();
  private pendingRisks = new Map<
    string,
    { level: RiskLevel; count: number; timestamp: string; day: number }
  >();
  private runId = 0;

  constructor(
    private factory: FactoryService,
    private analysis: DailyAnalysisProvider = createDailyAnalysisProvider(),
  ) {}

  reset(runId: number) {
    this.runId = runId;
    this.daily.clear();
    this.events.clear();
    this.previousRisks.clear();
    this.pendingRisks.clear();
  }

  observe(assets: Asset[], timestamp: string, day: number) {
    for (const asset of assets) {
      const previous = this.previousRisks.get(asset.id);
      if (previous === undefined) {
        this.previousRisks.set(asset.id, asset.riskLevel);
        continue;
      }
      if (previous === asset.riskLevel) {
        this.pendingRisks.delete(asset.id);
        continue;
      }
      const pending = this.pendingRisks.get(asset.id);
      const candidate =
        pending?.level === asset.riskLevel
          ? { ...pending, count: pending.count + 1 }
          : { level: asset.riskLevel, count: 1, timestamp, day };
      this.pendingRisks.set(asset.id, candidate);
      const requiredSamples = rank[asset.riskLevel] > rank[previous] ? 4 : 8;
      if (candidate.count < requiredSamples) continue;
      this.pendingRisks.delete(asset.id);
      this.previousRisks.set(asset.id, asset.riskLevel);
      const direction = rank[asset.riskLevel] > rank[previous] ? "yükseldi" : "geriledi";
      const report: RiskEventReport = {
        id: `${this.runId}:${asset.id}:${candidate.timestamp}:${asset.riskLevel}`,
        runId: this.runId,
        day: candidate.day,
        timestamp: candidate.timestamp,
        machineId: asset.id,
        machine: asset.name,
        fromRisk: previous,
        toRisk: asset.riskLevel,
        summary: `${asset.name} risk seviyesi ${tr(previous).toLocaleLowerCase("tr-TR")} düzeyinden ${tr(asset.riskLevel).toLocaleLowerCase("tr-TR")} düzeyine ${direction}. ${asset.mainIssue}.`,
      };
      this.events.set(report.id, report);
    }
  }

  private async evidence(day: number, timestamp: string): Promise<DailyEvidence> {
    const dashboard = await this.factory.dashboard();
    const forecasts = await this.factory.getFleetForecasts(96);
    const bySensor = new Map(
      forecasts.map((forecast) => [
        `${forecast.machineId}:${forecast.metric}`,
        forecast,
      ]),
    );
    const assets = await Promise.all(
      dashboard.machines.map(async (asset) => ({
        machineId: asset.id,
        machine: asset.name,
        riskLevel: asset.riskLevel,
        healthScore: asset.healthScore,
        signals: await Promise.all(
          asset.risk.signals.map(async (signal) => {
            const forecast = bySensor.get(`${asset.id}:${signal.metric}`)!;
            return {
              label: signal.label,
              unit: signal.unit,
              current: signal.current,
              baseline: signal.baseline,
              change24h: signal.change24h,
              ratePerHour: signal.ratePerHour,
              forecast24hPeak: Math.max(
                signal.current,
                ...forecast.forecast.map((point) => point.value),
              ),
              warning: signal.warning,
              critical: signal.critical,
              currentlyAboveWarning: signal.current >= signal.warning,
              predictedThresholdCrossing: futureThresholdCrossing(
                signal.current,
                signal.warning,
                forecast.forecast,
              ),
              model: forecast.model,
            };
          }),
        ),
      })),
    );
    return {
      day,
      timestamp,
      plantHealth: dashboard.plantHealth,
      assets,
      recentRiskEvents: this.riskEvents().filter((event) => event.day === day),
      processLinks: PROCESS_LINKS.map(({ from, to }) => ({ from, to })),
    };
  }

  async generateDaily(day: number, timestamp: string) {
    const evidence = await this.evidence(day, timestamp);
    const narrative = await this.analysis.analyze(evidence);
    const reportAssets: ReportAsset[] = evidence.assets
      .filter(
        (asset) =>
          asset.riskLevel !== "LOW" ||
          asset.signals.some((signal) => signal.predictedThresholdCrossing),
      )
      .sort((a, b) => rank[b.riskLevel] - rank[a.riskLevel])
      .slice(0, 6)
      .map((asset) => {
        const abnormal = asset.signals
          .filter(
            (signal) =>
              signal.current >= signal.warning || signal.predictedThresholdCrossing,
          )
          .map(
            (signal) =>
              `${signal.label} ${n(signal.current)} ${signal.unit} (24 saatlik tepe ${n(signal.forecast24hPeak)} ${signal.unit})`,
          );
        const crossings = asset.signals
          .map((signal) => signal.predictedThresholdCrossing)
          .filter((value): value is string => !!value)
          .sort();
        return {
          machineId: asset.machineId,
          machine: asset.machine,
          riskLevel: asset.riskLevel,
          healthScore: asset.healthScore,
          summary: abnormal.length
            ? abnormal.join("; ")
            : "Yükselen eğilim nedeniyle izleme öneriliyor.",
          predictedThresholdCrossing: crossings[0] ?? null,
        };
      });
    const report: DailyReport = {
      id: `${this.runId}:day:${day}`,
      runId: this.runId,
      day,
      date: new Date(Date.parse(timestamp) - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      generatedAt: timestamp,
      provider: narrative.provider,
      forecastModels: [
        ...new Set(
          evidence.assets.flatMap((asset) =>
            asset.signals.map((signal) => signal.model),
          ),
        ),
      ],
      fallbackReason: narrative.fallbackReason,
      plantHealth: evidence.plantHealth,
      criticalAssets: reportAssets,
      summary: narrative.summary,
      outlook: narrative.outlook,
      recommendedFocus: narrative.recommendedFocus,
    };
    this.daily.set(report.id, report);
    return report;
  }

  dailyReports() {
    return [...this.daily.values()].sort((a, b) => b.day - a.day);
  }

  riskEvents() {
    return [...this.events.values()].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
  }

  latest() {
    return this.dailyReports()[0];
  }
}
