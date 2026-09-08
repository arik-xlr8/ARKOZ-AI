import {
  MemoryRepository,
  type Alert,
  type Asset,
  type Forecast,
  type Task,
  type SensorDataSource,
  type Repository,
} from "./domain.js";
import {
  PythonForecastProvider,
  trendForecast,
  type ForecastProvider,
  type ForecastRequest,
} from "./forecast.js";
import { rank, RiskEngine } from "./risk.js";
export class FactoryService {
  private engine = new RiskEngine();
  private cached?: { key: string; value: Promise<Asset[]> };
  private forecasts = new Map<string, Promise<Forecast>>();
  constructor(
    public source: SensorDataSource,
    private forecaster: ForecastProvider = new PythonForecastProvider(),
    public alerts: Repository<Alert> = new MemoryRepository<Alert>(),
    public tasks: Repository<Task> = new MemoryRepository<Task>(),
  ) {}
  getMachineDetails(id: string) {
    const machine = this.source.machines.find((m) => m.id === id);
    if (!machine)
      throw Object.assign(new Error("Ekipman bulunamadı"), { status: 404 });
    return machine;
  }
  getMachineSensorHistory(id: string, metric: string) {
    const m = this.getMachineDetails(id);
    if (!m.sensors.some((s) => s.metric === metric))
      throw Object.assign(new Error("Sensör bulunamadı"), { status: 404 });
    return this.source.history(id, metric).map((point) => ({ ...point }));
  }
  getMaintenanceHistory(id: string) {
    return this.getMachineDetails(id).maintenanceHistory;
  }
  private forecastKey(request: ForecastRequest) {
    return [
      this.source.now,
      request.machineId,
      request.metric,
      request.horizon,
    ].join(":");
  }
  private async resolveForecasts(requests: ForecastRequest[]) {
    if (this.forecasts.size > 300) this.forecasts.clear();
    const missing = requests.filter(
      (request) => !this.forecasts.has(this.forecastKey(request)),
    );
    if (missing.length) {
      const generated = this.forecaster.forecastMany
        ? await this.forecaster.forecastMany(missing)
        : await Promise.all(
            missing.map((request) =>
              this.forecaster.forecast(
                request.machineId,
                request.metric,
                request.history,
                request.horizon,
              ),
            ),
          );
      generated.forEach((forecast, index) =>
        this.forecasts.set(
          this.forecastKey(missing[index]),
          Promise.resolve(forecast),
        ),
      );
    }
    return Promise.all(
      requests.map((request) => this.forecasts.get(this.forecastKey(request))!),
    );
  }
  getMachineForecast(id: string, metric: string, horizon = 16) {
    const h = this.getMachineSensorHistory(id, metric);
    return this.resolveForecasts([
      { machineId: id, metric, history: h, horizon },
    ]).then(([forecast]) => forecast);
  }
  getMachineForecasts(id: string, horizon = 96) {
    const machine = this.getMachineDetails(id);
    return this.resolveForecasts(
      machine.sensors.map((sensor) => ({
        machineId: machine.id,
        metric: sensor.metric,
        history: this.getMachineSensorHistory(machine.id, sensor.metric),
        horizon,
      })),
    );
  }
  async getFleetForecasts(horizon = 16) {
    const requests: ForecastRequest[] = this.source.machines.flatMap((machine) =>
      machine.sensors.map((sensor) => ({
        machineId: machine.id,
        metric: sensor.metric,
        history: this.getMachineSensorHistory(machine.id, sensor.metric),
        horizon,
      })),
    );
    return this.resolveForecasts(requests);
  }
  invalidate() {
    this.cached = undefined;
    this.forecasts.clear();
  }
  async getCurrentRisks(): Promise<Asset[]> {
    const key = this.source.now;
    if (this.cached?.key === key) return this.cached.value;
    const value = this.calculate();
    this.cached = { key, value };
    return value;
  }
  private async calculate() {
    const now = this.source.now;
    const assets = this.source.machines.map((m) => {
        const inputs = m.sensors.map((config) => ({
          config,
          history: this.getMachineSensorHistory(m.id, config.metric),
          forecast: {
            machineId: m.id,
            metric: config.metric,
            model: "real-time-linear-trend",
            forecast: trendForecast(
              this.getMachineSensorHistory(m.id, config.metric),
              16,
            ),
          },
        }));
        const risk = this.engine.evaluate(m.id, inputs);
        return {
          ...m,
          risk,
          riskLevel: risk.riskLevel,
          healthScore: risk.healthScore,
          status:
            risk.riskLevel === "LOW"
              ? "NORMAL"
              : risk.riskLevel === "MEDIUM"
                ? "WARNING"
                : "HIGH RISK",
          mainIssue: [...risk.signals].sort(
            (a, b) => rank[b.severity] - rank[a.severity],
          )[0].reason,
          lastUpdate: now,
        };
      });
    for (const asset of assets)
      for (const s of asset.risk.signals) {
        const id = asset.id + ":" + s.metric;
        const old = this.alerts.get(id);
        if (s.severity !== "LOW") {
          this.alerts.save({
            id,
            machineId: asset.id,
            machine: asset.name,
            metric: s.metric,
            severity: s.severity,
            timestamp: old?.status !== "RESOLVED" && old ? old.timestamp : now,
            current: s.current,
            predicted: s.forecast,
            unit: s.unit,
            reason: s.reason,
            status:
              old?.status === "ACKNOWLEDGED" && old.severity === s.severity
                ? "ACKNOWLEDGED"
                : "OPEN",
          });
        } else if (old && old.status !== "RESOLVED")
          this.alerts.save({ ...old, status: "RESOLVED" });
      }
    return assets.sort(
      (a, b) =>
        rank[b.riskLevel] - rank[a.riskLevel] || a.name.localeCompare(b.name),
    );
  }
  async getHighRiskMachines() {
    return (await this.getCurrentRisks()).filter((m) => rank[m.riskLevel] >= 2);
  }
  async dashboard() {
    const machines = await this.getCurrentRisks();
    return {
      machines,
      plantHealth: Math.round(
        machines.reduce((s, m) => s + m.healthScore, 0) / machines.length,
      ),
      online: machines.length,
      highRisk: machines.filter((m) => rank[m.riskLevel] >= 2).length,
      mediumRisk: machines.filter((m) => m.riskLevel === "MEDIUM").length,
      criticalAlerts: this.alerts
        .all()
        .filter((a) => a.severity === "CRITICAL" && a.status !== "RESOLVED")
        .length,
      predictedRisks: machines.filter((m) =>
        m.risk.signals.some((s) => s.current < s.warning && s.crossing),
      ).length,
      openRecommendations: machines.filter(
        (m) =>
          m.riskLevel !== "LOW" &&
          !this.tasks
            .all()
            .some((t) => t.machineId === m.id && t.status !== "COMPLETED"),
      ).length,
      lastUpdate: this.source.now,
    };
  }
}
