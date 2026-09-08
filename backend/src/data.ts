import type {
  Machine,
  MachineCondition,
  MaintenanceRecord,
  Point,
  SensorConfig,
  SensorDataSource,
  SimulationEvent,
  SimulationMode,
} from "./domain.js";
import { tr } from "./locale.js";
import { AutonomousPlant, STEPS_PER_DAY } from "./autonomous.js";
export const INTERVAL = 15 * 60 * 1000;
export const SEED_TIME = Date.parse("2026-09-08T06:00:00Z");
const sensor = (
  metric: string,
  label: string,
  unit: string,
  base: number,
  warning: number,
  critical: number,
): SensorConfig => ({
  metric,
  label: tr(label),
  unit,
  base,
  warning,
  critical,
});
const vibration = () => sensor("vibration", "Vibration", "mm/s", 3.4, 5.5, 9);
const bearing = () =>
  sensor("bearingTemperature", "Bearing temperature", "°C", 65, 85, 105);
const current = () => sensor("current", "Motor current", "A", 140, 175, 220);
const rpm = () => sensor("rpm", "Rotational speed", "rpm", 1480, 1550, 1650);
const definitions: [string, string, string, SensorConfig[]][] = [
  [
    "Rotary Kiln 1",
    "Kiln",
    "Pyroprocessing",
    [
      sensor("temperature", "Shell temperature", "°C", 280, 340, 400),
      sensor("rpm", "Kiln speed", "rpm", 3.2, 4.2, 5),
      sensor("power", "Drive power", "kW", 480, 620, 760),
    ],
  ],
  [
    "Kiln Main Motor",
    "Motor",
    "Pyroprocessing",
    [vibration(), bearing(), current(), rpm()],
  ],
  [
    "Kiln ID Fan",
    "Fan",
    "Gas handling",
    [
      vibration(),
      bearing(),
      sensor("pressure", "Duct pressure magnitude", "kPa", 2.5, 3.5, 4.5),
    ],
  ],
  [
    "Raw Mill",
    "Mill",
    "Raw preparation",
    [
      vibration(),
      bearing(),
      sensor("power", "Mill power", "kW", 2500, 3100, 3700),
    ],
  ],
  [
    "Cement Mill 1",
    "Mill",
    "Finish grinding",
    [
      vibration(),
      bearing(),
      sensor("power", "Mill power", "kW", 3200, 4000, 4800),
    ],
  ],
  [
    "Cement Mill 2",
    "Mill",
    "Finish grinding",
    [
      vibration(),
      bearing(),
      sensor("power", "Mill power", "kW", 3000, 3600, 4600),
    ],
  ],
  [
    "Crusher",
    "Crusher",
    "Raw preparation",
    [vibration(), current(), bearing()],
  ],
  [
    "Clinker Cooler",
    "Cooler",
    "Pyroprocessing",
    [
      sensor("temperature", "Outlet temperature", "°C", 130, 170, 210),
      sensor("flow", "Cooling airflow", "m³/s", 70, 95, 115),
    ],
  ],
  [
    "Bucket Elevator",
    "Elevator",
    "Material handling",
    [
      vibration(),
      bearing(),
      sensor("current", "Motor current", "A", 45, 65, 85),
    ],
  ],
  [
    "Conveyor Line 1",
    "Conveyor",
    "Material handling",
    [
      bearing(),
      sensor("current", "Motor current", "A", 30, 45, 60),
      sensor("rpm", "Drive speed", "rpm", 960, 1100, 1300),
    ],
  ],
];
export const scenarios = [
  { id: "normal", name: "Normal çalışma", machineId: "kiln-main-motor" },
  {
    id: "bearing",
    name: "Rulman aşınması — Fırın Ana Motoru",
    machineId: "kiln-main-motor",
  },
  {
    id: "overheating",
    name: "Aşırı ısınma — Fırın Çekiş Fanı",
    machineId: "kiln-id-fan",
  },
  {
    id: "vibration",
    name: "Titreşim anomalisi — Kırıcı",
    machineId: "crusher",
  },
  {
    id: "power",
    name: "Güç tüketimi anomalisi — Çimento Değirmeni 2",
    machineId: "cement-mill-2",
  },
];
export function scenarioOffset(scenario: string, metric: string, step: number) {
  const t = Math.min(step, 32);
  if (scenario === "bearing")
    return metric === "vibration"
      ? t * 0.16
      : metric === "bearingTemperature"
        ? t * 1.05
        : 0;
  if (scenario === "overheating")
    return metric === "bearingTemperature" ? t * 1.8 : 0;
  if (scenario === "vibration") return metric === "vibration" ? t * 0.18 : 0;
  if (scenario === "power") return metric === "power" ? t * 25 : 0;
  return 0;
}
const maintenanceHistory = (type: string): MaintenanceRecord[] => [
  {
    date: "2026-01-17",
    title: type === "Motor" ? "Rulman kontrolü" : "Durum kontrolü",
    outcome: "Anormal aşınma kaydedilmedi",
  },
  {
    date: "2026-04-03",
    title: ["Motor", "Fan", "Mill"].includes(type)
      ? "Mil hizalaması düzeltildi"
      : "Tahrik ve kaplin kontrolü",
    outcome: "Normal çalışma değerlerine dönüldü",
  },
  {
    date: "2026-07-11",
    title: "Yağlama bakımı",
    outcome: "Yağ yenilendi; sonrasında eğilimlerin izlenmesi önerildi",
  },
];
export class MockFactoryData implements SensorDataSource {
  machines: Machine[] = definitions.map(
    ([name, type, location, sensors], i) => ({
      id: name.toLowerCase().replaceAll(" ", "-"),
      name: tr(name),
      type: tr(type),
      location: tr(location),
      sensors,
      status: "NORMAL",
      healthScore: 94,
      riskLevel: "LOW",
      lastMaintenanceDate: "2026-07-11",
      operatingHours: 12400 + i * 713,
      maintenanceHistory: maintenanceHistory(type),
    }),
  );
  now = new Date(SEED_TIME).toISOString();
  private series = new Map<string, Point[]>();
  step = 0;
  scenario = "normal";
  mode: SimulationMode = "scenario";
  running = false;
  revision = 0;
  runId = 0;
  seed = 20260908;
  private autonomous?: AutonomousPlant;
  constructor() {
    this.activateAutonomous(this.seed);
    this.runId = 0;
    this.running = false;
  }
  reset(includeSeedEvents = true) {
    this.now = new Date(SEED_TIME).toISOString();
    this.step = 0;
    this.scenario = "normal";
    this.mode = "scenario";
    this.running = false;
    this.autonomous = undefined;
    this.revision++;
    this.series.clear();
    this.machines.forEach((machine, index) => {
      machine.operatingHours = 12400 + index * 713;
      machine.lastMaintenanceDate = "2026-07-11";
      machine.maintenanceHistory = maintenanceHistory(definitions[index][1]);
    });
    this.machines.forEach((m, index) =>
      m.sensors.forEach((s, j) => {
        const points = Array.from({ length: 673 }, (_, i) => {
          let value =
            s.base *
            (1 +
              0.009 * Math.sin(i * 0.13 + index) +
              0.004 * Math.sin(i * 1.7 + j));
          if (
            includeSeedEvents &&
            m.id === "cement-mill-2" &&
            s.metric === "power"
          )
            value += 420 * Math.max(0, (i - 624) / 48);
          if (
            includeSeedEvents &&
            m.id === "crusher" &&
            s.metric === "vibration" &&
            i >= 620 &&
            i <= 624
          )
            value += 3 * Math.sin(((i - 620) / 4) * Math.PI);
          return {
            timestamp: new Date(SEED_TIME - (672 - i) * INTERVAL).toISOString(),
            value: +value.toFixed(3),
          };
        });
        this.series.set(m.id + ":" + s.metric, points);
      }),
    );
  }
  history(id: string, metric: string) {
    return this.series.get(id + ":" + metric) ?? [];
  }
  activate(id: string) {
    this.reset(false);
    this.runId++;
    this.scenario = id;
    this.mode = "scenario";
    this.running = true;
  }
  activateAutonomous(seed = 20260908) {
    this.reset(false);
    this.runId++;
    this.seed = Math.trunc(seed) >>> 0 || 20260908;
    this.mode = "autonomous";
    this.scenario = "normal";
    this.autonomous = new AutonomousPlant(this.machines, this.seed);
    this.running = true;
  }
  get day() {
    return Math.floor(this.step / STEPS_PER_DAY) + 1;
  }
  get completedDays() {
    return Math.floor(this.step / STEPS_PER_DAY);
  }
  get conditions(): MachineCondition[] {
    return [...(this.autonomous?.conditions.values() ?? [])].map((condition) => ({
      ...condition,
      processImpactFrom: [...condition.processImpactFrom],
    }));
  }
  get simulationEvents(): SimulationEvent[] {
    return (this.autonomous?.events ?? []).map((event) => ({ ...event }));
  }
  completeMaintenance(machineId: string, title = "Bakım görevi") {
    const machine = this.machines.find((candidate) => candidate.id === machineId);
    if (!machine) return;
    const date = this.now.slice(0, 10);
    machine.lastMaintenanceDate = date;
    machine.maintenanceHistory.push({
      date,
      title,
      outcome:
        this.mode === "autonomous"
          ? "Simüle bakım etkisi uygulandı; sonraki ölçümlerin izlenmesi gerekiyor"
          : "Bakım görevi tamamlandı; sonraki ölçümlerin izlenmesi gerekiyor",
    });
    if (this.mode === "autonomous")
      this.autonomous?.maintain(machineId, this.step, this.now);
    this.revision++;
  }
  advance() {
    this.step++;
    this.revision++;
    this.now = new Date(Date.parse(this.now) + INTERVAL).toISOString();
    if (this.mode === "autonomous") this.autonomous?.tick(this.step, this.now);
    const target =
      this.mode === "scenario"
        ? scenarios.find((s) => s.id === this.scenario)?.machineId
        : undefined;
    for (const [machineIndex, m] of this.machines.entries())
      for (const [sensorIndex, s] of m.sensors.entries()) {
        const phase = machineIndex * 0.61 + sensorIndex * 0.89;
        const normalVariation =
          0.005 * Math.sin(this.step * 0.7 + phase) +
          0.002 * Math.sin(this.step * 0.23 + phase * 1.7);
        const value =
          s.base *
            (1 +
              (this.mode === "autonomous"
                ? normalVariation +
                  (this.autonomous?.sensorRatio(m.id, s.metric) ?? 0) +
                  (this.autonomous?.noise(0.0015) ?? 0)
                : this.scenario === "normal"
                  ? normalVariation
                  : 0.006 * Math.sin(this.step * 0.7))) +
          (m.id === target
            ? scenarioOffset(this.scenario, s.metric, this.step)
            : 0);
        const points = this.history(m.id, s.metric);
        points.push({ timestamp: this.now, value: +value.toFixed(3) });
        if (points.length > 2689) points.shift();
      }
    for (const machine of this.machines) machine.operatingHours += 0.25;
  }
}
