import { Component, computed, input } from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import { tr } from "../../backend/src/locale";
export interface Point {
  timestamp: string;
  value: number;
}
@Component({
  selector: "sensor-chart",
  imports: [DatePipe, DecimalPipe],
  template: ` <div class="chart-title">
      <div>
        <strong>{{ label() }}</strong
        ><span class="muted"> · {{ unit() }}</span>
      </div>
      <div class="legend">
        <span class="history-key">Geçmiş</span
        ><span class="forecast-key">Tahmin</span
        ><span class="threshold-key">Uyarı eşiği</span>
      </div>
    </div>
    <svg
      viewBox="0 0 760 240"
      role="img"
      [attr.aria-label]="label() + ' geçmişi ve tahmini; birim: ' + unit()"
    >
      <rect
        [attr.x]="boundary()"
        y="16"
        [attr.width]="720 - boundary()"
        height="184"
        fill="#a2a0ff"
        opacity=".045"
      />
      @for (tick of ticks(); track tick) {
        <line
          x1="54"
          x2="720"
          [attr.y1]="y(tick)"
          [attr.y2]="y(tick)"
          stroke="#293840"
        />
        <text x="44" [attr.y]="y(tick) + 4" text-anchor="end">
          {{ tick | number: "1.0-1" }}
        </text>
      }
      <line
        x1="54"
        x2="720"
        [attr.y1]="y(threshold())"
        [attr.y2]="y(threshold())"
        stroke="#d3a653"
        stroke-dasharray="4 5"
        opacity=".8"
      />
      <path
        [attr.d]="historyPath()"
        fill="none"
        stroke="#53cdb6"
        stroke-width="2.4"
      />
      <path
        [attr.d]="forecastPath()"
        fill="none"
        stroke="#aaa5ff"
        stroke-width="2.4"
        stroke-dasharray="6 4"
      />
      <line
        [attr.x1]="boundary()"
        [attr.x2]="boundary()"
        y1="16"
        y2="205"
        stroke="#72818b"
        stroke-dasharray="3 4"
      />
      <text [attr.x]="boundary() + 7" y="29">ŞİMDİ</text>
      <text x="54" y="226">
        {{ visible()[0]?.timestamp | date: "d MMM, HH:mm" }}
      </text>
      <text x="720" y="226" text-anchor="end">
        {{ end() | date: "d MMM, HH:mm" }}
      </text>
    </svg>
    <div class="chart-note">
      {{ tr(model()) }} · Nokta tahmini; belirsizlik kalibre edilmemiştir · 15
      dakikalık örnekler
    </div>`,
})
export class SensorChart {
  tr = tr;
  history = input<Point[]>([]);
  forecast = input<Point[]>([]);
  label = input("Sensör");
  unit = input("");
  threshold = input(0);
  model = input("linear-trend");
  visible = computed(() => this.history().slice(-96));
  all = computed(() => [...this.visible(), ...this.forecast()]);
  min = computed(
    () => Math.min(this.threshold(), ...this.all().map((p) => p.value)) * 0.9,
  );
  max = computed(
    () => Math.max(this.threshold(), ...this.all().map((p) => p.value)) * 1.08,
  );
  end = computed(() => this.all().at(-1)?.timestamp ?? "");
  ticks = computed(() =>
    Array.from(
      { length: 5 },
      (_, i) => this.min() + ((this.max() - this.min()) * i) / 4,
    ),
  );
  x(t: string) {
    const start = Date.parse(this.all()[0]?.timestamp ?? "");
    return (
      54 +
      ((Date.parse(t) - start) / (Date.parse(this.end()) - start || 1)) * 666
    );
  }
  y(v: number) {
    return 200 - ((v - this.min()) / (this.max() - this.min() || 1)) * 184;
  }
  path(points: Point[]) {
    return points
      .map(
        (p, i) =>
          (i ? "L" : "M") +
          this.x(p.timestamp).toFixed(2) +
          "," +
          this.y(p.value).toFixed(2),
      )
      .join(" ");
  }
  boundary = computed(() => this.x(this.history().at(-1)?.timestamp ?? ""));
  historyPath = computed(() => this.path(this.visible()));
  forecastPath = computed(() =>
    this.path([
      ...(this.history().length ? [this.history().at(-1)!] : []),
      ...this.forecast(),
    ]),
  );
}
