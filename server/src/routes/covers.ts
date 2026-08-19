import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, storage } from "edgespark";
import { auth } from "edgespark/http";
import { buckets, coverReferences, generationJobs, projects, scriptAnalyses, scriptVersions } from "@defs";
import { archiveCoverImages, archivedCoverUris, providerCoverUrls, signArchivedCoverImages } from "../services/cover-storage";
import { AppRequestError, getUserProviderKey, requireActiveAccess, safeJson } from "../services/user-providers";

type JsonRecord = Record<string, unknown>;

const STYLES = [
  { id: "impact", name: "强冲击", direction: "强烈明暗对比，高饱和红黄视觉锤，人物表情和手势明显夸张但真实，信息一眼能读懂" },
  { id: "authority", name: "专业权威", direction: "电影级布光，深色高级背景，人物可信有力量，蓝金或黑金配色，克制但有压迫感" },
  { id: "curiosity", name: "悬念好奇", direction: "制造未揭晓的悬念和前后反差，人物带疑问或震惊表情，颜色鲜明，画面有故事冲突" },
] as const;

function fail(c: Context, error: unknown) {
  if (error instanceof AppRequestError) return c.json({ ok: false as const, error: { code: error.code, message: error.message } }, error.status);
  console.error("Cover route error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false as const, error: { code: "INTERNAL_ERROR", message: "封面服务暂时不可用" } }, 500);
}

async function ownedProject(userId: string, id: string) {
  const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId))).limit(1);
  if (!row) throw new AppRequestError("PROJECT_NOT_FOUND", "项目不存在", 404);
  return row;
}

async function jobView(row: typeof generationJobs.$inferSelect) {
  const result = safeJson<JsonRecord>(row.resultJson, {});
  const signed = archivedCoverUris(result).length
    ? await signArchivedCoverImages(result)
    : { imageUrls: providerCoverUrls(result), imageUrlExpiresAt: null };
  return {
    ...row,
    request: safeJson<JsonRecord>(row.requestJson, {}),
    result: { ...result, ...signed, imageSource: archivedCoverUris(result).length ? "archive" : "provider" },
  };
}

function coverPrompt(input: { title: string; subtitle: string; script: string; keywords: string[]; style: typeof STYLES[number]; ratio: string }) {
  return [
    `生成一张中文短视频封面，画幅${input.ratio}，这是可直接发布的最终成图。`,
    `封面主标题必须准确写成：『${input.title}』。${input.subtitle ? `辅助短句可写：『${input.subtitle}』。` : "不要额外编造长文案。"}`,
    `视觉方向：${input.style.direction}。`,
    "人物必须延续参考图中的同一个人，保留脸型、五官、发型、眼镜与年龄观感；允许为主题调整服装、姿势、表情和环境。",
    "标题要大、短、具有点击冲击力，使用高对比中文粗体设计，保证手机信息流缩略图仍清楚。人物与标题互不遮挡，不要水印，不要平台角标。",
    `内容关键词：${input.keywords.join("、") || "个人成长、经验分享"}。`,
    `文案语义参考：${input.script.slice(0, 700)}`,
  ].join("\n");
}

async function syncCoverJobs(userId: string, projectId?: string) {
  const rows = await db.select().from(generationJobs).where(projectId
    ? and(eq(generationJobs.userId, userId), eq(generationJobs.projectId, projectId), eq(generationJobs.type, "cover_image"))
    : and(eq(generationJobs.userId, userId), eq(generationJobs.type, "cover_image"))).orderBy(desc(generationJobs.createdAt));
  const migrated = await Promise.all(rows.map(ensureArchivedCover));
  return Promise.all(migrated.map(jobView));
}

async function ensureArchivedCover(row: typeof generationJobs.$inferSelect) {
  const result = safeJson<JsonRecord>(row.resultJson, {});
  if (row.status !== "completed" || archivedCoverUris(result).length) return row;
  const providerUrls = providerCoverUrls(result);
  if (!providerUrls.length) return row;
  try {
    const archived = await archiveCoverImages(
      row,
      providerUrls,
      typeof result.expiresAt === "number" ? result.expiresAt : null,
    );
    const resultJson = JSON.stringify(archived);
    await db.update(generationJobs).set({ resultJson, updatedAt: Date.now() }).where(eq(generationJobs.id, row.id));
    return { ...row, resultJson, updatedAt: Date.now() };
  } catch (error) {
    console.error("Legacy cover archive failed", row.id, error instanceof Error ? error.message : "unknown");
    return row;
  }
}

