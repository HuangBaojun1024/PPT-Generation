/**
 * 预览工具：把 out 目录下的 slide-XX.html 渲染成 .preview.png
 * 用法: npx tsx scripts/preview.mts out/xxx/html/slide-01.html [...]
 */
import { chromium } from "playwright";
import { resolve } from "node:path";

const files = process.argv.slice(2);
const b = await chromium.launch();
for (const f of files) {
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(`file://${resolve(f)}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: f.replace(/\.html$/, ".preview.png") });
  await page.close();
  console.log(f.replace(/\.html$/, ".preview.png"));
}
await b.close();
