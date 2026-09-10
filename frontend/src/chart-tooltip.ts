import { Component, input } from "@angular/core";

export interface ChartTooltipRow {
  label: string;
  value: string;
}

@Component({
  selector: "chart-tooltip",
  template: `
    <span class="tooltip-kicker">{{ subtitle() }}</span>
    <strong>{{ title() }}</strong>
    <span class="tooltip-rows">
      @for (row of rows(); track row.label) {
        <span
          ><small>{{ row.label }}</small
          ><b>{{ row.value }}</b></span
        >
      }
    </span>
  `,
  host: {
    role: "tooltip",
    "[class.tooltip-below]": "placement() === 'bottom'",
    "[class.tooltip-start]": "align() === 'start'",
    "[class.tooltip-end]": "align() === 'end'",
  },
  styles: `
    :host {
      --tooltip-x: -50%;
      position: absolute;
      z-index: 30;
      bottom: 16px;
      left: 50%;
      display: block;
      width: 210px;
      padding: 12px 13px;
      border: 1px solid rgba(255, 255, 255, 0.13);
      border-radius: 8px;
      background: #292b31;
      box-shadow: 0 12px 30px rgba(24, 25, 29, 0.22);
      color: #fff;
      font-family: Manrope, "DM Sans", sans-serif;
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transform: translate(var(--tooltip-x), 5px);
      transition:
        opacity 140ms ease,
        transform 160ms ease,
        visibility 140ms ease;
    }
    :host(.tooltip-below) {
      top: 16px;
      bottom: auto;
      transform: translate(var(--tooltip-x), -5px);
    }
    :host(.tooltip-start) {
      --tooltip-x: 0%;
      left: -8px;
    }
    :host(.tooltip-end) {
      --tooltip-x: 0%;
      right: -8px;
      left: auto;
    }
    :host-context(.chart-data-point:hover),
    :host-context(.chart-data-point:focus-visible) {
      opacity: 1;
      visibility: visible;
      transform: translate(var(--tooltip-x), 0);
    }
    .tooltip-kicker {
      display: block;
      margin-bottom: 3px;
      color: #c9bbff;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.65px;
    }
    :host > strong {
      display: block;
      margin-bottom: 8px;
      color: #fff;
      font-size: 12px;
    }
    .tooltip-rows {
      display: grid;
      gap: 5px;
      padding-top: 7px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
    }
    .tooltip-rows > span {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }
    small {
      color: #b9bbc3;
      font-size: 10px;
    }
    b {
      color: #fff;
      font-size: 11px;
      font-weight: 750;
      text-align: right;
    }
    .tooltip-rows > span:first-child b {
      font-size: 17px;
      letter-spacing: -0.25px;
    }
  `,
})
export class ChartTooltip {
  title = input.required<string>();
  subtitle = input("");
  rows = input<ChartTooltipRow[]>([]);
  placement = input<"top" | "bottom">("top");
  align = input<"start" | "center" | "end">("center");
}
