import { describe, it, expect } from "vitest";
import { resolveIconName, resolveIcons, iconSvg } from "../src/assets/icons.js";
import { extractJson } from "../src/llm.js";

describe("Phosphor 图标解析", () => {
  it("精确名 / 驼峰 / 同义词都能解析", () => {
    expect(resolveIconName("rocket", "duotone")).toBe("rocket");
    expect(resolveIconName("gitBranch", "regular")).toBe("git-branch");
    expect(resolveIconName("test", "duotone")).toBe("flask");
    expect(resolveIconName("coffee", "regular")).toBe("coffee");
  });

  it("解析结果一定能读到 currentColor 的 SVG；解析不出的直接丢弃", () => {
    const icons = resolveIcons(["rocket", "不存在的名字xyz"], "duotone");
    expect(icons.length).toBe(1);
    for (const i of icons) expect(iconSvg(i.name, "duotone")).toContain("currentColor");
  });
});

describe("LLM JSON 提取", () => {
  it("容忍代码块与前后闲话", () => {
    expect(extractJson('好的，输出如下：\n```json\n{"a":1}\n```\n以上')).toEqual({ a: 1 });
    expect(extractJson('{"a":{"b":[1,2]}}')).toEqual({ a: { b: [1, 2] } });
  });
});
