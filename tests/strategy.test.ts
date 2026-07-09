import { describe, it, expect } from "vitest";
import { chooseStrategy } from "../src/pipeline/choose-strategy.js";
import { getProfile } from "../src/profiles.js";
import type { SlidePlan } from "../schemas/slide-plan.js";
import type { DeckPlan } from "../schemas/deck-plan.js";

const style = {
  styleName: "t",
  primaryColor: "#0F766E",
  secondaryColor: "#38BDF8",
  accentColor: "#F59E0B",
  backgroundColor: "#F8FAFC",
  surfaceColor: "#FFFFFF",
  textColor: "#111827",
  mutedTextColor: "#6B7280",
  darkMode: false,
  visualKeywords: ["a", "b"],
  imageStyleAnchor: "soft watercolor style with teal palette, muted tones, editorial illustration",
};

const plan: DeckPlan = {
  deckTitle: "测试标题",
  deckSubtitle: "测试副标题",
  intent: { category: "test", goal: "g", tone: "t", audienceLevel: "a" },
  narrative: { hook: "h", arc: "a", chapters: [{ title: "c1", message: "m", contentSlides: 4 }], closing: "c" },
  style,
  templateId: "aurora-consulting",
  language: "zh-CN",
};

function slide(index: number, pageType: SlidePlan["pageType"], extra: Partial<SlidePlan["expression"]> = {}): SlidePlan {
  return {
    index,
    chapterIndex: 0,
    pageType,
    title: `第${index}页`,
    body: [],
    expression: { density: "medium", needsImage: false, icons: [], ...extra },
  } as SlidePlan;
}

describe("策略层（纯规则）", () => {
  it("生图不超预算，且按优先级分配（封面/章节/收尾优先）", () => {
    const slides = [
      slide(0, "cover"),
      slide(1, "agenda"),
      slide(2, "chapter"),
      slide(3, "caseStory", { needsImage: true, imageBrief: "x" }),
      slide(4, "quote"),
      slide(5, "imageSpread"),
      slide(6, "closing"),
    ];
    const profile = { ...getProfile("balanced"), imageBudget: 3 };
    const ds = chooseStrategy(slides, plan, profile);
    expect(ds.filter((d) => d.useImage).length).toBe(3);
    expect(ds[0].useImage).toBe(true); // cover 最优先
    expect(ds[2].useImage).toBe(true); // chapter 次之
    expect(ds[6].useImage).toBe(true); // closing 第三
    expect(ds[3].useImage).toBe(false); // caseStory 预算外
  });

  it("信息精确页型禁止生图，即使自报需要", () => {
    const slides = [slide(0, "barChart", { needsImage: true }), slide(1, "table", { needsImage: true }), slide(2, "code", { needsImage: true })];
    const ds = chooseStrategy(slides, plan, getProfile("beauty-max"));
    expect(ds.every((d) => !d.useImage)).toBe(true);
  });

  it("背景/局部图角色划分正确，prompt 含风格锚与负面清单", () => {
    const slides = [slide(0, "cover"), slide(1, "caseStory", { needsImage: true, imageBrief: "一间京都的老咖啡馆" })];
    const ds = chooseStrategy(slides, plan, getProfile("beauty-max"));
    expect(ds[0].imageRole).toBe("background");
    expect(ds[1].imageRole).toBe("supporting");
    expect(ds[1].imagePrompt).toContain("watercolor");
    expect(ds[1].imagePrompt).toContain("no text");
  });
});
