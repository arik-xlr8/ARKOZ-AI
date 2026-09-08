import type {
  Forecast,
  Point,
  Risk,
  RiskLevel,
  SensorConfig,
} from "./domain.js";
export const RISK_CONFIG = {
  baselineDeviation: 0.12,
  rapidRateFraction: 0.025,
  healthyScore: 94,
  penalty: { LOW: 0, MEDIUM: 15, HIGH: 33, CRITICAL: 60 },
  additionalSensorPenalty: 4,
};
export const rank: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
export function thresholdCrossing(
  history: Point[],
  forecast: Point[],
  threshold: number,
): string | null {
  if (history.at(-1)!.value >= threshold) return history.at(-1)!.timestamp;
  return forecast.find((p) => p.value >= threshold)?.timestamp ?? null;
}
export function healthScore(level: RiskLevel, abnormalCount: number) {
  return Math.max(
    0,
    Math.min(
      100,
      RISK_CONFIG.healthyScore -
        RISK_CONFIG.penalty[level] -
        Math.max(0, abnormalCount - 1) * RISK_CONFIG.additionalSensorPenalty,
    ),
  );
}
export class RiskEngine {
  evaluate(
    machineId: string,
    inputs: { config: SensorConfig; history: Point[]; forecast: Forecast }[],
  ): Risk {
    const signals = inputs.map(({ config: s, history, forecast }) => {
      const current = history.at(-1)!.value;
      const baselinePoints = history.slice(0, -96);
      const baseline =
        baselinePoints.reduce((a, p) => a + p.value, 0) / baselinePoints.length;
      const peak = Math.max(...forecast.forecast.map((p) => p.value));
      const previous = history.at(-5)!;
      const rate =
        (current - previous.value) /
        ((Date.parse(history.at(-1)!.timestamp) -
          Date.parse(previous.timestamp)) /
          3600000);
      const deviation =
        (current - baseline) / Math.max(Math.abs(baseline), 0.01);
      const rapid = rate > baseline * RISK_CONFIG.rapidRateFraction;
      let severity: RiskLevel = "LOW";
      let reason = "Simüle normal çalışma aralığında";
      if (current >= s.critical || peak >= s.critical) {
        severity = "CRITICAL";
        reason =
          current >= s.critical
            ? "Mevcut değer simüle kritik eşiği aşıyor"
            : "Kritik eşik aşımı öngörülüyor";
      } else if (current >= s.warning) {
        severity = "HIGH";
        reason =
          "Mevcut değer uyarı eşiğini aşıyor" +
          (rapid ? "; hızlı yükseliş eğilimi" : "");
      } else if (
        peak >= s.warning ||
        deviation > RISK_CONFIG.baselineDeviation ||
        rapid
      ) {
        severity = "MEDIUM";
        reason =
          peak >= s.warning
            ? "Uyarı eşiği aşımı öngörülüyor"
            : rapid
              ? "Hızlı yükseliş eğilimi"
              : "Geçmiş normal değerlerin üzerinde";
      }
      return {
        metric: s.metric,
        label: s.label,
        unit: s.unit,
        current,
        forecast: peak,
        baseline: +baseline.toFixed(3),
        change24h: +(current - history.at(-97)!.value).toFixed(3),
        ratePerHour: +rate.toFixed(3),
        warning: s.warning,
        critical: s.critical,
        severity,
        reason,
        crossing: thresholdCrossing(history, forecast.forecast, s.warning),
      };
    });
    let riskLevel = signals.reduce<RiskLevel>(
      (a, s) => (rank[s.severity] > rank[a] ? s.severity : a),
      "LOW",
    );
    const abnormal = signals.filter((s) => s.severity !== "LOW").length;
    if (
      riskLevel === "MEDIUM" &&
      abnormal >= 2 &&
      signals.some((s) => s.current >= s.warning * 0.95)
    )
      riskLevel = "HIGH";
    return {
      machineId,
      riskLevel,
      healthScore: healthScore(riskLevel, abnormal),
      signals,
    };
  }
}
