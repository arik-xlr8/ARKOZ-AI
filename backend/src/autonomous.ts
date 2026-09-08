import type {
  FaultStage,
  Machine,
  MachineCondition,
  SimulationEvent,
} from "./domain.js";

export const STEPS_PER_DAY = 96;

export const PROCESS_LINKS = [
  { from: "crusher", to: "raw-mill", influence: 0.32 },
  { from: "raw-mill", to: "rotary-kiln-1", influence: 0.28 },
  { from: "raw-mill", to: "kiln-main-motor", influence: 0.18 },
  { from: "kiln-main-motor", to: "rotary-kiln-1", influence: 0.26 },
  { from: "kiln-id-fan", to: "rotary-kiln-1", influence: 0.3 },
  { from: "rotary-kiln-1", to: "clinker-cooler", influence: 0.34 },
  { from: "clinker-cooler", to: "cement-mill-1", influence: 0.2 },
  { from: "clinker-cooler", to: "cement-mill-2", influence: 0.2 },
  { from: "cement-mill-1", to: "bucket-elevator", influence: 0.18 },
  { from: "cement-mill-2", to: "bucket-elevator", influence: 0.18 },
  { from: "bucket-elevator", to: "conveyor-line-1", influence: 0.24 },
  { from: "conveyor-line-1", to: "bucket-elevator", influence: 0.16 },
] as const;

interface FaultProfile {
  id: string;
  name: string;
  cause: string;
  durationDays: number;
  targetMetrics: readonly string[];
  sensorRatios: Record<string, number>;
}

interface FaultPlan extends FaultProfile {
  machineId: string;
  onsetStep: number;
  durationSteps: number;
  resolvedAtStep?: number;
}

const PROFILES: FaultProfile[] = [
  {
    id: "bearing-wear",
    name: "Rulman aşınması",
    cause: "Artan çalışma yüküyle birlikte ilerleyen rulman veya yağlama bozulması",
    durationDays: 2.4,
    targetMetrics: ["bearingTemperature"],
    sensorRatios: {
      vibration: 1.02,
      bearingTemperature: 0.72,
      current: 0.16,
      rpm: 0.14,
      power: 0.18,
    },
  },
  {
    id: "fan-cooling-restriction",
    name: "Termal veya akış kısıtı",
    cause: "Soğutma ya da gaz akışındaki kısıt, yağlama sorunu veya artan proses yükü",
    durationDays: 2.1,
    targetMetrics: ["temperature", "bearingTemperature", "flow", "pressure"],
    sensorRatios: {
      temperature: 0.55,
      bearingTemperature: 0.86,
      flow: 0.5,
      pressure: 0.48,
      vibration: 0.62,
      current: 0.22,
      power: 0.24,
      rpm: 0.12,
    },
  },
  {
    id: "crusher-imbalance",
    name: "Dönen ekipman dengesizliği",
    cause: "Dengesiz aşınma, gevşek bağlantı, hizasızlık veya darbeli besleme",
    durationDays: 1.8,
    targetMetrics: ["vibration", "rpm"],
    sensorRatios: {
      vibration: 1.18,
      rpm: 0.4,
      current: 0.32,
      bearingTemperature: 0.38,
      power: 0.28,
      temperature: 0.24,
    },
  },
  {
    id: "mill-feed-overload",
    name: "Proses yükü artışı",
    cause: "Besleme özelliklerindeki değişim, akış direnci veya tahrik verimindeki düşüş",
    durationDays: 2.6,
    targetMetrics: ["power", "current", "pressure", "flow"],
    sensorRatios: {
      power: 0.58,
      current: 0.7,
      pressure: 0.5,
      flow: 0.45,
      vibration: 0.64,
      bearingTemperature: 0.4,
      temperature: 0.35,
      rpm: 0.2,
    },
  },
  {
    id: "conveyor-misalignment",
    name: "Tahrik direnci veya hizasızlık",
    cause: "Hizasızlık, rulman sürtünmesi, malzeme birikmesi veya artan tahrik direnci",
    durationDays: 2.2,
    targetMetrics: ["current", "rpm", "power", "bearingTemperature"],
    sensorRatios: {
      current: 0.7,
      bearingTemperature: 0.62,
      rpm: 0.35,
      power: 0.5,
      vibration: 0.55,
      pressure: 0.42,
      temperature: 0.3,
    },
  },
];

const wearSensitivity = (metric: string) =>
  metric === "vibration"
    ? 0.24
    : metric.toLowerCase().includes("temperature")
      ? 0.18
      : metric === "power" || metric === "current"
        ? 0.08
        : metric === "rpm"
          ? 0.04
          : 0.03;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next() {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  between(min: number, max: number) {
    return min + (max - min) * this.next();
  }
}

