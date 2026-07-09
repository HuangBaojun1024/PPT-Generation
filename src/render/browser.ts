import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SLIDE_W, SLIDE_H } from "./tokens.js";

let browser: Browser | null = null;
// 按进程隔离：多个生成任务并行时不能互删临时文件
const TMP_DIR = join(tmpdir(), `pptgen-${process.pid}`);

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    mkdirSync(TMP_DIR, { recursive: true });
    browser = await chromium.launch();
  }
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = null;
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
}

/**
 * 注意：必须落盘后 goto file://，不能用 setContent——
 * about:blank 页面会被 Chromium 禁止加载 file:// 子资源（生成图会 404）。
 */
async function newSlidePage(html: string): Promise<Page> {
  const b = await getBrowser();
  const page = await b.newPage({
    viewport: { width: SLIDE_W, height: SLIDE_H },
    deviceScaleFactor: 2,
  });
  // tsx(esbuild keepNames) 会往 page.evaluate 序列化代码里注入 __name 调用，浏览器端需要 shim
  await page.addInitScript("window.__name = (fn) => fn;");
  const tmpFile = join(TMP_DIR, `${randomUUID()}.html`);
  writeFileSync(tmpFile, html);
  await page.goto(`file://${tmpFile}`, { waitUntil: "networkidle", timeout: 30_000 });
  (page as any).__tmpFile = tmpFile;
  return page;
}

async function closeSlidePage(page: Page) {
  const tmp = (page as any).__tmpFile;
  await page.close();
  if (tmp) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
  }
}

// ---------- 测量 ----------

/** 行级文本盒：一行文字的精确字形矩形（不含 padding/容器留白） */
export interface TextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSizePx: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string; // rgb(...)
  letterSpacingPx: number;
}

export interface Issue {
  kind: "pageOverflow" | "textClipped" | "overlap" | "minFont" | "safeMargin";
  detail: string;
}

export interface MeasureResult {
  textLines: TextLine[];
  issues: Issue[];
}

/** 覆盖判定阈值：有效不透明度低于该值的文字视为装饰层，留在背景截图里 */
const OVERLAY_MIN_OPACITY = 0.5;

/**
 * 测量所有 [data-text] 元素 + 跑 Level 1 确定性检查。
 * 文本按"渲染行"拆分（Range 逐字符取字形矩形再按行分组），
 * 保证 pptx 文字覆盖的换行位置与浏览器像素级一致。
 * 装饰文字（低透明度/竖排）不产出 textLines——它们留在背景截图中。
 */
