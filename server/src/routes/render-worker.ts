import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, secret, storage, vars } from "edgespark";
import { buckets, coverReferences, generationJobs, videoOutputs } from "@defs";
import { archiveCoverImages } from "../services/cover-storage";
import { getImageGenApiBase } from "../services/imagegen";
import { getUserProviderKey, safeJson } from "../services/user-providers";
import { cleanupExpiredVideoOutputs, refreshWaitingPackagingSources } from "../services/video-sync";

type JsonRecord = Record<string, unknown>;

function authorized(c: Context): boolean {
  const expected = secret.get("RENDER_WORKER_TOKEN") || "";
  const provided = c.req.header("authorization")?.replace(/^Bearer\s+/iu, "") || "";
  if (!expected || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return mismatch === 0;
}

function reject(c: Context) {
  return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Worker authentication failed" } }, 401);
}

async function activeJob(id: string) {
  const [row] = await db.select().from(generationJobs).where(and(eq(generationJobs.id, id), eq(generationJobs.type, "video_packaging"))).limit(1);
  return row;
}

async function activeCoverJob(id: string) {
  const [row] = await db.select().from(generationJobs).where(and(eq(generationJobs.id, id), eq(generationJobs.type, "cover_image"))).limit(1);
  return row;
}

export const renderWorkerRoutes = new Hono()
  .post("/api/webhooks/render-worker/cleanup", async (c) => {
    if (!authorized(c)) return reject(c);
    const body = await c.req.json<{ limit?: number }>().catch(() => ({} as { limit?: number }));
    return c.json({ ok: true, data: await cleanupExpiredVideoOutputs(body.limit) });
  })
  .post("/api/webhooks/render-worker/claim", async (c) => {
    if (!authorized(c)) return reject(c);
    const body = await c.req.json<{ workerId?: string; leaseSeconds?: number }>().catch(() => ({} as { workerId?: string; leaseSeconds?: number }));
    const workerId = (body.workerId || "volcano-render-1").slice(0, 80);
    await refreshWaitingPackagingSources(3);
    const now = Date.now();
    const [candidate] = await db.select().from(generationJobs).where(and(
      eq(generationJobs.type, "video_packaging"),
      or(eq(generationJobs.status, "queued"), and(eq(generationJobs.status, "processing"), or(isNull(generationJobs.leaseExpiresAt), lt(generationJobs.leaseExpiresAt, now)))),
    )).orderBy(asc(generationJobs.createdAt)).limit(1);
    if (!candidate) return c.json({ ok: true, data: null });
    const leaseExpiresAt = now + Math.min(900, Math.max(120, body.leaseSeconds || 600)) * 1000;
    const [claimed] = await db.update(generationJobs).set({ status: "processing", progress: Math.max(8, candidate.progress), leaseOwner: workerId, leaseExpiresAt, updatedAt: now }).where(and(eq(generationJobs.id, candidate.id), eq(generationJobs.status, candidate.status))).returning();
    if (!claimed) return c.json({ ok: true, data: null });
    const request = safeJson<JsonRecord>(claimed.requestJson, {});
    const sourceJobId = typeof request.sourceJobId === "string" ? request.sourceJobId : "";
    const [source] = await db.select().from(videoOutputs).where(eq(videoOutputs.generationJobId, sourceJobId)).limit(1);
    if (source?.status === "expired") {
      await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: "SOURCE_EXPIRED", errorMessage: "基础成片已超过7天保存期限，请重新生成", leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, claimed.id));
      return c.json({ ok: true, data: null });
    }
    const parsed = source?.r2Uri ? storage.tryParseS3Uri(source.r2Uri) : null;
    if (!parsed) {
      await db.update(generationJobs).set({ status: "waiting_source", progress: 0, leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, claimed.id));
      return c.json({ ok: true, data: null });
    }
    const outputPath = typeof request.outputPath === "string" ? request.outputPath : `users/${claimed.userId}/packaged/${claimed.id}.mp4`;
    const [input, output] = await Promise.all([
      storage.from(parsed.bucket).createPresignedGetUrl(parsed.path, 3600),
      storage.from(buckets.outputs).createPresignedPutUrl(outputPath, 3600, { contentType: "video/mp4", contentDisposition: `attachment; filename="${claimed.id}.mp4"` }),
    ]);
    return c.json({ ok: true, data: { id: claimed.id, leaseExpiresAt, inputUrl: input.downloadUrl, outputUrl: output.uploadUrl, outputHeaders: output.requiredHeaders, request: { ...request, outputPath } } });
  })
  .post("/api/webhooks/render-worker/jobs/:id/progress", async (c) => {
    if (!authorized(c)) return reject(c);
    const job = await activeJob(c.req.param("id"));
    if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const body = await c.req.json<{ workerId?: string; progress?: number; stage?: string; leaseSeconds?: number }>().catch(() => ({} as { workerId?: string; progress?: number; stage?: string; leaseSeconds?: number }));
    if (job.leaseOwner && body.workerId !== job.leaseOwner) return c.json({ ok: false, error: { code: "LEASE_MISMATCH" } }, 409);
    const progress = Math.max(job.progress, Math.min(98, Math.round(body.progress || job.progress)));
    const result = safeJson<JsonRecord>(job.resultJson, {});
    await db.update(generationJobs).set({ progress, resultJson: JSON.stringify({ ...result, stage: body.stage || result.stage }), leaseExpiresAt: Date.now() + Math.min(900, Math.max(120, body.leaseSeconds || 600)) * 1000, updatedAt: Date.now() }).where(eq(generationJobs.id, job.id));
    return c.json({ ok: true, data: { progress } });
  })
  .post("/api/webhooks/render-worker/jobs/:id/complete", async (c) => {
    if (!authorized(c)) return reject(c);
    const job = await activeJob(c.req.param("id"));
    if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const body = await c.req.json<{ workerId?: string; outputPath?: string; durationMs?: number; width?: number; height?: number; transcript?: unknown; captions?: unknown }>().catch(() => ({} as { workerId?: string; outputPath?: string; durationMs?: number; width?: number; height?: number; transcript?: unknown; captions?: unknown }));
    if (job.leaseOwner && body.workerId !== job.leaseOwner) return c.json({ ok: false, error: { code: "LEASE_MISMATCH" } }, 409);
    const request = safeJson<JsonRecord>(job.requestJson, {});
    const outputPath = body.outputPath || (typeof request.outputPath === "string" ? request.outputPath : "");
    if (!outputPath) return c.json({ ok: false, error: { code: "OUTPUT_PATH_REQUIRED" } }, 400);
    const object = await storage.from(buckets.outputs).head(outputPath);
    if (!object) return c.json({ ok: false, error: { code: "OUTPUT_NOT_UPLOADED", message: "Rendered output was not uploaded" } }, 409);
    const now = Date.now();
    const r2Uri = storage.createS3Uri(buckets.outputs, outputPath);
    const resultJson = JSON.stringify({ stage: "completed", durationMs: body.durationMs || null, width: body.width || null, height: body.height || null, transcript: body.transcript || null, captions: body.captions || null, sizeBytes: object.size });
    await db.batch([
      db.update(generationJobs).set({ status: "completed", progress: 100, resultJson, errorCode: null, errorMessage: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now }).where(eq(generationJobs.id, job.id)),
      db.insert(videoOutputs).values({ id: crypto.randomUUID(), userId: job.userId, projectId: job.projectId, generationJobId: job.id, r2Uri, status: "available", createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: videoOutputs.generationJobId, set: { r2Uri, status: "available", updatedAt: now } }),
    ]);
    return c.json({ ok: true, data: { status: "completed", sizeBytes: object.size } });
  })
  .post("/api/webhooks/render-worker/jobs/:id/fail", async (c) => {
    if (!authorized(c)) return reject(c);
    const job = await activeJob(c.req.param("id"));
    if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const body = await c.req.json<{ workerId?: string; code?: string; message?: string }>().catch(() => ({} as { workerId?: string; code?: string; message?: string }));
    if (job.leaseOwner && body.workerId !== job.leaseOwner) return c.json({ ok: false, error: { code: "LEASE_MISMATCH" } }, 409);
    await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: (body.code || "RENDER_FAILED").slice(0, 80), errorMessage: (body.message || "字幕包装失败，请重试").slice(0, 500), leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, job.id));
    return c.json({ ok: true, data: { status: "failed" } });
  })
  .post("/api/webhooks/render-worker/cover-claim", async (c) => {
    if (!authorized(c)) return reject(c);
    const body = await c.req.json<{ workerId?: string; leaseSeconds?: number }>().catch(() => ({} as { workerId?: string; leaseSeconds?: number }));
    const workerId = (body.workerId || "volcano-cover-1").slice(0, 80);
    const now = Date.now();
    const [candidate] = await db.select().from(generationJobs).where(and(
      eq(generationJobs.type, "cover_image"),
      or(eq(generationJobs.status, "queued"), and(eq(generationJobs.status, "processing"), or(isNull(generationJobs.leaseExpiresAt), lt(generationJobs.leaseExpiresAt, now)))),
    )).orderBy(asc(generationJobs.createdAt)).limit(1);
    if (!candidate) return c.json({ ok: true, data: null });
    const leaseExpiresAt = now + Math.min(1800, Math.max(300, body.leaseSeconds || 900)) * 1000;
    const [claimed] = await db.update(generationJobs).set({ status: "processing", progress: Math.max(5, candidate.progress), leaseOwner: workerId, leaseExpiresAt, updatedAt: now }).where(and(eq(generationJobs.id, candidate.id), eq(generationJobs.status, candidate.status))).returning();
    if (!claimed) return c.json({ ok: true, data: null });
    try {
      const request = safeJson<JsonRecord>(claimed.requestJson, {});
      const prompt = typeof request.prompt === "string" ? request.prompt : "";
      if (!prompt) throw new Error("封面提示词不完整，请重新生成");
      const referenceId = typeof request.referenceId === "string" ? request.referenceId : "";
      const imageUrls: string[] = [];
      if (referenceId) {
        const [reference] = await db.select().from(coverReferences).where(and(eq(coverReferences.id, referenceId), eq(coverReferences.userId, claimed.userId), eq(coverReferences.status, "ready"))).limit(1);
        if (!reference) throw new Error("封面人物参考图已失效，请重新上传");
        imageUrls.push((await storage.from(buckets.coverInputs).createPresignedGetUrl(reference.objectPath, 3600)).downloadUrl);
      }
      const apiKey = await getUserProviderKey(claimed.userId, "imagegen");
      return c.json({ ok: true, data: {
        id: claimed.id,
        leaseExpiresAt,
        apiKey,
        apiBase: getImageGenApiBase(vars.get("IMAGEGEN_API_BASE")),
        idempotencyKey: claimed.idempotencyKey,
        request: { prompt, size: request.ratio === "16:9" ? "16:9" : "9:16", imageUrls },
      } });
    } catch (error) {
      await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: "COVER_SETUP_FAILED", errorMessage: (error instanceof Error ? error.message : "封面任务配置失败").slice(0, 500), leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, claimed.id));
      return c.json({ ok: true, data: null });
    }
  })
  .post("/api/webhooks/render-worker/cover-jobs/:id/progress", async (c) => {
    if (!authorized(c)) return reject(c);
    const job = await activeCoverJob(c.req.param("id"));
    if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const body = await c.req.json<{ workerId?: string; progress?: number; providerJobId?: string; leaseSeconds?: number }>().catch(() => ({} as { workerId?: string; progress?: number; providerJobId?: string; leaseSeconds?: number }));
    if (job.leaseOwner && body.workerId !== job.leaseOwner) return c.json({ ok: false, error: { code: "LEASE_MISMATCH" } }, 409);
    const progress = Math.max(job.progress, Math.min(98, Math.round(body.progress || job.progress)));
    await db.update(generationJobs).set({ progress, providerJobId: body.providerJobId || job.providerJobId, leaseExpiresAt: Date.now() + Math.min(1800, Math.max(300, body.leaseSeconds || 900)) * 1000, updatedAt: Date.now() }).where(eq(generationJobs.id, job.id));
    return c.json({ ok: true, data: { progress } });
  })
  .post("/api/webhooks/render-worker/cover-jobs/:id/complete", async (c) => {
    if (!authorized(c)) return reject(c);
    const job = await activeCoverJob(c.req.param("id"));
    if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const body = await c.req.json<{ workerId?: string; providerJobId?: string; imageUrls?: string[]; expiresAt?: number | null }>().catch(() => ({} as { workerId?: string; providerJobId?: string; imageUrls?: string[]; expiresAt?: number | null }));
    if (job.leaseOwner && body.workerId !== job.leaseOwner) return c.json({ ok: false, error: { code: "LEASE_MISMATCH" } }, 409);
    const imageUrls = (body.imageUrls || []).filter((url) => /^https?:\/\//u.test(url)).slice(0, 4);
    if (!imageUrls.length) return c.json({ ok: false, error: { code: "IMAGE_REQUIRED", message: "ImageGen did not return an image" } }, 409);
    try {
      const archived = await archiveCoverImages(job, imageUrls, body.expiresAt || null);
      await db.update(generationJobs).set({ status: "completed", progress: 100, providerJobId: body.providerJobId || job.providerJobId, resultJson: JSON.stringify(archived), errorCode: null, errorMessage: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, job.id));
      return c.json({ ok: true, data: { status: "completed", imageCount: imageUrls.length, deliveryStatus: "archived" } });
    } catch (error) {
      console.error("Cover archive failed", job.id, error instanceof Error ? error.message : "unknown");
      await db.update(generationJobs).set({
        status: "failed",
        progress: 100,
        providerJobId: body.providerJobId || job.providerJobId,
        resultJson: JSON.stringify({ imageUrls, providerExpiresAt: body.expiresAt || null, deliveryStatus: "archive_failed" }),
        errorCode: "COVER_ARCHIVE_FAILED",
        errorMessage: "封面已生成，但保存到平台失败，请点击重试",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: Date.now(),
      }).where(eq(generationJobs.id, job.id));
      return c.json({ ok: true, data: { status: "failed", imageCount: imageUrls.length, deliveryStatus: "archive_failed" } });
    }
  })
  .post("/api/webhooks/render-worker/cover-jobs/:id/fail", async (c) => {
    if (!authorized(c)) return reject(c);
    const job = await activeCoverJob(c.req.param("id"));
    if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const body = await c.req.json<{ workerId?: string; code?: string; message?: string }>().catch(() => ({} as { workerId?: string; code?: string; message?: string }));
    if (job.leaseOwner && body.workerId !== job.leaseOwner) return c.json({ ok: false, error: { code: "LEASE_MISMATCH" } }, 409);
    await db.update(generationJobs).set({ status: "failed", progress: 100, errorCode: (body.code || "IMAGEGEN_FAILED").slice(0, 80), errorMessage: (body.message || "封面生成失败，请检查 ImageGen 余额和密钥").slice(0, 500), leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, job.id));
    return c.json({ ok: true, data: { status: "failed" } });
  });
