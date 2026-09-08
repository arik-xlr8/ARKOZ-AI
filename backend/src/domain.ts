export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type SimulationMode = "autonomous" | "scenario";
export type FaultStage =
  | "HEALTHY"
  | "INCIPIENT"
  | "DEGRADING"
  | "WARNING"
  | "CRITICAL"
  | "MAINTAINED";
export interface Point {
  timestamp: string;
  value: number;
}
export interface SensorConfig {
  metric: string;
  label: string;
  unit: string;
  base: number;
  warning: number;
  critical: number;
}
export interface MaintenanceRecord {
  date: string;
  title: string;
  outcome: string;
}
export interface Machine {
  id: string;
  name: string;
  type: string;
  location: string;
  status: string;
  healthScore: number;
  riskLevel: RiskLevel;
  lastMaintenanceDate: string;
  operatingHours: number;
  sensors: SensorConfig[];
  maintenanceHistory: MaintenanceRecord[];
}
export interface Forecast {
  machineId: string;
  metric: string;
  forecast: Point[];
  model: string;
  fallbackReason?: string;
}
export interface Signal {
  metric: string;
  label: string;
  unit: string;
  current: number;
  forecast: number;
  baseline: number;
  change24h: number;
  ratePerHour: number;
  warning: number;
  critical: number;
  severity: RiskLevel;
  reason: string;
  crossing: string | null;
}
export interface Risk {
  machineId: string;
  riskLevel: RiskLevel;
  healthScore: number;
  signals: Signal[];
}
export interface Asset extends Machine {
  risk: Risk;
  mainIssue: string;
  lastUpdate: string;
}
export interface Alert {
  id: string;
  machineId: string;
  machine: string;
  metric: string;
  severity: RiskLevel;
  timestamp: string;
  current: number;
  predicted: number;
  unit: string;
  reason: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
}
export interface Task {
  id: string;
  machineId: string;
  machine: string;
  title: string;
  priority: RiskLevel;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED";
  createdAt: string;
  recommendedBy: string;
}
export interface MachineCondition {
  machineId: string;
  healthIndex: number;
  wear: number;
  load: number;
  stage: FaultStage;
  faultType?: string;
  probableCause?: string;
  startedAt?: string;
  processImpactFrom: string[];
}
export interface SimulationEvent {
  id: string;
  timestamp: string;
  day: number;
  machineId: string;
  type: "FAULT_ONSET" | "PROCESS_IMPACT" | "MAINTENANCE_EFFECT";
  title: string;
  description: string;
}
export interface ReportAsset {
  machineId: string;
  machine: string;
  riskLevel: RiskLevel;
  healthScore: number;
  summary: string;
  predictedThresholdCrossing: string | null;
}
export interface DailyReport {
  id: string;
  runId: number;
  day: number;
  date: string;
  generatedAt: string;
  provider: string;
  forecastModels: string[];
  fallbackReason?: string;
  plantHealth: number;
  criticalAssets: ReportAsset[];
  summary: string;
  outlook: string;
  recommendedFocus: string[];
}
export interface RiskEventReport {
  id: string;
  runId: number;
  day: number;
  timestamp: string;
  machineId: string;
  machine: string;
  fromRisk: RiskLevel;
  toRisk: RiskLevel;
  summary: string;
}
export interface Repository<T extends { id: string }> {
  all(): T[];
  get(id: string): T | undefined;
  save(item: T): void;
  clear(): void;
}
export class MemoryRepository<
  T extends { id: string },
> implements Repository<T> {
  private data = new Map<string, T>();
  all() {
    return [...this.data.values()];
  }
  get(id: string) {
    return this.data.get(id);
  }
  save(item: T) {
    this.data.set(item.id, item);
  }
  clear() {
    this.data.clear();
  }
}
export interface SensorDataSource {
  machines: Machine[];
  now: string;
  history(machineId: string, metric: string): Point[];
}