export async function measureSlide(html: string): Promise<MeasureResult> {
  const page = await newSlidePage(html);
  try {
    return await page.evaluate(
      ({ W, H, MIN_OP }) => {
        const issues: { kind: any; detail: string }[] = [];
        const root = document.querySelector(".slide") as HTMLElement | null;
        if (!root) {
          issues.push({ kind: "pageOverflow", detail: "缺少 .slide 根元素" });
          return { textLines: [], issues };
        }
        if (root.scrollWidth > W + 2 || root.scrollHeight > H + 2) {
          issues.push({ kind: "pageOverflow", detail: `slide 内容 ${root.scrollWidth}x${root.scrollHeight} 超出画布 ${W}x${H}` });
        }

        function effectiveOpacity(el: Element | null): number {
          let o = 1;
          while (el && el.nodeType === 1) {
            const op = parseFloat(getComputedStyle(el as HTMLElement).opacity);
            if (!Number.isNaN(op)) o *= op;
            el = (el as HTMLElement).parentElement;
          }
          return o;
        }

        /** 颜色 alpha：兼容 rgba(...) 与 color(srgb r g b / a) 两种序列化格式 */
        function colorAlpha(c: string): number {
          let m = c.match(/\/\s*([\d.]+%?)\s*\)/);
          if (m) return m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
          m = c.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)/);
          return m ? parseFloat(m[1]) : 1;
        }

        /** 文字的综合可见度 = 祖先 opacity 累乘 × 文字颜色 alpha */
        function textVisibility(el: HTMLElement, cs: CSSStyleDeclaration): number {
          const a = colorAlpha(cs.color);
          return effectiveOpacity(el) * (Number.isNaN(a) ? 1 : a);
        }

        /** 逐字符取矩形并按行分组 */
        function extractLines(el: HTMLElement): { text: string; x1: number; y1: number; x2: number; y2: number }[] {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const lines: { text: string; x1: number; y1: number; x2: number; y2: number }[] = [];
          let cur: { text: string; x1: number; y1: number; x2: number; y2: number } | null = null;
          const range = document.createRange();
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const data = (node as Text).data;
            for (let i = 0; i < data.length; i++) {
              const ch = data[i];
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              const r = range.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              if (/\s/.test(ch) && (!cur || r.width === 0)) continue;
              // 新行判定：首字符，或 top 差超过半行高，或 x 明显回退
              if (!cur || Math.abs(r.top - cur.y1) > r.height * 0.5) {
                if (cur && cur.text.trim()) lines.push(cur);
                cur = { text: ch, x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
              } else {
                cur.text += ch;
                cur.x1 = Math.min(cur.x1, r.left);
                cur.y1 = Math.min(cur.y1, r.top);
                cur.x2 = Math.max(cur.x2, r.right);
                cur.y2 = Math.max(cur.y2, r.bottom);
              }
            }
          }
          if (cur && cur.text.trim()) lines.push(cur);
          for (const l of lines) l.text = l.text.replace(/\s+$/g, "");
          return lines;
        }

        const nodes = Array.from(document.querySelectorAll("[data-text]")) as HTMLElement[];
        const outLines: any[] = [];
        const rects: { r: DOMRect; label: string; el: HTMLElement }[] = [];
        for (const el of nodes) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const text = (el.innerText || "").trim();
          if (!text) continue;

          // ---- Level 1 检查（元素级；装饰字豁免——大字装饰天然超框/出血是设计手法） ----
          const fontSize = parseFloat(cs.fontSize);
          const horizontal = cs.writingMode === "horizontal-tb";
          const decorative = textVisibility(el, cs) < MIN_OP || !horizontal;
          // 大字号 + 紧凑行高时字形天然略超 content box，按字号比例容忍
          const clipTol = Math.max(4, fontSize * 0.18);
          if (!decorative && (el.scrollHeight > el.clientHeight + clipTol || el.scrollWidth > el.clientWidth + clipTol)) {
            issues.push({ kind: "textClipped", detail: `文本被裁剪: "${text.slice(0, 20)}…" (${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight})` });
          }
          if (fontSize < 12 && !decorative) {
            issues.push({ kind: "minFont", detail: `字号过小 ${fontSize}px: "${text.slice(0, 20)}"` });
          }
          if (!decorative && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) {
            issues.push({ kind: "safeMargin", detail: `文本超出画布: "${text.slice(0, 20)}"` });
          }
          if (!decorative) rects.push({ r, label: text.slice(0, 16), el });

          // ---- 行级提取（装饰字不覆盖，留在背景） ----
          if (decorative) continue;
          const style = {
            fontSizePx: fontSize,
            fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
            bold: parseInt(cs.fontWeight) >= 600,
            italic: cs.fontStyle === "italic",
            color: cs.color,
            letterSpacingPx: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0,
          };
          for (const l of extractLines(el)) {
            outLines.push({ text: l.text, x: l.x1, y: l.y1, w: l.x2 - l.x1, h: l.y2 - l.y1, ...style });
          }
        }

        // 文本元素两两重叠检查（不含装饰字）
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i].r;
            const b = rects[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 8 && oy > 8) {
              const inter = ox * oy;
              const minArea = Math.min(a.width * a.height, b.width * b.height);
              if (inter > minArea * 0.25) {
                issues.push({ kind: "overlap", detail: `文本重叠: "${rects[i].label}" 与 "${rects[j].label}"` });
              }
            }
          }
        }

        // ---- 装饰元素 × 文字 重叠检查 ----
        // 小型可见装饰（图标 svg、带边框/底色的节点圆点等）压在文字上是常见翻车点，
        // data-text × data-text 检查覆盖不到，这里单独扫一遍。
        const decors: { r: DOMRect; el: Element; tag: string }[] = [];
        for (const el of Array.from(root.querySelectorAll("*"))) {
          const tag = el.tagName.toLowerCase();
          if (tag !== "svg" && el.closest("svg")) continue; // svg 内部子节点跳过
          const isSvg = tag === "svg";
          if (!isSvg && (el.textContent || "").trim()) continue; // 含文字的容器不算装饰
          const cs = getComputedStyle(el as HTMLElement);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          if (effectiveOpacity(el) < 0.3) continue; // 低透明度装饰压字不影响可读性
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area < 16 || area > 3600) continue; // 只查小型装饰，排除卡片底/大色块
          let visible = isSvg;
          if (!visible) {
            const hasBg = colorAlpha(cs.backgroundColor) > 0.05 && cs.backgroundColor !== "transparent";
            const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
            visible = hasBg || hasBorder;
          }
          if (!visible) continue;
          decors.push({ r, el, tag });
        }
        for (const d of decors) {
          for (const t of rects) {
            if (d.el.contains(t.el) || t.el.contains(d.el)) continue; // 包含关系不算压字
            const ox = Math.min(d.r.right, t.r.right) - Math.max(d.r.left, t.r.left);
            const oy = Math.min(d.r.bottom, t.r.bottom) - Math.max(d.r.top, t.r.top);
            if (ox > 4 && oy > 4) {
              const inter = ox * oy;
              const minArea = Math.min(d.r.width * d.r.height, t.r.width * t.r.height);
              if (inter > minArea * 0.2) {
                issues.push({
                  kind: "overlap",
                  detail: `装饰元素(${d.tag} ${Math.round(d.r.width)}x${Math.round(d.r.height)})与文字重叠: "${t.label}"`,
                });
                break; // 每个装饰元素报一次即可
              }
            }
          }
        }
        return { textLines: outLines, issues };
      },
      { W: SLIDE_W, H: SLIDE_H, MIN_OP: OVERLAY_MIN_OPACITY },
    );
  } finally {
    await closeSlidePage(page);
  }
}

