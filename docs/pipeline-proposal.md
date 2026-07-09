# PPT 一套生成器 — 技术方案

> 输入一个 JSON，输出一套 25–30 页、风格统一、有叙事线的 `.pptx`。
> 三个考核维度：**美观度 / LLM 成本 / 生成速度**，且需交付「最大化美观度版」与「Trade-off 版」两版。

---

## 0. 核心技术选型（一句话结论）

| 决策点 | 选择 | 一句话理由 |
|---|---|---|
| 页面中间产物 | **HTML + CSS** | LLM 生成 HTML/CSS 的排版能力远强于生成 pptx 坐标参数；且 HTML 可被浏览器精确测量，天然带质检能力。 |
| HTML → pptx | **混合转换（背景光栅化 + 文字覆盖），整页截图兜底** | 装饰层像素级还原，文字层保留可编辑；对不齐时整页退化为截图，保证一定能打开。 |
| 模板描述 | **LayoutMap（Design Tokens + 布局区块 Map）** | 模板是数据不是代码；用 Map 描述每种页型的区块与槽位，编译成 HTML 骨架。 |
| 图标库 | **Phosphor Icons（主）/ Lucide（备）** | Phosphor 6 种统一字重、几何一致，可按档位切风格；同一套库天然保证图标一致性。 |
| 生图模型 | **GPT-Image-2（背景 / 氛围图 / 示意图）** | 已有调用链路；仅用于「文字少、强氛围」页，中文字交给 HTML 层。 |
| 文本模型 | **按角色独立配置**（规划 / 分镜 / 写 HTML / 一致性审查 各自一个角色，见 §0.5） | 各环节能力要求不同：写 HTML 用代码强的模型，一致性审查用视觉推理强的 thinking 模型，互不绑架。 |
| 渲染引擎 | **Playwright（headless Chromium）** | 同一引擎负责渲染、测量、截图、质检，闭环成本最低。 |

---

## 0.5 模型与代理商配置

所有模型、代理商、密钥**全部外置于配置**，代码只认「角色」不认具体模型，方便随时换供应商或降级。
四个可独立配置的角色：**规划（planner）/ 分镜文案（writer）/ 写 HTML（coder）/ 一致性审查（reviewer）**，外加生图（image）。

### 角色 → 模型映射（目标配置 · 拉满档）

| 角色 | 模型 | 代理商（网关） | 用在哪 | 说明 |
|---|---|---|---|---|
| `planner` 规划 | `gpt-5.5`（reasoning: high） | saturday（OpenAI 兼容网关，地址由 `SATURDAY_BASE_URL` 环境变量传入） | ① 规划层 | 全局叙事和风格质量由它兜底 |
| `writer` 分镜文案 | `gpt-5.5`（reasoning: low） | saturday | ② 分镜 | 低推理并行，结构由 schema 约束 |
| `coder` 写 HTML | `claude-fable-5` | haoai（Anthropic 兼容，`https://api.hao.ai/anthropic/v1`） | ④ HTML 渲染 | 写前端代码的能力最强，页面美观度上限由它决定 |
| `reviewer` 一致性审查 | `claude-opus-4-7`（extended thinking） | haoai | ⑤ contact-sheet 拼图审查 | 视觉推理 + thinking 找离群页，结果回 ④ 由 coder 修正 |
| `image` 生图 | `gpt-image-2` | saturday（主）→ APIMart（`https://api.apimart.ai/v1`，兜底） | 封面/章节/氛围图 | 主渠道同步接口更快；失败自动回退 |
| 备选降级 | `glm-5.1` | saturday | writer/coder 降级 | 主模型限流/故障时的文本降级线 |

### 测试阶段配置（先跑通再拉满）

测试期全部文本角色先用 `gpt-5.5`；**GPT-5.5 做不了可靠的一致性审查，reviewer 直接置 `enabled: false` 跳过**——评估层只走 Level 1 确定性检查（免费），Level 2 拼图审查整级跳过，流程其余部分不受影响。

