import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, secret, storage, vars } from "edgespark";
import { auth } from "edgespark/http";
import { auditLogs, buckets, tutorialVideos } from "@defs";
import { isAdmin } from "./admin";
import { requireActiveAccess } from "../services/user-providers";
import {
  createAliyunOssPresignedUrl,
  createAliyunOssUri,
  parseAliyunOssUri,
  type AliyunOssConfig,
} from "../services/aliyun-oss";

const MAX_TUTORIAL_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const DEFAULT_ALIYUN_OSS_BUCKET = "replace-with-your-oss-bucket";
const DEFAULT_ALIYUN_OSS_REGION = "replace-with-your-oss-region";
type TutorialUploadBody = { filename?: string; contentType?: string; sizeBytes?: number; durationMs?: number; title?: string; description?: string };

function fail(message: string, code: string, status: 400 | 403 | 404 | 409 | 413 | 500) {
  return { body: { ok: false as const, error: { code, message } }, status };
}

function aliyunOssConfig(bucket = vars.get("ALIYUN_OSS_BUCKET") || DEFAULT_ALIYUN_OSS_BUCKET): AliyunOssConfig {
  const accessKeyId = secret.get("ALIYUN_OSS_ACCESS_KEY_ID");
  const accessKeySecret = secret.get("ALIYUN_OSS_ACCESS_KEY_SECRET");
  if (!accessKeyId || !accessKeySecret) throw new Error("Aliyun OSS credentials are not configured");
  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    region: vars.get("ALIYUN_OSS_REGION") || DEFAULT_ALIYUN_OSS_REGION,
  };
}

async function tutorialView(row: typeof tutorialVideos.$inferSelect) {
  const aliyunObject = parseAliyunOssUri(row.objectPath);
  const playbackUrl = aliyunObject
    ? await createAliyunOssPresignedUrl({
        ...aliyunOssConfig(aliyunObject.bucket), method: "GET", objectKey: aliyunObject.objectKey, expiresInSeconds: 6 * 60 * 60,
      })
    : (await storage.from(buckets.tutorials).createPresignedGetUrl(row.objectPath, 6 * 60 * 60)).downloadUrl;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    status: row.status,
    playbackUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const tutorialRoutes = new Hono()
  .get("/api/tutorial-video", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const [current] = await db.select().from(tutorialVideos).where(eq(tutorialVideos.status, "active")).orderBy(desc(tutorialVideos.updatedAt)).limit(1);
      return c.json({ ok: true, data: current ? await tutorialView(current) : null });
    } catch (error) {
      console.error("Tutorial read failed", error instanceof Error ? error.message : "unknown");
      return c.json({ ok: false, error: { code: "TUTORIAL_READ_FAILED", message: "新手教学暂时无法加载" } }, 500);
    }
  })
  .get("/api/admin/tutorial-video", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以管理教学视频" } }, 403);
    const [current] = await db.select().from(tutorialVideos).where(eq(tutorialVideos.status, "active")).orderBy(desc(tutorialVideos.updatedAt)).limit(1);
    return c.json({ ok: true, data: current ? await tutorialView(current) : null });
  })
  .post("/api/admin/tutorial-video/upload-ticket", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以上传教学视频" } }, 403);
    const body = await c.req.json<TutorialUploadBody>().catch(() => ({} as TutorialUploadBody));
    const filename = (body.filename || "").trim();
    const contentType = (body.contentType || "").toLowerCase();
    const sizeBytes = Math.round(body.sizeBytes || 0);
    if (!filename || !ALLOWED_VIDEO_TYPES.has(contentType)) {
      const error = fail("请上传 MP4 或 WebM 格式的教学视频", "INVALID_TUTORIAL_FILE", 400);
      return c.json(error.body, error.status);
    }
    if (sizeBytes <= 0 || sizeBytes > MAX_TUTORIAL_BYTES) {
      const error = fail("教学视频不能超过 2GB", "TUTORIAL_TOO_LARGE", 413);
      return c.json(error.body, error.status);
    }
    const ossConfig = aliyunOssConfig();
    const id = crypto.randomUUID();
    const extension = contentType === "video/webm" ? "webm" : "mp4";
    const objectKey = `onboarding/${id}/tutorial.${extension}`;
    const objectPath = createAliyunOssUri(ossConfig.bucket, objectKey);
    const now = Date.now();
    await db.insert(tutorialVideos).values({
      id,
      title: (body.title || "新手教学：从想法到成片").trim().slice(0, 100),
      description: (body.description || "跟着视频完成第一次文案、声音克隆和数字人成片。").trim().slice(0, 500),
      objectPath,
      contentType,
      sizeBytes,
      durationMs: body.durationMs && body.durationMs > 0 ? Math.round(body.durationMs) : null,
      status: "uploading",
      uploadedBy: auth.user.id,
      createdAt: now,
      updatedAt: now,
    });
    const uploadUrl = await createAliyunOssPresignedUrl({
      ...ossConfig, method: "PUT", objectKey, expiresInSeconds: 60 * 60, contentType,
    });
    return c.json({ ok: true, data: { id, uploadUrl, requiredHeaders: { "Content-Type": contentType } } }, 201);
  })
  .post("/api/admin/tutorial-video/:id/finalize", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以发布教学视频" } }, 403);
    const id = c.req.param("id");
    const [pending] = await db.select().from(tutorialVideos).where(eq(tutorialVideos.id, id)).limit(1);
    if (!pending || pending.uploadedBy !== auth.user.id) {
      const error = fail("没有找到这次教学视频上传", "TUTORIAL_UPLOAD_NOT_FOUND", 404);
      return c.json(error.body, error.status);
    }
    if (pending.status === "active") return c.json({ ok: true, data: await tutorialView(pending) });
    const aliyunObject = parseAliyunOssUri(pending.objectPath);
    let uploadedSize: number | null = null;
    if (aliyunObject) {
      const headUrl = await createAliyunOssPresignedUrl({
        ...aliyunOssConfig(aliyunObject.bucket), method: "HEAD", objectKey: aliyunObject.objectKey, expiresInSeconds: 5 * 60,
      });
      const headResponse = await fetch(headUrl, { method: "HEAD" });
      if (headResponse.ok) {
        const contentLength = Number(headResponse.headers.get("content-length"));
        uploadedSize = Number.isFinite(contentLength) ? contentLength : null;
      }
    } else {
      uploadedSize = (await storage.from(buckets.tutorials).head(pending.objectPath))?.size ?? null;
    }
    if (uploadedSize !== pending.sizeBytes) {
      const error = fail("视频尚未完整上传，请重新选择文件上传", "TUTORIAL_UPLOAD_INCOMPLETE", 409);
      return c.json(error.body, error.status);
    }
    const now = Date.now();
    const [, activated] = await db.batch([
      db.update(tutorialVideos).set({ status: "archived", updatedAt: now }).where(eq(tutorialVideos.status, "active")),
      db.update(tutorialVideos).set({ status: "active", updatedAt: now }).where(eq(tutorialVideos.id, id)).returning(),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(), actorUserId: auth.user.id, action: "tutorial_video.published",
        targetType: "tutorial_video", targetId: id,
        safeMetadataJson: JSON.stringify({ contentType: pending.contentType, sizeBytes: pending.sizeBytes, durationMs: pending.durationMs }),
        createdAt: now,
      }),
    ]);
    const current = activated[0];
    if (!current) {
      const error = fail("教学视频发布失败", "TUTORIAL_PUBLISH_FAILED", 500);
      return c.json(error.body, error.status);
    }
    return c.json({ ok: true, data: await tutorialView(current) });
  });
