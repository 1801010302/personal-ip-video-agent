import { and, eq, gt, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { db, secret, vars } from "edgespark";
import { auth } from "edgespark/http";
import {
  accessGrants,
  appProfiles,
  auditLogs,
  inviteCodes,
  inviteRedemptions,
  providerCredentials,
} from "@defs";
import {
  createPendingInviteToken,
  digestInviteCode,
  verifyPendingInviteToken,
} from "../services/crypto";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const ADMIN_BOOTSTRAP_INVITE_ID = "__admin_bootstrap__";
const DEFAULT_ADMIN_BOOTSTRAP_EMAIL = "";

function adminBootstrapEmail(): string {
  return normalizeEmail(vars.get("ADMIN_BOOTSTRAP_EMAIL") || DEFAULT_ADMIN_BOOTSTRAP_EMAIL);
}

function inviteAvailableWhere(digest: string, now: number) {
  return and(
    eq(inviteCodes.codeDigest, digest),
    eq(inviteCodes.status, "active"),
    or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, now)),
  );
}

export const accessRoutes = new Hono()
  .get("/api/public/health", (c) =>
    c.json({ ok: true, service: "personal-ip-video-agent", time: new Date().toISOString() }),
  )
  .post("/api/public/access/preflight", async (c) => {
    const hmacKey = secret.get("INVITE_CODE_HMAC_KEY");
    if (!hmacKey) {
      return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "暗号服务尚未配置" } }, 503);
    }

    const body: { email?: string; inviteCode?: string } = await c.req
      .json<{ email?: string; inviteCode?: string }>()
      .catch(() => ({}));
    const email = normalizeEmail(body.email || "");
    const inviteCode = body.inviteCode || "";
    const bootstrapEmail = adminBootstrapEmail();
    const isAdminBootstrap = Boolean(bootstrapEmail) && email === bootstrapEmail && !inviteCode.trim();
    if (!email.includes("@") || (!isAdminBootstrap && inviteCode.trim().length < 6)) {
      return c.json({ ok: false, error: { code: "INVALID_INPUT", message: "请填写有效邮箱和暗号" } }, 400);
    }

    const now = Date.now();
    if (isAdminBootstrap) {
      const pendingToken = await createPendingInviteToken(
        {
          inviteId: ADMIN_BOOTSTRAP_INVITE_ID,
          email,
          expiresAt: now + 30 * 60 * 1000,
          nonce: crypto.randomUUID(),
        },
        hmacKey,
      );
      return c.json({ ok: true, data: { pendingToken, expiresInSeconds: 1800 } });
    }

    const digest = await digestInviteCode(inviteCode, hmacKey);
    const [invite] = await db.select().from(inviteCodes).where(inviteAvailableWhere(digest, now)).limit(1);

    if (!invite || (invite.maxUses !== null && invite.usedCount >= invite.maxUses)) {
      return c.json({ ok: false, error: { code: "INVITE_UNAVAILABLE", message: "这个暗号无效、已过期或名额已用完" } }, 400);
    }

    const pendingToken = await createPendingInviteToken(
      {
        inviteId: invite.id,
        email,
        expiresAt: now + 30 * 60 * 1000,
        nonce: crypto.randomUUID(),
      },
      hmacKey,
    );

    return c.json({ ok: true, data: { pendingToken, expiresInSeconds: 1800 } });
  })
  .get("/api/access/status", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);

    const [grant] = await db.select().from(accessGrants).where(eq(accessGrants.userId, auth.user.id)).limit(1);
    const [profile] = await db
      .select({ role: appProfiles.role })
      .from(appProfiles)
      .where(eq(appProfiles.userId, auth.user.id))
      .limit(1);
    const credentials = await db
      .select({ provider: providerCredentials.provider, status: providerCredentials.status })
      .from(providerCredentials)
      .where(eq(providerCredentials.userId, auth.user.id));
    const chuanshenyun = credentials.find((credential) => credential.provider === "chuanshenyun");
    const deepseek = credentials.find((credential) => credential.provider === "deepseek");
    const imagegen = credentials.find((credential) => credential.provider === "imagegen");
    const grantActive = grant?.status === "active" && (grant.expiresAt === null || grant.expiresAt > Date.now());

    return c.json({
      ok: true,
      data: {
        activated: grantActive,
        accessStatus: grantActive ? "active" : grant?.status === "active" ? "expired" : grant?.status ?? "pending",
        accessSource: grant?.source ?? null,
        accessExpiresAt: grant?.expiresAt ?? null,
        role: profile?.role ?? "user",
        providerConnected: chuanshenyun?.status === "connected",
        providerStatus: chuanshenyun?.status ?? "not_connected",
        deepseekConnected: deepseek?.status === "connected",
        deepseekStatus: deepseek?.status ?? "not_connected",
        imagegenConnected: imagegen?.status === "connected",
        imagegenStatus: imagegen?.status ?? "not_connected",
      },
    });
  })
  .post("/api/access/redeem", async (c) => {
    if (!auth.user?.email) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    const hmacKey = secret.get("INVITE_CODE_HMAC_KEY");
    if (!hmacKey) {
      return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "暗号服务尚未配置" } }, 503);
    }

    const body: { pendingToken?: string } = await c.req
      .json<{ pendingToken?: string }>()
      .catch(() => ({}));
    const payload = body.pendingToken
      ? await verifyPendingInviteToken(body.pendingToken, hmacKey)
      : null;
    if (!payload || payload.email !== normalizeEmail(auth.user.email)) {
      return c.json({ ok: false, error: { code: "INVALID_TOKEN", message: "暗号验证已过期，请重新输入" } }, 400);
    }

    const [existingGrant] = await db.select().from(accessGrants).where(eq(accessGrants.userId, auth.user.id)).limit(1);
    const bootstrapEmail = adminBootstrapEmail();
    const isAdminBootstrap =
      payload.inviteId === ADMIN_BOOTSTRAP_INVITE_ID &&
      Boolean(bootstrapEmail) &&
      normalizeEmail(auth.user.email) === bootstrapEmail;

    if (isAdminBootstrap) {
      const now = Date.now();
      await db.batch([
        db.insert(accessGrants).values({
          userId: auth.user.id,
          status: "active",
          source: "admin_bootstrap",
          grantedAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: accessGrants.userId,
          set: { status: "active", source: "admin_bootstrap", revokedAt: null, updatedAt: now },
        }),
        db.insert(appProfiles).values({
          userId: auth.user.id,
          displayName: auth.user.name,
          role: "admin",
          onboardingStep: "connect_provider",
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: appProfiles.userId,
          set: { displayName: auth.user.name, role: "admin", onboardingStep: "connect_provider", updatedAt: now },
        }),
        db.insert(auditLogs).values({
          id: crypto.randomUUID(),
          actorUserId: auth.user.id,
          action: "access.admin_bootstrapped",
          targetType: "user",
          targetId: auth.user.id,
          safeMetadataJson: "{}",
          createdAt: now,
        }),
      ]);
      return c.json({ ok: true, data: { activated: true, alreadyActivated: existingGrant?.status === "active", role: "admin" } });
    }

    if (existingGrant?.status === "active") {
      return c.json({ ok: true, data: { activated: true, alreadyActivated: true, role: "user" } });
    }

    const [invite] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, payload.inviteId))
      .limit(1);
    const now = Date.now();
    if (
      !invite ||
      invite.status !== "active" ||
      (invite.expiresAt !== null && invite.expiresAt <= now) ||
      (invite.maxUses !== null && invite.usedCount >= invite.maxUses)
    ) {
      return c.json({ ok: false, error: { code: "INVITE_UNAVAILABLE", message: "这个暗号已不可使用" } }, 400);
    }

    const redemptionId = crypto.randomUUID();
    await db.batch([
      db.insert(inviteRedemptions).values({
        id: redemptionId,
        inviteCodeId: invite.id,
        userId: auth.user.id,
        redeemedAt: now,
      }),
      db.insert(accessGrants).values({
        userId: auth.user.id,
        status: "active",
        source: "invite_code",
        grantedAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: accessGrants.userId,
        set: { status: "active", revokedAt: null, updatedAt: now },
      }),
      db.insert(appProfiles).values({
        userId: auth.user.id,
        displayName: auth.user.name,
        role: "user",
        onboardingStep: "connect_provider",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing(),
      db.update(inviteCodes).set({ usedCount: invite.usedCount + 1, updatedAt: now }).where(eq(inviteCodes.id, invite.id)),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: auth.user.id,
        action: "access.invite_redeemed",
        targetType: "invite_code",
        targetId: invite.id,
        safeMetadataJson: JSON.stringify({ redemptionId }),
        createdAt: now,
      }),
    ]);

    return c.json({ ok: true, data: { activated: true, alreadyActivated: false } });
  });