| 角色 | 测试阶段 | 拉满档 |
|---|---|---|
| planner | gpt-5.5 (high) | gpt-5.5 (high) |
| writer | gpt-5.5 (low) | gpt-5.5 (low) |
| coder | gpt-5.5 (low) | claude-fable-5 |
| reviewer | **disabled（跳过 Level 2）** | claude-opus-4-7 (thinking) |
| image | gpt-image-2 | gpt-image-2 |

### 配置文件设计

密钥进 `.env`（不入库），模型路由进 `config/models.json`：

```jsonc
// config/models.json —— 只描述路由，不含密钥
{
  "providers": {
    "saturday": { "baseURLEnv": "SATURDAY_BASE_URL",              "apiKeyEnv": "SATURDAY_API_KEY", "protocol": "openai" },
    "haoai":    { "baseURL": "https://api.hao.ai/anthropic/v1",   "apiKeyEnv": "HAOAI_API_KEY",    "protocol": "anthropic" },
    "apimart":  { "baseURL": "https://api.apimart.ai/v1",         "apiKeyEnv": "APIMART_API_KEY",  "protocol": "apimart" }
  },
  "roles": {
    "planner":  { "provider": "saturday", "model": "gpt-5.5", "reasoningEffort": "high" },
    "writer":   { "provider": "saturday", "model": "gpt-5.5", "reasoningEffort": "low",
                  "fallback": { "provider": "saturday", "model": "glm-5.1" } },
    "coder":    { "provider": "haoai", "model": "claude-fable-5",
                  "fallback": { "provider": "saturday", "model": "gpt-5.5", "reasoningEffort": "low" } },
    "reviewer": { "enabled": true, "provider": "haoai", "model": "claude-opus-4-7", "thinking": true },
    "image":    { "provider": "saturday", "model": "gpt-image-2",
                  "fallback": { "provider": "apimart", "model": "gpt-image-2" } }
  }
}
```

```bash
# .env（不提交，README 说明如何配置）
SATURDAY_BASE_URL=<内部网关地址，不入库>
SATURDAY_API_KEY=sk-xxx
HAOAI_API_KEY=sk-xxx
APIMART_API_KEY=sk-xxx
```

约定：
1. 代码内**只允许通过角色取模型**（`getModel("coder")`），禁止硬编码模型名——换供应商是改配置不是改代码。
2. 每个角色可声明 `fallback`，由统一的调用封装做「主渠道失败 → 自动降级」，并把实际命中渠道写进 metrics。
3. `reviewer.enabled=false` 时评估层自动退化为「仅 Level 1 确定性检查」，pipeline 不需要任何代码改动。
4. 单价表也放配置（`config/pricing.json`），metrics 按 token 用量 × 单价折算成本；网关计价与官方价不一致时以实测账单校准。

---

## 1. 整体流程图

```text
┌──────────────────────────────────────────────────────────────┐
│ 输入 JSON  { topic, brief, audience }                          │
└───────────────────────────┬──────────────────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ ① 规划层（GPT-5.5 高推理 · 1 次调用）    │   ← 唯一的"贵"调用
        │   输入：JSON + 档位 profile              │
        │   输出：DeckPlan                         │
        │   - DeckIntent  主题/受众/目的/语气      │
        │   - Narrative   钩子/叙事弧/章节结构      │
        │   - DeckStyle   色板/双字体/视觉关键词    │
        │   - templateId  选中的 LayoutMap 模板     │
        └───────────────────┬────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ ② 分镜层（GPT-5.5 低推理 · 按章节并行）   │
        │   输入：DeckPlan（逐章）                  │
        │   输出：SlidePlan[]（25–30 页）           │
        │   每页：pageType / 文案 / 表达形式        │
        │        / 素材需求(需图?需图标?需图表?)     │
        └───────────────────┬────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ ③ 策略层（纯代码 · 0 LLM）               │   ← 免费的确定性规则
        │   SlidePlan + LayoutMap → RenderDecision │
        │   选定：页面变体 + 素材清单               │
        │   （谁需要 GPT-Image-2 / 图标 / 图表）    │
        └───────────────────┬────────────────────┘
             ┌───────────────┼────────────────┐
             │               │                │        ③.5 素材并行预取
   ┌─────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
   │ GPT-Image-2 图 │ │ Phosphor 图标 │ │ 图表 SVG    │
   │ (仅氛围/背景页) │ │ (统一字重)    │ │ (确定性渲染) │
   └─────────┬──────┘ └──────┬───────┘ └──────┬──────┘
             └───────────────┼────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ ④ 渲染层（coder: fable-5 逐页并行→HTML） │
        │   SlidePlan + Tokens + 素材 → 单页 HTML   │
        │   共享同一份 tokens.css（构造性一致）     │
        └───────────────────┬────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ ⑤ 评估层（可开关）                        │
        │   a. 确定性检查(0 LLM)：溢出/重叠/对比度  │
        │   b. contact-sheet → reviewer:            │
        │      opus-4.7 thinking 找离群页           │
        │   两条返工路径（都是单页级，不重跑全流程）：│
        │   - 样式问题 → 回 ④ 由 coder 修正 HTML     │──► ④
        │   - 图片/素材问题 → 回 ③ 单页重定策略      │──► ③
        │     （换变体/重生成图/降级为 CSS 底）→ ④   │
        │   单页修复总次数 ≤ maxFixesPerSlide(可配)  │
        │   （reviewer disabled 时只跑 a）          │
        └───────────────────┬────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ ⑥ 合并层（纯代码）                        │
        │   每页 HTML → 混合转换 → pptx 页          │
        │   输出 final.pptx + metrics.json + audit  │
        └──────────────────────────────────────────┘
```

