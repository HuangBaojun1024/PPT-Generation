import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DeckInputSchema } from "../schemas/deck-plan.js";
import { getProfile } from "./profiles.js";
import { setPreset, getPresetName } from "./llm.js";
import { metrics } from "./metrics.js";
import { planDeck } from "./pipeline/plan-deck.js";
import { planSlides } from "./pipeline/plan-slides.js";
import { chooseStrategy, prefetchImages } from "./pipeline/choose-strategy.js";
import { renderAllSlides, type DeckContext } from "./pipeline/render-html.js";
import { evaluateAndFix } from "./pipeline/evaluate.js";
import { mergeToPptx } from "./pipeline/merge-pptx.js";
import { buildTokensCss } from "./render/tokens.js";
import { wrapHtml } from "./render/tokens.js";
import { closeBrowser } from "./render/browser.js";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.log(`用法: npm run gen -- --input demo/4-rust.json [--profile balanced|beauty-max] [--preset test|full] [--out out]`);
    process.exit(1);
  }
  const profile = getProfile(args.profile ?? "balanced");
  if (args.preset) setPreset(args.preset);

  const input = DeckInputSchema.parse(JSON.parse(readFileSync(resolve(args.input), "utf8")));
  const name = basename(args.input).replace(/\.json$/, "");
  const outDir = resolve(args.out ?? "out", `${name}-${profile.name}`);
  const dirs = {
    root: outDir,
    html: join(outDir, "html"),
    assets: join(outDir, "assets"),
    shots: join(outDir, "shots"),
    bg: join(outDir, "bg"),
  };
  Object.values(dirs).forEach((d) => mkdirSync(d, { recursive: true }));

  metrics.meta = { input: name, topic: input.topic, profile: profile.name, preset: getPresetName() };
  console.log(`▶ ${input.topic} | 档位=${profile.name} | 模型preset=${getPresetName()}`);

  // ① 规划
  const { plan, template } = await metrics.stage("plan", () => planDeck(input, profile));
  console.log(`① 规划完成: ${plan.style.styleName} / 模板=${template.templateId} / ${plan.narrative.chapters.length} 章`);

  // ② 分镜
  const slides = await metrics.stage("slides", () => planSlides(input, plan, template));
  console.log(`② 分镜完成: ${slides.length} 页`);
  metrics.meta.slides = slides.length;

  // ③ 策略（纯代码）+ ③.5 素材预取
  const decisions = chooseStrategy(slides, plan, profile);
  console.log(`③ 策略完成: 生图 ${decisions.filter((d) => d.useImage).length} 张（预算 ${profile.imageBudget}）`);
  await metrics.stage("images", () => prefetchImages(decisions, dirs.assets, profile));
  console.log(`③.5 素材完成: 实际生成 ${decisions.filter((d) => d.imagePath).length} 张`);

  // ④ 渲染
  const ctx: DeckContext = { input, plan, template, profile, total: slides.length };
  let htmls = await metrics.stage("render", () => renderAllSlides(slides, decisions, ctx));
  console.log(`④ 渲染完成`);

  // ⑤ 评估 + 修复
  const tokensCss = buildTokensCss(plan.style);
  const evalRes = await metrics.stage("evaluate", () =>
    evaluateAndFix(slides, decisions, ctx, htmls, tokensCss, { shots: dirs.shots, assets: dirs.assets }),
  );
  htmls = evalRes.htmls;
  console.log(`⑤ 评估完成: L1/L2 修复 ${evalRes.audit.length} 条${evalRes.reviewScore != null ? ` / reviewer 评分 ${evalRes.reviewScore}` : "（reviewer 关闭）"}`);

  // 落盘 HTML（调试与追溯）
  htmls.forEach((h, i) => writeFileSync(join(dirs.html, `slide-${String(i + 1).padStart(2, "0")}.html`), wrapHtml(h, tokensCss)));

  // ⑥ 合并导出
  const pptxPath = join(outDir, "final.pptx");
  await metrics.stage("merge", () => mergeToPptx(htmls, tokensCss, { bg: dirs.bg }, pptxPath));

  writeFileSync(join(outDir, "audit.json"), JSON.stringify({ reviewScore: evalRes.reviewScore, entries: evalRes.audit, decisions }, null, 2));
  metrics.write(join(outDir, "metrics.json"));
  const sum = metrics.summary() as any;
  console.log(`⑥ 完成: ${pptxPath}`);
  console.log(`   成本 $${sum.costUsd.total}（文本 $${sum.costUsd.llmText} + 图 $${sum.costUsd.image}） | 总耗时 ${(sum.latencyMs.total / 1000).toFixed(0)}s | LLM 调用 ${sum.llmCalls} 次`);

  await closeBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeBrowser();
  process.exit(1);
});
