import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DeckPlanSchema, type DeckPlan, type DeckInput } from "../../schemas/deck-plan.js";
import { TemplateSchema, type Template } from "../../schemas/template.js";
import type { Profile } from "../profiles.js";
import { chatJSON } from "../llm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadTemplates(): Template[] {
  const dir = join(ROOT, "templates");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => TemplateSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** ① 规划层：一次高推理调用产出 DeckPlan（意图 + 叙事 + 风格 + 模板选择） */
export async function planDeck(input: DeckInput, profile: Profile): Promise<{ plan: DeckPlan; template: Template }> {
  const templates = loadTemplates();
  const menu = templates
    .map((t) => `- ${t.templateId}（${t.name}）适合: ${t.bestFor.join("、")}；不适合: ${t.notGoodFor.join("、")}`)
    .join("\n");

  const target = Math.round((profile.slideCount.min + profile.slideCount.max) / 2); // 目标页数
  const system = `你是顶级演示文稿策划人 + 品牌设计师。你为一套 25-30 页的 PPT 做全局规划：理解需求、设计叙事线、定义视觉风格、选择模板。只输出 JSON。`;

  const user = `输入：
- 主题: ${input.topic}
- 简介: ${input.brief}
- 受众: ${input.audience}

可选模板（templateId 必须从中选择）：
${menu}

请输出以下结构的 JSON：
{
  "deckTitle": "演示主标题(≤20字)",
  "deckSubtitle": "副标题一句话(≤36字)",
  "intent": { "category": "主题类型", "goal": "演示目标(≤60字)", "tone": "语气(≤60字)", "audienceLevel": "受众水平(≤40字)" },
  "narrative": {
    "hook": "开场钩子一句话(≤80字)",
    "arc": "叙事弧概述(≤120字)",
    "chapters": [ { "title": "章节名(≤24字)", "message": "本章一句话主旨(≤80字)", "contentSlides": 每章正文页数(2-7) } ],
    "closing": "收尾一句话(≤80字)"
  },
  "style": {
    "styleName": "风格名",
    "primaryColor": "#RRGGBB", "secondaryColor": "#RRGGBB", "accentColor": "#RRGGBB",
    "backgroundColor": "#RRGGBB", "surfaceColor": "#RRGGBB（卡片底色，比背景稍有区分）",
    "textColor": "#RRGGBB", "mutedTextColor": "#RRGGBB",
    "darkMode": 背景是否深色,
    "visualKeywords": ["2-8个视觉关键词"],
    "imageStyleAnchor": "英文风格锚段落：描述全套配图的统一艺术风格、媒介质感、光线、色调（引用上面色板的具体颜色），30-60词。所有配图 prompt 都会拼接这段。"
  },
  "templateId": "从模板菜单选择",
  "language": "zh-CN"
}

硬约束：
1. 章节数 4-6 个，chapters[].contentSlides 之和必须等于 ${target - 3 - 4}~${target - 3 + 2} 之间的某个数（固定框架另占：封面1 + 目录1 + 每章章节页1 + 收尾1，总页数须在 ${profile.slideCount.min}-${profile.slideCount.max}）。
2. 配色必须保证 textColor 与 backgroundColor 有足够对比度；颜色体系要贴合主题气质，避免用烂大街的默认蓝。
3. 叙事必须有钩子、有展开、有收尾，章节之间有递进关系，不是并列口袋。
4. style 是给${input.audience}看的，气质要匹配。
5. deckTitle 是"演讲现场投在幕布上的标题"：站在演讲者立场、说给听众听，凝练有观点（好例子：「订单系统的确定性投资」「两天，把京都装进口袋」）；严禁复述任务描述（坏例子：「给老板讲清楚为什么…」「帮零基础的人理解…」）。`;

  const plan = await chatJSON("planner", DeckPlanSchema, { system, user, stage: "plan", maxTokens: 4000 });

  const template = templates.find((t) => t.templateId === plan.templateId) ?? templates[0];
  plan.templateId = template.templateId;

  // 页数校正：固定框架 = 封面 + 目录 + 每章1页章节页 + 收尾
  fixSlideCount(plan, profile);
  return { plan, template };
}

function fixSlideCount(plan: DeckPlan, profile: Profile) {
  const frame = 3 + plan.narrative.chapters.length; // cover + agenda + closing + dividers
  const total = () => frame + plan.narrative.chapters.reduce((s, c) => s + c.contentSlides, 0);
  let guard = 60;
  while (total() < profile.slideCount.min && guard--) {
    const c = [...plan.narrative.chapters].sort((a, b) => a.contentSlides - b.contentSlides)[0];
    if (c.contentSlides >= 7) break;
    c.contentSlides++;
  }
  while (total() > profile.slideCount.max && guard--) {
    const c = [...plan.narrative.chapters].sort((a, b) => b.contentSlides - a.contentSlides)[0];
    if (c.contentSlides <= 2) break;
    c.contentSlides--;
  }
}