export class AutonomousPlant {
  readonly conditions = new Map<string, MachineCondition>();
  readonly events: SimulationEvent[] = [];
  readonly seed: number;
  private random: SeededRandom;
  private plans: FaultPlan[] = [];
  private ratios = new Map<string, Record<string, number>>();
  private emittedImpacts = new Set<string>();
  private initialWear = new Map<string, number>();

  constructor(
    private machines: Machine[],
    seed: number,
  ) {
    this.seed = Math.trunc(seed) >>> 0 || 20260908;
    this.random = new SeededRandom(this.seed);
    this.initializeConditions();
    this.planFaults();
  }

  private initializeConditions() {
    for (const machine of this.machines) {
      const wear = +this.random.between(0.025, 0.075).toFixed(5);
      this.initialWear.set(machine.id, wear);
      this.conditions.set(machine.id, {
        machineId: machine.id,
        healthIndex: 98,
        wear,
        load: 0.82,
        stage: "HEALTHY",
        processImpactFrom: [],
      });
    }
  }

  private planFaults() {
    const profiles = [...PROFILES];
    for (let i = profiles.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.next() * (i + 1));
      [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
    }
    const targetRandom = new SeededRandom(this.seed ^ 0xa511e9b3);
    const available = [...this.machines];
    const windows = [1.35, 4.25, 7.15, 9.35, 12.4];
    this.plans = profiles.map((profile, index) => {
      const eligible = available.filter((machine) =>
        machine.sensors.some((sensor) =>
          profile.targetMetrics.includes(sensor.metric),
        ),
      );
      const pool = eligible.length ? eligible : available;
      const machine = pool[Math.floor(targetRandom.next() * pool.length)];
      available.splice(
        available.findIndex((candidate) => candidate.id === machine.id),
        1,
      );
      const onsetDays = windows[index] + this.random.between(-0.28, 0.28);
      const durationDays = profile.durationDays * this.random.between(0.9, 1.12);
      return {
        ...profile,
        machineId: machine.id,
        onsetStep: Math.max(1, Math.round(onsetDays * STEPS_PER_DAY)),
        durationSteps: Math.round(durationDays * STEPS_PER_DAY),
      };
    });
  }

  private progress(plan: FaultPlan, step: number) {
    if (step < plan.onsetStep || plan.resolvedAtStep !== undefined) return 0;
    return clamp((step - plan.onsetStep + 1) / plan.durationSteps, 0, 1);
  }

  private stage(progress: number): FaultStage {
    if (progress <= 0) return "HEALTHY";
    if (progress < 0.22) return "INCIPIENT";
    if (progress < 0.58) return "DEGRADING";
    if (progress < 0.86) return "WARNING";
    return "CRITICAL";
  }

  tick(step: number, timestamp: string) {
    this.ratios.clear();
    const dayCycle = Math.sin(((step % STEPS_PER_DAY) / STEPS_PER_DAY) * Math.PI * 2 - 1.1);
    const plantLoad = clamp(
      0.84 + dayCycle * 0.09 + Math.sin(step * 0.17) * 0.018,
      0.68,
      0.98,
    );

    for (const [index, machine] of this.machines.entries()) {
      const condition = this.conditions.get(machine.id)!;
      const plan = this.plans.find((candidate) => candidate.machineId === machine.id);
      const progress = plan ? this.progress(plan, step) : 0;
      const previousStage = condition.stage;
      const load = clamp(
        plantLoad * (0.965 + (index % 4) * 0.018) + this.random.between(-0.009, 0.009),
        0.62,
        1.04,
      );
      condition.load = +load.toFixed(3);
      condition.wear = +clamp(
        condition.wear + 0.000035 * load * (1 + progress * 2.2),
        0,
        1,
      ).toFixed(5);
      condition.stage = this.stage(progress);
      condition.healthIndex = +clamp(
        99 - condition.wear * 32 - progress * 62,
        5,
        99,
      ).toFixed(1);
      condition.processImpactFrom = [];
      if (plan && progress > 0) {
        condition.faultType = plan.name;
        condition.probableCause = plan.cause;
        condition.startedAt ??= timestamp;
        if (previousStage === "HEALTHY")
          this.events.push({
            id: `${this.seed}:${plan.id}:${plan.onsetStep}`,
            timestamp,
            day: Math.floor(step / STEPS_PER_DAY) + 1,
            machineId: machine.id,
            type: "FAULT_ONSET",
            title: `${machine.name} üzerinde erken bozulma başladı`,
            description:
              "Gizli simülasyon durumu sensörlere kademeli ve ilişkili olarak yansıtılıyor.",
          });
      } else if (!plan || plan.resolvedAtStep !== undefined) {
        condition.faultType = undefined;
        condition.probableCause = undefined;
        condition.startedAt = undefined;
        if (plan?.resolvedAtStep !== undefined) condition.stage = "MAINTAINED";
      }

      const sensorRatios: Record<string, number> = {};
      const wearGrowth = Math.max(
        0,
        condition.wear - (this.initialWear.get(machine.id) ?? condition.wear),
      );
      for (const sensor of machine.sensors) {
        const loadSensitivity =
          sensor.metric === "power" || sensor.metric === "current"
            ? 0.16
            : sensor.metric.toLowerCase().includes("temperature")
              ? 0.075
              : sensor.metric === "vibration"
                ? 0.045
                : 0.025;
        const loadRatio = (load - 0.84) * loadSensitivity;
        const faultRatio = (plan?.sensorRatios[sensor.metric] ?? 0) * progress;
        const wearRatio = wearGrowth * wearSensitivity(sensor.metric);
        sensorRatios[sensor.metric] = loadRatio + wearRatio + faultRatio;
      }
      this.ratios.set(machine.id, sensorRatios);
    }

    this.applyProcessImpacts(step, timestamp);
  }

