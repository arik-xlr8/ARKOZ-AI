import { Component, signal, computed, OnDestroy } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { CommonModule, registerLocaleData } from "@angular/common";
import localeTr from "@angular/common/locales/tr";
import { LOCALE_ID } from "@angular/core";
import { tr } from "../../backend/src/locale";
registerLocaleData(localeTr);
import { FormsModule } from "@angular/forms";
import { SensorChart, type Point } from "./chart";
import type {
  Asset,
  Alert,
  Task,
  SensorConfig,
  Forecast,
  MaintenanceRecord,
} from "../../backend/src/domain";
import type { AnalysisResult } from "../../backend/src/analysis";
interface Simulation {
  scenario: string;
  mode: "autonomous" | "scenario";
  running: boolean;
  step: number;
  day: number;
  completedDays: number;
  maxSteps: number;
  seed: number;
  now: string;
}
interface Dashboard {
  machines: Asset[];
  plantHealth: number;
  online: number;
  highRisk: number;
  mediumRisk: number;
  criticalAlerts: number;
  predictedRisks: number;
  openRecommendations: number;
  lastUpdate: string;
  simulation: Simulation;
}
interface Sensor extends SensorConfig {
  history: Point[];
}
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  provider?: string;
  sources?: { machineId: string; name: string; timestamp: string }[];
}
interface CriticalAssetReport {
  machineId: string;
  machine: string;
  riskLevel: string;
  healthScore: number;
  summary: string;
}
interface DailyReport {
  id: string;
  date: string;
  day: number;
  generatedAt: string;
  provider: string;
  forecastModels: string[];
  fallbackReason?: string;
  plantHealth: number;
  criticalAssets: CriticalAssetReport[];
  summary: string;
  outlook: string;
  recommendedFocus: string[];
}
interface EventReport {
  id: string;
  timestamp: string;
  machineId: string;
  machine: string;
  fromRisk: string;
  toRisk: string;
  summary: string;
}
interface ReportsResponse {
  daily: DailyReport[];
  events: EventReport[];
}
interface FactoryCalendarDay {
  iso: string;
  day: number;
  weekday: string;
  distance: number;
}
@Component({
  selector: "app-root",
  imports: [CommonModule, FormsModule, SensorChart],
  templateUrl: "./app.html",
})
class App implements OnDestroy {
  tr = tr;
  translatedModels(models: string[]) {
    return models.map((model) => tr(model)).join(", ");
  }
  pages = [
    { name: "Genel Bakış", icon: "fa-solid fa-chart-pie" },
    { name: "Ekipmanlar", icon: "fa-solid fa-gears" },
    { name: "Alarmlar", icon: "fa-solid fa-triangle-exclamation" },
    { name: "Tahminler", icon: "fa-solid fa-chart-line" },
    { name: "Günlük Analizler", icon: "fa-solid fa-file-waveform" },
    { name: "Bakım", icon: "fa-solid fa-screwdriver-wrench" },
    { name: "Yapay Zekâ Asistanı", icon: "fa-solid fa-diamond ai-sparkle" },
    { name: "Ayarlar", icon: "fa-solid fa-gear" },
  ];
  page = signal("Genel Bakış");
  dash = signal<Dashboard | null>(null);
  selected = signal<Asset | null>(null);
  sensors = signal<Sensor[]>([]);
  forecasts = signal<Record<string, Forecast>>({});
  assessment = signal<(AnalysisResult & { asOf: string }) | null>(null);
  alerts = signal<Alert[]>([]);
  tasks = signal<Task[]>([]);
  history = signal<(MaintenanceRecord & { machine: string })[]>([]);
  dailyReports = signal<DailyReport[]>([]);
  eventReports = signal<EventReport[]>([]);
  reportsLoading = signal(false);
  scenarios = signal<{ id: string; name: string }[]>([]);
  settings = signal<{
    thresholdLabel: string;
    storage: string;
    geminiConfigured: boolean;
    dataSource: string;
    forecastProvider: string;
    sensors: { machine: string; sensors: SensorConfig[] }[];
  } | null>(null);
  error = signal("");
  notice = signal("");
  busy = signal(false);
  manualRefreshing = signal(false);
  chatBusy = signal(false);
  messages = signal<ChatMessage[]>([]);
  search = "";
  simulationMode: "autonomous" | "scenario" = "autonomous";
  simulationSeed = 20260908;
  scenarioId = "bearing";
  forecastMachine = "kiln-main-motor";
  forecastMetric = "vibration";
  horizon = 16;
  chatInput = "";
  alertFilter = "ACTIVE";
  private timer: ReturnType<typeof setInterval>;
  private refreshing = false;
  private detailVersion = 0;
  private routeHandler = () => void this.restoreRoute();
  machines = computed(() => this.dash()?.machines ?? []);
  attention = computed(() =>
    this.machines().filter((m) => m.riskLevel !== "LOW"),
  );
  detailCharts = computed(() =>
    this.sensors()
      .filter(
        (s) =>
          s.metric === "vibration" ||
          s.metric.toLowerCase().includes("temperature"),
      )
      .slice(0, 2),
  );
  activeAlerts = computed(
    () => this.alerts().filter((a) => a.status !== "RESOLVED").length,
  );
  factoryCalendar = computed(() => {
    const simulation = this.dash()?.simulation;
    const timestamp = simulation?.now ?? this.dash()?.lastUpdate;
    if (!simulation || !timestamp) return null;
    const current = new Date(timestamp);
    const currentMidnight = Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
    );
    const origin = currentMidnight - (simulation.day - 1) * 86_400_000;
    const currentIndex = simulation.day - 1 + 2;
    const totalDays = Math.max(5, Math.ceil(simulation.maxSteps / 96) + 5);
    const weekdayFormatter = new Intl.DateTimeFormat("tr-TR", {
      weekday: "short",
      timeZone: "UTC",
    });
    const monthFormatter = new Intl.DateTimeFormat("tr-TR", {
      month: "long",
      timeZone: "UTC",
    });
    const days: FactoryCalendarDay[] = Array.from(
      { length: totalDays },
      (_, index) => {
        const date = new Date(origin + (index - 2) * 86_400_000);
        return {
          iso: date.toISOString().slice(0, 10),
          day: date.getUTCDate(),
          weekday: weekdayFormatter.format(date).replace(".", ""),
          distance: index - currentIndex,
        };
      },
    );
    return {
      days,
      month: monthFormatter.format(current),
      year: current.getUTCFullYear(),
      currentIso: new Date(currentMidnight).toISOString().slice(0, 10),
      shift: -(currentIndex - 2) * 50,
    };
  });
  constructor() {
    window.addEventListener("hashchange", this.routeHandler);
    void this.initialize();
    this.timer = setInterval(() => void this.refresh(), 3000);
  }
  ngOnDestroy() {
    clearInterval(this.timer);
    window.removeEventListener("hashchange", this.routeHandler);
  }
  async api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    const r = await fetch(
      "/api" + path,
      body !== undefined
        ? {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
    );
    if (!r.ok) {
      const error = await r
        .json()
        .catch(() => ({ error: "İstek tamamlanamadı" }));
      throw new Error(error.error ?? "İstek tamamlanamadı");
    }
    return r.json();
  }
  async restoreRoute() {
    const route = decodeURIComponent(location.hash.slice(1));
    if (route.startsWith("assets/")) {
      const id = route.slice(7);
      if (this.selected()?.id !== id || this.page() !== "Ekipman detayı")
        this.openById(id);
    } else {
      const p = this.pages.find(
        (p) => p.name.toLowerCase().replaceAll(" ", "-") === route,
      );
      if (p && this.page() !== p.name) await this.navigate(p.name);
    }
  }
  async initialize() {
    await this.refresh();
    const simulation = this.dash()?.simulation;
    if (simulation) {
      this.simulationMode =
        simulation.mode ??
        (simulation.scenario === "normal" ? "autonomous" : "scenario");
      this.simulationSeed = simulation.seed ?? this.simulationSeed;
    }
    await this.restoreRoute();
    try {
      const s = await this.api<{ scenarios: { id: string; name: string }[] }>(
        "/simulation/scenarios",
      );
      this.scenarios.set(s.scenarios);
    } catch (e) {
      this.fail(e);
    }
  }
  fail(e: unknown) {
    this.error.set(
      e instanceof TypeError
        ? "Sunucuya bağlanılamadı. Bağlantıyı kontrol edip tekrar deneyin."
        : e instanceof Error
          ? e.message
          : "Bağlantı kurulamadı",
    );
  }
  async refresh(showFeedback = false) {
    if (this.refreshing) {
      if (showFeedback)
        this.notice.set("Veriler zaten yenileniyor. Güncel sonuçlar birazdan gösterilecek.");
      return;
    }
    this.refreshing = true;
    if (showFeedback) {
      this.manualRefreshing.set(true);
      this.notice.set("");
    }
    try {
      const d = await this.api<Dashboard>("/dashboard");
      this.dash.set(d);
      this.error.set("");
      const [a, m] = await Promise.all([
        this.api<Alert[]>("/alerts"),
        this.api<{
          tasks: Task[];
          history: (MaintenanceRecord & { machine: string })[];
        }>("/maintenance"),
      ]);
      this.alerts.set(a);
      this.tasks.set(m.tasks);
      this.history.set(m.history);
      if (this.selected() && this.page() === "Ekipman detayı") {
        this.selected.set(
          d.machines.find((m) => m.id === this.selected()!.id) ?? null,
        );
        await this.loadDetail(false);
      }
      if (this.page() === "Tahminler") await this.loadForecast();
      if (this.page() === "Günlük Analizler") await this.loadReports(false);
      if (showFeedback)
        this.notice.set(
          `Fabrika, alarm ve bakım verileri ${new Intl.DateTimeFormat("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date())} itibarıyla yenilendi.`,
        );
    } catch (e) {
      this.fail(e);
    } finally {
      this.refreshing = false;
      if (showFeedback) this.manualRefreshing.set(false);
    }
  }
  async navigate(page: string) {
    this.page.set(page);
    this.notice.set("");
    if (page === "Tahminler") await this.loadForecast();
    if (page === "Günlük Analizler") await this.loadReports();
    if (page === "Ayarlar")
      try {
        this.settings.set(await this.api("/settings"));
      } catch (e) {
        this.fail(e);
      }
    location.hash = page.toLowerCase().replaceAll(" ", "-");
  }
  filteredMachines() {
    return this.machines().filter((m) =>
      (m.name + " " + m.location)
        .toLocaleLowerCase("tr-TR")
        .includes(this.search.toLocaleLowerCase("tr-TR")),
    );
  }
  filteredAlerts() {
    return this.alerts().filter(
      (a) =>
        this.alertFilter === "ALL" ||
        (this.alertFilter === "ACTIVE"
          ? a.status !== "RESOLVED"
          : a.status === this.alertFilter),
    );
  }
  async openMachine(m: Asset) {
    this.selected.set(m);
    this.sensors.set([]);
    this.forecasts.set({});
    this.assessment.set(null);
    this.page.set("Ekipman detayı");
    location.hash = "assets/" + m.id;
    await this.loadDetail(true);
  }
  async loadDetail(includeAnalysis: boolean) {
    const m = this.selected();
    if (!m) return;
    const version = ++this.detailVersion;
    try {
      const sensors = await this.api<Sensor[]>(
        "/machines/" + m.id + "/sensors",
      );
      const charts = sensors
        .filter(
          (s) =>
            s.metric === "vibration" ||
            s.metric.toLowerCase().includes("temperature"),
        )
        .slice(0, 2);
      const f = await Promise.all(
        charts.map((s) =>
          this.api<Forecast>(
            "/machines/" +
              m.id +
              "/forecast?metric=" +
              s.metric +
              "&horizon=16",
          ),
        ),
      );
      if (version !== this.detailVersion || this.selected()?.id !== m.id)
        return;
      this.sensors.set(sensors);
      this.forecasts.set(Object.fromEntries(f.map((v) => [v.metric, v])));
      if ((includeAnalysis || !this.assessment()) && !this.busy())
        await this.analyze();
    } catch (e) {
      this.fail(e);
    }
  }
  async analyze() {
    const m = this.selected();
    if (!m) return;
    this.busy.set(true);
    try {
      const a = await this.api<AnalysisResult & { asOf: string }>(
        "/machines/" + m.id + "/analysis",
      );
      if (this.selected()?.id === m.id) this.assessment.set(a);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async activate() {
    this.busy.set(true);
    try {
      const seed = Math.max(
        1,
        Math.min(
          2147483647,
          Math.trunc(Number(this.simulationSeed) || 20260908),
        ),
      );
      const body =
        this.simulationMode === "autonomous"
          ? { mode: "autonomous", seed }
          : { mode: "scenario", scenarioId: this.scenarioId };
      if (this.simulationMode === "autonomous") this.simulationSeed = seed;
      await this.api("/simulation/activate", body);
      this.assessment.set(null);
      await this.refresh();
      this.notice.set(
        this.simulationMode === "autonomous"
          ? "Otonom fabrika başlatıldı. Üretim sürerken yıpranma, proses etkileri ve olası arızalar kendiliğinden gelişir."
          : "Test senaryosu başladı. Seçilen arıza gelişimi kontrollü biçimde uygulanıyor.",
      );
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async resetSimulation() {
    this.busy.set(true);
    try {
      const seed = Math.max(
        1,
        Math.min(
          2147483647,
          Math.trunc(Number(this.simulationSeed) || 20260908),
        ),
      );
      const body =
        this.simulationMode === "autonomous"
          ? { mode: "autonomous", seed }
          : { mode: "scenario", scenarioId: this.scenarioId };
      if (this.simulationMode === "autonomous") this.simulationSeed = seed;
      await this.api("/simulation/reset", body);
      this.assessment.set(null);
      await this.refresh();
      this.notice.set(
        "Simülasyon başa alındı ve durduruldu. Gün 1 · Adım 0; yeniden başlatmaya hazır.",
      );
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async pause() {
    try {
      await this.api("/simulation/pause", {
        paused: !!this.dash()?.simulation.running,
      });
      await this.refresh();
    } catch (e) {
      this.fail(e);
    }
  }
  async advance() {
    this.busy.set(true);
    try {
      await this.api("/simulation/step", { steps: 4 });
      this.assessment.set(null);
      await this.refresh();
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async advanceDay() {
    this.busy.set(true);
    try {
      await this.api("/simulation/step", { steps: 96 });
      this.assessment.set(null);
      await this.refresh();
      this.notice.set(
        "Bir simülasyon günü tamamlandı. Gün sonu analizi Günlük Analizler sayfasına kaydedildi.",
      );
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async loadReports(showLoading = true) {
    if (showLoading) this.reportsLoading.set(true);
    try {
      const reports = await this.api<ReportsResponse>("/reports");
      this.dailyReports.set(reports.daily ?? []);
      this.eventReports.set(reports.events ?? []);
    } catch (e) {
      this.fail(e);
    } finally {
      if (showLoading) this.reportsLoading.set(false);
    }
  }
  pageDescription() {
    if (this.page() === "Genel Bakış")
      return "Ekipman sağlığını izleyin. İnceleme gerektiren durumları erken fark edin.";
    if (this.page() === "Ekipman detayı")
      return `${this.selected()?.location ?? ""} · ${this.selected()?.type ?? ""}`;
    if (this.page() === "Tahminler")
      return "Sensör eğilimlerini ve tahmin edilen eşik aşımlarını inceleyin.";
    if (this.page() === "Günlük Analizler")
      return "Gün sonu fabrika değerlendirmelerini, ertesi gün görünümünü ve risk değişimlerini inceleyin.";
    if (this.page() === "Yapay Zekâ Asistanı")
      return "Sorular sorun, fabrikanızın verilerine dayalı yanıtlar alın.";
    return "Koşulları izleyin, kontrolleri önceliklendirin ve bakımı takip edin.";
  }
  activeMode() {
    return this.dash()?.simulation?.mode ?? "scenario";
  }
  simulationStatus() {
    const simulation = this.dash()?.simulation;
    if (!simulation) return "Simülasyon bilgisi bekleniyor";
    const mode =
      this.activeMode() === "autonomous" ? "Otonom fabrika" : "Test senaryosu";
    return simulation.running
      ? `${mode} çalışıyor · 3 saniyede 15 dakika`
      : `${mode} duraklatıldı`;
  }
  async acknowledge(id: string) {
    try {
      await this.api("/alerts/" + encodeURIComponent(id) + "/acknowledge", {});
      await this.refresh();
      this.notice.set("Alarm görüldü olarak işaretlendi. İzleme devam ediyor.");
    } catch (e) {
      this.fail(e);
    }
  }
  async createTask(machine: Asset, title?: string) {
    this.busy.set(true);
    this.notice.set("");
    try {
      await this.api("/maintenance", {
        machineId: machine.id,
        title:
          title ??
          "Kontrol: " +
            machine.name +
            " — " +
            machine.risk.signals
              .filter((s) => s.severity !== "LOW")
              .map((s) => s.label.toLowerCase())
              .join(" ve "),
      });
      await this.refresh();
      this.notice.set(
        "Bakım görevi oluşturuldu. İlerlemeyi Bakım sayfasından takip edebilirsiniz.",
      );
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  async updateTask(task: Task, status: string) {
    try {
      await this.api("/maintenance/" + task.id, { status }, "PATCH");
      await this.refresh();
    } catch (e) {
      this.fail(e);
    }
  }
  forecastSensors() {
    return (
      this.machines().find((m) => m.id === this.forecastMachine)?.sensors ?? []
    );
  }
  async changeForecastMachine() {
    this.forecastMetric = this.forecastSensors()[0]?.metric ?? "";
    await this.loadForecast();
  }
  async loadForecast() {
    try {
      const [s, f] = await Promise.all([
        this.api<Sensor[]>("/machines/" + this.forecastMachine + "/sensors"),
        this.api<Forecast>(
          "/machines/" +
            this.forecastMachine +
            "/forecast?metric=" +
            this.forecastMetric +
            "&horizon=" +
            this.horizon,
        ),
      ]);
      this.sensors.set(s);
      this.forecasts.set({ [f.metric]: f });
    } catch (e) {
      this.fail(e);
    }
  }
  forecastSensor() {
    return this.sensors().find((s) => s.metric === this.forecastMetric);
  }
  crossing() {
    const s = this.forecastSensor(),
      f = this.forecasts()[this.forecastMetric];
    if (!s || !f) return "";
    const last = s.history.at(-1)!;
    if (last.value >= s.warning) return "Uyarı eşiği şu anda aşılmış durumda";
    const p = f.forecast.find((p) => p.value >= s.warning);
    if (!p) return "Seçilen süre içinde uyarı eşiği aşımı öngörülmüyor";
    const minutes = Math.round(
      (Date.parse(p.timestamp) - Date.parse(last.timestamp)) / 60000,
    );
    return `Uyarı eşiğinin yaklaşık ${Math.floor(minutes / 60)} saat ${minutes % 60} dakika sonra aşılması öngörülüyor`;
  }
  async ask(question?: string) {
    const message = question ?? this.chatInput;
    if (!message.trim() || this.chatBusy()) return;
    this.chatInput = "";
    this.messages.update((m) => [...m, { role: "user", text: message }]);
    this.chatBusy.set(true);
    try {
      const r = await this.api<{
        answer: string;
        provider: string;
        sources: ChatMessage["sources"];
      }>("/copilot/chat", { message });
      this.messages.update((m) => [
        ...m,
        {
          role: "assistant",
          text: r.answer,
          provider: r.provider,
          sources: r.sources,
        },
      ]);
    } catch (e) {
      this.fail(e);
    } finally {
      this.chatBusy.set(false);
    }
  }
  openById(id: string) {
    const m = this.machines().find((m) => m.id === id);
    if (m) void this.openMachine(m);
  }
  machineIcon(type: string) {
    const value = type.toLocaleLowerCase("tr-TR");
    if (value.includes("motor")) return "fa-gear";
    if (value.includes("fan")) return "fa-fan";
    if (value.includes("fırın")) return "fa-fire-flame-curved";
    if (value.includes("soğutucu")) return "fa-snowflake";
    if (value.includes("kırıcı")) return "fa-hammer";
    if (value.includes("konveyör")) return "fa-forward";
    if (value.includes("elevatör")) return "fa-arrow-up-wide-short";
    if (value.includes("değirmen")) return "fa-gears";
    return "fa-industry";
  }
  trend(m: Asset) {
    const s = [...m.risk.signals].sort(
      (a, b) => (b.severity !== "LOW" ? 1 : 0) - (a.severity !== "LOW" ? 1 : 0),
    )[0];
    return s.ratePerHour > Math.abs(s.baseline) * 0.025
      ? "Yükseliyor"
      : s.ratePerHour < -Math.abs(s.baseline) * 0.025
        ? "Düşüyor"
        : "Kararlı";
  }
}
bootstrapApplication(App, {
  providers: [{ provide: LOCALE_ID, useValue: "tr-TR" }],
}).catch(console.error);
