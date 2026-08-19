const DEFAULT_API_BASE = "https://openapi.yiminju.xyz/api/public/v1";

type JsonRecord = Record<string, unknown>;

export class ImageGenRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ImageGenRequestError";
  }
}

export interface ImageGenConnectionResult {
  balanceCents: number | null;
  currency: string;
  models: string[];
}

export interface ImageGenTask {
  id: string;
  status: string;
  progress: number;
  imageUrls: string[];
  expiresAt: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  raw: JsonRecord;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function extractImageUrls(payload: JsonRecord): string[] {
  const nested = [payload.result, payload.data, payload.output].map(asRecord);
  const candidates: unknown[] = [payload.images, payload.image_urls, payload.urls, ...nested.flatMap((item) => [item.images, item.image_urls, item.urls])];
  const single = [payload.url, payload.image_url, payload.result_url, ...nested.flatMap((item) => [item.url, item.image_url, item.result_url])];
  const urls = new Set<string>();
  for (const value of candidates) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const url = stringValue(item) || stringValue(asRecord(item).url) || stringValue(asRecord(item).image_url);
      if (url?.startsWith("http")) urls.add(url);
    }
  }
  for (const value of single) {
    const url = stringValue(value);
    if (url?.startsWith("http")) urls.add(url);
  }
  return [...urls];
}

async function request(apiKey: string, apiBase: string, pathname: string, init?: RequestInit): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    console.warn("ImageGen upstream request unavailable", pathname, error instanceof Error ? error.name : "unknown");
    throw new ImageGenRequestError("生图服务暂时无法连接，请稍后重试", 503, "IMAGEGEN_UNAVAILABLE");
  }
  const payload = asRecord(await response.json().catch(() => null));
  if (!response.ok) {
    const error = asRecord(payload.error);
    const unauthorized = response.status === 401 || response.status === 403;
    console.warn("ImageGen upstream request failed", pathname, response.status, stringValue(error.code) || stringValue(payload.code) || "unknown");
    throw new ImageGenRequestError(
      unauthorized ? "这个 ImageGen API Key 无效" : stringValue(error.message) || stringValue(payload.message) || "封面生成请求失败",
      response.status,
      unauthorized ? "INVALID_API_KEY" : stringValue(error.code) || stringValue(payload.code) || "IMAGEGEN_ERROR",
    );
  }
  return payload;
}

export function getImageGenApiBase(value: string | null): string {
  const base = (value || DEFAULT_API_BASE).replace(/\/+$/u, "");
  if (base !== DEFAULT_API_BASE) throw new Error("ImageGen API 基础地址与受信任地址不一致");
  return base;
}

export async function testImageGenConnection(apiKey: string, apiBase: string): Promise<ImageGenConnectionResult> {
  // Edge runtimes can serialize two simultaneous requests to another EdgeSpark
  // project and hit the platform's 20-second upstream ceiling. A models request
  // is enough to validate the API key without spending any generation balance.
  const models = await request(apiKey, apiBase, "/models");
  const rawModels = Array.isArray(models.data) ? models.data : Array.isArray(models.models) ? models.models : [];
  return {
    balanceCents: null,
    currency: stringValue(models.currency) || stringValue(asRecord(models.data).currency) || "CNY",
    models: rawModels.map((item) => stringValue(item) || stringValue(asRecord(item).id)).filter((item): item is string => Boolean(item)),
  };
}

export async function createImageGenTask(
  apiKey: string,
  apiBase: string,
  input: { prompt: string; size: "1:1" | "16:9" | "9:16"; imageUrls?: string[]; idempotencyKey: string },
): Promise<ImageGenTask> {
  const raw = await request(apiKey, apiBase, "/images/generations", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: input.prompt,
      resolution: "2k",
      size: input.size,
      n: 1,
      ...(input.imageUrls?.length ? { image_urls: input.imageUrls } : {}),
    }),
  });
  return normalizeImageGenTask(raw);
}

export async function getImageGenTask(apiKey: string, apiBase: string, id: string): Promise<ImageGenTask> {
  return normalizeImageGenTask(await request(apiKey, apiBase, `/tasks/${encodeURIComponent(id)}`));
}

export function normalizeImageGenTask(raw: JsonRecord): ImageGenTask {
  const data = asRecord(raw.data);
  const result = asRecord(raw.result);
  const status = stringValue(raw.status) || stringValue(data.status) || stringValue(result.status) || "queued";
  const taskId = stringValue(raw.task_id) || stringValue(raw.id) || stringValue(data.task_id) || stringValue(data.id) || "";
  const progress = numberValue(raw.progress) ?? numberValue(data.progress) ?? (status === "completed" || status === "succeeded" ? 100 : 10);
  const error = asRecord(raw.error);
  const expiresRaw = raw.expires_at ?? data.expires_at ?? result.expires_at;
  const expiresNumber = numberValue(expiresRaw);
  return {
    id: taskId,
    status: status === "succeeded" ? "completed" : status,
    progress: Math.max(0, Math.min(100, progress)),
    imageUrls: extractImageUrls(raw),
    expiresAt: expiresNumber ? (expiresNumber < 10_000_000_000 ? expiresNumber * 1000 : expiresNumber) : null,
    errorCode: stringValue(error.code) || stringValue(raw.error_code),
    errorMessage: stringValue(error.message) || stringValue(raw.error_message),
    raw,
  };
}
