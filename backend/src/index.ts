import dotenv from "dotenv";
import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { MockFactoryData, scenarios } from "./data.js";
import { FactoryService } from "./factory.js";
import { createAnalysisProvider, type AnalysisResult } from "./analysis.js";
import { FactoryCopilot } from "./copilot.js";
import { RISK_CONFIG } from "./risk.js";
import { ReportService } from "./reports.js";
dotenv.config({ path: process.env.ENV_FILE ?? ".env", quiet: true });
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
const data = new MockFactoryData(),
  factory = new FactoryService(data),
  analysis = createAnalysisProvider(),
  reports = new ReportService(factory),
  copilot = new FactoryCopilot(factory, analysis, reports);
const analysisCache = new Map<string, Promise<AnalysisResult>>();
let updating = false;
let updateQueue = Promise.resolve();
const maxSimulationSteps = () =>
  data.mode === "scenario" ? 32 : 30 * 96;
async function refresh(reportDay = data.day) {
  const assets = await factory.getCurrentRisks();
  reports.observe(assets, data.now, reportDay);
  return assets;
}
async function step(count = 1) {
  const operation = updateQueue.then(async () => {
    updating = true;
    try {
      const allowed = Math.min(
        count,
        Math.max(0, maxSimulationSteps() - data.step),
      );
      for (let i = 0; i < allowed; i++) {
        const completedBefore = data.completedDays;
        data.advance();
        factory.invalidate();
        analysisCache.clear();
        await refresh(
          data.completedDays > completedBefore ? data.completedDays : data.day,
        );
        if (
          data.mode === "autonomous" &&
          data.completedDays > completedBefore
        ) {
          await reports.generateDaily(data.completedDays, data.now);
        }
      }
      if (data.step >= maxSimulationSteps()) data.running = false;
    } finally {
      updating = false;
    }
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}
const state = () => ({
  mode: data.mode,
  scenario: data.scenario,
  running: data.running,
  step: data.step,
  day: data.day,
  completedDays: data.completedDays,
  seed: data.seed,
  maxSteps: maxSimulationSteps(),
  now: data.now,
  intervalMinutes: 15,
  wallSecondsPerStep: 3,
});
const simulationSelectionSchema = z
  .object({
    mode: z.enum(["autonomous", "scenario"]).optional(),
    scenarioId: z
      .enum(["normal", "bearing", "overheating", "vibration", "power"])
      .optional(),
    seed: z.number().int().min(1).max(2147483647).optional(),
  })
  .strict();
app.get("/api/health", async (_req, res) => {
  let forecast: unknown;
  try {
    const r = await fetch(
      (process.env.FORECAST_SERVICE_URL ?? "http://127.0.0.1:8000") + "/health",
      { signal: AbortSignal.timeout(2000) },
    );
    forecast = await r.json();
  } catch {
    forecast = { status: "unavailable", provider: "API trend fallback" };
  }
  res.json({
    api: "ok",
    forecast,
    analysis: process.env.GEMINI_API_KEY
      ? "gemini configured"
      : "deterministic",
    storage: "in-memory",
  });
});
app.get("/api/dashboard", async (_req, res) =>
  res.json({ ...(await factory.dashboard()), simulation: state() }),
);
app.get("/api/machines", async (_req, res) =>
  res.json(await factory.getCurrentRisks()),
);
app.get("/api/machines/:id", async (req, res) => {
  factory.getMachineDetails(req.params.id);
  res.json(
    (await factory.getCurrentRisks()).find((m) => m.id === req.params.id),
  );
});
app.get("/api/machines/:id/sensors", (req, res) =>
  res.json(
    factory.getMachineDetails(req.params.id).sensors.map((s) => ({
      ...s,
      history: factory.getMachineSensorHistory(req.params.id, s.metric),
    })),
  ),
);
app.get("/api/machines/:id/forecast", async (req, res) => {
  const q = z
    .object({
      metric: z.string().default("vibration"),
      horizon: z.coerce.number().int().min(1).max(96).default(16),
    })
    .parse(req.query);
  res.json(
    await factory.getMachineForecast(req.params.id, q.metric, q.horizon),
  );
});
app.get("/api/machines/:id/analysis", async (req, res) => {
  factory.getMachineDetails(req.params.id);
  const asset = (await factory.getCurrentRisks()).find(
    (m) => m.id === req.params.id,
  )!;
  const key = asset.id + asset.lastUpdate;
  if (!analysisCache.has(key)) {
    if (analysisCache.size > 50) analysisCache.clear();
    const forecasts = await factory.getMachineForecasts(asset.id, 96);
    analysisCache.set(key, analysis.analyze(asset, forecasts));
  }
  res.json({ ...(await analysisCache.get(key)), asOf: asset.lastUpdate });
});
app.get("/api/alerts", async (_req, res) => {
  await refresh();
  res.json(factory.alerts.all());
});
app.post("/api/alerts/:id/acknowledge", (req, res) => {
  const a = factory.alerts.get(req.params.id);
  if (!a) throw Object.assign(new Error("Alarm bulunamadı"), { status: 404 });
  if (a.status === "RESOLVED")
    throw Object.assign(
      new Error("Çözülmüş alarm görüldü olarak işaretlenemez"),
      {
        status: 409,
      },
    );
  factory.alerts.save({ ...a, status: "ACKNOWLEDGED" });
  res.json(factory.alerts.get(a.id));
});
app.get("/api/maintenance", (_req, res) =>
  res.json({
    tasks: factory.tasks.all(),
    history: data.machines.flatMap((m) =>
      m.maintenanceHistory.map((h) => ({
        ...h,
        machine: m.name,
        machineId: m.id,
      })),
    ),
  }),
);
app.get("/api/reports", (_req, res) =>
  res.json({ daily: reports.dailyReports(), events: reports.riskEvents() }),
);
app.post("/api/maintenance", async (req, res) => {
  const body = z
    .object({ machineId: z.string(), title: z.string().trim().min(3).max(200) })
    .strict()
    .parse(req.body);
  const m = factory.getMachineDetails(body.machineId);
  const asset = (await factory.getCurrentRisks()).find((a) => a.id === m.id)!;
  const existing = factory.tasks
    .all()
    .find(
      (t) =>
        t.machineId === m.id &&
        t.title === body.title &&
        t.status !== "COMPLETED",
    );
  if (existing) {
    res.status(200).json(existing);
    return;
  }
  const task = {
    id: randomUUID(),
    machineId: m.id,
    machine: m.name,
    title: body.title,
    priority: asset.riskLevel,
    status: "OPEN" as const,
    createdAt: data.now,
    recommendedBy: process.env.GEMINI_API_KEY
      ? "Yapay zekâ destekli / operatör onaylı"
      : "Kural tabanlı öneri / operatör onaylı",
  };
  factory.tasks.save(task);
  res.status(201).json(task);
});
app.patch("/api/maintenance/:id", async (req, res) => {
  const { status } = z
    .object({ status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED"]) })
    .strict()
    .parse(req.body);
  const task = factory.tasks.get(req.params.id);
  if (!task)
    throw Object.assign(new Error("Görev bulunamadı"), { status: 404 });
  factory.tasks.save({ ...task, status });
  if (status === "COMPLETED" && task.status !== "COMPLETED") {
    data.completeMaintenance(task.machineId, task.title);
    factory.invalidate();
    analysisCache.clear();
    await refresh();
  }
  res.json(factory.tasks.get(task.id));
});
app.post("/api/copilot/chat", async (req, res) => {
  const body = z
    .object({
      message: z.string().trim().min(1).max(1500),
      machineId: z.string().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(await copilot.chat(body.message, body.machineId));
});
app.get("/api/simulation/scenarios", (_req, res) =>
  res.json({ scenarios, state: state() }),
);
app.post("/api/simulation/activate", async (req, res) => {
  const body = simulationSelectionSchema.parse(req.body);
  if (updating) await updateQueue;
  const mode = body.mode ?? "scenario";
  if (mode === "autonomous") data.activateAutonomous(body.seed);
  else data.activate(body.scenarioId ?? "normal");
  reports.reset(data.runId);
  factory.invalidate();
  analysisCache.clear();
  await refresh();
  res.json(state());
});
app.post("/api/simulation/reset", async (req, res) => {
  const body = simulationSelectionSchema.parse(req.body);
  if (updating) await updateQueue;
  const mode = body.mode ?? data.mode;
  if (mode === "autonomous") data.activateAutonomous(body.seed ?? data.seed);
  else data.activate(body.scenarioId ?? data.scenario ?? "normal");
  data.running = false;
  factory.alerts.clear();
  factory.tasks.clear();
  reports.reset(data.runId);
  factory.invalidate();
  analysisCache.clear();
  await refresh();
  res.json(state());
});
app.post("/api/simulation/step", async (req, res) => {
  const { steps } = z
    .object({ steps: z.number().int().min(1).max(96).default(1) })
    .parse(req.body ?? {});
  await step(steps);
  res.json(state());
});
app.post("/api/simulation/pause", (req, res) => {
  const { paused } = z.object({ paused: z.boolean() }).strict().parse(req.body);
  data.running = !paused && data.step < maxSimulationSteps();
  res.json(state());
});
app.get("/api/settings", (_req, res) =>
  res.json({
    thresholdLabel:
      "SİMÜLASYON AYARLARI — üretici onaylı güvenlik sınırları değildir",
    riskConfig: RISK_CONFIG,
    sensors: data.machines.map((m) => ({
      machine: m.name,
      sensors: m.sensors,
    })),
    dataSource:
      "Seed ile tekrarlanabilir otonom fabrika ve kontrollü test senaryoları",
    storage: "Bellekte saklanır; sunucu yeniden başlatıldığında sıfırlanır",
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    forecastProvider: process.env.FORECAST_PROVIDER ?? "fallback",
  }),
);
app.use((_req, res) =>
  res.status(404).json({ error: "İstenen adres bulunamadı" }),
);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: "Geçersiz istek",
        details: err.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
      return;
    }
    const e = err as { status?: number; message?: string };
    console.warn("API request failed", e.message);
    res
      .status(e.status ?? 500)
      .json({ error: e.status ? e.message : "Sunucu hatası" });
  },
);
setInterval(() => {
  const withinLimit = data.step < maxSimulationSteps();
  if (data.running && !updating && withinLimit)
    void step().catch((e) =>
      console.warn("Simulation update failed", e.message),
    );
  if (!withinLimit) data.running = false;
}, 3000).unref();
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  console.log("ARKOZ AI API http://localhost:3000"),
);
