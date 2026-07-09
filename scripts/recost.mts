/**
 * 按 config/pricing.json 的官方单价，用每套 metrics.json 里已存的 per-call token 明细
 * 重算成本（文本按 token×官方单价；图片按张单价不变），回写 metrics.json，并打印汇总表。
 * 用法: npx tsx scripts/recost.mts deliverables
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "deliverables";
const pricing = JSON.parse(readFileSync("config/pricing.json", "utf8"));
const order = ["1-python", "2-review", "3-coffee", "4-rust", "5-kyoto"];
const profiles = ["balanced", "beauty-max"];
const round = (n: number) => Math.round(n * 10000) / 10000;

const textCost = (model: string, inTok: number, outTok: number) => {
  const p = pricing.text[model];
  return p ? (inTok * p.inputPerMTok + outTok * p.outputPerMTok) / 1e6 : 0;
};
const imageCost = (model: string, res: string) => pricing.image[model]?.[res] ?? 0;

type Row = { demo: string; profile: string; slides: number; imgGen: number; text: number; image: number; total: number; latSec: number; llmCalls: number };
const rows: Row[] = [];

for (const demo of order) {
  for (const profile of profiles) {
    const p = join(dir, `${demo}-${profile}`, "metrics.json");
    if (!existsSync(p)) { console.error(`缺失: ${p}`); continue; }
    const m = JSON.parse(readFileSync(p, "utf8"));

    // 重算每次调用
    for (const c of m.calls) c.costUsd = round(textCost(c.model, c.inputTokens, c.outputTokens));
    for (const im of m.images) im.costUsd = im.ok ? imageCost(im.model, im.resolution) : 0;

    const llmText = round(m.calls.reduce((s: number, c: any) => s + c.costUsd, 0));
    const image = round(m.images.reduce((s: number, c: any) => s + c.costUsd, 0));
    m.costUsd = { llmText, image, total: round(llmText + image) };

    // 重算 byRole
    const g: Record<string, any> = {};
    for (const c of m.calls) {
      g[c.role] ??= { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      g[c.role].calls++; g[c.role].costUsd = round(g[c.role].costUsd + c.costUsd);
      g[c.role].inputTokens += c.inputTokens; g[c.role].outputTokens += c.outputTokens;
    }
    m.byRole = g;

    writeFileSync(p, JSON.stringify(m, null, 2));
    rows.push({ demo, profile, slides: m.slides, imgGen: m.imagesGenerated, text: llmText, image, total: m.costUsd.total, latSec: Math.round(m.latencyMs.total / 1000), llmCalls: m.llmCalls });
  }
}

const f = (n: number) => `$${n.toFixed(2)}`;
let out = `| # | demo | 档位 | 页数 | 生图 | 文本成本 | 图片成本 | 总成本 | 时延 | LLM 次数 |\n|---|---|---|---|---|---|---|---|---|---|\n`;
let i = 1;
for (const r of rows) out += `| ${i++} | ${r.demo} | ${r.profile} | ${r.slides} | ${r.imgGen} | ${f(r.text)} | ${f(r.image)} | **${f(r.total)}** | ${r.latSec}s | ${r.llmCalls} |\n`;
console.log(out);
for (const pf of profiles) {
  const g = rows.filter((r) => r.profile === pf);
  const avgC = g.reduce((s, r) => s + r.total, 0) / (g.length || 1);
  const avgL = g.reduce((s, r) => s + r.latSec, 0) / (g.length || 1);
  console.error(`${pf} 均值: $${avgC.toFixed(2)} / ${Math.round(avgL)}s`);
}
