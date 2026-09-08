import { tr, formatNumber as n } from "./locale.js";
import { GeminiJsonClient, isAllowedAdvisoryText } from "./gemini.js";
import { z } from "zod";
import type { Asset, Forecast } from "./domain.js";
const safeText = z
  .string()
  .min(1)
  .max(3000)
  .refine((s) => !/<[^>]*>/.test(s), "HTML is not allowed")
  .refine(isAllowedAdvisoryText, "Unsafe certainty or certification claim");
export const analysisSchema = z
  .object({
    summary: safeText,
    probableCauses: z
      .array(
        z
          .object({
            cause: safeText,
            confidence: z.enum(["low", "medium", "high"]),
            reasoning: safeText,
          })
          .strict(),
      )
      .max(5),
    recommendedActions: z
      .array(
        z
          .object({
            priority: z.number().int().min(1).max(5),
            action: safeText,
            reason: safeText,
          })
          .strict(),
      )
      .min(1)
      .max(5),
    urgency: z.enum([
      "monitor",
      "schedule_inspection",
      "inspect_soon",
      "immediate_attention",
    ]),
    operatorMessage: safeText,
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export interface AnalysisResult extends Analysis {
  provider: string;
  fallbackReason?: string;
}
export interface ForecastEvidence {
  metric: string;
  label: string;
  unit: string;
  model: string;
  current: number;
  predictedPeak: number;
  warning: number;
  critical: number;
  predictedWarningCrossing: string | null;
  forecastEnd: string | null;
}
export function summarizeForecasts(
  asset: Asset,
  forecasts: Forecast[] = [],
): ForecastEvidence[] {
  return forecasts.map((forecast) => {
    const signal = asset.risk.signals.find(
      (candidate) => candidate.metric === forecast.metric,
    )!;
    const config = asset.sensors.find(
      (candidate) => candidate.metric === forecast.metric,
    )!;
    return {
      metric: forecast.metric,
      label: config.label,
      unit: config.unit,
      model: forecast.model,
      current: signal.current,
      predictedPeak: Math.max(
        signal.current,
        ...forecast.forecast.map((point) => point.value),
      ),
      warning: config.warning,
      critical: config.critical,
      predictedWarningCrossing:
        signal.current < config.warning
          ? (forecast.forecast.find((point) => point.value >= config.warning)
              ?.timestamp ?? null)
          : null,
      forecastEnd: forecast.forecast.at(-1)?.timestamp ?? null,
    };
  });
}
export interface AIAnalysisProvider {
  analyze(asset: Asset, forecasts?: Forecast[]): Promise<AnalysisResult>;
}
export class DeterministicAnalysisProvider implements AIAnalysisProvider {
  async analyze(asset: Asset, forecasts: Forecast[] = []): Promise<AnalysisResult> {
    const abnormal = asset.risk.signals.filter((s) => s.severity !== "LOW");
    const forecastEvidence = new Map(
      summarizeForecasts(asset, forecasts).map((item) => [item.metric, item]),
    );
    const vibration = abnormal.some((s) => s.metric === "vibration");
    const thermal = abnormal.some((s) =>
      s.metric.toLowerCase().includes("temperature"),
    );
    const power = abnormal.some((s) => s.metric === "power");
    const evidence = abnormal
      .map(
        (s) =>
          `${s.label}: mevcut değer ${n(s.current)} ${s.unit}, normal değer ${n(s.baseline)}; tahmin tepe değeri ${n(forecastEvidence.get(s.metric)?.predictedPeak ?? s.forecast)} ${s.unit}. ${s.reason}.`,
      )
      .join(" ");
    const history = asset.maintenanceHistory.at(-1)!;
    const causes = vibration
      ? [
          "Rulman aşınması veya yağlama sorunu",
          "Mil hizasızlığı veya rotor dengesizliği",
        ]
      : thermal
        ? ["Soğutma kısıtı veya yağlama sorunu"]
        : power
          ? ["Artan proses yükü veya tahrik verimsizliği"]
          : [];
    const actions = vibration
      ? [
          "Rulman durumunu ve yağlamayı kontrol edin",
          "Titreşim spektrumunu ve mil hizalamasını inceleyin",
          "Motor akımını ve proses yükünü karşılaştırın",
        ]
      : thermal
        ? [
            "Soğutma hava akışını ve yatak yağlamasını kontrol edin",
            "Sıcaklık sensörünü referans ölçümle doğrulayın",
          ]
        : power
          ? [
              "Değirmen kapasitesini ve besleme özelliklerini karşılaştırın",
              "Tahrik verimini ve güç ölçümünü kontrol edin",
            ]
          : ["Rutin durum izlemeye devam edin"];
    return {
      provider: "deterministic",
      summary: abnormal.length
        ? `${asset.name} için risk seviyesi ${tr(asset.riskLevel).toLocaleLowerCase("tr-TR")}. ${evidence}`
        : `${asset.name} simüle normal çalışma aralığında. Şu anda yükselmiş risk saptanmadı.`,
      probableCauses: causes.map((cause) => ({
        cause,
        confidence: "low",
        reasoning: `Ölçülen ${abnormal.map((s) => s.label.toLocaleLowerCase("tr-TR")).join(" ve ")} eğilimi için olası açıklamadır; kontrolle doğrulanmalıdır. ${history.date} tarihli ${history.title.toLocaleLowerCase("tr-TR")}: ${history.outcome}.`,
      })),
      recommendedActions: actions.map((action, i) => ({
        priority: i + 1,
        action,
        reason:
          i === 0
            ? `Ölçülen durumu doğrulayın. Son bakım: ${history.date}.`
            : "Bulguları geçmiş normal değerler ve bakım kayıtlarıyla karşılaştırın.",
      })),
      urgency: (
        {
          LOW: "monitor",
          MEDIUM: "schedule_inspection",
          HIGH: "inspect_soon",
          CRITICAL: "immediate_attention",
        } as const
      )[asset.riskLevel],
      operatorMessage:
        "Yalnızca karar desteği sağlar. Öneriler yetkin bakım personeli tarafından doğrulanmalı ve mevcut tesis prosedürleri izlenmelidir.",
    };
  }
}
export class GeminiAnalysisProvider implements AIAnalysisProvider {
  private fallback = new DeterministicAnalysisProvider();
  private client: GeminiJsonClient;
  constructor(key: string) {
    this.client = new GeminiJsonClient(key);
  }
  async analyze(asset: Asset, forecasts: Forecast[] = []): Promise<AnalysisResult> {
    try {
      const result = await this.client.generate(
        analysisSchema,
        "You interpret cement plant simulated condition-monitoring evidence. Always write every user-facing JSON string in Turkish. Keep schema field names and enum values unchanged. Use Turkish decimal formatting in prose. Never assert a machine will fail. Treat risk levels and numerical signals as authoritative; do not invent readings or certify safety. Causes are hypotheses, not diagnoses. Use maintenance history. Give concise inspection recommendations, never automatic machine-control actions. No HTML.",
        {
          machine: {
            id: asset.id,
            name: asset.name,
            type: asset.type,
            operatingHours: asset.operatingHours,
          },
          risk: asset.risk,
          forecasts: summarizeForecasts(asset, forecasts),
          maintenanceHistory: asset.maintenanceHistory,
        },
      );
      return { ...result, provider: "gemini" };
    } catch (error) {
      console.warn(
        "Gemini analysis unavailable or invalid:",
        error instanceof Error ? error.name : "unknown",
      );
      return {
        ...(await this.fallback.analyze(asset)),
        fallbackReason:
          "Gemini yanıtı alınamadı veya doğrulanamadı; kural tabanlı açıklama kullanılıyor.",
      };
    }
  }
}
export function createAnalysisProvider(): AIAnalysisProvider {
  return process.env.GEMINI_API_KEY
    ? new GeminiAnalysisProvider(process.env.GEMINI_API_KEY)
    : new DeterministicAnalysisProvider();
}
