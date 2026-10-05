// Preserve input ordering while bounding independent read work.
export async function mapConcurrent(items, limit, fn) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Concurrency must be a positive integer');
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}
