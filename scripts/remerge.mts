// 用已落盘的 html 目录重建 final.pptx（验证合并层改动，不调 LLM）
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mergeToPptx } from "../src/pipeline/merge-pptx.js";
import { closeBrowser } from "../src/render/browser.js";

const dir = process.argv[2]; // e.g. out/4-rust-balanced
const files = readdirSync(join(dir, "html")).filter((f) => /^slide-\d+\.html$/.test(f)).sort();
const htmls: string[] = [];
let tokensCss = "";
for (const f of files) {
  const doc = readFileSync(join(dir, "html", f), "utf8");
  const style = doc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const body = doc.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "";
  tokensCss = style.match(/:root \{[\s\S]*?\}/)?.[0] ?? tokensCss;
  htmls.push(body);
}
mkdirSync(join(dir, "bg"), { recursive: true });
await mergeToPptx(htmls, tokensCss, { bg: join(dir, "bg") }, join(dir, "final-v2.pptx"));
console.log("done:", join(dir, "final-v2.pptx"), htmls.length, "slides");
await closeBrowser();

// 确保退出
process.exit(0);
