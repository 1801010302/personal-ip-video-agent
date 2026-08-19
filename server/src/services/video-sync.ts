import { and, asc, eq, lte, ne } from "drizzle-orm";
import { db, storage, vars } from "edgespark";
import { buckets, generationJobs, videoOutputs } from "@defs";
import { getProviderApiBase, providerRequest } from "./chuanshenyun";
import { getUserProviderKey, safeJson } from "./user-providers";

type JsonRecord = Record<string, unknown>;

export const VIDEO_RETENTION_DAYS = 7;
export const VIDEO_RETENTION_MS = VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function videoOutputExpiresAt(createdAt: number) {
  return createdAt + VIDEO_RETENTION_MS;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function archiveCompletedVideo(userId: string, jobId: string, providerJobId: string, apiKey: string, apiBase: string) {
  const [existing] = await db.select().from(videoOutputs).where(eq(videoOutputs.generationJobId, jobId)).limit(1);
  if (existing?.r2Uri || ["copying", "expired"].includes(existing?.status || "")) return;
  const now = Date.now();
  if (existing) await db.update(videoOutputs).set({ status: "copying", updatedAt: now }).where(eq(videoOutputs.id, existing.id));
  else await db.insert(videoOutputs).values({ id: crypto.randomUUID(), userId, generationJobId: jobId, status: "copying", createdAt: now, updatedAt: now });
  try {
    const download = await providerRequest<JsonRecord>(apiKey, apiBase, `/generation-jobs/${encodeURIComponent(providerJobId)}/download`, { method: "POST", body: "{}" });
    const url = stringValue(download.url);
    if (!url) throw new Error("missing download url");
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`download ${response.status}`);
    const path = `users/${userId}/videos/${jobId}.mp4`;
    await storage.from(buckets.outputs).put(path, await response.arrayBuffer(), { contentType: response.headers.get("content-type") || "video/mp4", contentDisposition: `attachment; filename="${jobId}.mp4"` });
    const r2Uri = storage.createS3Uri(buckets.outputs, path);
    const [job] = await db.select({ projectId: generationJobs.projectId }).from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
    const [output] = await db.select().from(videoOutputs).where(eq(videoOutputs.generationJobId, jobId)).limit(1);
    if (output) await db.update(videoOutputs).set({ projectId: job?.projectId || null, r2Uri, status: "available", updatedAt: Date.now() }).where(eq(videoOutputs.id, output.id));
    const waiting = await db.select().from(generationJobs).where(and(eq(generationJobs.userId, userId), eq(generationJobs.type, "video_packaging"), eq(generationJobs.status, "waiting_source")));
    for (const packaging of waiting) {
      const request = safeJson<JsonRecord>(packaging.requestJson, {});
      if (request.sourceJobId === jobId) {
        await db.update(generationJobs).set({ status: "queued", progress: 5, errorCode: null, errorMessage: null, updatedAt: Date.now() }).where(eq(generationJobs.id, packaging.id));
      }
    }
  } catch (error) {
    console.error("Video archive failed", error instanceof Error ? error.message : "unknown");
    await db.update(videoOutputs).set({ status: "provider_available", updatedAt: Date.now() }).where(eq(videoOutputs.generationJobId, jobId));
  }
}

export async function cleanupExpiredVideoOutputs(limit = 50) {
  const now = Date.now();
  const cutoff = now - VIDEO_RETENTION_MS;
  const rows = await db.select().from(videoOutputs).where(and(
    lte(videoOutputs.createdAt, cutoff),
    ne(videoOutputs.status, "expired"),
  )).orderBy(asc(videoOutputs.createdAt)).limit(Math.max(1, Math.min(100, limit)));
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (row.r2Uri) {
        const parsed = storage.tryParseS3Uri(row.r2Uri);
        if (parsed) await storage.from(parsed.bucket).delete(parsed.path);
      }
      await db.update(videoOutputs).set({ r2Uri: null, status: "expired", updatedAt: now }).where(eq(videoOutputs.id, row.id));
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("Expired video cleanup failed", row.id, error instanceof Error ? error.message : "unknown");
    }
  }
  return { deleted, failed, cutoff, retentionDays: VIDEO_RETENTION_DAYS };
}

/**
 * Advances source digital-human jobs even when the user has left the page.
 * The render worker calls this before claiming packaging jobs, so generation,
 * archiving and packaging form one durable server-side pipeline.
 */
export async function refreshWaitingPackagingSources(limit = 3) {
  const waiting = await db.select().from(generationJobs).where(and(
    eq(generationJobs.type, "video_packaging"),
    eq(generationJobs.status, "waiting_source"),
  )).orderBy(asc(generationJobs.createdAt)).limit(Math.max(1, Math.min(10, limit)));

  for (const packaging of waiting) {
    const request = safeJson<JsonRecord>(packaging.requestJson, {});
    const sourceJobId = stringValue(request.sourceJobId);
    if (!sourceJobId) {
      await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: "SOURCE_JOB_MISSING", errorMessage: "字幕包装任务缺少基础成片", updatedAt: Date.now() }).where(eq(generationJobs.id, packaging.id));
      continue;
    }
    const [source] = await db.select().from(generationJobs).where(and(
      eq(generationJobs.id, sourceJobId),
      eq(generationJobs.userId, packaging.userId),
      eq(generationJobs.type, "digital_human"),
    )).limit(1);
    if (!source?.providerJobId) {
      await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: "SOURCE_JOB_MISSING", errorMessage: "找不到对应的基础数字人成片", updatedAt: Date.now() }).where(eq(generationJobs.id, packaging.id));
      continue;
    }
    if (["failed", "cancelled"].includes(source.status)) {
      await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: "SOURCE_JOB_FAILED", errorMessage: source.errorMessage || "基础数字人成片生成失败", updatedAt: Date.now() }).where(eq(generationJobs.id, packaging.id));
      continue;
    }
    try {
      const apiKey = await getUserProviderKey(source.userId, "chuanshenyun");
      const apiBase = getProviderApiBase(vars.get("CHUANSHENYUN_API_BASE"));
      let status = source.status;
      if (status !== "completed" && source.updatedAt < Date.now() - 15_000) {
        const remote = await providerRequest<JsonRecord>(apiKey, apiBase, `/generation-jobs/${encodeURIComponent(source.providerJobId)}`);
        status = stringValue(remote.status) || source.status;
        await db.update(generationJobs).set({
          status,
          estimatedPoints: numberValue(remote.estimatedPoints) ?? numberValue(remote.estimatedCostFen) ?? source.estimatedPoints,
          finalPoints: numberValue(remote.finalPoints) ?? numberValue(remote.finalCostFen) ?? source.finalPoints,
          resultJson: JSON.stringify(remote),
          errorCode: stringValue(remote.errorCode),
          errorMessage: stringValue(remote.errorMessage),
          updatedAt: Date.now(),
        }).where(eq(generationJobs.id, source.id));
      }
      if (status === "completed") await archiveCompletedVideo(source.userId, source.id, source.providerJobId, apiKey, apiBase);
      else if (["failed", "cancelled"].includes(status)) {
        await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: "SOURCE_JOB_FAILED", errorMessage: "基础数字人成片生成失败", updatedAt: Date.now() }).where(eq(generationJobs.id, packaging.id));
      }
    } catch (error) {
      console.error("Waiting source refresh failed", error instanceof Error ? error.message : "unknown");
    }
  }
}
