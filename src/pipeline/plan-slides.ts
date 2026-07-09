import type { DeckPlan, DeckInput } from "../../schemas/deck-plan.js";
import { ChapterSlidesSchema, type SlidePlan, PAGE_TYPES } from "../../schemas/slide-plan.js";
import type { Template } from "../../schemas/template.js";
import { chatJSON } from "../llm.js";
import { pMap } from "../util.js";

/** 章节正文可用的页面类型（框架页由代码直接生成，不占 LLM） */
const CONTENT_TYPES = PAGE_TYPES.filter((t) => !["cover", "agenda", "chapter", "closing"].includes(t));

/**
 * ② 分镜层：框架页（封面/目录/章节页/收尾）纯代码生成，
 * 各章正文页并行调用 writer 生成，最后组装完整 SlidePlan[]。
 */
export async function planSlides(input: DeckInput, plan: DeckPlan, template: Template): Promise<SlidePlan[]> {
  const chapters = plan.narrative.chapters;

  const chapterResults = await pMap(
    chapters.map((c, i) => ({ c, i })),
    async ({ c, i }) => {
      const system = `你是演示文稿分镜师。你为一套 PPT 的某一章规划正文页：每页的类型、文案、表达形式和素材需求。文案要精炼有力，禁止空话套话。只输出 JSON。`;
      const supportedTypes = CONTENT_TYPES.filter((t) => template.layouts[t]);
      const user = `整套 PPT 背景：
- 主题: ${input.topic}
- 受众: ${input.audience}（${plan.intent.audienceLevel}）
- 目标: ${plan.intent.goal}；语气: ${plan.intent.tone}
- 叙事弧: ${plan.narrative.arc}
- 全部章节: ${chapters.map((x, j) => `${j + 1}.${x.title}`).join(" / ")}

当前任务：为第 ${i + 1} 章「${c.title}」规划 ${c.contentSlides} 页正文。
本章主旨: ${c.message}

可用页面类型（pageType 必须从中选择）: ${supportedTypes.join(", ")}

输出 JSON：
{
  "slides": [
    {
      "pageType": "...",
      "title": "页标题(≤20字，观点式而非标签式，如'问题不是慢，而是不确定')",
      "subtitle": "可选副标题(≤40字)",
      "body": ["要点1", "要点2", ...],
      "expression": {
        "density": "low|medium|high",
        "needsImage": 该页是否值得配 AI 生成图,
        "imageBrief": "若 needsImage，用中文描述画面内容(≤60字，具体场景而非抽象概念)",
        "icons": ["若页型适合图标，给出英文图标名(如 rocket, coffee, shield-check)"],
        "chart": { "type": "bar|line", "title": "...", "unit": "...", "labels": [...], "values": [...] } 或省略,
        "table": { "headers": [...], "rows": [[...], ...] } 或省略
      }
    }
  ]
}

硬约束：
1. 恰好 ${c.contentSlides} 页；页型多样化，同一页型在本章最多出现 2 次。
2. body 条目：卡片类页面（threePoints/metricCards/checklist/roadmap/process）每条格式为"小标题|一句说明"；其余页面每条是完整短句。每条 ≤40 字。
3. barChart 页必须提供 chart 数据（数字要合理可信，可以是估算但要标注单位）；table 页必须提供 table。
4. threePoints 页 body 恰好 3 条；metricCards 页 body 是"数字|指标名|注解"格式 2-4 条。
5. 章内要有节奏：观点页与信息页交替，避免连续三页高密度。
6. code 页只在主题真的涉及代码时使用，body 第一条放代码（用\\n换行，≤12行），其余条放解释。`;

      const res = await chatJSON("writer", ChapterSlidesSchema, {
        system,
        user,
        stage: `slides:ch${i + 1}`,
        maxTokens: 6000,
      });
      // 数量硬校正
      let slides = res.slides.slice(0, c.contentSlides);
      while (slides.length < c.contentSlides) {
        slides.push({
          pageType: "bigIdea",
          title: c.message.slice(0, 20),
          body: [c.message],
          expression: { density: "low", needsImage: false, icons: [] },
        } as any);
      }
      return slides;
    },
    3,
  );

  // ---- 组装完整分镜（框架页零 LLM 成本） ----
  const all: SlidePlan[] = [];
  let idx = 0;
  const push = (s: Omit<SlidePlan, "index">) => all.push({ ...s, index: idx++ } as SlidePlan);

  push({
    chapterIndex: -1,
    pageType: "cover",
    title: plan.deckTitle,
    subtitle: plan.deckSubtitle,
    body: [`for ${input.audience}`],
    expression: { density: "low", needsImage: true, imageBrief: `封面氛围图：${input.topic}`, icons: [] },
  } as any);

  push({
    chapterIndex: -1,
    pageType: "agenda",
    title: "目录",
    body: chapters.map((c, i) => `${String(i + 1).padStart(2, "0")} ${c.title}|${c.message.slice(0, 30)}`),
    expression: { density: "medium", needsImage: false, icons: [] },
  } as any);

  chapters.forEach((c, i) => {
    push({
      chapterIndex: i,
      pageType: "chapter",
      title: c.title,
      subtitle: c.message.slice(0, 60),
      body: [String(i + 1).padStart(2, "0")],
      expression: { density: "low", needsImage: true, imageBrief: `章节氛围图：${c.title}（${input.topic}）`, icons: [] },
    } as any);
    for (const s of chapterResults[i]) push({ ...s, chapterIndex: i } as any);
  });

  push({
    chapterIndex: -1,
    pageType: "closing",
    title: plan.narrative.closing.slice(0, 32),
    subtitle: plan.intent.goal.slice(0, 60),
    body: [],
    expression: { density: "low", needsImage: true, imageBrief: `收尾氛围图：${input.topic}`, icons: [] },
  } as any);

  return all;
}
