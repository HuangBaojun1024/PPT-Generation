import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { SlidePlan } from "../../schemas/slide-plan.js";
import type { RenderDecision } from "../../schemas/render-decision.js";
import { getRole, chatJSON } from "../llm.js";
import { measureSlide, screenshotFull, buildContactSheet } from "../render/browser.js";
import { wrapHtml } from "../render/tokens.js";
import { fixSlideHtml, renderOneSlide, type DeckContext } from "./render-html.js";
import { buildImagePrompt } from "./choose-strategy.js";
import { generateImage } from "../assets/image2.js";
import { pMap } from "../util.js";

export interface AuditEntry {
  slide: number;
  level: "L1" | "L2";
  issues: string[];
  action: string;
}

const ReviewSchema = z.object({
  score: z.number().min(0).max(10),
  issues: z
    .array(
      z.object({
        slide: z.number().int().min(1),
        type: z.enum(["style", "asset"]),
        reason: z.string(),
        suggestion: z.string(),
      }),
    )
    .default([]),
});

/**
 * ⑤ 评估层。
 * Level 1：Playwright 确定性检查（每页），问题页回 ④ coder 修复（占用单页修复预算）。
 * Level 2：contact sheet → reviewer 找离群页（可关），style 问题回 ④、asset 问题回 ③ 单页重定策略。
 */
export async function evaluateAndFix(
  slides: SlidePlan[],
  decisions: RenderDecision[],
  ctx: DeckContext,
  htmls: string[],
  tokensCss: string,
  dirs: { shots: string; assets: string },
): Promise<{ htmls: string[]; audit: AuditEntry[]; reviewScore: number | null }> {
  const audit: AuditEntry[] = [];
  const { profile } = ctx;

  // ---------- Level 1 ----------
  await pMap(
    slides,
    async (slide) => {
      const d = decisions[slide.index];
      for (;;) {
        const { issues } = await measureSlide(wrapHtml(htmls[slide.index], tokensCss));
        if (!issues.length) break;
        const details = issues.map((i) => `[${i.kind}] ${i.detail}`);
        if (d.fixCount >= profile.maxFixesPerSlide) {
          audit.push({ slide: slide.index + 1, level: "L1", issues: details, action: "修复预算耗尽，接受当前版本" });
          break;
        }
        d.fixCount++;
        htmls[slide.index] = await fixSlideHtml(slide, d, ctx, htmls[slide.index], details);
        audit.push({ slide: slide.index + 1, level: "L1", issues: details, action: `coder 修复（第 ${d.fixCount} 次）` });
      }
    },
    4,
  );

  // ---------- Level 2 ----------
  const reviewerConf = getRole("reviewer");
  let reviewScore: number | null = null;
  if (reviewerConf.enabled === false || profile.maxReviewRounds <= 0) {
    return { htmls, audit, reviewScore };
  }

  for (let round = 1; round <= profile.maxReviewRounds; round++) {
    // 全量截图 → contact sheet
    const shotPaths = await pMap(
      slides,
      async (s) => {
        const p = join(dirs.shots, `slide-${String(s.index + 1).padStart(2, "0")}.png`);
        await screenshotFull(wrapHtml(htmls[s.index], tokensCss), p);
        return p;
      },
      4,
    );
    const sheet = await buildContactSheet(shotPaths);

    const review = await chatJSON(
      "reviewer",
      ReviewSchema,
      {
        system: `你是严格的演示设计总监，审查一套 PPT 的视觉一致性与美观度。图中是全套 ${slides.length} 页的缩略图（按 #编号排列）。`,
        user: `请找出「离群页」：与整体相比配色跳戏、密度失衡、版式突兀、配图风格不协调、明显丑或空的页面。
只报告确定的问题（最多 ${Math.max(3, Math.floor(slides.length / 6))} 页），没有问题就返回空数组。
输出 JSON：{"score": 整体评分0-10, "issues": [{"slide": 页号, "type": "style"(版式/配色/密度问题) 或 "asset"(配图本身的问题), "reason": "问题", "suggestion": "怎么改(表达层建议，不改文案)"}]}`,
        images: [{ base64: sheet.toString("base64"), mediaType: "image/png" }],
        stage: `review:round${round}`,
        maxTokens: 3000,
      },
      1,
    );
    reviewScore = review.score;
    const actionable = (review.issues ?? []).filter((i) => i.slide >= 1 && i.slide <= slides.length);
    if (!actionable.length) break;

    for (const issue of actionable) {
      const idx = issue.slide - 1;
      const slide = slides[idx];
      const d = decisions[idx];
      if (d.fixCount >= profile.maxFixesPerSlide) {
        audit.push({ slide: issue.slide, level: "L2", issues: [issue.reason], action: "修复预算耗尽，接受当前版本" });
        continue;
      }
      d.fixCount++;
      if (issue.type === "asset" && d.useImage && d.imagePath) {
        // 回 ③：单页重定策略——重生成图片；失败则剥离图片走 CSS 底
        const ok = await generateImage({
          prompt: `${buildImagePrompt(slide, ctx.plan, d.imageRole as "background" | "supporting")} Additional direction: ${issue.suggestion}`,
          outPath: d.imagePath,
          resolution: profile.imageResolution,
          stage: `image:refix:slide${issue.slide}`,
        });
        if (!ok) {
          d.useImage = false;
          d.imageRole = "none";
          d.imagePath = null;
        }
        htmls[idx] = await renderOneSlide(slide, d, ctx);
        audit.push({ slide: issue.slide, level: "L2", issues: [issue.reason], action: ok ? "重生成配图并重渲染" : "生图失败，剥离图片降级 CSS 底" });
      } else {
        htmls[idx] = await fixSlideHtml(slide, d, ctx, htmls[idx], [`${issue.reason}；建议：${issue.suggestion}`]);
        audit.push({ slide: issue.slide, level: "L2", issues: [issue.reason], action: "coder 表达层修复" });
      }
      // 修完再过一遍 L1 兜底（不占额外预算，只测不修）
      const { issues: l1 } = await measureSlide(wrapHtml(htmls[idx], tokensCss));
      if (l1.length) {
        audit.push({ slide: issue.slide, level: "L1", issues: l1.map((i) => i.detail), action: "L2 修复后仍有 L1 问题，记录不再修" });
      }
    }
  }
  return { htmls, audit, reviewScore };
}
