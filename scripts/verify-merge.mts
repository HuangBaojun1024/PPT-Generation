import { readFileSync } from "node:fs";
import { measureSlide, closeBrowser } from "../src/render/browser.js";

for (const f of process.argv.slice(2)) {
  const html = readFileSync(f, "utf8");
  const { textLines, issues } = await measureSlide(html);
  console.log(`\n=== ${f}`);
  console.log(`lines: ${textLines.length}, issues: ${issues.length}`);
  for (const l of textLines.slice(0, 12)) {
    console.log(`  [${Math.round(l.x)},${Math.round(l.y)} ${Math.round(l.w)}x${Math.round(l.h)}] fs=${l.fontSizePx} ls=${l.letterSpacingPx} "${l.text.slice(0, 24)}"`);
  }
  const giant = textLines.filter((l) => l.fontSizePx > 100);
  console.log(`  >100px 大字行数: ${giant.length}${giant.length ? " -> " + giant.map((g) => g.text).join(",") : ""}`);
}
await closeBrowser();
