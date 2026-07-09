import type { DeckInput, DeckPlan } from "../../schemas/deck-plan.js";
import type { SlidePlan } from "../../schemas/slide-plan.js";
import type { RenderDecision } from "../../schemas/render-decision.js";
import type { Template } from "../../schemas/template.js";
import type { Profile } from "../profiles.js";
import { chat } from "../llm.js";
import { iconSvg, resolveIcons } from "../assets/icons.js";
import { renderChartSvg } from "../assets/charts.js";
import { pMap } from "../util.js";
import { SLIDE_W, SLIDE_H } from "../render/tokens.js";

export interface DeckContext {
  input: DeckInput;
  plan: DeckPlan;
  template: Template;
  profile: Profile;
  total: number;
}

/** coder 的全局风格契约：所有页面共享，一致性从这里"编译"出来 */
export function coderSystemPrompt(ctx: DeckContext): string {
  const { plan, template, profile } = ctx;
  return `你是顶尖的演示页面前端设计师。你为一套 PPT 逐页编写 HTML，页面会被渲染为 ${SLIDE_W}x${SLIDE_H} 的幻灯片。

【设计系统（必须严格使用 CSS 变量，禁止硬编码颜色）】
--color-primary: ${plan.style.primaryColor}（主色）
--color-secondary: ${plan.style.secondaryColor}（辅助色）
--color-accent: ${plan.style.accentColor}（点缀色）
--color-bg: ${plan.style.backgroundColor}（页面背景）
--color-surface: ${plan.style.surfaceColor}（卡片底）
--color-text: ${plan.style.textColor}（正文）
--color-text-muted: ${plan.style.mutedTextColor}（次要文字）
--font-main / --font-mono / --safe-margin(56px) / --radius / --shadow-card
风格关键词：${plan.style.visualKeywords.join("、")}${plan.style.darkMode ? "（深色模式）" : ""}

【模板风格：${template.name}】
${template.styleNotes}
全套复用的视觉母题：
${template.motifs.map((m) => `- ${m}`).join("\n")}
装饰复杂度：${profile.decorLevel === "rich" ? "允许精致装饰（渐变、纹理、阴影、大号低透明度装饰字）" : "克制扁平，少用阴影和渐变"}

【硬性规则】
1. 只输出一个 HTML 片段，根元素必须是 <div class="slide">，不要输出 <html>/<head>/<body>/<style> 标签，不要解释。
2. 所有样式写在 style 属性内（inline CSS）。布局用 flex/grid。
3. 所有"可见文字"必须放在带 data-text 属性的元素里（如 <div data-text style="...">标题</div>）。data-text 元素必须是叶子节点（内部只有文字，不嵌套其他元素）。装饰性字符（超大背景数字/引号）也要 data-text。
4. 内容绝不允许超出 ${SLIDE_W}x${SLIDE_H} 画布；四周留白遵守 --safe-margin；正文字号 ≥16px，页码等辅助文字 ≥12px。
5. 提供的图片用 <img src="给定路径">，必须包一层 <div class="img-unify">（统一色调滤镜）。背景图铺满时该容器 position:absolute; inset:0。禁止使用未提供的图片 URL。
6. 提供的图标 SVG 直接内联（包在 <span class="icon" style="width:__px;height:__px;color:var(--color-primary)">），禁止自造 emoji 或其他图标。
7. 提供的图表 SVG 原样内联到指定位置，不要改其内容。
8. 每页右下角固定放页码（data-text，12-13px，muted 色，距右下角 24px）。
9. 文字内容用给定文案，可微调标点但不得改意思、不得自行扩写正文。
10. 排版要有明确的视觉层级与对齐网格，杜绝元素随意摆放。
11. 版面必须完整：内容在画布内分布均衡，不允许出现超过画布 1/3 的连续空白死区。低密度页也要用模板母题（大色块、超大低透明度装饰数字/字符、分隔线、几何装饰）撑起版面，而不是内容缩在一角。
12. 卡片/列表类版式中，若某条内容没有对应图标，用编号或色点代替，禁止硬凑不相关图标。
13. 装饰元素（节点圆点、图标、连线）禁止用绝对定位或负 margin/负偏移悬挂进其他元素的内容区。时间线/流程的节点标记必须占据自己的网格列或 flex 槽位（正常文档流），与文字之间用 gap 隔开，绝不允许覆盖在文字上。
14. 列表/时间线/流程的所有兄弟行必须使用完全相同的行结构（同样的列、同样的槽位）。图标数量不够覆盖所有行时，所有行统一改用色点或编号，禁止部分行有图标、部分行没有。`;
}

function assetBlock(slide: SlidePlan, d: RenderDecision, ctx: DeckContext): string {
  const parts: string[] = [];
  if (d.useImage && d.imagePath) {
    parts.push(`【图片】路径: file://${d.imagePath}
角色: ${d.imageRole === "background" ? "整页背景（absolute inset:0 铺满，文字区加半透明底带保证可读）" : "版面局部配图（约占 40-50% 版面，圆角 var(--radius)）"}`);
  } else if (ctx.template.layouts[slide.pageType]?.allowFullBleedImage) {
    parts.push(`【图片】无。该页用 CSS 渐变/大色块做背景氛围（基于主色体系），不要放 <img>。`);
  }
  if (d.icons.length) {
    const svgs = d.icons.map((n) => `<!-- icon:${n} -->\n${iconSvg(n, ctx.profile.iconWeight)}`).join("\n");
    parts.push(`【图标 SVG（可用子集，按需使用）】\n${svgs}`);
  }
  if (d.chart) {
    parts.push(`【图表 SVG（原样内联）】\n${renderChartSvg(d.chart, ctx.plan.style)}`);
  }
  if (d.table) {
    parts.push(`【表格数据】${JSON.stringify(d.table)}`);
  }
  return parts.join("\n\n");
}

