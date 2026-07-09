import { join } from "node:path";
import { existsSync } from "node:fs";
import PptxGenJS from "pptxgenjs";
import { measureSlide, screenshotBackground, screenshotFull, type TextLine } from "../render/browser.js";
import { wrapHtml } from "../render/tokens.js";
import { pMap } from "../util.js";

const PX_PER_IN = 96;
const PT_PER_PX = 0.75;

/**
 * ⑥ 合并层：HTML → pptx 混合转换。
 * 背景 = 隐藏"待覆盖文字"后的整页截图（装饰层像素级还原，低透明度装饰字保留在背景）；
 * 文字 = 行级字形矩形叠加 pptx 原生文本框：每个渲染行一个文本框、禁止二次换行，
 *        换行位置/垂直居中/字距与浏览器渲染像素级一致。
 * 任一页转换失败 → 该页整页截图兜底（无文字覆盖）。
 */
export async function mergeToPptx(
  htmls: string[],
  tokensCss: string,
  dirs: { bg: string },
  outPath: string,
): Promise<void> {
  const pptx: any = new (PptxGenJS as any)();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";

  // 并行准备每页素材（截图 + 测量），再顺序组装保证页序
  const pages = await pMap(
    htmls,
    async (html, i) => {
      const full = wrapHtml(html, tokensCss);
      const bgPath = join(dirs.bg, `bg-${String(i + 1).padStart(2, "0")}.png`);
      let lines: TextLine[] = [];
      try {
        await screenshotBackground(full, bgPath);
        lines = (await measureSlide(full)).textLines;
      } catch (e) {
        console.error(`  [merge] 第 ${i + 1} 页混合转换失败，整页截图兜底: ${e}`);
        lines = [];
        try {
          await screenshotFull(full, bgPath); // 带文字整页截图兜底
        } catch (e2) {
          console.error(`  [merge] 第 ${i + 1} 页整页截图也失败，该页将为空白: ${e2}`);
        }
      }
      return { bgPath: existsSync(bgPath) ? bgPath : null, lines };
    },
    4,
  );

  for (const { bgPath, lines } of pages) {
    const slide = pptx.addSlide();
    if (bgPath) slide.addImage({ path: bgPath, x: 0, y: 0, w: 13.333, h: 7.5 });
    for (const l of lines) {
      const color = rgbToHex(l.color);
      if (!color || !l.text) continue;
      // 行级盒是紧贴字形的矩形：左右各留缓冲吸收字体度量差异，居中对齐保持视觉锚点
      const bufIn = Math.max(0.06, px2in(l.fontSizePx) * 0.6);
      slide.addText(l.text, {
        x: px2in(l.x) - bufIn,
        y: px2in(l.y) - 0.02,
        w: px2in(l.w) + bufIn * 2,
        h: px2in(l.h) + 0.04,
        fontSize: Math.max(6, round1(l.fontSizePx * PT_PER_PX)),
        fontFace: normalizeFont(l.fontFamily),
        color,
        bold: l.bold,
        italic: l.italic,
        align: "center",
        valign: "middle",
        margin: 0,
        charSpacing: l.letterSpacingPx ? round1(l.letterSpacingPx * PT_PER_PX) : undefined,
        wrap: false,
        fit: "none",
      });
    }
  }
  await pptx.writeFile({ fileName: outPath });
}

function px2in(px: number): number {
  return Math.round((px / PX_PER_IN) * 1000) / 1000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** computed style 颜色 → PPTX 十六进制；兼容 rgb(a) 与 color(srgb ...)；近透明返回 null */
function rgbToHex(css: string): string | null {
  let m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return null;
    return [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  m = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 0.5) return null;
    return [m[1], m[2], m[3]]
      .map((v) => Math.round(parseFloat(v) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return css.startsWith("#") ? css.slice(1) : null;
}

function normalizeFont(family: string): string {
  const f = family.toLowerCase();
  if (f.includes("mono") || f.includes("menlo") || f.includes("consolas")) return "Menlo";
  if (f.includes("pingfang") || f.includes("yahei") || f.includes("han sans") || f.includes("hiragino")) return "PingFang SC";
  return "PingFang SC";
}