// ---------- 截图 ----------

/** 完整截图（预览/审查用） */
export async function screenshotFull(html: string, outPath: string) {
  const page = await newSlidePage(html);
  try {
    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await closeSlidePage(page);
  }
}

/**
 * 背景层截图：只隐藏"会被 pptx 文本框覆盖"的文字（水平书写且有效不透明度 ≥ 阈值）。
 * 装饰文字（低透明度水印数字、竖排字等）保留在背景里，像素级还原。
 */
export async function screenshotBackground(html: string, outPath: string) {
  const page = await newSlidePage(html);
  try {
    await page.evaluate((MIN_OP) => {
      function effectiveOpacity(el: Element | null): number {
        let o = 1;
        while (el && el.nodeType === 1) {
          const op = parseFloat(getComputedStyle(el as HTMLElement).opacity);
          if (!Number.isNaN(op)) o *= op;
          el = (el as HTMLElement).parentElement;
        }
        return o;
      }
      for (const el of Array.from(document.querySelectorAll("[data-text]")) as HTMLElement[]) {
        const cs = getComputedStyle(el);
        const horizontal = cs.writingMode === "horizontal-tb";
        let am = cs.color.match(/\/\s*([\d.]+%?)\s*\)/);
        let alpha = am ? (am[1].endsWith("%") ? parseFloat(am[1]) / 100 : parseFloat(am[1])) : NaN;
        if (Number.isNaN(alpha)) {
          am = cs.color.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)/);
          alpha = am ? parseFloat(am[1]) : 1;
        }
        const visibility = effectiveOpacity(el) * (Number.isNaN(alpha) ? 1 : alpha);
        if (horizontal && visibility >= MIN_OP) {
          el.style.setProperty("color", "transparent", "important");
          el.style.setProperty("text-shadow", "none", "important");
          el.style.setProperty("-webkit-text-stroke", "0", "important");
        }
      }
    }, OVERLAY_MIN_OPACITY);
    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await closeSlidePage(page);
  }
}

/** 把 N 张截图拼成 contact sheet（评估层 Level 2 输入），返回 PNG buffer */
export async function buildContactSheet(imagePaths: string[], cols = 5): Promise<Buffer> {
  const rows = Math.ceil(imagePaths.length / cols);
  const thumbW = 384;
  const thumbH = 216;
  const gap = 10;
  const W = cols * thumbW + (cols + 1) * gap;
  const H = rows * (thumbH + 26) + (rows + 1) * gap;
  const cells = imagePaths
    .map(
      (p, i) =>
        `<div style="width:${thumbW}px"><img src="file://${p}" style="width:${thumbW}px;height:${thumbH}px;object-fit:cover;display:block;border:1px solid #ccc"/><div style="font:12px sans-serif;text-align:center;padding:4px">#${i + 1}</div></div>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#fff;width:${W}px">
<div style="display:flex;flex-wrap:wrap;gap:${gap}px;padding:${gap}px">${cells}</div></body></html>`;
  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width: W, height: H } });
  const tmpFile = join(TMP_DIR, `${randomUUID()}.html`);
  writeFileSync(tmpFile, html);
  (page as any).__tmpFile = tmpFile;
  try {
    await page.goto(`file://${tmpFile}`, { waitUntil: "networkidle", timeout: 60_000 });
    return await page.screenshot({ type: "png", fullPage: true });
  } finally {
    await closeSlidePage(page);
  }
}
