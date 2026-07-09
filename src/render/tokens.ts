import type { DeckStyle } from "../../schemas/deck-plan.js";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** 中文安全字体栈（macOS/Windows 双端可用，绝不引外部字体） */
export const FONT_STACK = `"PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Hiragino Sans GB", sans-serif`;
export const MONO_STACK = `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`;

/** DeckStyle → 全套共享的 tokens.css（构造性一致的核心） */
export function buildTokensCss(style: DeckStyle): string {
  return `:root {
  --color-primary: ${style.primaryColor};
  --color-secondary: ${style.secondaryColor};
  --color-accent: ${style.accentColor};
  --color-bg: ${style.backgroundColor};
  --color-surface: ${style.surfaceColor};
  --color-text: ${style.textColor};
  --color-text-muted: ${style.mutedTextColor};
  --font-main: ${FONT_STACK};
  --font-mono: ${MONO_STACK};
  --safe-margin: 56px;
  --radius: 14px;
  --shadow-card: 0 2px 12px rgba(0, 0, 0, ${style.darkMode ? "0.45" : "0.07"});
}`;
}

/** 所有页面共享的基础样式：画布、重置、文字规则、图片滤镜 */
export function buildBaseCss(): string {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${SLIDE_W}px; height: ${SLIDE_H}px; overflow: hidden; }
body { font-family: var(--font-main); color: var(--color-text); background: var(--color-bg); }
.slide {
  position: relative;
  width: ${SLIDE_W}px;
  height: ${SLIDE_H}px;
  overflow: hidden;
  background: var(--color-bg);
}
/* 生成图统一色调处理：底图去饱和一点 + 主色罩层拉进同一色系 */
.img-unify { position: relative; overflow: hidden; }
.img-unify > img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(0.88); }
.img-unify::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: var(--color-primary); opacity: 0.14; mix-blend-mode: soft-light;
}
.icon { display: inline-block; }
.icon svg { width: 100%; height: 100%; display: block; }`;
}

/** 页面 HTML 片段 → 可渲染的完整文档 */
export function wrapHtml(fragmentHtml: string, tokensCss: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
${tokensCss}
${buildBaseCss()}
</style></head>
<body>${fragmentHtml}</body></html>`;
}
