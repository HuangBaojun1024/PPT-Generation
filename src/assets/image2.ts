import { writeFileSync } from "node:fs";
import { getRole, getProvider, type RoleConf } from "../llm.js";
import { metrics } from "../metrics.js";

export interface ImageJob {
  prompt: string;
  outPath: string; // 绝对路径 .png
  resolution: "1k" | "2k";
  stage: string;
}

/** 主渠道（openai 同步）→ 兜底渠道（apimart 异步）自动回退 */
export async function generateImage(job: ImageJob): Promise<boolean> {
  const rc = getRole("image");
  const chain: RoleConf[] = [rc, ...(rc.fallback ? [rc.fallback] : [])];
  for (const ch of chain) {
    const t = Date.now();
    const p = getProvider(ch.provider);
    try {
      const bytes =
        p.protocol === "apimart"
          ? await runApimart(p.baseURL, p.apiKey, ch.model, job)
          : await runOpenAI(p.baseURL, p.apiKey, ch.model, job);
      writeFileSync(job.outPath, bytes);
      metrics.recordImage({
        stage: job.stage,
        model: ch.model,
        channel: ch.provider,
        resolution: job.resolution,
        costUsd: metrics.imageCost(ch.model, job.resolution),
        latencyMs: Date.now() - t,
        ok: true,
      });
      return true;
    } catch (e: any) {
      metrics.recordImage({
        stage: job.stage,
        model: ch.model,
        channel: ch.provider,
        resolution: job.resolution,
        costUsd: 0,
        latencyMs: Date.now() - t,
        ok: false,
      });
      console.error(`  [image] 渠道 ${ch.provider} 失败: ${String(e?.message).slice(0, 150)}`);
    }
  }
  return false; // 全部失败 → 调用方降级为 CSS 底
}

async function runOpenAI(baseURL: string, apiKey: string, model: string, job: ImageJob): Promise<Buffer> {
  const res = await fetchWithTimeout(
    `${baseURL}/images/generations`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: job.prompt,
        n: 1,
        size: "1536x1024",
        quality: job.resolution === "2k" ? "high" : "medium",
      }),
    },
    300_000,
  );
  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) return download(item.url);
  throw new Error(`无图片数据: ${JSON.stringify(data).slice(0, 200)}`);
}

async function runApimart(baseURL: string, apiKey: string, model: string, job: ImageJob): Promise<Buffer> {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const submit = await fetchWithTimeout(
    `${baseURL}/images/generations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ model, prompt: job.prompt, n: 1, size: "3:2", resolution: job.resolution }),
    },
    60_000,
  );
  const taskId = (await submit.json()).data?.[0]?.task_id;
  if (!taskId) throw new Error("提交无 task_id");
  await sleep(15_000);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const r = await fetchWithTimeout(`${baseURL}/tasks/${taskId}`, { headers }, 30_000);
    const d = (await r.json()).data ?? {};
    if (d.status === "completed") {
      const urls = d.result?.images?.flatMap((im: any) => (typeof im.url === "string" ? [im.url] : im.url ?? []));
      if (!urls?.length) throw new Error("完成但无图片 URL");
      return download(urls[0]);
    }
    if (d.status === "failed") throw new Error(`任务失败: ${JSON.stringify(d.error).slice(0, 150)}`);
    await sleep(4000);
  }
  throw new Error("apimart 轮询超时");
}

async function download(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, {}, 120_000);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
