import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { tr } from "../../backend/src/locale";

use([
  LineChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export interface Point {
  timestamp: string;
  value: number;
}

type RangeKey = "24h" | "3d" | "7d" | "14d" | "all" | "custom";

const RANGE_OPTIONS: {
  key: Exclude<RangeKey, "custom">;
  label: string;
  hours?: number;
}[] = [
  { key: "24h", label: "24 saat", hours: 24 },
  { key: "3d", label: "3 gün", hours: 72 },
  { key: "7d", label: "7 gün", hours: 168 },
  { key: "14d", label: "14 gün", hours: 336 },
  { key: "all", label: "Tümü" },
];

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

@Component({
  selector: "sensor-chart",
  template: `
    <div class="chart-title">
      <div>
        <strong>{{ label() }}</strong
        ><span class="muted"> · {{ unit() }}</span>
      </div>
      <div class="legend" aria-label="Grafik açıklaması">
        <span class="history-key">Geçmiş</span>
        <span class="forecast-key">Tahmin</span>
        <span class="threshold-key">Uyarı eşiği</span>
      </div>
    </div>

    <div class="sensor-chart-toolbar">
      <div class="sensor-chart-ranges" aria-label="Gösterilecek tarih aralığı">
        @for (range of ranges; track range.key) {
          <button
            type="button"
            [class.active]="selectedRange() === range.key"
            [attr.aria-pressed]="selectedRange() === range.key"
            (click)="setRange(range.key)"
          >
            {{ range.label }}
          </button>
        }
      </div>
      <span class="sensor-chart-window" aria-live="polite">{{
        visibleWindow()
      }}</span>
    </div>

    <div
      #chartHost
      class="sensor-chart-canvas"
      role="img"
      [attr.aria-label]="
        label() + ' sensör geçmişi ve tahmini; birim: ' + unit()
      "
      [attr.data-range]="selectedRange()"
    ></div>

    <div class="chart-note">
      <i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>
      Alt zaman çubuğunu sürükleyerek geçmişe gidin; kenarlarından tutarak
      aralığı daraltın. Grafik üzerinde kaydırabilir ve yakınlaştırabilirsiniz.
      <span>· {{ tr(model()) }} · 15 dakikalık örnekler</span>
    </div>
  `,
})
export class SensorChart implements AfterViewInit, OnDestroy {
  readonly tr = tr;
  readonly ranges = RANGE_OPTIONS;
  readonly history = input<Point[]>([]);
  readonly forecast = input<Point[]>([]);
  readonly label = input("Sensör");
  readonly unit = input("");
  readonly threshold = input(0);
  readonly model = input("linear-trend");
  readonly selectedRange = signal<RangeKey>("7d");
  readonly visibleWindow = signal("");
  readonly chartHost = viewChild<ElementRef<HTMLDivElement>>("chartHost");

  private chart?: ECharts;
  private resizeObserver?: ResizeObserver;
  private suppressZoomEvent = false;
  private customBounds?: { start: number; end: number };

  constructor() {
    effect(() => {
      this.history();
      this.forecast();
      this.label();
      this.unit();
      this.threshold();
      this.model();
      if (this.chart) this.render();
    });
  }

  ngAfterViewInit() {
    const element = this.chartHost()?.nativeElement;
    if (!element) return;
    this.chart = init(element, undefined, { renderer: "canvas" });
    this.chart.on("datazoom", () => {
      if (this.suppressZoomEvent) return;
      queueMicrotask(() => {
        const bounds = this.visibleBoundsFromChart();
        if (!bounds) return;
        this.customBounds = bounds;
        this.selectedRange.set("custom");
        this.visibleWindow.set(this.formatWindow(bounds.start, bounds.end));
      });
    });
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(element);
    this.render();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }

  setRange(range: Exclude<RangeKey, "custom">) {
    this.selectedRange.set(range);
    this.render();
  }

  private render() {
    if (!this.chart) return;
    const history = this.history();
    const forecast = this.forecast();
    const all = [...history, ...forecast];
    if (!all.length) {
      this.chart.clear();
      this.visibleWindow.set("Veri bulunamadı");
      return;
    }

    const { start, end } = this.rangeBounds(this.selectedRange());
    const latestHistory = history.at(-1);
    const historyData = history.map((point) => [
      Date.parse(point.timestamp),
      point.value,
    ]);
    const forecastData = [
      ...(latestHistory
        ? [[Date.parse(latestHistory.timestamp), latestHistory.value]]
        : []),
      ...forecast.map((point) => [Date.parse(point.timestamp), point.value]),
    ];

    this.suppressZoomEvent = true;
    this.chart.setOption(
      {
        animationDuration: 260,
        aria: {
          enabled: true,
          description: `${this.label()} sensör geçmişi ve model tahmini. Birim ${this.unit()}.`,
        },
        grid: { left: 58, right: 92, top: 22, bottom: 66 },
        tooltip: {
          trigger: "axis",
          confine: true,
          backgroundColor: "rgba(25, 27, 31, .96)",
          borderWidth: 0,
          padding: [10, 12],
          textStyle: {
            color: "#fff",
            fontFamily: "Manrope, DM Sans, sans-serif",
            fontSize: 13,
          },
          axisPointer: {
            type: "line",
            lineStyle: { color: "#9b9da2", type: "dashed" },
          },
          formatter: (params: unknown) => this.tooltip(params),
        },
        xAxis: {
          type: "time",
          min: Date.parse(all[0].timestamp),
          max: Date.parse(all.at(-1)!.timestamp),
          boundaryGap: false,
          axisLine: { lineStyle: { color: "#cfd1d5" } },
          axisTick: { show: false },
          axisLabel: {
            color: "#565b63",
            fontSize: 12,
            hideOverlap: true,
            formatter: (value: number) =>
              dateTimeFormatter.format(new Date(value)),
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          scale: true,
          name: this.unit(),
          nameTextStyle: { color: "#65686e", padding: [0, 0, 5, 0] },
          axisLabel: { color: "#565b63", fontSize: 12 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: "#e7e7e9" } },
        },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            startValue: start,
            endValue: end,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
            zoomOnMouseWheel: true,
            preventDefaultMouseMove: true,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            filterMode: "none",
            startValue: start,
            endValue: end,
            height: 22,
            bottom: 10,
            borderColor: "#dedfe2",
            backgroundColor: "#f4f4f5",
            fillerColor: "rgba(224, 0, 42, .12)",
            dataBackground: {
              lineStyle: { color: "#a8aaaf", width: 1 },
              areaStyle: { color: "rgba(168, 170, 175, .1)" },
            },
            selectedDataBackground: {
              lineStyle: { color: "#e0002a", width: 1.2 },
              areaStyle: { color: "rgba(224, 0, 42, .08)" },
            },
            handleStyle: {
              color: "#fff",
              borderColor: "#e0002a",
              borderWidth: 2,
            },
            moveHandleStyle: { color: "#e0002a", opacity: 0.35 },
            labelFormatter: (value: number) =>
              dateTimeFormatter.format(new Date(value)),
            brushSelect: false,
          },
        ],
        series: [
          {
            name: "Geçmiş",
            type: "line",
            data: historyData,
            showSymbol: false,
            symbol: "circle",
            symbolSize: 7,
            sampling: "lttb",
            smooth: 0.12,
            lineStyle: { color: "#e0002a", width: 2.2 },
            itemStyle: { color: "#e0002a" },
            emphasis: { focus: "series" },
          },
          {
            name: "Tahmin",
            type: "line",
            data: forecastData,
            showSymbol: false,
            symbol: "circle",
            symbolSize: 7,
            smooth: 0.12,
            lineStyle: { color: "#735fc3", width: 2.2, type: "dashed" },
            itemStyle: { color: "#735fc3" },
            areaStyle: { color: "rgba(115, 95, 195, .07)" },
            emphasis: { focus: "series" },
            markArea: latestHistory
              ? {
                  silent: true,
                  itemStyle: { color: "rgba(115, 95, 195, .045)" },
                  data: [
                    [
                      { xAxis: Date.parse(latestHistory.timestamp) },
                      { xAxis: end },
                    ],
                  ],
                }
              : undefined,
          },
          {
            name: "Uyarı eşiği",
            type: "line",
            data: [
              [Date.parse(all[0].timestamp), this.threshold()],
              [Date.parse(all.at(-1)!.timestamp), this.threshold()],
            ],
            silent: true,
            animation: false,
            showSymbol: false,
            symbol: "none",
            lineStyle: {
              color: "#d97706",
              type: "dashed",
              width: 1.8,
              opacity: 0.95,
            },
            endLabel: {
              show: true,
              formatter: `Uyarı ${this.formatValue(this.threshold())}`,
              color: "#8b4d08",
              backgroundColor: "#fff7e6",
              borderColor: "#f0c87a",
              borderWidth: 1,
              borderRadius: 4,
              padding: [3, 6],
              fontSize: 11,
              fontWeight: 700,
              distance: 8,
            },
            tooltip: { show: false },
            z: 4,
          },
        ],
      },
      { notMerge: true },
    );
    this.visibleWindow.set(this.formatWindow(start, end));
    queueMicrotask(() => {
      this.suppressZoomEvent = false;
    });
  }

  private rangeBounds(range: RangeKey) {
    const history = this.history();
    const forecast = this.forecast();
    const first = Date.parse(
      history[0]?.timestamp ?? forecast[0]?.timestamp ?? "",
    );
    const latestHistory = Date.parse(
      history.at(-1)?.timestamp ?? forecast.at(-1)?.timestamp ?? "",
    );
    const end = Date.parse(
      forecast.at(-1)?.timestamp ?? history.at(-1)?.timestamp ?? "",
    );
    const hours = RANGE_OPTIONS.find((option) => option.key === range)?.hours;
    if (range === "custom" && this.customBounds) return this.customBounds;
    return {
      start: hours
        ? Math.max(first, latestHistory - hours * 60 * 60 * 1000)
        : first,
      end,
    };
  }

  private visibleBoundsFromChart() {
    if (!this.chart) return undefined;
    const option = this.chart.getOption();
    const zoom = Array.isArray(option.dataZoom)
      ? option.dataZoom[0]
      : undefined;
    const axis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
    const fullStart = Number(axis?.min);
    const fullEnd = Number(axis?.max);
    const start = Number(
      zoom?.startValue ??
        fullStart + ((fullEnd - fullStart) * Number(zoom?.start ?? 0)) / 100,
    );
    const end = Number(
      zoom?.endValue ??
        fullStart + ((fullEnd - fullStart) * Number(zoom?.end ?? 100)) / 100,
    );
    return Number.isFinite(start) && Number.isFinite(end)
      ? { start, end }
      : undefined;
  }

  private tooltip(params: unknown) {
    const entries = Array.isArray(params) ? params : [params];
    const usable = entries.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    );
    const timestamp = Number((usable[0]?.["value"] as unknown[])?.[0]);
    const rows = usable
      .map((entry) => {
        const value = Number((entry["value"] as unknown[])?.[1]);
        const color =
          typeof entry["color"] === "string" ? entry["color"] : "#e0002a";
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:22px;margin-top:7px"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:${color}"></i>${this.escape(String(entry["seriesName"] ?? "Değer"))}</span><strong style="font-size:15px">${this.formatValue(value)} ${this.escape(this.unit())}</strong></div>`;
      })
      .join("");
    return `<div style="min-width:190px"><strong>${dateTimeFormatter.format(new Date(timestamp))}</strong>${rows}<div style="display:flex;justify-content:space-between;gap:22px;margin-top:7px;color:#d8b66b"><span>Uyarı eşiği</span><strong>${this.formatValue(this.threshold())} ${this.escape(this.unit())}</strong></div></div>`;
  }

  private formatValue(value: number) {
    return value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  }

  private formatWindow(start: number, end: number) {
    return `${dateTimeFormatter.format(new Date(start))} – ${dateTimeFormatter.format(new Date(end))}`;
  }

  private escape(value: string) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[character]!,
    );
  }
}
