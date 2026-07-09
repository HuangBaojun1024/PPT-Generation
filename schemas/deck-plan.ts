import { z } from "zod";

export const DeckInputSchema = z.object({
  topic: z.string().min(1),
  brief: z.string().min(1).max(2000),
  audience: z.string().min(1),
});
export type DeckInput = z.infer<typeof DeckInputSchema>;

export const DeckStyleSchema = z.object({
  styleName: z.string(),
  /** 全部为 #RRGGBB */
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  surfaceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  mutedTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  darkMode: z.boolean().default(false),
  visualKeywords: z.array(z.string()).min(2).max(8),
  /** 风格锚：拼进每条生图 prompt 的固定风格段落（英文） */
  imageStyleAnchor: z.string().min(20),
});
export type DeckStyle = z.infer<typeof DeckStyleSchema>;

export const ChapterPlanSchema = z.object({
  title: z.string().min(1).max(24),
  message: z.string().min(1).max(80),
  /** 本章正文页数（不含章节页） */
  contentSlides: z.number().int().min(2).max(7),
});
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;

export const DeckPlanSchema = z.object({
  /** 投影在幕布上的主标题：演讲者视角、面向观众，不是任务描述的复述 */
  deckTitle: z.string().min(1).max(24),
  deckSubtitle: z.string().min(1).max(40),
  intent: z.object({
    category: z.string(),
    goal: z.string().max(60),
    tone: z.string().max(60),
    audienceLevel: z.string().max(40),
  }),
  narrative: z.object({
    hook: z.string().min(1).max(80),
    arc: z.string().min(1).max(120),
    chapters: z.array(ChapterPlanSchema).min(3).max(6),
    closing: z.string().min(1).max(80),
  }),
  style: DeckStyleSchema,
  templateId: z.string(),
  language: z.string().default("zh-CN"),
});
export type DeckPlan = z.infer<typeof DeckPlanSchema>;
