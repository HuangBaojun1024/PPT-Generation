import { z } from "zod";
import { PageTypeSchema } from "./slide-plan.js";

/**
 * 模板 = Design Tokens 默认值 + LayoutMap（pageType → 布局提示与约束）。
 * 模板不写死颜色——DeckStyle 会覆盖 tokens；模板负责版式家族与约束。
 */
export const LayoutHintSchema = z.object({
  /** 给 coder 的版式描述（自然语言 + 网格建议） */
  hint: z.string(),
  /** 正文条目上限 */
  maxItems: z.number().int().min(0).max(8).default(4),
  /** 内容密度 */
  density: z.enum(["low", "medium", "high"]).default("medium"),
  /** 是否允许整页背景图 */
  allowFullBleedImage: z.boolean().default(false),
});

export const TemplateSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  bestFor: z.array(z.string()),
  notGoodFor: z.array(z.string()).default([]),
  /** 视觉母题：coder 在所有页面复用的装饰语言 */
  motifs: z.array(z.string()).default([]),
  /** 模板级风格补充说明（拼进 coder system prompt） */
  styleNotes: z.string().default(""),
  layouts: z.record(PageTypeSchema, LayoutHintSchema),
});
export type Template = z.infer<typeof TemplateSchema>;
export type LayoutHint = z.infer<typeof LayoutHintSchema>;
