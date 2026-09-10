import { Component, signal, computed, OnDestroy } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { CommonModule, registerLocaleData } from "@angular/common";
import localeTr from "@angular/common/locales/tr";
import { LOCALE_ID } from "@angular/core";
import { tr } from "../../backend/src/locale";
registerLocaleData(localeTr);
import { FormsModule } from "@angular/forms";
import { SensorChart, type Point } from "./chart";
import { ChartTooltip, type ChartTooltipRow } from "./chart-tooltip";
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
interface BillingPoint {
  month: string;
  label: string;
  consumption: number;
  unitPrice: number;
  amount: number;
  lower?: number;
  upper?: number;
}
interface BillingCategory {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
  unit: string;
  color: string;
  history: BillingPoint[];
  forecast: BillingPoint[];
  share: number;
  changePercent: number;
}
interface BillingForecast {
  seed: number;
  currency: "TRY";
  generatedAt: string;
  forecastFallbackReason?: string;
  historyMonths: number;
  modelContextMonths: number;
  forecastMonths: number;
  model: string;
  categories: BillingCategory[];
  historyTotals: BillingPoint[];
  outlook: BillingPoint[];
  lastMonthTotal: number;
  nextMonthTotal: number;
  nextMonthLower: number;
  nextMonthUpper: number;
  changePercent: number;
  averageMonthlyTotal: number;
  electricityShare: number;
  annualEstimate: number;
  analysis: {
    provider: "gemini" | "deterministic";
    summary: string;
    keyDrivers: string[];
    recommendedActions: string[];
    fallbackReason?: string;
  };
}
@Component({
  selector: "app-root",
  imports: [CommonModule, FormsModule, SensorChart, ChartTooltip],
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
    { name: "Fatura Tahmini", icon: "fa-solid fa-file-invoice-dollar" },
    { name: "Yapay Zekâ Asistanı", icon: "fa-solid fa-hexagon-nodes" },
    { name: "Ayarlar", icon: "fa-solid fa-gear" },
  ];
  page = signal("Genel Bakış");
  authenticated = signal(false);
  loginBusy = signal(false);
  loginError = signal("");
  profileMenuOpen = signal(false);
  loginPassword = "";
  appLoading = signal(true);
  loadingProgress = signal(0);
  simulationEngaged = signal(false);
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
  billing = signal<BillingForecast | null>(null);
  billingLoading = signal(false);
  showBillingHistory = signal(false);
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
  billingSeed = 20260908;
  billingFocus = signal("electricity");
  scenarioId = "bearing";
  forecastMachine = "kiln-main-motor";
  forecastMetric = "vibration";
  horizon = 16;
  chatInput = "";
  alertFilter = "ACTIVE";
  private timer?: ReturnType<typeof setInterval>;
  private loadingTimer?: ReturnType<typeof setInterval>;
  private appStarted = false;
  private authToken = sessionStorage.getItem("arkoz-session") ?? "";
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
  factoryRunState = computed(() => {
    const simulation = this.dash()?.simulation;
    if (!simulation)
      return {
        label: "Bağlanıyor",
        tone: "ready",
      };
    if (simulation.mode === "scenario")
      return {
        label: simulation.running ? "Test çalışıyor" : "Test duraklatıldı",
        tone: simulation.running ? "running" : "paused",
      };
    if (simulation.running)
      return {
        label: "Üretim aktif",
        tone: "running",
      };
    return {
      label:
        simulation.step > 0 || this.simulationEngaged()
          ? "Üretim duraklatıldı"
          : "Başlatılmaya hazır",
      tone:
        simulation.step > 0 || this.simulationEngaged() ? "paused" : "ready",
    };
  });
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
  factoryTimeline = computed(() => {
    const simulation = this.dash()?.simulation;
    const timestamp = simulation?.now ?? this.dash()?.lastUpdate;
    if (!simulation || !timestamp) return null;
    const current = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Istanbul",
    });
    const timeAt = (offsetMinutes: number) =>
      formatter.format(new Date(current.getTime() + offsetMinutes * 60_000));
    const stepInDay = simulation.step % 96;
    const progress = (stepInDay / 96) * 100;
    return {
      current: timeAt(0),
      times: Array.from({ length: 11 }, (_, index) => {
        const offset = index - 5;
        return {
          offset,
          label: timeAt(offset * 15),
        };
      }),
      day: simulation.day || 1,
      step: simulation.step || 0,
      progress: Number(progress.toFixed(2)),
    };
  });
  billingSeries = computed(() => {
    const billing = this.billing();
    if (!billing) return [];
    if (this.billingFocus() === "total")
      return [
        ...billing.historyTotals.map((point) => ({
          ...point,
          forecast: false,
        })),
        ...billing.outlook.map((point) => ({ ...point, forecast: true })),
      ];
    const category = billing.categories.find(
      (candidate) => candidate.id === this.billingFocus(),
    );
    if (!category) return [];
    return [
      ...category.history.map((point) => ({ ...point, forecast: false })),
      ...category.forecast.map((point) => ({ ...point, forecast: true })),
    ];
  });
  billingChartMax = computed(() =>
    Math.max(
      1,
      ...this.billingSeries().map((point) => point.upper ?? point.amount),
    ),
  );
  billingFocusLabel = computed(() =>
    this.billingFocus() === "total"
      ? "Toplam gider"
      : (this.billing()?.categories.find(
          (category) => category.id === this.billingFocus(),
        )?.label ?? "Gider"),
  );
  billingFocusColor = computed(() =>
    this.billingFocus() === "total"
      ? "#e0002a"
      : (this.billing()?.categories.find(
          (category) => category.id === this.billingFocus(),
        )?.color ?? "#e0002a"),
  );
  billingFocusCategory = computed(() =>
    this.billing()?.categories.find(
      (category) => category.id === this.billingFocus(),
    ),
  );
  billingFocusForecast = computed(() => {
    const billing = this.billing();
    if (!billing) return [];
    return this.billingFocus() === "total"
      ? billing.outlook
      : (this.billingFocusCategory()?.forecast ?? []);
  });
  billingFocusHistory = computed(() => {
    const billing = this.billing();
    if (!billing) return [];
    return (
      this.billingFocus() === "total"
        ? billing.historyTotals
        : (this.billingFocusCategory()?.history ?? [])
    ).slice(-6);
  });
  billingFocusSummary = computed(() => {
    const billing = this.billing();
    if (!billing) return null;
    if (this.billingFocus() === "total")
      return {
        periodLabel: billing.outlook[0].label,
        contextLabel: "Toplam fatura",
        nextMonthTotal: billing.nextMonthTotal,
        lastMonthTotal: billing.lastMonthTotal,
        lower: billing.nextMonthLower,
        upper: billing.nextMonthUpper,
        changePercent: billing.changePercent,
        annualEstimate: billing.annualEstimate,
      };
    const category = billing.categories.find(
      (candidate) => candidate.id === this.billingFocus(),
    );
    if (!category) return null;
    const next = category.forecast[0];
    const last = category.history.at(-1)!;
    const averageForecast =
      category.forecast.reduce((sum, point) => sum + point.amount, 0) /
      Math.max(category.forecast.length, 1);
    return {
      periodLabel: `${billing.outlook[0].label} · ${category.shortLabel}`,
      contextLabel: category.label,
      nextMonthTotal: next.amount,
      lastMonthTotal: last.amount,
      lower: next.lower ?? next.amount,
      upper: next.upper ?? next.amount,
      changePercent: category.changePercent,
      annualEstimate: averageForecast * 12,
    };
  });
  recentBillingRows = computed(() => {
    const billing = this.billing();
    if (!billing) return [];
    return billing.historyTotals.slice(-6).map((total, relativeIndex) => {
      const index = billing.historyTotals.length - 6 + relativeIndex;
      return {
        ...total,
        categories: billing.categories.map((category) => ({
          id: category.id,
          amount: category.history[index].amount,
        })),
      };
    });
  });
  constructor() {
    if (this.authToken) {
      this.authenticated.set(true);
      this.startApplication();
    }
  }
  private startApplication() {
    if (this.appStarted) return;
    this.appStarted = true;
    this.beginLoading();
    window.addEventListener("hashchange", this.routeHandler);
    void this.initialize().finally(() => {
      if (this.authenticated() && this.appStarted)
        this.timer = setInterval(() => void this.refresh(), 3000);
    });
  }
  private beginLoading() {
    if (this.loadingTimer) clearInterval(this.loadingTimer);
    this.appLoading.set(true);
    this.loadingProgress.set(6);
    this.loadingTimer = setInterval(
      () =>
        this.loadingProgress.update((progress) => Math.min(92, progress + 2)),
      70,
    );
  }
  private async finishLoading() {
    if (this.loadingTimer) clearInterval(this.loadingTimer);
    this.loadingTimer = undefined;
    this.loadingProgress.set(100);
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (this.authenticated()) this.appLoading.set(false);
  }
  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.loadingTimer) clearInterval(this.loadingTimer);
    window.removeEventListener("hashchange", this.routeHandler);
  }
  async login() {
    if (this.loginBusy()) return;
    this.loginBusy.set(true);
    this.loginError.set("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.loginPassword }),
      });
      const result = await response
        .json()
        .catch(() => ({ error: "Giriş işlemi tamamlanamadı" }));
      if (!response.ok || !result.token)
        throw new Error(result.error ?? "Şifre hatalı");
      this.authToken = result.token;
      sessionStorage.setItem("arkoz-session", this.authToken);
      this.loginPassword = "";
      this.authenticated.set(true);
      this.startApplication();
    } catch (error) {
      this.loginError.set(
        error instanceof Error ? error.message : "Giriş işlemi tamamlanamadı",
      );
    } finally {
      this.loginBusy.set(false);
    }
  }
  private endSession(
    loginMessage = "Oturum sona erdi. Lütfen tekrar giriş yapın.",
  ) {
    this.authToken = "";
    sessionStorage.removeItem("arkoz-session");
    this.profileMenuOpen.set(false);
    this.authenticated.set(false);
    this.loginPassword = "";
    this.loginError.set(loginMessage);
    if (this.timer) clearInterval(this.timer);
    if (this.loadingTimer) clearInterval(this.loadingTimer);
    this.timer = undefined;
    this.loadingTimer = undefined;
    this.loadingProgress.set(0);
    this.appStarted = false;
    window.removeEventListener("hashchange", this.routeHandler);
  }
  logout() {
    this.endSession("");
  }
  async api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    const r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : method,
      headers: {
        "Content-Type": "application/json",
        "X-Arkoz-Session": this.authToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      const error = await r
        .json()
        .catch(() => ({ error: "İstek tamamlanamadı" }));
      if (r.status === 401) this.endSession();
      throw new Error(error.error ?? "İstek tamamlanamadı");
    }
    return r.json();
  }
  async restoreRoute() {
    const route = decodeURIComponent(location.hash.slice(1));
    if (!route) {
      window.history.replaceState(null, "", "#genel-bakış");
      if (this.page() !== "Genel Bakış") await this.navigate("Genel Bakış");
      return;
    }
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
    try {
      await this.refresh();
      if (!this.authenticated()) return;
      this.loadingProgress.update((progress) => Math.max(progress, 55));
      const [s, settings, reportData] = await Promise.all([
        this.api<{ scenarios: { id: string; name: string }[] }>(
          "/simulation/scenarios",
        ),
        this.api<NonNullable<ReturnType<typeof this.settings>>>("/settings"),
        this.api<ReportsResponse>("/reports"),
      ]);
      this.scenarios.set(s.scenarios);
      this.settings.set(settings);
      this.dailyReports.set(reportData.daily);
      this.eventReports.set(reportData.events);
      this.loadingProgress.update((progress) => Math.max(progress, 88));
      const simulation = this.dash()?.simulation;
      if (simulation) {
        this.simulationMode = "autonomous";
        this.simulationSeed = simulation.seed ?? this.simulationSeed;
      }
      await this.restoreRoute();
      this.loadingProgress.update((progress) => Math.max(progress, 96));
    } catch (e) {
      this.fail(e);
    } finally {
      if (this.authenticated()) await this.finishLoading();
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
        this.notice.set(
          "Veriler zaten yenileniyor. Güncel sonuçlar birazdan gösterilecek.",
        );
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
    const route = page.toLowerCase().replaceAll(" ", "-");
    if (location.hash !== "#" + route) location.hash = route;
    if (page === "Tahminler") await this.loadForecast();
    if (page === "Fatura Tahmini") await this.loadBilling();
    if (page === "Günlük Analizler") await this.loadReports();
    if (page === "Ayarlar")
      try {
        this.settings.set(await this.api("/settings"));
      } catch (e) {
        this.fail(e);
      }
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
      this.simulationEngaged.set(true);
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
      this.simulationEngaged.set(false);
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
      this.simulationEngaged.set(true);
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
  async loadBilling(showFeedback = false) {
    if (this.billingLoading()) return;
    this.billingLoading.set(true);
    if (showFeedback) this.notice.set("");
    try {
      const seed = Math.min(
        2_147_483_647,
        Math.max(1, Math.trunc(Number(this.billingSeed) || 20260908)),
      );
      this.billingSeed = seed;
      this.billing.set(
        await this.api<BillingForecast>(
          "/billing?seed=" + encodeURIComponent(seed),
        ),
      );
      if (showFeedback)
        this.notice.set(
          `${seed} tohumu ile fatura geçmişi ve yeni tahmin oluşturuldu.`,
        );
    } catch (e) {
      this.fail(e);
    } finally {
      this.billingLoading.set(false);
    }
  }
  randomizeBillingSeed() {
    this.billingSeed = Math.floor(Math.random() * 2_147_483_646) + 1;
    void this.loadBilling(true);
  }
  formatBillingCurrency(amount: number) {
    return `${Math.round(amount).toLocaleString("tr-TR")} ₺`;
  }
  formatBillingCompact(amount: number) {
    return `${(amount / 1_000_000).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MN ₺`;
  }
  billingPeriodDetail(point: BillingPoint) {
    const category = this.billingFocusCategory();
    if (!category) return "Toplam fabrika gideri";
    return `${Math.round(point.consumption).toLocaleString("tr-TR")} ${category.unit} · ${point.unitPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} ₺/${category.unit}`;
  }
  billingTooltipRows(
    point: BillingPoint & { forecast: boolean },
  ): ChartTooltipRow[] {
    const rows: ChartTooltipRow[] = [
      { label: "Tutar", value: this.formatBillingCurrency(point.amount) },
    ];
    const category = this.billing()?.categories.find(
      (candidate) => candidate.id === this.billingFocus(),
    );
    if (category) {
      rows.push(
        {
          label: "Tüketim",
          value: `${Math.round(point.consumption).toLocaleString("tr-TR")} ${category.unit}`,
        },
        {
          label: "Birim fiyat",
          value: `${point.unitPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} ₺/${category.unit}`,
        },
      );
    }
    if (
      point.forecast &&
      point.lower !== undefined &&
      point.upper !== undefined
    )
      rows.push({
        label: "Tahmin aralığı",
        value: `${this.formatBillingCompact(point.lower)} – ${this.formatBillingCompact(point.upper)}`,
      });
    return rows;
  }
  billingTooltipLabel(point: BillingPoint & { forecast: boolean }) {
    return `${this.billingFocusLabel()}, ${point.label}, ${point.forecast ? "model tahmini" : "simüle geçmiş"}, ${this.billingTooltipRows(
      point,
    )
      .map((row) => `${row.label}: ${row.value}`)
      .join(", ")}`;
  }
  billingBarHeight(amount: number) {
    return Math.max(4, (amount / this.billingChartMax()) * 100);
  }
  billingCategoryAmount(
    row: ReturnType<typeof this.recentBillingRows>[number],
    id: string,
  ) {
    return row.categories.find((category) => category.id === id)?.amount ?? 0;
  }
  pageDescription() {
    if (this.page() === "Genel Bakış")
      return "Ekipman sağlığını izleyin. İnceleme gerektiren durumları erken fark edin.";
    if (this.page() === "Ekipman detayı")
      return `${this.selected()?.location ?? ""} · ${this.selected()?.type ?? ""}`;
    if (this.page() === "Tahminler")
      return "Sensör eğilimlerini ve tahmin edilen eşik aşımlarını inceleyin.";
    if (this.page() === "Fatura Tahmini")
      return "Enerji ve işletme giderlerini izleyin, bir sonraki fatura dönemini öngörün.";
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
