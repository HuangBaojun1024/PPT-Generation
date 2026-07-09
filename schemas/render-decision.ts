import { z } from "zod";
import { ChartDataSchema, PageTypeSchema, TableDataSchema } from "./slide-plan.js";

/** 策略层输出：每页的执行决定（纯代码产生，无 LLM） */
export const RenderDecisionSchema = z.object({
  index: z.number().int().min(0),
  pageType: PageTypeSchema,
  /** 是否为该页生成 AI 图片 */
  useImage: z.boolean(),
  /** 图片角色：整页背景 or 版面局部图 */
  imageRole: z.enum(["background", "supporting", "none"]).default("none"),
  imagePrompt: z.string().nullish(),
  /** 生成后的图片绝对路径（素材阶段回填） */
  imagePath: z.string().nullish(),
  /** 解析后的 Phosphor 图标名（已验证存在） */
  icons: z.array(z.string()).default([]),
  chart: ChartDataSchema.nullish(),
  table: TableDataSchema.nullish(),
  /** 修复计数（评估阶段使用，封顶 maxFixesPerSlide） */
  fixCount: z.number().int().default(0),
});
export type RenderDecision = z.infer<typeof RenderDecisionSchema>;
