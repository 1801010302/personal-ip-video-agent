import type { ClaimedCoverJob } from "./types";

type JsonRecord = Record<string, unknown>;

export interface ImageGenResult {
  providerJobId: string;
  imageUrls: string[];
  expiresAt: number | null;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function imageUrls(payload: JsonRecord): string[] {
  const nested = [payload.result, payload.data, payload.output].map(record);
  const lists = [payload.images, payload.image_urls, payload.urls, ...nested.flatMap((item) => [item.images, item.image_urls, item.urls])];
  const singles = [payload.url, payload.image_url, payload.result_url, ...nested.flatMap((item) => [item.url, item.image_url, item.result_url])];
  const urls = new Set<string>();
  for (const value of lists) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const url = text(item) || text(record(item).url) || text(record(item).image_url);
      if (url?.startsWith("http")) urls.add(url);
    }
  }
  for (const value of singles) {
    const url = text(value);
    if (url?.startsWith("http")) urls.add(url);
  }
  return [...urls];
}

function normalize(payload: JsonRecord) {
  const data = record(payload.data);
  const result = record(payload.result);
  const status = text(payload.status) || text(data.status) || text(result.status) || "queued";
  const id = text(payload.task_id) || text(payload.id) || text(data.task_id) || text(data.id) || "";
  const progress = number(payload.progress) ?? number(data.progress) ?? (["completed", "succeeded", "success"].includes(status) ? 100 : 10);
  const error = record(payload.error);
  const expires = number(payload.expires_at ?? data.expires_at ?? result.expires_at);
  return {
    id,
    status: status === "succeeded" || status === "success" ? "completed" : status,
    progress: Math.max(0, Math.min(100, progress)),
    imageUrls: imageUrls(payload),
    expiresAt: expires ? (expires < 10_000_000_000 ? expires * 1000 : expires) : null,
    errorCode: text(error.code) || text(payload.error_code) || "IMAGEGEN_FAILED",
    errorMessage: text(error.message) || text(payload.error_message) || text(payload.message) || "封面生成失败",
  };
}

async function request(job: ClaimedCoverJob, pathname: string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(`${job.apiBase.replace(/\/+$/u, "")}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${job.apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  const payload = record(await response.json().catch(() => null));
  if (!response.ok) {
    const error = record(payload.error);
    const message = response.status === 401 || response.status === 403
      ? "ImageGen API Key 无效，请到 API 设置中更换"
      : text(error.message) || text(payload.message) || `ImageGen 请求失败（${response.status}）`;
    const requestError = new Error(message) as Error & { code?: string };
    requestError.code = text(error.code) || text(payload.code) || `IMAGEGEN_HTTP_${response.status}`;
    throw requestError;
  }
  return payload;
}

export async function runCoverImageTask(
  job: ClaimedCoverJob,
  onProgress: (value: { providerJobId: string; progress: number }) => Promise<void>,
): Promise<ImageGenResult> {
  let task = normalize(await request(job, "/images/generations", {
    method: "POST",
    headers: { "Idempotency-Key": job.idempotencyKey },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: job.request.prompt,
      resolution: "2k",
      size: job.request.size,
      n: 1,
      ...(job.request.imageUrls.length ? { image_urls: job.request.imageUrls } : {}),
    }),
  }));
  if (!task.id) throw new Error("ImageGen 未返回任务 ID");
  await onProgress({ providerJobId: task.id, progress: Math.max(10, task.progress) });
  const deadline = Date.now() + 20 * 60_000;
  while (!task.imageUrls.length && !["failed", "cancelled"].includes(task.status)) {
    if (Date.now() >= deadline) throw new Error("封面生成超时，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    task = normalize(await request(job, `/tasks/${encodeURIComponent(task.id)}`));
    await onProgress({ providerJobId: task.id, progress: Math.max(12, task.progress) });
  }
  if (!task.imageUrls.length) {
    const error = new Error(task.errorMessage) as Error & { code?: string };
    error.code = task.errorCode;
    throw error;
  }
  return { providerJobId: task.id, imageUrls: task.imageUrls, expiresAt: task.expiresAt };
}