**LLM 调用点总览（成本可控的关键）：**

| 步骤 | 是否 LLM | 角色（拉满档模型） | 调用次数 |
|---|---|---|---|
| ① 规划 | 是 | planner（gpt-5.5 高推理） | 1 |
| ② 分镜 | 是 | writer（gpt-5.5 低推理） | 章节数（约 5–7，可并行） |
| ③ 策略 | **否（纯代码）** | — | 0 |
| ④ 渲染 HTML | 是 | coder（claude-fable-5） | 25–30（并行）+ 返工页 |
| ⑤ 评估 | 是（仅拼图审查，可关） | reviewer（claude-opus-4-7 thinking） | 1–2 |
| ⑥ 合并 | **否（纯代码）** | — | 0 |

设计原则：**贵的推理只花在 1 次全局规划上，其余都是可并行的便宜调用或零成本代码。**

---

## 2. 如何保证风格一致性

策略：**构造性保证优先（编译出来的一致，约占 90%），评估只兜底漏网的 10%。**

### 2.1 构造层（零成本、确定性）

1. **单一 Design Token 源**
   `DeckStyle` 编译成唯一一份 `tokens.css`（CSS variables）：主色/辅助色/背景/文字色、双字体、字号阶梯、间距、圆角、阴影、安全边距。
   **所有 25–30 页共享同一份样式表**——一致性是"编译"出来的，不是每页各自发挥后再去检查。

   ```css
   :root {
     --color-primary: #0F766E;
     --color-secondary: #38BDF8;
     --color-bg: #F8FAFC;
     --color-text: #111827;
     --font-title: "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
     --font-body:  "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif;
     --safe-margin: 64px;
     --radius-card: 16px;
   }
   ```

2. **图片统一色调滤镜**
   所有 GPT-Image-2 生成图，在 HTML 层统一叠一层主色 duotone / tint（`mix-blend-mode` 或半透明色罩）。这是把「风格各异的生成图」强行拉进同一色系最便宜、最立竿见影的手段，也解决 fullImage 页与 template 页的视觉断层。

3. **Style Anchor（生图一致性锚点）**
   生成一段固定「风格锚文案」= 风格描述 + 色板 hex 列表 + 负面清单（`no text, no watermark, no logo`），拼进**每一条** Image-2 prompt；统一模型、统一宽高比、统一 seed 策略；封面先出图，后续图 prompt 引用封面风格描述，保证同一套视觉语言。

4. **硬约束清单（写死在校验里）**
   - 图标：只用 **Phosphor 一套库、一个字重**（beauty-max 用 duotone，balanced 用 regular），不混用其他库。
   - 颜色：全套 ≤ 4 个色 + 主色的透明度派生。
   - 字体：全套 ≤ 2 个字族。
   - 页眉、页码、安全边距：固定位置，模板级约定。

