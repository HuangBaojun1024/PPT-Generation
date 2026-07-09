import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Weight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

const catalogCache = new Map<Weight, Set<string>>();

function assetDir(weight: Weight): string {
  return join(ROOT, "node_modules", "@phosphor-icons", "core", "assets", weight);
}

/** 该字重下所有可用图标名（不带字重后缀，如 "rocket-launch"） */
export function catalog(weight: Weight): Set<string> {
  let c = catalogCache.get(weight);
  if (!c) {
    const suffix = weight === "regular" ? ".svg" : `-${weight}.svg`;
    c = new Set(
      readdirSync(assetDir(weight))
        .filter((f) => f.endsWith(".svg"))
        .map((f) => f.slice(0, -suffix.length)),
    );
    catalogCache.set(weight, c);
  }
  return c;
}

/** 宽松解析图标名 → 已验证存在的 Phosphor 名；找不到返回 null */
export function resolveIconName(name: string, weight: Weight): string | null {
  const cat = catalog(weight);
  const kebab = name
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (cat.has(kebab)) return kebab;
  // 常见同义词映射
  const alias: Record<string, string> = {
    test: "flask",
    branch: "git-branch",
    speed: "gauge",
    fast: "lightning",
    performance: "gauge",
    time: "clock",
    money: "currency-circle-dollar",
    cost: "coins",
    idea: "lightbulb",
    goal: "target",
    risk: "warning",
    safe: "shield-check",
    data: "chart-bar",
    growth: "trend-up",
    team: "users-three",
    code: "code",
    server: "hard-drives",
    database: "database",
    food: "fork-knife",
    coffee: "coffee",
    travel: "airplane-tilt",
    map: "map-trifold",
    temple: "bank",
    hotel: "bed",
    train: "train",
    walk: "person-simple-walk",
    photo: "camera",
    check: "check-circle",
    done: "check-circle",
    step: "footprints",
    learn: "graduation-cap",
    book: "book-open",
    write: "pencil-simple",
    list: "list-checks",
    loop: "arrows-clockwise",
    function: "function",
    variable: "cube",
  };
  if (alias[kebab] && cat.has(alias[kebab])) return alias[kebab];
  // 前缀 / 包含匹配
  for (const c of cat) {
    if (c === kebab || c.startsWith(kebab + "-")) return c;
  }
  for (const c of cat) {
    if (c.includes(kebab)) return c;
  }
  return null;
}

/** 读取内联 SVG（fill=currentColor，颜色由 CSS 控制） */
export function iconSvg(name: string, weight: Weight): string {
  const file = weight === "regular" ? `${name}.svg` : `${name}-${weight}.svg`;
  return readFileSync(join(assetDir(weight), file), "utf8");
}

/** 解析一组图标需求；解析不出的直接丢弃（无意义的占位图标比没有更伤美观） */
export function resolveIcons(names: string[], weight: Weight): { name: string; svg: string }[] {
  const out: { name: string; svg: string }[] = [];
  for (const n of names) {
    const resolved = resolveIconName(n, weight);
    if (resolved) out.push({ name: resolved, svg: iconSvg(resolved, weight) });
  }
  return out;
}
