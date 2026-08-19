import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db, secret } from "edgespark";
import { auth } from "edgespark/http";
import {
  accessGrants,
  appProfiles,
  auditLogs,
  esSystemAuthUser,
  generationJobs,
  inviteCodes,
  projects,
  providerCredentials,
} from "@defs";
import { digestInviteCode } from "../services/crypto";

type InviteStatus = "active" | "disabled";

function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `XING-${value.slice(0, 4)}-${value.slice(4)}`;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const [result] = await db
    .select({ role: appProfiles.role, accessStatus: accessGrants.status })
    .from(appProfiles)
    .innerJoin(accessGrants, eq(accessGrants.userId, appProfiles.userId))
    .where(and(eq(appProfiles.userId, userId), eq(appProfiles.role, "admin")))
    .limit(1);
  return result?.role === "admin" && result.accessStatus === "active";
}

function safeInvite(invite: typeof inviteCodes.$inferSelect) {
  return {
    id: invite.id,
    label: invite.label,
    status: invite.status,
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function startOfBeijingDay(value = Date.now()): number {
  const shifted = new Date(value + BEIJING_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - BEIJING_OFFSET_MS;
}

function beijingDayKey(value: number): string {
  return new Date(value + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function safeError(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/gu, " ").trim().slice(0, 240);
}

export const adminRoutes = new Hono()
  .get("/api/admin/operations", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以查看运营数据" } }, 403);
    }

    const now = Date.now();
    const todayStart = startOfBeijingDay(now);
    const rangeStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    const [userMetrics] = await db.select({
      total: count(),
      today: sql<number>`sum(case when ${esSystemAuthUser.createdAt} >= ${todayStart} then 1 else 0 end)`.as("users_today"),
    }).from(esSystemAuthUser);
    const [accessMetrics] = await db.select({
      active: sql<number>`sum(case when ${accessGrants.status} = 'active' then 1 else 0 end)`.as("access_active"),
      invited: sql<number>`sum(case when ${accessGrants.status} = 'active' and ${accessGrants.source} = 'invite_code' then 1 else 0 end)`.as("access_invited"),
      paid: sql<number>`sum(case when ${accessGrants.status} = 'active' and ${accessGrants.source} != 'invite_code' then 1 else 0 end)`.as("access_paid"),
    }).from(accessGrants);
    const metricJobRows = await db.select({
      userId: generationJobs.userId,
      type: generationJobs.type,
      status: generationJobs.status,
      createdAt: generationJobs.createdAt,
      updatedAt: generationJobs.updatedAt,
    }).from(generationJobs).limit(20000);
    const queuedStatuses = new Set(["created", "queued", "waiting_source"]);
    const processingStatuses = new Set(["processing", "generating", "fetching"]);
    const isFailed = (status: string) => status === "failed" || status === "cancelled";
    const isActive = (status: string) => !TERMINAL_STATUSES.has(status);
    const queuedRows = metricJobRows.filter((row) => queuedStatuses.has(row.status));
    const jobMetrics = {
      total: metricJobRows.length,
      completed: metricJobRows.filter((row) => row.status === "completed").length,
      failed: metricJobRows.filter((row) => isFailed(row.status)).length,
      active: metricJobRows.filter((row) => isActive(row.status)).length,
      today: metricJobRows.filter((row) => row.createdAt >= todayStart).length,
      todayFailed: metricJobRows.filter((row) => row.createdAt >= todayStart && isFailed(row.status)).length,
      rangeTotal: metricJobRows.filter((row) => row.createdAt >= rangeStart).length,
      rangeCompleted: metricJobRows.filter((row) => row.createdAt >= rangeStart && row.status === "completed").length,
      packagingQueued: metricJobRows.filter((row) => row.type === "video_packaging" && queuedStatuses.has(row.status)).length,
      packagingProcessing: metricJobRows.filter((row) => row.type === "video_packaging" && processingStatuses.has(row.status)).length,
      coverQueued: metricJobRows.filter((row) => row.type === "cover_image" && queuedStatuses.has(row.status)).length,
      coverProcessing: metricJobRows.filter((row) => row.type === "cover_image" && processingStatuses.has(row.status)).length,
      digitalHumanActive: metricJobRows.filter((row) => row.type === "digital_human" && isActive(row.status)).length,
      oldestQueuedAt: queuedRows.length ? Math.min(...queuedRows.map((row) => row.createdAt)) : null,
    };

    const users = await db.select({
      id: esSystemAuthUser.id,
      email: esSystemAuthUser.email,
      name: esSystemAuthUser.name,
      emailVerified: esSystemAuthUser.emailVerified,
      createdAt: esSystemAuthUser.createdAt,
      lastLoginAt: esSystemAuthUser.lastLoginAt,
    }).from(esSystemAuthUser).orderBy(desc(esSystemAuthUser.createdAt)).limit(500);
    const userIds = users.map((item) => item.id);
    const userIdBatches = Array.from({ length: Math.ceil(userIds.length / 80) }, (_, index) => userIds.slice(index * 80, index * 80 + 80));
    const [profileBatches, grantBatches, credentialBatches] = userIdBatches.length ? await Promise.all([
      Promise.all(userIdBatches.map((batch) => db.select().from(appProfiles).where(inArray(appProfiles.userId, batch)))),
      Promise.all(userIdBatches.map((batch) => db.select().from(accessGrants).where(inArray(accessGrants.userId, batch)))),
      Promise.all(userIdBatches.map((batch) => db.select({
        userId: providerCredentials.userId,
        provider: providerCredentials.provider,
        status: providerCredentials.status,
        verifiedAt: providerCredentials.verifiedAt,
      }).from(providerCredentials).where(inArray(providerCredentials.userId, batch)))),
    ]) : [[], [], []];
    const profiles = profileBatches.flat();
    const grants = grantBatches.flat();
    const credentials = credentialBatches.flat();
    const userJobMetricsMap = new Map<string, { userId: string; total: number; completed: number; failed: number; active: number; lastJobAt: number }>();
    metricJobRows.forEach((row) => {
      const current = userJobMetricsMap.get(row.userId) || { userId: row.userId, total: 0, completed: 0, failed: 0, active: 0, lastJobAt: 0 };
      current.total += 1;
      if (row.status === "completed") current.completed += 1;
      if (isFailed(row.status)) current.failed += 1;
      if (isActive(row.status)) current.active += 1;
      current.lastJobAt = Math.max(current.lastJobAt, row.updatedAt);
      userJobMetricsMap.set(row.userId, current);
    });
    const userJobMetrics = [...userJobMetricsMap.values()];
    const userProjectMetrics = await db.select({ userId: projects.userId, total: count() }).from(projects).groupBy(projects.userId);

    const profileMap = new Map(profiles.map((item) => [item.userId, item]));
    const grantMap = new Map(grants.map((item) => [item.userId, item]));
    const jobMap = new Map(userJobMetrics.map((item) => [item.userId, item]));
    const projectMap = new Map(userProjectMetrics.map((item) => [item.userId, Number(item.total || 0)]));
    const credentialMap = new Map<string, Array<{ provider: string; status: string; verifiedAt: number }>>();
    credentials.forEach((item) => credentialMap.set(item.userId, [...(credentialMap.get(item.userId) || []), { provider: item.provider, status: item.status, verifiedAt: item.verifiedAt }]));

    const recentJobs = await db.select({
      id: generationJobs.id,
      userId: generationJobs.userId,
      userEmail: esSystemAuthUser.email,
      projectId: generationJobs.projectId,
      projectTitle: projects.title,
      name: generationJobs.name,
      type: generationJobs.type,
      status: generationJobs.status,
      progress: generationJobs.progress,
      providerJobId: generationJobs.providerJobId,
      requestId: generationJobs.requestId,
      estimatedPoints: generationJobs.estimatedPoints,
      finalPoints: generationJobs.finalPoints,
      errorCode: generationJobs.errorCode,
      errorMessage: generationJobs.errorMessage,
      createdAt: generationJobs.createdAt,
      updatedAt: generationJobs.updatedAt,
    }).from(generationJobs)
      .leftJoin(esSystemAuthUser, eq(generationJobs.userId, esSystemAuthUser.id))
      .leftJoin(projects, eq(generationJobs.projectId, projects.id))
      .orderBy(desc(generationJobs.createdAt)).limit(500);

    const trendJobs = await db.select({ createdAt: generationJobs.createdAt, status: generationJobs.status })
      .from(generationJobs).where(gte(generationJobs.createdAt, rangeStart)).limit(5000);
    const trendUsers = await db.select({ createdAt: esSystemAuthUser.createdAt })
      .from(esSystemAuthUser).where(gte(esSystemAuthUser.createdAt, rangeStart)).limit(5000);
    const daily = Array.from({ length: 7 }, (_, index) => {
      const date = beijingDayKey(rangeStart + index * 24 * 60 * 60 * 1000);
      return { date, users: 0, jobs: 0, completed: 0, failed: 0 };
    });
    const dailyMap = new Map(daily.map((item) => [item.date, item]));
    trendUsers.forEach((item) => { const bucket = dailyMap.get(beijingDayKey(item.createdAt)); if (bucket) bucket.users += 1; });
    trendJobs.forEach((item) => {
      const bucket = dailyMap.get(beijingDayKey(item.createdAt));
      if (!bucket) return;
      bucket.jobs += 1;
      if (item.status === "completed") bucket.completed += 1;
      if (item.status === "failed" || item.status === "cancelled") bucket.failed += 1;
    });

    const rangeTotal = Number(jobMetrics?.rangeTotal || 0);
    const rangeCompleted = Number(jobMetrics?.rangeCompleted || 0);
    return c.json({ ok: true, data: {
      generatedAt: now,
      metrics: {
        totalUsers: Number(userMetrics?.total || 0),
        todayUsers: Number(userMetrics?.today || 0),
        activeAccessUsers: Number(accessMetrics?.active || 0),
        invitedUsers: Number(accessMetrics?.invited || 0),
        paidUsers: Number(accessMetrics?.paid || 0),
        totalJobs: Number(jobMetrics?.total || 0),
        completedJobs: Number(jobMetrics?.completed || 0),
        failedJobs: Number(jobMetrics?.failed || 0),
        activeJobs: Number(jobMetrics?.active || 0),
        todayJobs: Number(jobMetrics?.today || 0),
        todayFailedJobs: Number(jobMetrics?.todayFailed || 0),
        sevenDayJobs: rangeTotal,
        sevenDaySuccessRate: rangeTotal ? Math.round(rangeCompleted / rangeTotal * 1000) / 10 : 0,
        packagingQueuedJobs: Number(jobMetrics?.packagingQueued || 0),
        packagingProcessingJobs: Number(jobMetrics?.packagingProcessing || 0),
        coverQueuedJobs: Number(jobMetrics?.coverQueued || 0),
        coverProcessingJobs: Number(jobMetrics?.coverProcessing || 0),
        digitalHumanActiveJobs: Number(jobMetrics?.digitalHumanActive || 0),
        oldestQueuedAt: jobMetrics?.oldestQueuedAt || null,
      },
      daily,
      users: users.map((user) => {
        const profile = profileMap.get(user.id);
        const grant = grantMap.get(user.id);
        const jobs = jobMap.get(user.id);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: Boolean(user.emailVerified),
          role: profile?.role || "user",
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          accessStatus: grant?.status || "pending",
          accessSource: grant?.source || null,
          accessExpiresAt: grant?.expiresAt || null,
          providers: credentialMap.get(user.id) || [],
          projectCount: projectMap.get(user.id) || 0,
          jobCount: Number(jobs?.total || 0),
          completedJobCount: Number(jobs?.completed || 0),
          failedJobCount: Number(jobs?.failed || 0),
          activeJobCount: Number(jobs?.active || 0),
          lastJobAt: jobs?.lastJobAt || null,
        };
      }),
      jobs: recentJobs.map((job) => ({
        ...job,
        errorMessage: safeError(job.errorMessage),
        terminal: TERMINAL_STATUSES.has(job.status),
      })),
    } });
  })
  .get("/api/admin/invite-codes", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以管理暗号" } }, 403);
    }

    const invites = await db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).limit(200);
    return c.json({ ok: true, data: { invites: invites.map(safeInvite) } });
  })
  .post("/api/admin/invite-codes", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以生成暗号" } }, 403);
    }

    const hmacKey = secret.get("INVITE_CODE_HMAC_KEY");
    if (!hmacKey) {
      return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "暗号服务尚未配置" } }, 503);
    }

    const body: { label?: string; maxUses?: number | null; expiresAt?: number | null } = await c.req
      .json<{ label?: string; maxUses?: number | null; expiresAt?: number | null }>()
      .catch(() => ({}));
    const label = (body.label || "").trim();
    const maxUses = body.maxUses ?? null;
    const expiresAt = body.expiresAt ?? null;
    if (label.length < 2 || label.length > 80) {
      return c.json({ ok: false, error: { code: "INVALID_LABEL", message: "暗号备注需为 2～80 个字符" } }, 400);
    }
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000)) {
      return c.json({ ok: false, error: { code: "INVALID_MAX_USES", message: "使用次数需为 1～10000 的整数" } }, 400);
    }
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
      return c.json({ ok: false, error: { code: "INVALID_EXPIRY", message: "过期时间必须晚于当前时间" } }, 400);
    }

    const code = generateInviteCode();
    const now = Date.now();
    const invite = {
      id: crypto.randomUUID(),
      codeDigest: await digestInviteCode(code, hmacKey),
      label,
      status: "active" as const,
      maxUses,
      usedCount: 0,
      expiresAt,
      note: null,
      createdBy: auth.user.id,
      createdAt: now,
      updatedAt: now,
    };

    await db.batch([
      db.insert(inviteCodes).values(invite),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: auth.user.id,
        action: "invite.created",
        targetType: "invite_code",
        targetId: invite.id,
        safeMetadataJson: JSON.stringify({ label, maxUses, expiresAt }),
        createdAt: now,
      }),
    ]);

    return c.json({ ok: true, data: { code, invite: safeInvite(invite) } }, 201);
  })
  .patch("/api/admin/invite-codes/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await isAdmin(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ADMIN_REQUIRED", message: "仅管理员可以修改暗号" } }, 403);
    }

    const body: { status?: InviteStatus } = await c.req
      .json<{ status?: InviteStatus }>()
      .catch(() => ({}));
    if (body.status !== "active" && body.status !== "disabled") {
      return c.json({ ok: false, error: { code: "INVALID_STATUS", message: "暗号状态无效" } }, 400);
    }

    const id = c.req.param("id");
    const [existing] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, id)).limit(1);
    if (!existing) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "没有找到这个暗号" } }, 404);
    }

    const now = Date.now();
    await db.batch([
      db.update(inviteCodes).set({ status: body.status, updatedAt: now }).where(eq(inviteCodes.id, id)),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: auth.user.id,
        action: body.status === "active" ? "invite.enabled" : "invite.disabled",
        targetType: "invite_code",
        targetId: id,
        safeMetadataJson: "{}",
        createdAt: now,
      }),
    ]);

    return c.json({ ok: true, data: { invite: safeInvite({ ...existing, status: body.status, updatedAt: now }) } });
  });