### 2.2 评估层（抓漏网的 10%，见 §3）

- 确定性检查：对比度、最小字号、安全边距是否被撑破。
- 拼图审查：reviewer（opus-4.7 thinking）一次看 30 页缩略图，专找「配色/密度/风格跳戏」的离群页，结果回渲染层由 coder 修正。

### 2.3 一致性 ≠ 单调（与多样性的平衡）

一致性锁的是「视觉系统」（色板、字体、图标库、区块网格、留白节奏）；
多样性放开的是「页面变体」——同一模板下轮换 pageType 版式、配色在主色域内派生、封面/章节页图片各不相同。
所以不同输入产出的是「同系不同款」，而不是「同一个模板填空」。

---

## 3. 评估机制如何建立

分三级，越靠前越便宜，能在前一级拦住就不进下一级。

### Level 0 — Schema 校验（生成时，零成本）

每个中间产物（DeckPlan / SlidePlan / RenderDecision）都有 zod schema。
LLM 输出不合规 → 自动重试（最多 N 次）→ 仍失败则降级（用兜底模板/兜底文案），**绝不把坏数据带进下一步**。

### Level 1 — 确定性检查（Playwright DOM 测量，零 LLM）

每页 HTML 在浏览器里跑一遍机器可判定的规则：

| 检查项 | 判定方式 | 不过关处理 |
|---|---|---|
| 文字溢出 | `scrollHeight > clientHeight` | 缩字号 / 删条目 / 换密度更低的变体 |
| 元素重叠 | 关键节点 bounding box 相交 | 重排该区块 |
| 对比度 | 文字/背景 WCAG AA | 换文字色 token |
| 最小字号 | 计算样式 < 阈值 | 减少内容量 |
| 安全边距 | 内容溢出 safe-margin | 收紧 padding |
| 图标风格 | 是否全来自 Phosphor 同字重 | 替换成合规图标 |

**这一级完全免费，却能拦掉 80% 的「翻车页」（尤其中文文字溢出）。**

### Level 2 — reviewer 拼图审查（claude-opus-4-7 thinking，可开关）

把 25–30 页缩略图拼成一张 contact sheet（宫格图），reviewer（`claude-opus-4-7` + extended thinking）一次性完成：
- 找**离群页**：哪几页配色/密度/风格与整体不协调；
- 给整套打分（美观度、一致性）；
- 只输出「需返工的页号 + 问题分类（样式 / 图片素材）+ 原因 + 修改建议」，按分类路由到 ④ coder 修 HTML 或 ③ 单页重定策略（见下方返工闭环）。

**为什么拼图审而非逐页审**：逐页审 30 次 = 30 倍成本；拼图审 1 次就能抓住「不一致」这个最关键的问题（不一致本质是页与页之间的对比，正好适合一张图看全）。
**为什么用 thinking 模型**：一致性判断是跨页比对推理（"第 14 页的饱和度和其他页不是一个体系"），需要视觉 + 推理能力，低推理多模态模型判不稳。

**开关**：`reviewer.enabled=false` 时整级跳过，只保留 Level 0/1（测试阶段先用 GPT-5.5 跑通全流程时就是这个状态）。

### 返工闭环（两条路径，单页级，防死循环）

reviewer 对每个被点名的页给出问题分类，决定返工路径——**两条路径都只针对问题页本身，绝不重跑全流程**：

| 问题类型 | 返工路径 | 做什么 |
|---|---|---|
| 样式问题（字号、密度、配色跳戏、排版乱） | 回 **④ 渲染层** | coder 依据 reviewer 修改建议重写该页 HTML，**只改表达层，禁止改文案** |
| 图片/素材问题（生成图效果差、与整体风格不搭、图不达意） | 回 **③ 策略层（单页）** | 只对该页重新做 RenderDecision：换版式变体 / 换 prompt 重生成图 / 直接降级为 CSS 渐变底，然后回 ④ 重渲染该页 |

预算控制（全部可配置，见 `profiles.ts`）：

