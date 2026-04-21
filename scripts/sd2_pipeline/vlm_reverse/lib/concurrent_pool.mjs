/**
 * 无额外依赖的并发池：限制同时执行的 Promise 数量。
 * 用于批量调用 VLM，避免瞬时打满网关限流。
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit  并发上限（>=1）
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>} 与 items 顺序一致的结果数组
 */
export async function runPool(items, limit, fn) {
  if (items.length === 0) {
    return [];
  }
  const cap = Math.max(1, Math.min(limit, items.length));
  /** @type {R[]} */
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) {
        break;
      }
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: cap }, () => worker());
  await Promise.all(workers);
  return results;
}
