/**
 * 扫描 <dir>/<demo>-<profile>/metrics.json，输出实测汇总表（markdown）。
 * 用法: npx tsx scripts/summarize-metrics.mts out-final
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "out-final";
const order = ["1-python", "2-review", "3-coffee", "4-rust", "5-kyoto"];
const profiles = ["balanced", "beauty-max"];

type Row = {
  demo: string; profile: string; topic: string; slides: number;
  imgGen: number; text: number; image: number; total: number;
  latSec: number; llmCalls: number; imgCalls: number;
};

const rows: Row[] = [];
for (const demo of order) {
  for (const profile of profiles) {
    const p = join(dir, `${demo}-${profile}`, "metrics.json");
    if (!existsSync(p)) { console.error(`缺失: ${p}`); continue; }
    const m = JSON.parse(readFileSync(p, "utf8"));
    rows.push({
      demo, profile, topic: m.topic, slides: m.slides,
      imgGen: m.imagesGenerated,
      text: m.costUsd.llmText, image: m.costUsd.image, total: m.costUsd.total,
      latSec: Math.round(m.latencyMs.total / 1000),
      llmCalls: m.llmCalls, imgCalls: m.imageCalls,
    });
  }
}

const fmt = (n: number) => `$${n.toFixed(2)}`;
let out = `| # | demo（主题） | 档位 | 页数 | 生图 | 文本成本 | 图片成本 | 总成本 | 时延 | LLM 次数 |\n`;
out += `|---|---|---|---|---|---|---|---|---|---|\n`;
let i = 1;
for (const r of rows) {
  out += `| ${i++} | ${r.demo} | ${r.profile} | ${r.slides} | ${r.imgGen} | ${fmt(r.text)} | ${fmt(r.image)} | **${fmt(r.total)}** | ${r.latSec}s | ${r.llmCalls} |\n`;
}
// 均值
const avg = (sel: (r: Row) => number, f = (n: number) => n.toFixed(2)) => {
  for (const pf of profiles) {
    const g = rows.filter((r) => r.profile === pf);
    const v = g.reduce((s, r) => s + sel(r), 0) / (g.length || 1);
    console.error(`${pf} 均值: ${f(v)}`);
  }
};

console.log(out);
console.error("\n--- 均值 ---");
console.error("总成本:"); avg((r) => r.total);
console.error("时延(s):"); avg((r) => r.latSec, (n) => Math.round(n).toString());
