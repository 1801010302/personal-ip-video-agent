import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { ctx, db, storage, vars } from "edgespark";
import { auth } from "edgespark/http";
import { generationJobs, projects, providerAssets, videoOutputs, voiceProfiles, buckets } from "@defs";
import { getProviderApiBase, providerRequest, ProviderRequestError } from "../services/chuanshenyun";
import { AppRequestError, getUserProviderKey, requireActiveAccess, safeJson } from "../services/user-providers";
import { archiveCompletedVideo, VIDEO_RETENTION_MS, videoOutputExpiresAt } from "../services/video-sync";

type JsonRecord = Record<string, unknown>;

function fail(c: Context, error: unknown) {
  if (error instanceof ProviderRequestError) {
    const status = error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 404 ? 404 : error.status === 409 ? 409 : error.status === 422 ? 422 : error.status === 503 ? 503 : 502;
    return c.json({ ok: false as const, error: { code: error.code, message: error.message, requestId: error.requestId } }, status);
  }
  if (error instanceof AppRequestError) {
    return c.json({ ok: false as const, error: { code: error.code, message: error.message, requestId: error.requestId } }, error.status);
  }
  console.error("Media route error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false as const, error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } }, 500);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function providerContext(userId: string) {
  return {
    apiKey: await getUserProviderKey(userId, "chuanshenyun"),
    apiBase: getProviderApiBase(vars.get("CHUANSHENYUN_API_BASE")),
  };
}

async function ownedAsset(userId: string, localId: string) {
  const [asset] = await db.select().from(providerAssets).where(and(eq(providerAssets.id, localId), eq(providerAssets.userId, userId))).limit(1);
  if (!asset) throw new AppRequestError("ASSET_NOT_FOUND", "素材不存在", 404);
  return asset;
}

async function ownedProfile(userId: string, localId: string) {
  const [profile] = await db.select().from(voiceProfiles).where(and(eq(voiceProfiles.id, localId), eq(voiceProfiles.userId, userId))).limit(1);
  if (!profile) throw new AppRequestError("VOICE_PROFILE_NOT_FOUND", "声音档案不存在", 404);
  return profile;
}

async function ownedJob(userId: string, localId: string) {
  const [job] = await db.select().from(generationJobs).where(and(eq(generationJobs.id, localId), eq(generationJobs.userId, userId))).limit(1);
  if (!job) throw new AppRequestError("JOB_NOT_FOUND", "任务不存在", 404);
  return job;
}

async function ensureProject(userId: string, projectId: string | null | undefined) {
  if (!projectId) return null;
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  if (!project) throw new AppRequestError("PROJECT_NOT_FOUND", "项目不存在", 404);
  return project.id;
}

function assetView(row: typeof providerAssets.$inferSelect) {
  const metadata = safeJson<JsonRecord>(row.metadataJson, {});
  const publicMetadata = { ...metadata };
  delete publicMetadata.localProviderUploadUrl;
  delete publicMetadata.localProviderUploadHeaders;
  const objectKey = stringValue(metadata.ossObjectKey) || stringValue(metadata.normalizedObjectKey) || "";
  const locallyUploaded = metadata.localUploadOrigin === true;
  const origin = row.kind === "audio" && objectKey.includes("/voice-clones/")
    ? "voice_clone"
    : row.kind === "template" || locallyUploaded || objectKey.includes("/audio/")
      ? "user_upload"
      : "unknown";
  return {
    ...row,
    metadata: publicMetadata,
    origin,
    durationMs: numberValue(metadata.durationMs),
    width: numberValue(metadata.width),
    height: numberValue(metadata.height),
    previewUrl: stringValue(metadata.previewUrl),
    errorMessage: stringValue(metadata.errorMessage) || stringValue(metadata.localFinalizeError),
  };
}

async function upsertRemoteAssets(userId: string, remote: JsonRecord[]) {
  const existing = await db.select().from(providerAssets).where(eq(providerAssets.userId, userId));
  const byProviderId = new Map(existing.map((row) => [row.providerAssetId, row]));
  const now = Date.now();
  for (const item of remote) {
    const providerAssetId = stringValue(item.id);
    if (!providerAssetId) continue;
    const current = byProviderId.get(providerAssetId);
    const currentMetadata = safeJson<JsonRecord>(current?.metadataJson, {});
    const localMetadata = {
      ...(numberValue(currentMetadata.localExpectedSizeBytes) !== null ? { localExpectedSizeBytes: numberValue(currentMetadata.localExpectedSizeBytes) } : {}),
      ...(numberValue(currentMetadata.localFinalizeAttemptAt) !== null ? { localFinalizeAttemptAt: numberValue(currentMetadata.localFinalizeAttemptAt) } : {}),
      ...(stringValue(currentMetadata.localFinalizeError) ? { localFinalizeError: stringValue(currentMetadata.localFinalizeError) } : {}),
      ...(stringValue(currentMetadata.localOriginalName) ? { localOriginalName: stringValue(currentMetadata.localOriginalName) } : {}),
      ...(currentMetadata.localUploadOrigin === true ? { localUploadOrigin: true } : {}),
      ...(stringValue(currentMetadata.localUploadTransport) ? { localUploadTransport: stringValue(currentMetadata.localUploadTransport) } : {}),
      ...(stringValue(currentMetadata.localStagingPath) ? { localStagingPath: stringValue(currentMetadata.localStagingPath) } : {}),
      ...(stringValue(currentMetadata.localProviderUploadUrl) ? { localProviderUploadUrl: stringValue(currentMetadata.localProviderUploadUrl) } : {}),
      ...(stringValue(currentMetadata.localProviderUploadMethod) ? { localProviderUploadMethod: stringValue(currentMetadata.localProviderUploadMethod) } : {}),
      ...(Object.keys(stringRecord(currentMetadata.localProviderUploadHeaders)).length ? { localProviderUploadHeaders: stringRecord(currentMetadata.localProviderUploadHeaders) } : {}),
      ...(currentMetadata.localProviderUploadCompleted === true ? { localProviderUploadCompleted: true } : {}),
    };
    const values = {
      userId,
      provider: "chuanshenyun",
      providerAssetId,
      kind: stringValue(item.kind) || current?.kind || "audio",
      name: stringValue(currentMetadata.localOriginalName) || stringValue(item.name) || stringValue(item.filename) || current?.name || "云端素材",
      sha256: stringValue(item.contentSha256) || current?.sha256 || null,
      status: stringValue(item.status) || current?.status || "processing",
      metadataJson: JSON.stringify({ ...item, ...localMetadata }),
      updatedAt: now,
    };
    if (current) {
      await db.update(providerAssets).set(values).where(eq(providerAssets.id, current.id));
    } else {
      await db.insert(providerAssets).values({ id: crypto.randomUUID(), ...values, createdAt: now });
    }
  }
}

async function syncAssets(userId: string, apiKey: string, apiBase: string, kind?: string) {
  const pathname = `/assets${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`;
  const remote = await providerRequest<JsonRecord[]>(apiKey, apiBase, pathname);
  await upsertRemoteAssets(userId, Array.isArray(remote) ? remote : []);
  let rows = await db.select().from(providerAssets).where(kind
    ? and(eq(providerAssets.userId, userId), eq(providerAssets.kind, kind))
    : eq(providerAssets.userId, userId)).orderBy(desc(providerAssets.updatedAt));
  const now = Date.now();
  const recoverable = rows.filter((row) => {
    if (row.status !== "uploading" || row.createdAt > now - 30_000) return false;
    const metadata = safeJson<JsonRecord>(row.metadataJson, {});
    const remoteSize = numberValue(metadata.sizeBytes) || 0;
    const expectedSize = numberValue(metadata.localExpectedSizeBytes) || 0;
    const lastAttempt = numberValue(metadata.localFinalizeAttemptAt) || 0;
    const finalizeError = stringValue(metadata.localFinalizeError) || "";
    if (metadata.localUploadTransport === "edgespark_staging" && metadata.localProviderUploadCompleted !== true) return false;
    if (finalizeError.includes("重新选择文件上传") || finalizeError.includes("完整的上传文件")) return false;
    return remoteSize > 0 && (!expectedSize || remoteSize === expectedSize) && lastAttempt < now - 60_000;
  }).slice(0, 2);
  if (recoverable.length) {
    for (const row of recoverable) {
      const metadata = safeJson<JsonRecord>(row.metadataJson, {});
      await db.update(providerAssets).set({
        metadataJson: JSON.stringify({ ...metadata, localFinalizeAttemptAt: now, localFinalizeError: null }),
        updatedAt: now,
      }).where(eq(providerAssets.id, row.id));
      try {
        const finalized = await providerRequest<JsonRecord>(apiKey, apiBase, "/assets/finalize", { method: "POST", body: JSON.stringify({ assetId: row.providerAssetId }) });
        await db.update(providerAssets).set({
          status: stringValue(finalized.status) || "processing",
          metadataJson: JSON.stringify({ ...finalized, localExpectedSizeBytes: numberValue(metadata.localExpectedSizeBytes), localFinalizeAttemptAt: now, localOriginalName: stringValue(metadata.localOriginalName), localUploadOrigin: metadata.localUploadOrigin === true }),
          updatedAt: Date.now(),
        }).where(eq(providerAssets.id, row.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : "素材确认失败";
        await db.update(providerAssets).set({
          metadataJson: JSON.stringify({ ...metadata, localFinalizeAttemptAt: now, localFinalizeError: message }),
          updatedAt: Date.now(),
        }).where(eq(providerAssets.id, row.id));
      }
    }
    const refreshed = await providerRequest<JsonRecord[]>(apiKey, apiBase, pathname);
    await upsertRemoteAssets(userId, Array.isArray(refreshed) ? refreshed : []);
    rows = await db.select().from(providerAssets).where(kind
      ? and(eq(providerAssets.userId, userId), eq(providerAssets.kind, kind))
      : eq(providerAssets.userId, userId)).orderBy(desc(providerAssets.updatedAt));
  }
  return rows.map(assetView);
}

async function cachedAssets(userId: string, kind?: string) {
  const rows = await db.select().from(providerAssets).where(kind
    ? and(eq(providerAssets.userId, userId), eq(providerAssets.kind, kind))
    : eq(providerAssets.userId, userId)).orderBy(desc(providerAssets.updatedAt));
  return rows.map(assetView);
}

async function syncProfiles(userId: string, apiKey: string, apiBase: string) {
  const remote = await providerRequest<JsonRecord[]>(apiKey, apiBase, "/voice-profiles");
  const existing = await db.select().from(voiceProfiles).where(eq(voiceProfiles.userId, userId));
  const byProviderId = new Map(existing.map((row) => [row.providerProfileId, row]));
  const assets = await db.select().from(providerAssets).where(eq(providerAssets.userId, userId));
  const localAssetByProvider = new Map(assets.map((row) => [row.providerAssetId, row.id]));
  const now = Date.now();
  for (const item of Array.isArray(remote) ? remote : []) {
    const providerProfileId = stringValue(item.id);
    if (!providerProfileId) continue;
    const current = byProviderId.get(providerProfileId);
    const providerAudioId = stringValue(item.audioAssetId);
    const values = {
      userId,
      providerProfileId,
      referenceAssetId: providerAudioId ? localAssetByProvider.get(providerAudioId) || current?.referenceAssetId || null : current?.referenceAssetId || null,
      name: stringValue(item.name) || current?.name || "我的声音",
      promptText: stringValue(item.promptText),
      status: stringValue(item.status) || "processing",
      updatedAt: now,
    };
    if (current) await db.update(voiceProfiles).set(values).where(eq(voiceProfiles.id, current.id));
    else await db.insert(voiceProfiles).values({ id: crypto.randomUUID(), ...values, isDefault: existing.length === 0, createdAt: now });
  }
  return db.select().from(voiceProfiles).where(eq(voiceProfiles.userId, userId)).orderBy(desc(voiceProfiles.updatedAt));
}

async function cachedProfiles(userId: string) {
  return db.select().from(voiceProfiles).where(eq(voiceProfiles.userId, userId)).orderBy(desc(voiceProfiles.updatedAt));
}

function jobView(job: typeof generationJobs.$inferSelect, output?: typeof videoOutputs.$inferSelect) {
  const expiresAt = output ? videoOutputExpiresAt(output.createdAt) : null;
  const outputStatus = output && expiresAt && expiresAt <= Date.now() ? "expired" : output?.status || null;
  return {
    ...job,
    request: safeJson<JsonRecord>(job.requestJson, {}),
    result: safeJson<JsonRecord>(job.resultJson, {}),
    outputStatus,
    expiresAt,
    downloadAvailable: job.status === "completed" && outputStatus !== "expired",
  };
}

async function syncJobs(userId: string, apiKey: string, apiBase: string) {
  const local = await db.select().from(generationJobs).where(eq(generationJobs.userId, userId)).orderBy(desc(generationJobs.updatedAt));
  const providerJobs = local.filter((job) => ["voice_clone", "digital_human"].includes(job.type));
  const voiceRemote = providerJobs.some((job) => job.type === "voice_clone" && job.providerJobId)
    ? await providerRequest<JsonRecord[]>(apiKey, apiBase, "/voice-clone-jobs") : [];
  const voiceById = new Map((Array.isArray(voiceRemote) ? voiceRemote : []).map((item) => [stringValue(item.id), item]));
  for (const job of providerJobs) {
    if (!job.providerJobId || ["completed", "failed", "cancelled"].includes(job.status)) continue;
    const remote = job.type === "voice_clone"
      ? voiceById.get(job.providerJobId)
      : await providerRequest<JsonRecord>(apiKey, apiBase, `/generation-jobs/${encodeURIComponent(job.providerJobId)}`);
    if (!remote) continue;
    const status = stringValue(remote.status) || job.status;
    await db.update(generationJobs).set({
      status,
      estimatedPoints: numberValue(remote.estimatedPoints) ?? numberValue(remote.estimatedCostFen) ?? job.estimatedPoints,
      finalPoints: numberValue(remote.finalPoints) ?? numberValue(remote.finalCostFen) ?? job.finalPoints,
      resultJson: JSON.stringify(remote),
      errorCode: stringValue(remote.errorCode), errorMessage: stringValue(remote.errorMessage), updatedAt: Date.now(),
    }).where(eq(generationJobs.id, job.id));
    if (job.type === "digital_human" && status === "completed") {
      ctx.runInBackground(archiveCompletedVideo(userId, job.id, job.providerJobId, apiKey, apiBase));
    }
  }
  const [jobs, outputs] = await Promise.all([
    db.select().from(generationJobs).where(eq(generationJobs.userId, userId)).orderBy(desc(generationJobs.updatedAt)),
    db.select().from(videoOutputs).where(eq(videoOutputs.userId, userId)),
  ]);
  const outputByJobId = new Map(outputs.map((output) => [output.generationJobId, output]));
  return jobs.map((job) => jobView(job, outputByJobId.get(job.id)));
}

async function resolveAudioProviderId(userId: string, audioAssetId?: string, voiceJobId?: string) {
  if (audioAssetId) return (await ownedAsset(userId, audioAssetId)).providerAssetId;
  if (voiceJobId) {
    const job = await ownedJob(userId, voiceJobId);
    if (job.type !== "voice_clone" || job.status !== "completed") throw new AppRequestError("VOICE_NOT_READY", "克隆声音尚未完成", 409);
    const result = safeJson<JsonRecord>(job.resultJson, {});
    const resultAssetId = stringValue(result.resultAssetId) || stringValue(result.audioAssetId);
    if (!resultAssetId) throw new AppRequestError("VOICE_RESULT_MISSING", "益民居·数字人未返回克隆音频素材", 502);
    return resultAssetId;
  }
  throw new AppRequestError("AUDIO_REQUIRED", "请选择声音或完成声音克隆", 400);
}

export const mediaRoutes = new Hono()
  .post("/api/assets/upload-ticket", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ kind?: "audio" | "template"; filename?: string; contentType?: string; sizeBytes?: number; contentSha256?: string }>().catch(() => ({} as { kind?: "audio" | "template"; filename?: string; contentType?: string; sizeBytes?: number; contentSha256?: string }));
      if (!body.kind || !["audio", "template"].includes(body.kind)) throw new AppRequestError("INVALID_KIND", "素材类型不正确", 400);
      const filename = (body.filename || "").trim();
      const sizeBytes = Math.round(body.sizeBytes || 0);
      const limit = body.kind === "template" ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
      if (!filename || sizeBytes <= 0 || sizeBytes > limit) throw new AppRequestError("INVALID_FILE", `请选择有效的${body.kind === "template" ? "数字人视频" : "声音文件"}`, 400);
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const ticket = await providerRequest<JsonRecord>(apiKey, apiBase, "/upload-tickets", { method: "POST", body: JSON.stringify({ kind: body.kind, filename, contentType: body.contentType || (body.kind === "template" ? "video/mp4" : "audio/mpeg"), sizeBytes, ...(body.contentSha256 ? { contentSha256: body.contentSha256 } : {}) }) });
      const providerAssetId = stringValue(ticket.assetId);
      if (!providerAssetId) throw new AppRequestError("INVALID_PROVIDER_RESPONSE", "益民居·数字人未返回素材 ID", 502);
      const now = Date.now();
      const uploadRequired = ticket.uploadRequired !== false;
      const contentType = body.contentType || (body.kind === "template" ? "video/mp4" : "audio/mpeg");
      let clientUploadUrl = stringValue(ticket.uploadUrl);
      let clientUploadHeaders = stringRecord(ticket.headers);
      let stagingPath: string | null = null;
      if (uploadRequired) {
        if (!clientUploadUrl) throw new AppRequestError("INVALID_PROVIDER_RESPONSE", "益民居·数字人未返回上传地址", 502);
        stagingPath = `users/${auth.user.id}/provider-assets/${providerAssetId}/${crypto.randomUUID()}`;
        const stagingUpload = await storage.from(buckets.staging).createPresignedPutUrl(stagingPath, 3600, { contentType });
        clientUploadUrl = stagingUpload.uploadUrl;
        clientUploadHeaders = { ...stagingUpload.requiredHeaders };
      }
      const { uploadUrl: _providerUploadUrl, headers: _providerUploadHeaders, method: _providerUploadMethod, ...publicTicket } = ticket;
      const providerUploadHeaders = stringRecord(_providerUploadHeaders);
      const ticketMetadata = {
        ...publicTicket,
        localExpectedSizeBytes: sizeBytes,
        localFinalizeAttemptAt: null,
        localFinalizeError: null,
        localOriginalName: filename,
        localUploadOrigin: true,
        ...(uploadRequired ? {
          localUploadTransport: "edgespark_staging",
          localStagingPath: stagingPath,
          localProviderUploadUrl: stringValue(_providerUploadUrl),
          localProviderUploadMethod: stringValue(_providerUploadMethod) || "PUT",
          localProviderUploadHeaders: Object.keys(providerUploadHeaders).length ? providerUploadHeaders : { "Content-Type": contentType },
          localProviderUploadCompleted: false,
        } : {}),
      };
      const [local] = await db.insert(providerAssets).values({ id: crypto.randomUUID(), userId: auth.user.id, providerAssetId, kind: body.kind, name: filename, sha256: body.contentSha256 || null, status: ticket.uploadRequired === false ? "processing" : "uploading", metadataJson: JSON.stringify(ticketMetadata), createdAt: now, updatedAt: now }).onConflictDoUpdate({
        target: [providerAssets.userId, providerAssets.provider, providerAssets.providerAssetId],
        set: { name: filename, kind: body.kind, sha256: body.contentSha256 || null, status: uploadRequired ? "uploading" : "processing", metadataJson: JSON.stringify(ticketMetadata), updatedAt: now },
      }).returning();
      return c.json({ ok: true, data: { assetId: local.id, providerAssetId, uploadRequired, uploadUrl: clientUploadUrl, method: "PUT", headers: clientUploadHeaders } });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/assets/:id/finalize", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const asset = await ownedAsset(auth.user.id, c.req.param("id"));
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const ticket = safeJson<JsonRecord>(asset.metadataJson, {});
      if (ticket.uploadRequired === false) {
        const items = await syncAssets(auth.user.id, apiKey, apiBase, asset.kind);
        return c.json({ ok: true, data: items.find((item) => item.id === asset.id) || assetView(asset) });
      }
      if (ticket.localUploadTransport === "edgespark_staging" && ticket.localProviderUploadCompleted !== true) {
        const stagingPath = stringValue(ticket.localStagingPath);
        const providerUploadUrl = stringValue(ticket.localProviderUploadUrl);
        const providerUploadMethod = (stringValue(ticket.localProviderUploadMethod) || "PUT").toUpperCase();
        if (!stagingPath || !providerUploadUrl || providerUploadMethod !== "PUT") {
          throw new AppRequestError("INVALID_UPLOAD_SESSION", "上传会话已经失效，请重新选择文件上传", 409);
        }
        const staged = await storage.from(buckets.staging).head(stagingPath);
        const expectedSize = numberValue(ticket.localExpectedSizeBytes) || 0;
        if (!staged || staged.size !== expectedSize) {
          throw new AppRequestError("STAGED_UPLOAD_INCOMPLETE", "没有收到完整的视频文件，请重新选择文件上传", 409);
        }
        const { downloadUrl } = await storage.from(buckets.staging).createPresignedGetUrl(stagingPath, 900);
        const stagedResponse = await fetch(downloadUrl, { signal: AbortSignal.timeout(15 * 60_000) });
        if (!stagedResponse.ok || !stagedResponse.body) {
          throw new AppRequestError("STAGED_UPLOAD_UNAVAILABLE", "临时文件读取失败，请稍后重新确认上传", 503);
        }
        let providerUploadResponse: Response;
        try {
          providerUploadResponse = await fetch(providerUploadUrl, {
            method: providerUploadMethod,
            headers: stringRecord(ticket.localProviderUploadHeaders),
            body: stagedResponse.body,
            signal: AbortSignal.timeout(15 * 60_000),
          });
        } catch {
          throw new AppRequestError("PROVIDER_UPLOAD_UNAVAILABLE", "临时文件转交益民居·数字人失败，请点击“重新确认上传”", 503);
        }
        if (!providerUploadResponse.ok) {
          throw new AppRequestError("PROVIDER_UPLOAD_FAILED", `文件转交益民居·数字人失败（${providerUploadResponse.status}），请重新选择文件上传`, 502);
        }
        const uploadedMetadata = { ...ticket, localProviderUploadCompleted: true, localFinalizeAttemptAt: Date.now(), localFinalizeError: null };
        await db.update(providerAssets).set({ metadataJson: JSON.stringify(uploadedMetadata), updatedAt: Date.now() }).where(eq(providerAssets.id, asset.id));
        ctx.runInBackground(storage.from(buckets.staging).delete(stagingPath).catch((error) => console.error("Staging cleanup failed", error instanceof Error ? error.message : "unknown")));
      }
      const remote = await providerRequest<JsonRecord>(apiKey, apiBase, "/assets/finalize", { method: "POST", body: JSON.stringify({ assetId: asset.providerAssetId }) });
      const finalizedMetadata = { ...remote, localExpectedSizeBytes: numberValue(ticket.localExpectedSizeBytes), localOriginalName: stringValue(ticket.localOriginalName), localUploadOrigin: ticket.localUploadOrigin === true, localUploadTransport: stringValue(ticket.localUploadTransport), localProviderUploadCompleted: ticket.localUploadTransport === "edgespark_staging" ? true : ticket.localProviderUploadCompleted === true };
      await db.update(providerAssets).set({ status: stringValue(remote.status) || "processing", metadataJson: JSON.stringify(finalizedMetadata), updatedAt: Date.now() }).where(eq(providerAssets.id, asset.id));
      return c.json({ ok: true, data: assetView({ ...asset, status: stringValue(remote.status) || "processing", metadataJson: JSON.stringify(finalizedMetadata), updatedAt: Date.now() }) });
    } catch (error) { return fail(c, error); }
  })
  .get("/api/assets", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const kind = c.req.query("kind");
      if (c.req.query("refresh") === "0") return c.json({ ok: true, data: await cachedAssets(auth.user.id, kind) });
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      return c.json({ ok: true, data: await syncAssets(auth.user.id, apiKey, apiBase, kind) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/voice-profiles", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ assetId?: string; name?: string }>().catch(() => ({} as { assetId?: string; name?: string }));
      const asset = await ownedAsset(auth.user.id, body.assetId || "");
      if (asset.kind !== "audio" || asset.status !== "ready") throw new AppRequestError("AUDIO_NOT_READY", "请先等待声音素材检测完成", 409);
      const assetMetadata = safeJson<JsonRecord>(asset.metadataJson, {});
      if (assetMetadata.localUploadOrigin !== true) {
        throw new AppRequestError("REFERENCE_AUDIO_REQUIRED", "请先从本平台上传原始参考音频，再建立声音档案", 422);
      }
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const remote = await providerRequest<JsonRecord>(apiKey, apiBase, "/voice-profiles", { method: "POST", body: JSON.stringify({ audioAssetId: asset.providerAssetId, name: (body.name || "我的声音").trim() }) });
      const providerProfileId = stringValue(remote.id);
      if (!providerProfileId) throw new AppRequestError("INVALID_PROVIDER_RESPONSE", "益民居·数字人未返回声音档案 ID", 502);
      const now = Date.now();
      const [profile] = await db.insert(voiceProfiles).values({ id: crypto.randomUUID(), userId: auth.user.id, providerProfileId, referenceAssetId: asset.id, name: stringValue(remote.name) || (body.name || "我的声音"), promptText: stringValue(remote.promptText), status: stringValue(remote.status) || "processing", createdAt: now, updatedAt: now }).returning();
      return c.json({ ok: true, data: profile }, 201);
    } catch (error) { return fail(c, error); }
  })
  .get("/api/voice-profiles", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      if (c.req.query("refresh") === "0") return c.json({ ok: true, data: await cachedProfiles(auth.user.id) });
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      return c.json({ ok: true, data: await syncProfiles(auth.user.id, apiKey, apiBase) });
    } catch (error) { return fail(c, error); }
  })
  .patch("/api/voice-profiles/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const profile = await ownedProfile(auth.user.id, c.req.param("id"));
      if (profile.status !== "needs_review") {
        throw new AppRequestError("VOICE_PROFILE_NOT_REVIEWABLE", "只有新上传且等待校对的声音可以修改识别文字", 409);
      }
      const body = await c.req.json<{ promptText?: string; name?: string }>().catch(() => ({} as { promptText?: string; name?: string }));
      if (!body.promptText?.trim()) throw new AppRequestError("PROMPT_REQUIRED", "请校对并填写参考声音对应的文字", 400);
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const remote = await providerRequest<JsonRecord>(apiKey, apiBase, `/voice-profiles/${encodeURIComponent(profile.providerProfileId)}`, { method: "PATCH", body: JSON.stringify({ promptText: body.promptText.trim(), ...(body.name?.trim() ? { name: body.name.trim() } : {}) }) });
      const [updated] = await db.update(voiceProfiles).set({ promptText: body.promptText.trim(), name: body.name?.trim() || profile.name, status: stringValue(remote.status) || profile.status, updatedAt: Date.now() }).where(eq(voiceProfiles.id, profile.id)).returning();
      return c.json({ ok: true, data: updated });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/voice-clones/quote", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
      if (!body.text?.trim()) throw new AppRequestError("SCRIPT_REQUIRED", "请先填写口播文案", 400);
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      return c.json({ ok: true, data: await providerRequest<JsonRecord>(apiKey, apiBase, "/voice-clone-jobs/quote", { method: "POST", body: JSON.stringify({ text: body.text.trim() }) }) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/voice-clones", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ profileId?: string; projectId?: string; name?: string; text?: string; speed?: number; idempotencyKey?: string }>().catch(() => ({} as { profileId?: string; projectId?: string; name?: string; text?: string; speed?: number; idempotencyKey?: string }));
      const profile = await ownedProfile(auth.user.id, body.profileId || "");
      if (profile.status !== "ready") throw new AppRequestError("VOICE_PROFILE_NOT_READY", "声音档案尚未就绪", 409);
      const text = (body.text || "").trim();
      if (!text) throw new AppRequestError("SCRIPT_REQUIRED", "请先填写口播文案", 400);
      const projectId = await ensureProject(auth.user.id, body.projectId);
      const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const request = { voiceProfileId: profile.providerProfileId, name: (body.name || "克隆口播声音").trim(), text, speed: Math.min(1.5, Math.max(0.5, body.speed || 1)) };
      const quote = await providerRequest<JsonRecord>(apiKey, apiBase, "/voice-clone-jobs/quote", { method: "POST", body: JSON.stringify({ text }) });
      const remote = await providerRequest<JsonRecord>(apiKey, apiBase, "/voice-clone-jobs", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(request) });
      const providerJobId = stringValue(remote.id);
      if (!providerJobId) throw new AppRequestError("INVALID_PROVIDER_RESPONSE", "益民居·数字人未返回克隆任务 ID", 502);
      const now = Date.now();
      const [job] = await db.insert(generationJobs).values({ id: crypto.randomUUID(), userId: auth.user.id, projectId, type: "voice_clone", name: request.name, providerJobId, idempotencyKey, status: stringValue(remote.status) || "created", estimatedPoints: numberValue(quote.estimatedPoints) ?? numberValue(quote.estimatedCostFen), requestJson: JSON.stringify({ ...request, localProfileId: profile.id }), resultJson: JSON.stringify(remote), createdAt: now, updatedAt: now }).returning();
      return c.json({ ok: true, data: jobView(job) }, 201);
    } catch (error) { return fail(c, error); }
  })
  .post("/api/videos/quote", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ audioAssetId?: string; voiceJobId?: string; modelVersion?: string }>().catch(() => ({} as { audioAssetId?: string; voiceJobId?: string; modelVersion?: string }));
      const audioProviderId = await resolveAudioProviderId(auth.user.id, body.audioAssetId, body.voiceJobId);
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      return c.json({ ok: true, data: await providerRequest<JsonRecord>(apiKey, apiBase, "/generation-jobs/quote", { method: "POST", body: JSON.stringify({ audioAssetId: audioProviderId, modelVersion: body.modelVersion || "V2" }) }) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/videos", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      type VideoBody = { projectId?: string; templateAssetId?: string; audioAssetId?: string; voiceJobId?: string; modelVersion?: string; name?: string; idempotencyKey?: string; packaging?: { enabled?: boolean; templateId?: string; orientation?: "auto" | "portrait" | "landscape"; coreTitle?: string; script?: string; animationPlan?: unknown[]; subtitleStyle?: string } };
      const body = await c.req.json<VideoBody>().catch(() => ({} as VideoBody));
      const template = await ownedAsset(auth.user.id, body.templateAssetId || "");
      if (template.kind !== "template" || template.status !== "ready") throw new AppRequestError("TEMPLATE_NOT_READY", "请先等待数字人模板检测完成", 409);
      const audioProviderId = await resolveAudioProviderId(auth.user.id, body.audioAssetId, body.voiceJobId);
      const projectId = await ensureProject(auth.user.id, body.projectId);
      const idempotencyKey = body.idempotencyKey || crypto.randomUUID();
      const request = { templateAssetId: template.providerAssetId, audioAssetId: audioProviderId, modelVersion: body.modelVersion || "V2", name: (body.name || "数字人口播成片").trim() };
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const quote = await providerRequest<JsonRecord>(apiKey, apiBase, "/generation-jobs/quote", { method: "POST", body: JSON.stringify({ audioAssetId: audioProviderId, modelVersion: request.modelVersion }) });
      const remote = await providerRequest<JsonRecord>(apiKey, apiBase, "/generation-jobs", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(request) });
      const providerJobId = stringValue(remote.id);
      if (!providerJobId) throw new AppRequestError("INVALID_PROVIDER_RESPONSE", "益民居·数字人未返回数字人任务 ID", 502);
      const now = Date.now();
      const digitalJobId = crypto.randomUUID();
      const packagingJobId = body.packaging?.enabled === false ? null : crypto.randomUUID();
      const [job, packagingResult] = await db.batch([
        db.insert(generationJobs).values({ id: digitalJobId, userId: auth.user.id, projectId, type: "digital_human", name: request.name, providerJobId, idempotencyKey, status: stringValue(remote.status) || "created", progress: 5, estimatedPoints: numberValue(quote.estimatedPoints) ?? numberValue(quote.estimatedCostFen), requestJson: JSON.stringify({ ...request, localTemplateAssetId: template.id, localAudioAssetId: body.audioAssetId || null, localVoiceJobId: body.voiceJobId || null }), resultJson: JSON.stringify(remote), createdAt: now, updatedAt: now }).returning(),
        ...(packagingJobId ? [db.insert(generationJobs).values({ id: packagingJobId, userId: auth.user.id, projectId, type: "video_packaging", name: `${request.name} · 字幕包装`, idempotencyKey: crypto.randomUUID(), status: "waiting_source", progress: 0, requestJson: JSON.stringify({ sourceJobId: digitalJobId, templateId: body.packaging?.templateId || "impact-yellow", orientation: body.packaging?.orientation || "auto", coreTitle: (body.packaging?.coreTitle || request.name).slice(0, 40), script: (body.packaging?.script || "").slice(0, 6000), animationPlan: Array.isArray(body.packaging?.animationPlan) ? body.packaging?.animationPlan.slice(0, 8) : [], subtitleStyle: body.packaging?.subtitleStyle || "keyword", outputPath: `users/${auth.user.id}/packaged/${packagingJobId}.mp4` }), resultJson: "{}", createdAt: now, updatedAt: now }).returning()] : []),
        ...(projectId ? [db.update(projects).set({ status: "generating", updatedAt: now }).where(eq(projects.id, projectId))] : []),
      ]);
      return c.json({ ok: true, data: { videoJob: jobView(job[0]), packagingJob: packagingJobId && Array.isArray(packagingResult) ? jobView(packagingResult[0] as typeof generationJobs.$inferSelect) : null } }, 201);
    } catch (error) { return fail(c, error); }
  })
  .get("/api/jobs", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      return c.json({ ok: true, data: await syncJobs(auth.user.id, apiKey, apiBase) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/jobs/:id/retry", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const job = await ownedJob(auth.user.id, c.req.param("id"));
      if (!["failed", "cancelled"].includes(job.status)) throw new AppRequestError("JOB_NOT_RETRYABLE", "只有失败或已取消的任务可以重试", 409);
      if (job.type === "video_packaging") {
        const [retry] = await db.update(generationJobs).set({ status: "queued", progress: 0, resultJson: "{}", errorCode: null, errorMessage: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now() }).where(eq(generationJobs.id, job.id)).returning();
        return c.json({ ok: true, data: jobView(retry) });
      }
      if (!["voice_clone", "digital_human"].includes(job.type)) throw new AppRequestError("JOB_RETRY_ROUTE_MISMATCH", "请在对应的任务卡片中重试", 409);
      const request = safeJson<JsonRecord>(job.requestJson, {});
      const remoteRequest = Object.fromEntries(Object.entries(request).filter(([key]) => !key.startsWith("local")));
      const idempotencyKey = crypto.randomUUID();
      const endpoint = job.type === "voice_clone" ? "/voice-clone-jobs" : "/generation-jobs";
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const remote = await providerRequest<JsonRecord>(apiKey, apiBase, endpoint, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(remoteRequest) });
      const providerJobId = stringValue(remote.id);
      if (!providerJobId) throw new AppRequestError("INVALID_PROVIDER_RESPONSE", "益民居·数字人未返回新任务 ID", 502);
      const now = Date.now();
      const [retry] = await db.insert(generationJobs).values({ ...job, id: crypto.randomUUID(), providerJobId, idempotencyKey, status: stringValue(remote.status) || "created", resultJson: JSON.stringify(remote), errorCode: null, errorMessage: null, createdAt: now, updatedAt: now }).returning();
      return c.json({ ok: true, data: jobView(retry) }, 201);
    } catch (error) { return fail(c, error); }
  })
  .post("/api/jobs/:id/download", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const job = await ownedJob(auth.user.id, c.req.param("id"));
      if (!["digital_human", "video_packaging"].includes(job.type) || job.status !== "completed") throw new AppRequestError("VIDEO_NOT_READY", "成片尚未生成完成", 409);
      const [output] = await db.select().from(videoOutputs).where(eq(videoOutputs.generationJobId, job.id)).limit(1);
      if (output?.status === "expired" || (output && output.createdAt <= Date.now() - VIDEO_RETENTION_MS)) {
        throw new AppRequestError("VIDEO_EXPIRED", "该视频已超过7天保存期限，服务器文件已自动删除", 409);
      }
      if (output?.r2Uri) {
        const parsed = storage.tryParseS3Uri(output.r2Uri);
        if (parsed) {
          const signed = await storage.from(parsed.bucket).createPresignedGetUrl(parsed.path, 3600);
          return c.json({ ok: true, data: { url: signed.downloadUrl, source: "archive", expiresAt: signed.expiresAt.getTime() } });
        }
      }
      if (job.type === "video_packaging") throw new AppRequestError("ARCHIVE_NOT_READY", "包装成片正在归档，请稍后重试", 409);
      if (!job.providerJobId) throw new AppRequestError("VIDEO_NOT_READY", "成片尚未生成完成", 409);
      const { apiKey, apiBase } = await providerContext(auth.user.id);
      const download = await providerRequest<JsonRecord>(apiKey, apiBase, `/generation-jobs/${encodeURIComponent(job.providerJobId)}/download`, { method: "POST", body: "{}" });
      const url = stringValue(download.url);
      if (!url) throw new AppRequestError("DOWNLOAD_UNAVAILABLE", "益民居·数字人暂未提供下载地址", 502);
      ctx.runInBackground(archiveCompletedVideo(auth.user.id, job.id, job.providerJobId, apiKey, apiBase));
      return c.json({ ok: true, data: { url, source: "provider", expiresAt: download.expiresAt || null } });
    } catch (error) { return fail(c, error); }
  });
