import type { ChartData } from "../../schemas/slide-plan.js";
import type { DeckStyle } from "../../schemas/deck-plan.js";

/**
 * 确定性 SVG 图表渲染（不走 pptx 原生 chart）：
 * 颜色全部来自 DeckStyle，风格干净克制，可直接内联进 HTML。
 */
export function renderChartSvg(chart: ChartData, style: DeckStyle): string {
  const W = 760;
  const H = 380;
  const padL = 56;
  const padR = 20;
  const padT = 28;
  const padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...chart.values) * 1.15 || 1;
  const n = chart.values.length;
  const axis = style.mutedTextColor;
  const grid = style.darkMode ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";

  const gridLines = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = padT + plotH * (1 - f);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${grid}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="${axis}">${fmt(max * f)}</text>`;
    })
    .join("");

  const labels = chart.labels
    .map((l, i) => {
      const x = padL + (plotW / n) * (i + 0.5);
      return `<text x="${x}" y="${H - padB + 24}" text-anchor="middle" font-size="13" fill="${axis}">${esc(l)}</text>`;
    })
    .join("");

  let series = "";
  if (chart.type === "bar") {
    const bw = Math.min(56, (plotW / n) * 0.52);
    series = chart.values
      .map((v, i) => {
        const x = padL + (plotW / n) * (i + 0.5) - bw / 2;
        const h = (v / max) * plotH;
        const y = padT + plotH - h;
        const isMax = v === Math.max(...chart.values);
        return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="${isMax ? style.primaryColor : style.secondaryColor}" opacity="${isMax ? 1 : 0.75}"/>` +
          `<text x="${x + bw / 2}" y="${y - 8}" text-anchor="middle" font-size="13" font-weight="600" fill="${style.textColor}">${fmt(v)}</text>`;
      })
      .join("");
  } else {
    const pts = chart.values.map((v, i) => {
      const x = padL + (plotW / n) * (i + 0.5);
      const y = padT + plotH - (v / max) * plotH;
      return [x, y] as const;
    });
    const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
    const area = `${path} L${pts[pts.length - 1][0]},${padT + plotH} L${pts[0][0]},${padT + plotH} Z`;
    series =
      `<path d="${area}" fill="${style.primaryColor}" opacity="0.10"/>` +
      `<path d="${path}" fill="none" stroke="${style.primaryColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
      pts
        .map(
          ([x, y], i) =>
            `<circle cx="${x}" cy="${y}" r="5" fill="${style.primaryColor}"/>` +
            `<text x="${x}" y="${y - 12}" text-anchor="middle" font-size="13" font-weight="600" fill="${style.textColor}">${fmt(chart.values[i])}</text>`,
        )
        .join("");
  }

  const unit = chart.unit
    ? `<text x="${padL}" y="${padT - 10}" font-size="12" fill="${axis}">单位：${esc(chart.unit)}</text>`
    : "";

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="PingFang SC, Microsoft YaHei, sans-serif">
${gridLines}${unit}${series}${labels}
<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${axis}" stroke-width="1.5"/>
</svg>`;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 10000) return `${Math.round(n / 1000)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