export function coderUserPrompt(slide: SlidePlan, d: RenderDecision, ctx: DeckContext): string {
  const layout = ctx.template.layouts[slide.pageType];
  const chapter = slide.chapterIndex >= 0 ? ctx.plan.narrative.chapters[slide.chapterIndex] : null;
  return `第 ${slide.index + 1}/${ctx.total} 页 · 页型: ${slide.pageType}${chapter ? ` · 所属章节: 第${slide.chapterIndex + 1}章 ${chapter.title}` : ""}

【版式要求】
${layout?.hint ?? "自由排版，但保持模板风格与层级清晰。"}
密度: ${slide.expression.density}；正文条目上限: ${layout?.maxItems ?? 4}

【文案】
标题: ${slide.title}
${slide.subtitle ? `副标题: ${slide.subtitle}` : ""}
${slide.body.length ? `内容条目:\n${slide.body.map((b, i) => `${i + 1}. ${b}`).join("\n")}` : "（无正文条目）"}

${assetBlock(slide, d, ctx)}

输出该页完整 HTML 片段（以 <div class="slide" 开头）。`;
}

function extractFragment(text: string): string | null {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('<div class="slide"');
  if (start < 0) return null;
  return raw.slice(start).trim();
}

/** ④ 渲染层：coder 逐页并行生成 HTML 片段 */
export async function renderAllSlides(
  slides: SlidePlan[],
  decisions: RenderDecision[],
  ctx: DeckContext,
): Promise<string[]> {
  const system = coderSystemPrompt(ctx);
  return pMap(
    slides,
    async (slide) => renderOneSlide(slide, decisions[slide.index], ctx, system),
    ctx.profile.renderConcurrency,
  );
}

export async function renderOneSlide(
  slide: SlidePlan,
  d: RenderDecision,
  ctx: DeckContext,
  system?: string,
): Promise<string> {
  const sys = system ?? coderSystemPrompt(ctx);
  const user = coderUserPrompt(slide, d, ctx);
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await chat("coder", {
      system: sys,
      user: attempt === 0 ? user : `${user}\n\n注意：上次输出不合法（缺少 <div class="slide"> 根元素或 data-text 文字元素），请重新输出。`,
      stage: `render:slide${slide.index + 1}`,
      maxTokens: 6000,
    });
    const frag = extractFragment(text);
    if (frag && frag.includes("data-text")) return frag;
  }
  // 兜底：确定性极简版式，保证该页一定存在
  return fallbackSlide(slide, ctx);
}

/** 修复模式：把问题清单和原 HTML 交给 coder 重写（只改表达层） */
export async function fixSlideHtml(
  slide: SlidePlan,
  d: RenderDecision,
  ctx: DeckContext,
  currentHtml: string,
  issues: string[],
): Promise<string> {
  const system = coderSystemPrompt(ctx);
  const user = `以下是第 ${slide.index + 1} 页的当前 HTML，质检发现问题：
${issues.map((i) => `- ${i}`).join("\n")}

修复要求：只调整布局/字号/间距/密度等表达层，不得改变文字内容含义；若内容放不下允许删掉最次要的 1 条正文。保持所有硬性规则（data-text、CSS 变量、页码等）。

当前 HTML：
${currentHtml}

输出修复后的完整 HTML 片段（以 <div class="slide" 开头）。`;
  const text = await chat("coder", { system, user, stage: `fix:slide${slide.index + 1}`, maxTokens: 6000 });
  const frag = extractFragment(text);
  return frag && frag.includes("data-text") ? frag : currentHtml;
}

/** 确定性兜底页（LLM 连续失败时使用） */
export function fallbackSlide(slide: SlidePlan, ctx: DeckContext): string {
  const body = slide.body
    .map(
      (b) =>
        `<div data-text style="font-size:20px;line-height:1.6;color:var(--color-text);margin-bottom:14px">${escapeHtml(b.replace(/\|/g, " — "))}</div>`,
    )
    .join("");
  return `<div class="slide" style="padding:var(--safe-margin);display:flex;flex-direction:column;justify-content:center">
<div style="width:64px;height:6px;background:var(--color-primary);margin-bottom:28px"></div>
<div data-text style="font-size:40px;font-weight:700;color:var(--color-text);margin-bottom:12px">${escapeHtml(slide.title)}</div>
${slide.subtitle ? `<div data-text style="font-size:20px;color:var(--color-text-muted);margin-bottom:28px">${escapeHtml(slide.subtitle)}</div>` : ""}
<div style="margin-top:12px">${body}</div>
<div data-text style="position:absolute;right:24px;bottom:24px;font-size:12px;color:var(--color-text-muted)">${slide.index + 1} / ${ctx.total}</div>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
