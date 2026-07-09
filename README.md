# pptgen — PPT 一套生成器

输入一个 JSON（topic / brief / audience），输出一套 25–30 页、风格统一、有叙事线的 `.pptx`。

- 决策日志（架构 / 选型 / 一致性 / 多样性 / 实测 / AI 协作复盘）：`DESIGN.md`
- 完整技术方案：`docs/pipeline-proposal.md`
- 5 套 demo × 两版成品与实测数据：`deliverables/`

## 安装

```bash
npm install
npx playwright install chromium
cp .env.example .env   # 填入网关地址（SATURDAY_BASE_URL）与各密钥
```

## 运行

```bash
# 单条命令：吃 JSON 吐 pptx
npm run gen -- --input demo/4-rust.json --profile balanced --preset test

# 参数
#   --input    输入 JSON 路径（必填）
#   --profile  档位: balanced（默认）| beauty-max
#   --preset   模型组: test（默认，全 gpt-5.5，reviewer 关闭）| full（fable-5 写页面 + opus-4.7 审查）
#   --out      输出目录（默认 out/）
```

输出在 `out/<输入名>-<档位>/`：

```text
final.pptx      成品
metrics.json    成本 / 时延 / 每次调用明细
audit.json      质检与修复记录 + 每页策略
html/           每页 HTML（中间产物，可追溯）
assets/         生成的图片素材
bg/             合并用背景层截图
```

## 配置

- `config/models.json`：角色 → 模型/代理商路由（planner / writer / coder / reviewer / image），支持 fallback 与 reviewer 开关；内部网关地址不入库，通过 `baseURLEnv` 指向环境变量（如 `SATURDAY_BASE_URL`）传入
- `config/pricing.json`：单价表，metrics 据此折算成本
- `src/profiles.ts`：档位变量（生图预算、分辨率、图标字重、修复次数上限等）

## 开发

```bash
npm run check   # 类型检查
npm test        # 单元测试
npx tsx scripts/preview.mts out/xxx/html/slide-01.html   # 单页预览成 png
```

## 交付物（`deliverables/`）

用公开开发集 5 个输入（`demo/1-python`…`5-kyoto`）× 两版（`balanced` / `beauty-max`）跑出的成品：

```text
deliverables/
  <demo>-balanced/final.pptx     # 成品（含 metrics.json / audit.json）
  <demo>-beauty-max/final.pptx
  metrics-summary.md             # 10 组成本 / 时延实测汇总表
```

复现（test preset，全 gpt-5.5，reviewer 关闭）：

```bash
for f in 1-python 2-review 3-coffee 4-rust 5-kyoto; do
  for p in balanced beauty-max; do
    npm run gen -- --input demo/$f.json --profile $p --preset test --out deliverables
  done
done
```