- **`maxFixesPerSlide`（单页修复总次数上限）**：同一页无论走哪条路径，累计修复次数封顶；超限就接受当前最好的一版并记入 audit。默认 beauty-max = 2、balanced = 1。
- `maxReviewRounds`（全局审查轮数）：最多 1–2 轮，受时间盒约束。
- 回 ③ 的重生成图计入生图预算，生图预算耗尽时该路径自动降级为「换变体 / CSS 底」，不再产生图片成本。
- 每次修复的路径、次数、命中模型都写入 metrics，DESIGN.md 可以直接引用返工率数据。

---

## 4. 成本与速度：如何设置和统计

### 4.1 预算模型（先算账再实现）

以 balanced 档、单份 28 页为例（数字为方案预估，实测填入 DESIGN.md）：

| 支出项 | 模型 | 用量 | 小计 |
|---|---|---|---|
| ① 规划 | gpt-5.5（高推理） | 1 次 · 长输出 | ~$0.15 |
| ② 分镜 | gpt-5.5（低推理） | ~6 次并行 | ~$0.06 |
| ④ 渲染 HTML | claude-fable-5 | 28 次并行 + 返工页 | ~$0.40 |
| ⑤ 拼图审查 | claude-opus-4-7（thinking） | 1–2 次 | ~$0.15 |
| 生图 | gpt-image-2 | balanced 约 6–8 张 | 生图占大头 |
| **合计** | | | **远低于 $10 上限** |

> 单价以 `config/pricing.json` 为准（网关计价），上表为占位预估，实测后回填 DESIGN.md。

> 关键洞察：**生图是成本大头，文本 LLM 是小头。** 因此「省钱」主要靠控制生图页数（§5 档位变量），而不是省文本调用。

### 4.2 速度模型

| 阶段 | 是否并行 | 预估耗时 |
|---|---|---|
| ① 规划 | 串行 | ~15s |
| ② 分镜 | 章节并行 | ~15s |
| ③ 策略 | 代码 | <1s |
| 生图 + 图标 + 图表 | 全并行 | 取决于最慢的生图，~1–3min |
| ④ 渲染 HTML | 28 页并行 | ~30s |
| ⑤ 评估 + 返工 | 1–2 轮 | ~1min |
| ⑥ 合并导出 | 代码 | ~10s |
| **合计** | | **远低于 30min 上限** |

> 瓶颈是生图并发数。用并发池（如 6 路并发）平衡速度与限流。

### 4.3 统计口径（代码内建埋点）

每步记录 `{ tokensIn, tokensOut, model, costUsd, latencyMs, imageCount }`，
汇总输出 `metrics.json`：

```json
{
  "profile": "balanced",
  "slides": 28,
  "costUsd": { "llmText": 0.51, "image": 3.20, "vlm": 0.05, "total": 3.76 },
  "latencyMs": { "plan": 15000, "render": 30000, "images": 120000, "total": 210000 },
  "llmCalls": 35,
  "imageCalls": 7,
  "reworkRounds": 1
}
```

DESIGN.md 里对 5 套 demo × 2 版 = 10 组，各贴一行实测，形成对比表。

---

## 5. 两个档位：可控制的变量

用一个 `--profile` 参数切换，底层是一张**档位配置表**，控制以下变量：

| 变量 | `beauty-max`（最大美观度，<$10 / <30min） | `balanced`（Trade-off 版） |
|---|---|---|
| 生图页数预算 | 高（封面/章节/金句/氛围页尽量真图，约 10–14 张） | 低（仅封面+少数章节，约 4–6 张） |
| 生图分辨率 | 2k | 1k |
| 图片色调滤镜 | 精细（duotone + 纹理叠加） | 简单（tint 色罩） |
| 图标字重 | Phosphor `duotone`（更精致） | Phosphor `regular`（更省心、更稳） |
| 评估返工轮数 `maxReviewRounds` | 最多 2 轮 | 最多 1 轮 |
| 单页修复上限 `maxFixesPerSlide` | 2 | 1 |
| reviewer 审查 | 开启（opus-4.7 thinking） | 可选（省成本可关，只留 Level 1） |
| 装饰复杂度 | 允许渐变/阴影/纹理/插画分隔符 | 克制，扁平为主 |
| 非生图页背景 | 允许生成低干扰氛围底图 | 纯色/CSS 渐变底 |

