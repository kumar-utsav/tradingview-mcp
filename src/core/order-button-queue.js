/** Serialize distinct presses without dropping them or repeating submissions. */
export class OrderButtonQueue {
  #tail = Promise.resolve();
  #seen = new Map();
  #blocked = false;
  pending = 0;

  enqueue(request, execute) {
    if (this.#seen.has(request.id)) return this.#seen.get(request.id);
    if (this.pending >= 64) return Promise.reject(new Error('Order queue full; wait for acknowledgements'));
    this.pending++;
    const frozen = Object.freeze({ ...request });
    const result = this.#tail.then(async () => {
      if (this.#blocked) throw new Error('Submission outcome unknown; inspect orders and restart before continuing');
      const value = await execute(frozen);
      if (value.uncertain) this.#blocked = true;
      return value;
    }).finally(() => { this.pending--; });
    this.#tail = result.catch(() => {});
    this.#seen.set(request.id, result);
    // Keep a bounded deduplication window; only completed entries may expire.
    if (this.#seen.size > 1024) this.#seen.delete(this.#seen.keys().next().value);
    return result;
  }

  get blocked() { return this.#blocked; }
}
