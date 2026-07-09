import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
import type { ZodType } from "zod";
import { metrics } from "./metrics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv({ path: join(ROOT, ".env") });

// ---------- 配置 ----------

interface ProviderConf {
  /** 直接写在配置里的 baseURL（公网服务用） */
  baseURL?: string;
  /** 从环境变量读 baseURL（内部网关等不入库的地址用） */
  baseURLEnv?: string;
  apiKeyEnv: string;
  protocol: "openai" | "anthropic" | "apimart";
}

export interface RoleConf {
  enabled?: boolean;
  provider: string;
  model: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  thinking?: boolean;
  fallback?: RoleConf;
}

interface ModelsConf {
  providers: Record<string, ProviderConf>;
  defaultPreset: string;
  presets: Record<string, Record<string, RoleConf>>;
}

const conf: ModelsConf = JSON.parse(readFileSync(join(ROOT, "config/models.json"), "utf8"));
let activePreset = process.env.PPTGEN_PRESET || conf.defaultPreset;

export function setPreset(name: string) {
  if (!conf.presets[name]) throw new Error(`未知模型 preset: ${name}（可选: ${Object.keys(conf.presets).join(", ")}）`);
  activePreset = name;
}

export function getPresetName(): string {
  return activePreset;
}

export function getRole(role: string): RoleConf {
  const r = conf.presets[activePreset]?.[role];
  if (!r) throw new Error(`preset "${activePreset}" 中未配置角色: ${role}`);
  return r;
}

export function getProvider(name: string): ProviderConf & { apiKey: string; baseURL: string } {
  const p = conf.providers[name];
  if (!p) throw new Error(`未知 provider: ${name}`);
  const apiKey = process.env[p.apiKeyEnv] ?? "";
  if (!apiKey) throw new Error(`缺少环境变量 ${p.apiKeyEnv}（见 .env.example）`);
  const baseURL = p.baseURL ?? (p.baseURLEnv ? process.env[p.baseURLEnv] : undefined);
  if (!baseURL) throw new Error(`provider "${name}" 缺少 baseURL：请设置环境变量 ${p.baseURLEnv ?? "(未配置 baseURLEnv)"}（见 .env.example）`);
  return { ...p, apiKey, baseURL };
}

// ---------- 调用 ----------

export interface ChatImage {
  base64: string;
  mediaType: string; // e.g. image/png
}

export interface ChatOpts {
  system?: string;
  user: string;
  images?: ChatImage[];
  maxTokens?: number;
  stage: string;
  timeoutMs?: number;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(rc: RoleConf, opts: ChatOpts): Promise<{ text: string; inTok: number; outTok: number }> {
  const p = getProvider(rc.provider);
  const content: any = opts.images?.length
    ? [
        ...opts.images.map((im) => ({
          type: "image_url",
          image_url: { url: `data:${im.mediaType};base64,${im.base64}` },
        })),
        { type: "text", text: opts.user },
      ]
    : opts.user;
  const body: any = {
    model: rc.model,
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content },
    ],
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (rc.reasoningEffort) body.reasoning_effort = rc.reasoningEffort;

  let data: any;
  try {
    data = await fetchJson(
      `${p.baseURL}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      opts.timeoutMs ?? 240_000,
    );
  } catch (e: any) {
    // 网关不认 reasoning_effort 时去掉重试一次
    if (rc.reasoningEffort && /reasoning_effort|unknown|invalid/i.test(String(e?.message))) {
      delete body.reasoning_effort;
      data = await fetchJson(
        `${p.baseURL}/chat/completions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        opts.timeoutMs ?? 240_000,
      );
    } else throw e;
  }
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error(`空响应: ${JSON.stringify(data).slice(0, 300)}`);
  return {
    text,
    inTok: data.usage?.prompt_tokens ?? 0,
    outTok: data.usage?.completion_tokens ?? 0,
  };
}

async function callAnthropic(rc: RoleConf, opts: ChatOpts): Promise<{ text: string; inTok: number; outTok: number }> {
  const p = getProvider(rc.provider);
  const content: any[] = [
    ...(opts.images ?? []).map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.mediaType, data: im.base64 },
    })),
    { type: "text", text: opts.user },
  ];
  const body: any = {
    model: rc.model,
    max_tokens: opts.maxTokens ?? 8192,
    messages: [{ role: "user", content }],
  };
  if (opts.system) body.system = opts.system;
  if (rc.thinking) {
    body.thinking = { type: "enabled", budget_tokens: 4000 };
    body.max_tokens = Math.max(body.max_tokens, 12_000);
  }
  const data = await fetchJson(
    `${p.baseURL}/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": p.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? 300_000,
  );
  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  if (!text) throw new Error(`空响应: ${JSON.stringify(data).slice(0, 300)}`);
  return { text, inTok: data.usage?.input_tokens ?? 0, outTok: data.usage?.output_tokens ?? 0 };
}

async function callOnce(rc: RoleConf, role: string, opts: ChatOpts): Promise<string> {
  const p = getProvider(rc.provider);
  const t = Date.now();
  try {
    const fn = p.protocol === "anthropic" ? callAnthropic : callOpenAI;
    const { text, inTok, outTok } = await fn(rc, opts);
    metrics.recordCall({
      stage: opts.stage,
      role,
      model: rc.model,
      provider: rc.provider,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: metrics.textCost(rc.model, inTok, outTok),
      latencyMs: Date.now() - t,
      ok: true,
    });
    return text;
  } catch (e: any) {
    metrics.recordCall({
      stage: opts.stage,
      role,
      model: rc.model,
      provider: rc.provider,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - t,
      ok: false,
      note: String(e?.message).slice(0, 200),
    });
    throw e;
  }
}

/** 角色化对话：主配置失败（含一次瞬时重试）自动走 fallback */
export async function chat(role: string, opts: ChatOpts): Promise<string> {
  const rc = getRole(role);
  try {
    return await callOnce(rc, role, opts);
  } catch (e1: any) {
    if (/HTTP (429|5\d\d)|aborted|fetch failed/i.test(String(e1?.message))) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        return await callOnce(rc, role, opts);
      } catch {
        /* 落入 fallback */
      }
    }
    if (rc.fallback) {
      console.error(`  [${role}] 主模型 ${rc.model} 失败，降级到 ${rc.fallback.model}: ${String(e1?.message).slice(0, 120)}`);
      return await callOnce(rc.fallback, role, { ...opts, stage: `${opts.stage}:fallback` });
    }
    throw e1;
  }
}

/** 从模型输出中提取 JSON（容忍 markdown 代码块与前后闲话） */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`输出中找不到 JSON: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

/** 带 schema 校验与自动纠错重试的 JSON 调用 */
export async function chatJSON<T>(role: string, schema: ZodType<T, any, any>, opts: ChatOpts, maxRetries = 2): Promise<T> {
  let lastErr = "";
  for (let i = 0; i <= maxRetries; i++) {
    const user = i === 0 ? opts.user : `${opts.user}\n\n上一次输出不合法，错误：${lastErr}\n请重新输出完整、合法的 JSON（不要解释）。`;
    const text = await chat(role, { ...opts, user });
    try {
      const parsed = extractJson(text);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      lastErr = JSON.stringify(result.error.issues.slice(0, 5));
    } catch (e: any) {
      lastErr = String(e?.message).slice(0, 300);
    }
  }
  throw new Error(`[${role}] JSON 输出连续 ${maxRetries + 1} 次不合法: ${lastErr}`);
}