**设计意图**：两档共用同一条 pipeline 和同一套模板，差异只在「花多少钱买视觉」——
beauty-max 把预算砸在生图与精修，balanced 用更多确定性渲染（图标/图表/CSS 装饰）换取成本与速度。这本身就是 DESIGN.md「成本-美观-速度 trade-off」章节的核心论据。

> 注意：**档位（beauty-max/balanced）与模型配置（测试/拉满，§0.5）是两个正交开关**——前者控制视觉预算，后者控制各角色用什么模型，可自由组合。

---

## 6. 模板：LayoutMap（用 Map 描述布局控制）

模板 = **Design Tokens + LayoutMap**。LayoutMap 用 Map 描述「每种页型 → 布局区块」，编译成 HTML 骨架；LLM 只负责往槽位填内容，不负责排版决策。

```jsonc
{
  "templateId": "aurora-consulting",
  "name": "咨询报告风",
  "bestFor": ["商业方案", "汇报", "说服", "复盘"],
  "notGoodFor": ["儿童教育", "强插画风"],
  "tokens": {
    "primaryColor": "#0F766E",
    "secondaryColor": "#38BDF8",
    "backgroundColor": "#F8FAFC",
    "textColor": "#111827",
    "fontTitle": "Source Han Sans SC",
    "fontBody": "Source Han Sans SC",
    "iconSet": "phosphor",
    "iconWeight": { "beauty-max": "duotone", "balanced": "regular" }
  },
  "motifs": ["accent-bar", "metric-card", "soft-shadow"],

  // 核心：pageType -> 布局区块 Map
  "layouts": {
    "cover": {
      "grid": "12x8",
      "blocks": {
        "bg":       { "area": "1/1/9/13", "role": "image-or-gradient", "density": "low" },
        "title":    { "area": "6/2/7/11", "slot": "title", "maxCn": 20 },
        "subtitle": { "area": "7/2/8/9",  "slot": "subtitle", "maxCn": 40 }
      }
    },
    "threePoints": {
      "grid": "12x8",
      "blocks": {
        "title": { "area": "1/2/2/12", "slot": "title", "maxCn": 24 },
        "card1": { "area": "3/2/7/5",  "slot": "point", "icon": true },
        "card2": { "area": "3/5/7/9",  "slot": "point", "icon": true },
        "card3": { "area": "3/9/7/12", "slot": "point", "icon": true }
      }
    },
    "roadmap": {
      "grid": "12x8",
      "blocks": {
        "title":    { "area": "1/2/2/12", "slot": "title" },
        "timeline": { "area": "3/2/7/12", "slot": "nodes", "min": 3, "max": 5, "icon": true }
      }
    }
    // ... 其余页型
  }
}
```

要点：
1. LayoutMap 描述**结构与约束**（网格、区块、槽位、字数上限、是否带图标），不描述某一次业务内容。
2. 同一 pageType 可有多个 `variant` 供多样性轮换。
3. `maxCn` 是给渲染层与 Level 1 检查用的字数约束（中文按渲染宽度兜底）。
4. 该结构同时服务 HTML 渲染与 pptx 合并，一份数据两处用。

---

## 7. HTML → pptx 转换（混合模式）

```text
单页 HTML（Playwright 渲染）
  ├─ 隐藏文字节点 → 截图 → 得到"纯装饰背景图"（像素级还原渐变/阴影/纹理/图片）
  ├─ DOM 测量每个文本框 bounding box + 计算样式（字号/字色/对齐/行高）
  └─ pptx 组装：背景图铺满整页 + 按测量坐标叠加 pptx 原生文本框
        ↓ 若文字对位偏差超阈值
     整页截图兜底（退化为不可编辑图片页，保证一定能打开）
```

- **好处**：装饰层像素级还原（HTML 的美观度不打折），文字层保留可编辑与清晰度。
- **兜底**：题目只要求「能正常打开」，故整页截图是绝对安全的降级线。
- pptxgenjs 只做最终组装，不承担排版智能。