  private applyProcessImpacts(step: number, timestamp: string) {
    for (const sourcePlan of this.plans) {
      const progress = this.progress(sourcePlan, step);
      if (progress < 0.28) continue;
      const source = this.machines.find(
        (machine) => machine.id === sourcePlan.machineId,
      );
      if (!source) continue;
      const queue: { machineId: string; strength: number; path: string[] }[] = [
        {
          machineId: sourcePlan.machineId,
          strength: progress,
          path: [sourcePlan.machineId],
        },
      ];
      const strongest = new Map<string, number>();
      while (queue.length) {
        const current = queue.shift()!;
        for (const link of PROCESS_LINKS.filter(
          (candidate) => candidate.from === current.machineId,
        )) {
          if (current.path.includes(link.to)) continue;
          const strength = current.strength * link.influence;
          if (strength < 0.0001) continue;
          const previousStrength = strongest.get(link.to) ?? 0;
          if (strength <= previousStrength) continue;
          const delta = strength - previousStrength;
          strongest.set(link.to, strength);
          const target = this.machines.find((machine) => machine.id === link.to);
          const condition = this.conditions.get(link.to);
          if (!target || !condition) continue;
          if (!condition.processImpactFrom.includes(sourcePlan.machineId))
            condition.processImpactFrom.push(sourcePlan.machineId);
          condition.load = +clamp(
            condition.load + delta * 0.12,
            0,
            1.08,
          ).toFixed(3);
          const currentRatios = this.ratios.get(link.to)!;
          for (const sensor of target.sensors) {
            const response =
              sensor.metric === "power" || sensor.metric === "current"
                ? 0.085
                : sensor.metric.toLowerCase().includes("temperature")
                  ? 0.055
                  : 0.025;
            currentRatios[sensor.metric] =
              (currentRatios[sensor.metric] ?? 0) + delta * response;
          }
          const eventKey = `${sourcePlan.id}:${sourcePlan.machineId}:${link.to}`;
          if (!this.emittedImpacts.has(eventKey)) {
            this.emittedImpacts.add(eventKey);
            const route = [...current.path, link.to]
              .map(
                (id) =>
                  this.machines.find((machine) => machine.id === id)?.name ?? id,
              )
              .join(" → ");
            this.events.push({
              id: `${this.seed}:impact:${eventKey}`,
              timestamp,
              day: Math.floor(step / STEPS_PER_DAY) + 1,
              machineId: link.to,
              type: "PROCESS_IMPACT",
              title: `${target.name} proses yükünden etkileniyor`,
              description: `${source.name} kaynaklı durum ${route} rotası üzerinden çalışma yüküne yansıdı.`,
            });
          }
          queue.push({
            machineId: link.to,
            strength,
            path: [...current.path, link.to],
          });
        }
      }
    }
  }

  sensorRatio(machineId: string, metric: string) {
    return this.ratios.get(machineId)?.[metric] ?? 0;
  }

  noise(amplitude: number) {
    return this.random.between(-amplitude, amplitude);
  }

  maintain(machineId: string, step: number, timestamp: string) {
    const condition = this.conditions.get(machineId);
    if (!condition) return;
    for (const plan of this.plans)
      if (plan.machineId === machineId && plan.resolvedAtStep === undefined)
        plan.resolvedAtStep = step;
    condition.wear = +(condition.wear * 0.35).toFixed(5);
    condition.healthIndex = 96;
    condition.stage = "MAINTAINED";
    condition.faultType = undefined;
    condition.probableCause = undefined;
    condition.processImpactFrom = [];
    this.events.push({
      id: `${this.seed}:maintenance:${machineId}:${step}`,
      timestamp,
      day: Math.floor(step / STEPS_PER_DAY) + 1,
      machineId,
      type: "MAINTENANCE_EFFECT",
      title: `${this.machines.find((machine) => machine.id === machineId)?.name ?? machineId} bakımı uygulandı`,
      description: "Aktif bozulma etkisi kaldırıldı ve yıpranma azaltıldı.",
    });
  }
}
