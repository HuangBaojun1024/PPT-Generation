/** 简易并发池 */
export async function pMap<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function slugify(s: string): string {
  return s.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 40);
}