---

## 8. 图标库选型说明

| 库 | 字重/风格 | 是否选用 | 理由 |
|---|---|---|---|
| **Phosphor** | thin/light/regular/bold/fill/**duotone** 6 档 | **主选** | 几何一致性极高、1500+ 图标、可按档位切字重（duotone 精致 / regular 稳），一套库解决图标一致性。 |
| Lucide | 线性单一字重 | 备选 | 极简线性场景更清爽，社区活跃。 |
| Heroicons | outline/solid | 未选 | 数量偏少，风格偏工具化。 |

统一约定：**全套只用一套库 + 一个字重**（由档位决定），SVG 内联进 HTML，`currentColor` 继承主色 token，天然与配色一致。

---

## 9. 可靠性与降级

| 风险 | 降级策略 |
|---|---|
| 分镜一次生成 30 页易截断 | 按章节分批 + 并行，各自 zod 校验，失败重试 |
| GPT-Image-2 失败/超时 | 退化为 CSS 渐变底 + 大字排版，不阻塞整套 |
| 文字溢出（中文最常见） | Level 1 自动缩字号/删条目/换低密度变体 |
| reviewer 判定不稳 | 只做「离群检测」不做精修指令，返工上限 1–2 轮；测试期可整级关闭 |
| 字体缺失 | 字体栈 fallback：思源黑体 → 微软雅黑 → 苹方；**绝不用 Aptos 等无中文字体** |
| 图表样式丑 | 图表走确定性 SVG 渲染而非 pptx 原生 chart，保证美观可控 |

---

## 10. 目录结构

```text
ppt-generator-interview/
  面试题目.md
  docs/
    pipeline-proposal.md      # 本文
    DESIGN.md                 # 决策日志（含 AI 协作复盘、实测数据）
  config/
    models.json               # 角色→模型/代理商路由（见 §0.5）
    pricing.json              # 单价表，metrics 折算成本用
  .env.example                # SATURDAY_API_KEY / APIMART_API_KEY
  schemas/
    deck-plan.schema.ts
    slide-plan.schema.ts
    render-decision.schema.ts
    template.schema.ts
  templates/
    aurora-consulting.json
    porcelain-editorial.json
    ember-startup.json
    matcha-travel.json
    midnight-technical.json
  src/
    cli.ts                    # 单命令：吃 JSON 吐 pptx
    profiles.ts               # beauty-max / balanced 档位表
    pipeline/
      plan-deck.ts            # ① 规划（planner: gpt-5.5 高推理）
      plan-slides.ts          # ② 分镜（并行）
      choose-strategy.ts      # ③ 策略（纯代码）
      render-html.ts          # ④ 逐页 HTML（coder: fable-5，并行 + 返工修正）
      evaluate.ts             # ⑤ 确定性检查 + 拼图审查（reviewer: opus-4.7 think，可关）
      merge-pptx.ts           # ⑥ HTML→pptx 混合转换
    assets/
      image2.ts               # GPT-Image-2 封装
      icons.ts                # Phosphor 取图标
      charts.ts               # SVG 图表
    render/
      browser.ts              # Playwright 单例 + 测量/截图
      tokens.ts               # DeckStyle → tokens.css
    llm.ts                    # getModel(role)：读 config/models.json，统一封装调用与 fallback
    metrics.ts                # 成本/时延埋点
```

---

## 11. 关键原则

1. 先成故事再谈美观，先构造一致再谈评估。
2. 贵推理只花在 1 次全局规划；其余并行便宜调用或零成本代码。
3. HTML 是美观度上限最高的中间产物，且自带质检能力。
4. 一致性靠「共享 token + 统一图标库 + 图片色调滤镜」构造出来，评估只兜底。
5. 评估三级递进：Schema（免费）→ DOM 测量（免费）→ reviewer 拼图审查（一次，可关）。
6. 成本大头是生图，两档位的本质差异就是「花多少钱买视觉」。
7. 任何一步都要有降级线，30 分钟时间盒内不允许无限重试。
8. 四个模型角色（规划/分镜/写 HTML/审查）独立配置、独立降级，换模型只改配置不改代码。
