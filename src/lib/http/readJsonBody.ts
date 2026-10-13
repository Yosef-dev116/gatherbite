const DEFAULT_MAX_JSON_BYTES = 64 * 1024;

export class JsonBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415,
  ) {
    super(message);
    this.name = "JsonBodyError";
  }
}

function invalidBody(): JsonBodyError {
  return new JsonBodyError("Please check your inputs and try again.", 400);
}

function isJsonMediaType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !isJsonMediaType(contentType)) {
    throw new JsonBodyError("Content-Type must be application/json.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new JsonBodyError("Request body is too large.", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw invalidBody();

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JsonBodyError("Request body is too large.", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    throw invalidBody();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidBody();
  }
}

export function jsonBodyErrorResponse(error: unknown): Response {
  const bodyError = error instanceof JsonBodyError ? error : invalidBody();
  return Response.json(
    { error: bodyError.message },
    { status: bodyError.status, headers: { "Cache-Control": "no-store" } },
  );
}
