/** 档位配置：控制"花多少钱买视觉"。与模型 preset（config/models.json）正交。 */
export interface Profile {
  name: string;
  /** 全套生图张数上限（成本大头） */
  imageBudget: number;
  /** 生图质量档 */
  imageResolution: "1k" | "2k";
  /** Phosphor 图标字重 */
  iconWeight: "duotone" | "regular" | "light" | "bold" | "fill" | "thin";
  /** 全局审查轮数上限（Level 2） */
  maxReviewRounds: number;
  /** 单页修复总次数上限（两条返工路径共用计数器） */
  maxFixesPerSlide: number;
  /** 装饰复杂度：给 coder 的风格指令 */
  decorLevel: "rich" | "flat";
  /** 生图并发数 */
  imageConcurrency: number;
  /** coder 渲染并发数 */
  renderConcurrency: number;
  /** 目标页数区间 */
  slideCount: { min: number; max: number };
}

export const PROFILES: Record<string, Profile> = {
  "beauty-max": {
    name: "beauty-max",
    imageBudget: 12,
    imageResolution: "2k",
    iconWeight: "duotone",
    maxReviewRounds: 2,
    maxFixesPerSlide: 2,
    decorLevel: "rich",
    imageConcurrency: 4,
    renderConcurrency: 8,
    slideCount: { min: 25, max: 30 },
  },
  balanced: {
    name: "balanced",
    imageBudget: 5,
    imageResolution: "1k",
    iconWeight: "regular",
    maxReviewRounds: 1,
    maxFixesPerSlide: 1,
    decorLevel: "flat",
    imageConcurrency: 4,
    renderConcurrency: 10,
    slideCount: { min: 25, max: 30 },
  },
};

export function getProfile(name: string): Profile {
  const p = PROFILES[name];
  if (!p) throw new Error(`未知档位: ${name}（可选: ${Object.keys(PROFILES).join(", ")}）`);
  return p;
}
