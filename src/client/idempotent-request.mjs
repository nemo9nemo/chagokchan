/** @param {Record<string, unknown>} payload @param {{ key: string; body: Record<string, unknown> } | null} [previous] @param {() => string} [createKey] @returns {{ key: string; body: Record<string, unknown> }} */
export function createIdempotentRequest(payload, previous = null, createKey = () => globalThis.crypto.randomUUID()) {
  if (previous) return previous;
  return {
    key: createKey(),
    body: JSON.parse(JSON.stringify(payload)),
  };
}

export function classifyMutationOutcome(status, ok = false) {
  if (ok) return "succeeded";
  if (status === 408 || status === 429 || status >= 500) return "retry_same_key";
  return "rejected";
}
