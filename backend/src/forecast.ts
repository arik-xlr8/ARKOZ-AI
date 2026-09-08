import { z } from "zod";
import type { Forecast, Point } from "./domain.js";
export interface ForecastRequest {
  machineId: string;
  metric: string;
  history: Point[];
  horizon: number;
}
export interface ForecastProvider {
  forecast(
    machineId: string,
    metric: string,
    history: Point[],
    horizon: number,
  ): Promise<Forecast>;
  forecastMany?(requests: ForecastRequest[]): Promise<Forecast[]>;
}
export function trendForecast(history: Point[], horizon: number): Point[] {
  const y = history.slice(-16).map((p) => p.value),
    n = y.length,
    c = (n - 1) / 2,
    mean = y.reduce((a, b) => a + b) / n;
  let slope =
    y.reduce((s, v, i) => s + (i - c) * (v - mean), 0) /
    y.reduce((s, _, i) => s + (i - c) ** 2, 0);
  if (Math.abs(slope) < Math.max(Math.abs(mean) * 0.0008, 0.0001)) slope = 0;
  const last = history.at(-1)!;
  const interval =
    Date.parse(last.timestamp) - Date.parse(history.at(-2)!.timestamp);
  return Array.from({ length: horizon }, (_, j) => {
    const i = j + 1;
    return {
      timestamp: new Date(
        Date.parse(last.timestamp) + i * interval,
      ).toISOString(),
      value: +Math.max(
        0,
        last.value +
          slope * Math.min(i, 24) +
          slope * 0.25 * Math.max(0, i - 24),
      ).toFixed(3),
    };
  });
}
const output = z.object({
  machineId: z.string(),
  metric: z.string(),
  model: z.string(),
  fallbackReason: z.string().nullable().optional(),
  forecast: z.array(
    z.object({
      timestamp: z.iso.datetime({ offset: true }),
      value: z.number().finite(),
    }),
  ),
});
const batchOutput = z.object({ forecasts: z.array(output) });
const TIMESFM_CONTEXT_LENGTH = 1024;
export class PythonForecastProvider implements ForecastProvider {
  private fallback(request: ForecastRequest): Forecast {
    return {
      machineId: request.machineId,
      metric: request.metric,
      forecast: trendForecast(request.history, request.horizon),
      model: "linear-trend (API fallback)",
      fallbackReason:
        "Python forecast service unavailable or invalid response",
    };
  }
  private valid(request: ForecastRequest, data: z.infer<typeof output>) {
    if (
      data.forecast.length !== request.horizon ||
      data.machineId !== request.machineId ||
      data.metric !== request.metric
    )
      return false;
    const interval =
      Date.parse(request.history.at(-1)!.timestamp) -
      Date.parse(request.history.at(-2)!.timestamp);
    return !data.forecast.some(
      (point, index) =>
        Date.parse(point.timestamp) !==
        Date.parse(request.history.at(-1)!.timestamp) + interval * (index + 1),
    );
  }
  async forecastMany(requests: ForecastRequest[]): Promise<Forecast[]> {
    try {
      const response = await fetch(
        (process.env.FORECAST_SERVICE_URL ?? "http://127.0.0.1:8000") +
          "/forecast/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: requests.map((request) => ({
              machineId: request.machineId,
              metric: request.metric,
              timestamps: request.history
                .slice(-TIMESFM_CONTEXT_LENGTH)
                .map((point) => point.timestamp),
              values: request.history
                .slice(-TIMESFM_CONTEXT_LENGTH)
                .map((point) => point.value),
              horizon: request.horizon,
            })),
          }),
          signal: AbortSignal.timeout(
            Number(process.env.FORECAST_TIMEOUT_MS ?? 30000),
          ),
        },
      );
      if (!response.ok) throw new Error("Forecast service error");
      const data = batchOutput.parse(await response.json());
      if (
        data.forecasts.length !== requests.length ||
        data.forecasts.some((forecast, index) =>
          this.valid(requests[index], forecast) === false)
      )
        throw new Error("Invalid batch forecast response");
      return data.forecasts.map((forecast) => ({
        ...forecast,
        fallbackReason: forecast.fallbackReason ?? undefined,
      }));
    } catch {
      return requests.map((request) => this.fallback(request));
    }
  }
  async forecast(
    machineId: string,
    metric: string,
    history: Point[],
    horizon: number,
  ): Promise<Forecast> {
    return (
      await this.forecastMany([{ machineId, metric, history, horizon }])
    )[0];
  }
}
