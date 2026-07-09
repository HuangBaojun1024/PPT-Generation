import { join } from "node:path";
import type { SlidePlan, PageType } from "../../schemas/slide-plan.js";
import type { DeckPlan } from "../../schemas/deck-plan.js";
import type { RenderDecision } from "../../schemas/render-decision.js";
import type { Profile } from "../profiles.js";
import { resolveIcons } from "../assets/icons.js";
import { generateImage } from "../assets/image2.js";
import { pMap } from "../util.js";
import { metrics } from "../metrics.js";

/** 生图优先级：数字越小越优先拿到预算（封面 > 章节 > 收尾 > 强视觉页 > 其他自报需求页） */
const IMAGE_PRIORITY: Partial<Record<PageType, number>> = {
  cover: 0,
  chapter: 1,
  closing: 2,
  imageSpread: 3,
  quote: 4,
  caseStory: 5,
  concept: 6,
};

/** 整页背景 or 局部配图 */
const BACKGROUND_TYPES = new Set<PageType>(["cover", "chapter", "closing", "quote", "imageSpread"]);

/** 这些页型禁止生图（信息精确性优先） */
const NO_IMAGE_TYPES = new Set<PageType>(["barChart", "table", "code", "agenda", "metricCards", "comparison"]);

/** ③ 策略层：纯规则，零 LLM。决定每页素材与形式，并按预算分配生图。 */
export function chooseStrategy(slides: SlidePlan[], plan: DeckPlan, profile: Profile): RenderDecision[] {
  const decisions: RenderDecision[] = slides.map((s) => ({
    index: s.index,
    pageType: s.pageType,
    useImage: false,
    imageRole: "none" as const,
    imagePrompt: null,
    imagePath: null,
    icons: resolveIcons(s.expression.icons ?? [], profile.iconWeight).map((i) => i.name),
    chart: s.expression.chart ?? null,
    table: s.expression.table ?? null,
    fixCount: 0,
  }));

  // 候选：页型优先级 or 分镜层自报 needsImage
  const candidates = slides
    .filter((s) => !NO_IMAGE_TYPES.has(s.pageType))
    .filter((s) => IMAGE_PRIORITY[s.pageType] !== undefined || s.expression.needsImage)
    .sort((a, b) => (IMAGE_PRIORITY[a.pageType] ?? 9) - (IMAGE_PRIORITY[b.pageType] ?? 9) || a.index - b.index);

  for (const s of candidates.slice(0, profile.imageBudget)) {
    const d = decisions[s.index];
    d.useImage = true;
    d.imageRole = BACKGROUND_TYPES.has(s.pageType) ? "background" : "supporting";
    d.imagePrompt = buildImagePrompt(s, plan, d.imageRole);
  }
  return decisions;
}

/** 风格锚 + 单页画面描述 + 负面清单 */
export function buildImagePrompt(slide: SlidePlan, plan: DeckPlan, role: "background" | "supporting"): string {
  const brief = slide.expression.imageBrief || `${slide.title}, related to ${plan.intent.category}`;
  const comp =
    role === "background"
      ? "Wide cinematic composition with generous negative space suitable as a presentation slide background, key subject off-center."
      : "Clean single-subject composition suitable as an editorial illustration inside a presentation slide.";
  return `${brief}. ${comp} ${plan.style.imageStyleAnchor} Strictly no text, no letters, no words, no watermark, no logo, no UI elements.`;
}

/** ③.5 素材预取：并行生成全部图片，失败自动置空（coder 降级为渐变底） */
export async function prefetchImages(decisions: RenderDecision[], assetsDir: string, profile: Profile): Promise<void> {
  const jobs = decisions.filter((d) => d.useImage && d.imagePrompt);
  await pMap(
    jobs,
    async (d) => {
      const outPath = join(assetsDir, `slide-${String(d.index + 1).padStart(2, "0")}.png`);
      const ok = await generateImage({
        prompt: d.imagePrompt!,
        outPath,
        resolution: profile.imageResolution,
        stage: `image:slide${d.index + 1}`,
      });
      if (ok) {
        d.imagePath = outPath;
      } else {
        d.useImage = false;
        d.imageRole = "none";
        d.imagePath = null;
      }
    },
    profile.imageConcurrency,
  );
  metrics.meta.imagesPlanned = jobs.length;
  metrics.meta.imagesGenerated = jobs.filter((j) => j.imagePath).length;
}