async function referenceView(row: typeof coverReferences.$inferSelect) {
  const signed = await storage.from(buckets.coverInputs).createPresignedGetUrl(row.objectPath, 3600);
  return {
    id: row.id,
    projectId: row.projectId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    previewUrl: signed.downloadUrl,
    previewExpiresAt: signed.expiresAt.getTime(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const coverRoutes = new Hono()
  .get("/api/cover-references", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const rows = await db.select().from(coverReferences).where(and(
        eq(coverReferences.userId, auth.user.id),
        eq(coverReferences.status, "ready"),
      )).orderBy(desc(coverReferences.updatedAt)).limit(50);
      return c.json({ ok: true, data: await Promise.all(rows.map(referenceView)) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/cover-references/upload-ticket", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ projectId?: string; filename?: string; contentType?: string; sizeBytes?: number }>().catch(() => ({} as { projectId?: string; filename?: string; contentType?: string; sizeBytes?: number }));
      const projectId = body.projectId ? (await ownedProject(auth.user.id, body.projectId)).id : null;
      const contentType = body.contentType || "";
      const sizeBytes = Math.round(body.sizeBytes || 0);
      if (!/^image\/(jpeg|png|webp)$/u.test(contentType) || sizeBytes < 1 || sizeBytes > 20 * 1024 * 1024) throw new AppRequestError("INVALID_IMAGE", "请选择20MB以内的 JPG、PNG 或 WebP 形象照", 400);
      const id = crypto.randomUUID();
      const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const objectPath = `users/${auth.user.id}/${id}.${extension}`;
      const signed = await storage.from(buckets.coverInputs).createPresignedPutUrl(objectPath, 1800, { contentType });
      const now = Date.now();
      await db.insert(coverReferences).values({ id, userId: auth.user.id, projectId, objectPath, filename: (body.filename || `portrait.${extension}`).slice(0, 180), contentType, sizeBytes, status: "uploading", createdAt: now, updatedAt: now });
      return c.json({ ok: true, data: { id, uploadUrl: signed.uploadUrl, headers: signed.requiredHeaders } }, 201);
    } catch (error) { return fail(c, error); }
  })
  .post("/api/cover-references/:id/finalize", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [row] = await db.select().from(coverReferences).where(and(eq(coverReferences.id, c.req.param("id")), eq(coverReferences.userId, auth.user.id))).limit(1);
      if (!row) throw new AppRequestError("REFERENCE_NOT_FOUND", "形象照不存在", 404);
      const object = await storage.from(buckets.coverInputs).head(row.objectPath);
      if (!object || object.size !== row.sizeBytes) throw new AppRequestError("UPLOAD_INCOMPLETE", "没有收到完整的形象照，请重新上传", 409);
      const [updated] = await db.update(coverReferences).set({ status: "ready", updatedAt: Date.now() }).where(eq(coverReferences.id, row.id)).returning();
      return c.json({ ok: true, data: await referenceView(updated) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/covers", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ projectId?: string; analysisId?: string; referenceId?: string; ratio?: "16:9" | "9:16"; count?: number }>().catch(() => ({} as { projectId?: string; analysisId?: string; referenceId?: string; ratio?: "16:9" | "9:16"; count?: number }));
      const project = await ownedProject(auth.user.id, body.projectId || "");
      const [analysis] = await db.select().from(scriptAnalyses).where(and(eq(scriptAnalyses.id, body.analysisId || ""), eq(scriptAnalyses.projectId, project.id), eq(scriptAnalyses.userId, auth.user.id))).limit(1);
      if (!analysis) throw new AppRequestError("ANALYSIS_REQUIRED", "请先确认核心标题", 422);
      if (body.referenceId) {
        const [reference] = await db.select().from(coverReferences).where(and(eq(coverReferences.id, body.referenceId), eq(coverReferences.userId, auth.user.id), eq(coverReferences.status, "ready"))).limit(1);
        if (!reference) throw new AppRequestError("REFERENCE_NOT_READY", "封面形象照尚未上传完成", 409);
      }
      const [script] = await db.select().from(scriptVersions).where(eq(scriptVersions.id, analysis.scriptVersionId)).limit(1);
      if (!script) throw new AppRequestError("SCRIPT_NOT_FOUND", "文案不存在", 404);
      await getUserProviderKey(auth.user.id, "imagegen");
      const now = Date.now();
      const ratio = body.ratio === "16:9" ? "16:9" : "9:16";
      const count = Math.max(1, Math.min(3, Math.round(body.count || 3)));
      const keywords = safeJson<string[]>(analysis.keywordsJson, []);
      const localJobs = STYLES.slice(0, count).map((style) => ({ id: crypto.randomUUID(), style, idempotencyKey: crypto.randomUUID() }));
      for (const { id, style, idempotencyKey } of localJobs) {
        const prompt = coverPrompt({ title: analysis.coreTitle, subtitle: analysis.coverSubtitle, script: script.content, keywords, style, ratio });
        await db.insert(generationJobs).values({
          id, userId: auth.user.id, projectId: project.id, type: "cover_image", name: `${analysis.coreTitle} · ${style.name}`,
          idempotencyKey, status: "queued", progress: 0,
          requestJson: JSON.stringify({ analysisId: analysis.id, referenceId: body.referenceId || null, ratio, styleId: style.id, styleName: style.name, prompt }),
          resultJson: "{}", createdAt: now, updatedAt: now,
        });
      }
      const rows = await db.select().from(generationJobs).where(inArray(generationJobs.id, localJobs.map((item) => item.id)));
      return c.json({ ok: true, data: await Promise.all(rows.map(jobView)) }, 201);
    } catch (error) { return fail(c, error); }
  })
  .get("/api/covers", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try { await requireActiveAccess(auth.user.id); return c.json({ ok: true, data: await syncCoverJobs(auth.user.id, c.req.query("projectId")) }); }
    catch (error) { return fail(c, error); }
  })
  .post("/api/covers/:id/retry", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(generationJobs).where(and(eq(generationJobs.id, c.req.param("id")), eq(generationJobs.userId, auth.user.id), eq(generationJobs.type, "cover_image"))).limit(1);
      if (!job || job.status !== "failed") throw new AppRequestError("JOB_NOT_RETRYABLE", "只有失败的封面任务可以重试", 409);
      const request = safeJson<JsonRecord>(job.requestJson, {});
      const previousResult = safeJson<JsonRecord>(job.resultJson, {});
      if (job.errorCode === "COVER_ARCHIVE_FAILED") {
        const providerUrls = providerCoverUrls(previousResult);
        if (!providerUrls.length) throw new AppRequestError("COVER_SOURCE_MISSING", "封面源文件已失效，请重新生成", 409);
        const archived = await archiveCoverImages(
          job,
          providerUrls,
          typeof previousResult.providerExpiresAt === "number" ? previousResult.providerExpiresAt : null,
        );
        const [recovered] = await db.update(generationJobs).set({
          status: "completed",
          progress: 100,
          resultJson: JSON.stringify(archived),
          errorCode: null,
          errorMessage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: Date.now(),
        }).where(eq(generationJobs.id, job.id)).returning();
        return c.json({ ok: true, data: await jobView(recovered) });
      }
      const analysisId = typeof request.analysisId === "string" ? request.analysisId : "";
      const referenceId = typeof request.referenceId === "string" ? request.referenceId : null;
      const ratio = request.ratio === "16:9" ? "16:9" as const : "9:16" as const;
      if (!job.projectId) throw new AppRequestError("PROJECT_NOT_FOUND", "封面任务缺少项目信息，请重新生成", 409);
      const style = STYLES.find((item) => item.id === request.styleId);
      if (!style) throw new AppRequestError("STYLE_NOT_FOUND", "这张封面的模板信息已失效，请重新生成", 409);
      const [analysis] = await db.select().from(scriptAnalyses).where(and(
        eq(scriptAnalyses.id, analysisId),
        eq(scriptAnalyses.projectId, job.projectId),
        eq(scriptAnalyses.userId, auth.user.id),
      )).limit(1);
      if (!analysis) throw new AppRequestError("ANALYSIS_NOT_FOUND", "核心标题分析不存在，请重新生成", 404);
      const [script] = await db.select().from(scriptVersions).where(eq(scriptVersions.id, analysis.scriptVersionId)).limit(1);
      if (!script) throw new AppRequestError("SCRIPT_NOT_FOUND", "文案不存在，请重新生成", 404);
      if (referenceId) {
        const [reference] = await db.select().from(coverReferences).where(and(
          eq(coverReferences.id, referenceId),
          eq(coverReferences.userId, auth.user.id),
          eq(coverReferences.status, "ready"),
        )).limit(1);
        if (!reference) throw new AppRequestError("REFERENCE_NOT_READY", "人物参考图已失效，请重新上传", 409);
      }
      await getUserProviderKey(auth.user.id, "imagegen");
      const idempotencyKey = crypto.randomUUID();
      const prompt = coverPrompt({
        title: analysis.coreTitle,
        subtitle: analysis.coverSubtitle,
        script: script.content,
        keywords: safeJson<string[]>(analysis.keywordsJson, []),
        style,
        ratio,
      });
      await db.update(generationJobs).set({
        idempotencyKey,
        providerJobId: null,
        status: "queued",
        progress: 0,
        requestJson: JSON.stringify({ ...request, prompt }),
        resultJson: "{}",
        errorCode: null,
        errorMessage: null,
        updatedAt: Date.now(),
      }).where(eq(generationJobs.id, job.id));
      const [updated] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
      return c.json({ ok: true, data: await jobView(updated) });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/covers/:id/refresh", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [job] = await db.select().from(generationJobs).where(and(
        eq(generationJobs.id, c.req.param("id")),
        eq(generationJobs.userId, auth.user.id),
        eq(generationJobs.type, "cover_image"),
      )).limit(1);
      if (!job) throw new AppRequestError("JOB_NOT_FOUND", "封面任务不存在", 404);
      const refreshed = await ensureArchivedCover(job);
      const result = safeJson<JsonRecord>(refreshed.resultJson, {});
      if (refreshed.status === "completed" && !archivedCoverUris(result).length) {
        throw new AppRequestError("COVER_DELIVERY_UNAVAILABLE", "封面已生成，但暂时无法载入，请稍后再试", 503);
      }
      return c.json({ ok: true, data: await jobView(refreshed) });
    } catch (error) { return fail(c, error); }
  });
