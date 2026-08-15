const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error !== null && typeof error === "object" ? error as Record<string, unknown> : null;
}
export function isTransientGatherBiteError(error: unknown): boolean {
  const record = errorRecord(error);
  if (!record) return false;
  if (record.name === "AbortError") return false;
  if (record.isRetryable === true) return true;
  const status = typeof record.statusCode === "number" ? record.statusCode : record.status;
  if (status === 408 || status === 425 || status === 429) return true;
  if (typeof status === "number" && status >= 500 && status <= 599) return true;
  return typeof record.code === "string" && TRANSIENT_CODES.has(record.code);
}

/** Retry a classified transport operation once; business verdicts are values, not retry errors. */
export async function withOneTransientRetry<T>(
  operation: (attempt: 1 | 2) => Promise<T>,
  isTransient: (error: unknown) => boolean,
): Promise<T> {
  try {
    return await operation(1);
  } catch (error) {
    if (!isTransient(error)) throw error;
    return operation(2);
  }
}
