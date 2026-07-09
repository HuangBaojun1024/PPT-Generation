import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface PricingConf {
  text: Record<string, { inputPerMTok: number; outputPerMTok: number }>;
  image: Record<string, Record<string, number>>;
}

const pricing: PricingConf = JSON.parse(readFileSync(join(ROOT, "config/pricing.json"), "utf8"));

export interface CallRecord {
  stage: string;
  role: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  note?: string;
}

export interface ImageRecord {
  stage: string;
  model: string;
  channel: string;
  resolution: string;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
}

class Metrics {
  private t0 = Date.now();
  calls: CallRecord[] = [];
  images: ImageRecord[] = [];
  stageMs: Record<string, number> = {};
  meta: Record<string, unknown> = {};

  textCost(model: string, inTok: number, outTok: number): number {
    const p = pricing.text[model];
    if (!p) return 0;
    return (inTok * p.inputPerMTok + outTok * p.outputPerMTok) / 1e6;
  }

  imageCost(model: string, resolution: string): number {
    return pricing.image[model]?.[resolution] ?? 0;
  }

  recordCall(rec: CallRecord) {
    this.calls.push(rec);
  }

  recordImage(rec: ImageRecord) {
    this.images.push(rec);
  }

  async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.stageMs[name] = (this.stageMs[name] ?? 0) + (Date.now() - t);
    }
  }

  summary() {
    const llmText = this.calls.reduce((s, c) => s + c.costUsd, 0);
    const image = this.images.reduce((s, c) => s + c.costUsd, 0);
    return {
      ...this.meta,
      costUsd: {
        llmText: round(llmText),
        image: round(image),
        total: round(llmText + image),
      },
      latencyMs: { ...this.stageMs, total: Date.now() - this.t0 },
      llmCalls: this.calls.length,
      imageCalls: this.images.length,
      byRole: groupCost(this.calls),
      calls: this.calls,
      images: this.images,
    };
  }

  write(path: string) {
    writeFileSync(path, JSON.stringify(this.summary(), null, 2));
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function groupCost(calls: CallRecord[]) {
  const g: Record<string, { calls: number; costUsd: number; inputTokens: number; outputTokens: number }> = {};
  for (const c of calls) {
    g[c.role] ??= { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    g[c.role].calls++;
    g[c.role].costUsd = round(g[c.role].costUsd + c.costUsd);
    g[c.role].inputTokens += c.inputTokens;
    g[c.role].outputTokens += c.outputTokens;
  }
  return g;
}

export const metrics = new Metrics();
