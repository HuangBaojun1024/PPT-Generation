import { readFileSync } from "node:fs";
import { measureSlide, closeBrowser } from "../src/render/browser.js";
const { issues } = await measureSlide(readFileSync(process.argv[2], "utf8"));
for (const i of issues) console.log(`[${i.kind}] ${i.detail}`);
await closeBrowser();
process.exit(0);
