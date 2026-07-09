import { z } from "zod";

/** 页面类型全集（策略层规则、模板 layoutHints、分镜层共用） */
export const PAGE_TYPES = [
  "cover",
  "agenda",
  "chapter",
  "bigIdea",
  "concept",
  "threePoints",
  "comparison",
  "metricCards",
  "timeline",
  "roadmap",
  "process",
  "table",
  "caseStory",
  "quote",
  "imageSpread",
  "checklist",
  "code",
  "barChart",
  "closing",
] as const;

export const PageTypeSchema = z.enum(PAGE_TYPES);
export type PageType = z.infer<typeof PageTypeSchema>;

export const ChartDataSchema = z.object({
  type: z.enum(["bar", "line"]),
  title: z.string().optional(),
  unit: z.string().optional(),
  labels: z.array(z.string()).min(2).max(8),
  values: z.array(z.number()).min(2).max(8),
});
export type ChartData = z.infer<typeof ChartDataSchema>;

export const TableDataSchema = z.object({
  headers: z.array(z.string()).min(2).max(6),
  rows: z.array(z.array(z.string())).min(2).max(8),
});
export type TableData = z.infer<typeof TableDataSchema>;

export const SlidePlanSchema = z.object({
  index: z.number().int().min(0),
  chapterIndex: z.number().int().min(-1),
  pageType: PageTypeSchema,
  title: z.string().min(1).max(40),
  subtitle: z.string().max(60).optional(),
  /** 结构化正文：每条是一个要点；卡片类页面每条格式 "小标题|正文" */
  body: z.array(z.string().max(120)).max(6).default([]),
  /** 表达形式与素材需求 */
  expression: z
    .object({
      density: z.enum(["low", "medium", "high"]).default("medium"),
      needsImage: z.boolean().default(false),
      imageBrief: z.string().max(200).optional(),
      icons: z.array(z.string()).max(6).default([]),
      chart: ChartDataSchema.nullish(),
      table: TableDataSchema.nullish(),
    })
    .default({}),
});
export type SlidePlan = z.infer<typeof SlidePlanSchema>;

/** 分镜层单章输出 */
export const ChapterSlidesSchema = z.object({
  slides: z.array(SlidePlanSchema.omit({ index: true, chapterIndex: true })).min(1),
});
export type ChapterSlides = z.infer<typeof ChapterSlidesSchema>;
