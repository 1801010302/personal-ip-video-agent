import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, secret, vars } from "edgespark";
import { auth } from "edgespark/http";
import { accessGrants, auditLogs, providerCredentials } from "@defs";
import { decryptCredential, encryptCredential } from "../services/crypto";
import {
  getProviderApiBase,
  ProviderRequestError,
  testProviderConnection,
} from "../services/chuanshenyun";
import {
  DeepSeekRequestError,
  getDeepSeekApiBase,
  testDeepSeekConnection,
} from "../services/deepseek";

function maskedKey(prefix: string, last4: string): string {
  return `${prefix}••••••••${last4}`;
}

function providerErrorResponse(error: unknown): {
  status: 400 | 401 | 403 | 502 | 503;
  body: { ok: false; error: { code: string; message: string; requestId?: string | null } };
} {
  if (error instanceof ProviderRequestError) {
    const status = error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 503 ? 503 : 502;
    return {
      status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, requestId: error.requestId },
      },
    };
  }
  return {
    status: 400,
    body: { ok: false, error: { code: "INVALID_REQUEST", message: "无法保存这个 API Key" } },
  };
}

function deepSeekErrorResponse(error: unknown): {
  status: 400 | 401 | 403 | 502 | 503;
  body: { ok: false; error: { code: string; message: string } };
} {
  if (error instanceof DeepSeekRequestError) {
    const status = error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 503 ? 503 : 502;
    return { status, body: { ok: false, error: { code: error.code, message: error.message } } };
  }
  return { status: 400, body: { ok: false, error: { code: "INVALID_REQUEST", message: "无法保存这个 DeepSeek API Key" } } };
}

async function hasActiveAccess(userId: string): Promise<boolean> {
  const [grant] = await db
    .select({ status: accessGrants.status, expiresAt: accessGrants.expiresAt })
    .from(accessGrants)
    .where(eq(accessGrants.userId, userId))
    .limit(1);
  return grant?.status === "active" && (grant.expiresAt === null || grant.expiresAt > Date.now());
}

export const settingsRoutes = new Hono()
  .get("/api/settings/provider", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ACCESS_REQUIRED", message: "请先使用暗号或年费会员开通账号" } }, 403);
    }

    const [credential] = await db
      .select({
        keyPrefix: providerCredentials.keyPrefix,
        keyLast4: providerCredentials.keyLast4,
        status: providerCredentials.status,
        availablePoints: providerCredentials.availablePoints,
        frozenPoints: providerCredentials.frozenPoints,
        verifiedAt: providerCredentials.verifiedAt,
      })
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.userId, auth.user.id),
          eq(providerCredentials.provider, "chuanshenyun"),
        ),
      )
      .limit(1);

    return c.json({
      ok: true,
      data: credential
        ? {
            connected: credential.status === "connected",
            status: credential.status,
            maskedKey: maskedKey(credential.keyPrefix, credential.keyLast4),
            availablePoints: credential.availablePoints,
            frozenPoints: credential.frozenPoints,
            verifiedAt: credential.verifiedAt,
          }
        : { connected: false, status: "not_connected" },
    });
  })
  .post("/api/settings/provider/test-and-save", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ACCESS_REQUIRED", message: "请先使用暗号或年费会员开通账号" } }, 403);
    }

    const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
    if (!masterKey) {
      return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "密钥保险箱尚未配置" } }, 503);
    }

    const body: { apiKey?: string } = await c.req
      .json<{ apiKey?: string }>()
      .catch(() => ({}));
    const apiKey = (body.apiKey || "").trim();
    if (apiKey.length < 16 || apiKey.length > 512) {
      return c.json({ ok: false, error: { code: "INVALID_API_KEY", message: "请输入完整的益民居·数字人 API Key" } }, 400);
    }

    try {
      const apiBase = getProviderApiBase(vars.get("CHUANSHENYUN_API_BASE"));
      const balance = await testProviderConnection(apiKey, apiBase);
      const now = Date.now();
      const keyVersion = 1;
      const additionalData = `${auth.user.id}:chuanshenyun:${keyVersion}`;
      const encrypted = await encryptCredential(apiKey, masterKey, additionalData);
      const keyPrefix = apiKey.slice(0, Math.min(8, Math.max(4, apiKey.length - 4)));
      const keyLast4 = apiKey.slice(-4);

      await db.batch([
        db.insert(providerCredentials).values({
          id: crypto.randomUUID(),
          userId: auth.user.id,
          provider: "chuanshenyun",
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          keyVersion,
          keyPrefix,
          keyLast4,
          status: "connected",
          availablePoints: balance.availablePoints,
          frozenPoints: balance.frozenPoints,
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [providerCredentials.userId, providerCredentials.provider],
          set: {
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            keyVersion,
            keyPrefix,
            keyLast4,
            status: "connected",
            availablePoints: balance.availablePoints,
            frozenPoints: balance.frozenPoints,
            verifiedAt: now,
            updatedAt: now,
          },
        }),
        db.insert(auditLogs).values({
          id: crypto.randomUUID(),
          actorUserId: auth.user.id,
          action: "provider.connected",
          targetType: "provider",
          targetId: "chuanshenyun",
          safeMetadataJson: JSON.stringify({ keyLast4, requestId: balance.requestId }),
          createdAt: now,
        }),
      ]);

      return c.json({
        ok: true,
        data: {
          connected: true,
          status: "connected",
          maskedKey: maskedKey(keyPrefix, keyLast4),
          availablePoints: balance.availablePoints,
          frozenPoints: balance.frozenPoints,
          verifiedAt: now,
        },
      });
    } catch (error) {
      const response = providerErrorResponse(error);
      return c.json(response.body, response.status);
    }
  })
  .post("/api/settings/provider/retest", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ACCESS_REQUIRED", message: "请先使用暗号或年费会员开通账号" } }, 403);
    }
    const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
    if (!masterKey) return c.json({ ok: false, error: { code: "NOT_CONFIGURED" } }, 503);

    const [credential] = await db.select().from(providerCredentials).where(
      and(
        eq(providerCredentials.userId, auth.user.id),
        eq(providerCredentials.provider, "chuanshenyun"),
      ),
    ).limit(1);
    if (!credential) {
      return c.json({ ok: false, error: { code: "NOT_CONNECTED", message: "请先填写 API Key" } }, 404);
    }

    try {
      const additionalData = `${auth.user.id}:chuanshenyun:${credential.keyVersion}`;
      const apiKey = await decryptCredential(
        credential.ciphertext,
        credential.iv,
        masterKey,
        additionalData,
      );
      const balance = await testProviderConnection(
        apiKey,
        getProviderApiBase(vars.get("CHUANSHENYUN_API_BASE")),
      );
      const now = Date.now();
      await db.update(providerCredentials).set({
        status: "connected",
        availablePoints: balance.availablePoints,
        frozenPoints: balance.frozenPoints,
        verifiedAt: now,
        updatedAt: now,
      }).where(eq(providerCredentials.id, credential.id));

      return c.json({
        ok: true,
        data: {
          connected: true,
          status: "connected",
          maskedKey: maskedKey(credential.keyPrefix, credential.keyLast4),
          availablePoints: balance.availablePoints,
          frozenPoints: balance.frozenPoints,
          verifiedAt: now,
        },
      });
    } catch (error) {
      const now = Date.now();
      await db.update(providerCredentials).set({ status: "error", updatedAt: now }).where(eq(providerCredentials.id, credential.id));
      const response = providerErrorResponse(error);
      return c.json(response.body, response.status);
    }
  })
  .delete("/api/settings/provider", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ACCESS_REQUIRED", message: "请先使用暗号或年费会员开通账号" } }, 403);
    }

    await db.delete(providerCredentials).where(
      and(
        eq(providerCredentials.userId, auth.user.id),
        eq(providerCredentials.provider, "chuanshenyun"),
      ),
    );
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: auth.user.id,
      action: "provider.disconnected",
      targetType: "provider",
      targetId: "chuanshenyun",
      safeMetadataJson: "{}",
      createdAt: Date.now(),
    });

    return c.json({ ok: true, data: { connected: false, status: "not_connected" } });
  })
  .get("/api/settings/deepseek", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ACCESS_REQUIRED", message: "请先使用暗号或年费会员开通账号" } }, 403);
    }

    const [credential] = await db.select({
      keyPrefix: providerCredentials.keyPrefix,
      keyLast4: providerCredentials.keyLast4,
      status: providerCredentials.status,
      verifiedAt: providerCredentials.verifiedAt,
    }).from(providerCredentials).where(and(
      eq(providerCredentials.userId, auth.user.id),
      eq(providerCredentials.provider, "deepseek"),
    )).limit(1);

    return c.json({
      ok: true,
      data: credential ? {
        connected: credential.status === "connected",
        status: credential.status,
        maskedKey: maskedKey(credential.keyPrefix, credential.keyLast4),
        verifiedAt: credential.verifiedAt,
      } : { connected: false, status: "not_connected" },
    });
  })
  .post("/api/settings/deepseek/test-and-save", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) {
      return c.json({ ok: false, error: { code: "ACCESS_REQUIRED", message: "请先使用暗号或年费会员开通账号" } }, 403);
    }
    const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
    if (!masterKey) return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "密钥保险箱尚未配置" } }, 503);

    const body: { apiKey?: string } = await c.req.json<{ apiKey?: string }>().catch(() => ({}));
    const apiKey = (body.apiKey || "").trim();
    if (apiKey.length < 16 || apiKey.length > 512) {
      return c.json({ ok: false, error: { code: "INVALID_API_KEY", message: "请输入完整的 DeepSeek API Key" } }, 400);
    }

    try {
      const result = await testDeepSeekConnection(apiKey, getDeepSeekApiBase(vars.get("DEEPSEEK_API_BASE")));
      const now = Date.now();
      const keyVersion = 1;
      const encrypted = await encryptCredential(apiKey, masterKey, `${auth.user.id}:deepseek:${keyVersion}`);
      const keyPrefix = apiKey.slice(0, Math.min(8, Math.max(4, apiKey.length - 4)));
      const keyLast4 = apiKey.slice(-4);
      await db.batch([
        db.insert(providerCredentials).values({
          id: crypto.randomUUID(), userId: auth.user.id, provider: "deepseek",
          ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyVersion, keyPrefix, keyLast4,
          status: "connected", availablePoints: null, frozenPoints: null, verifiedAt: now,
          createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [providerCredentials.userId, providerCredentials.provider],
          set: { ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyVersion, keyPrefix, keyLast4, status: "connected", verifiedAt: now, updatedAt: now },
        }),
        db.insert(auditLogs).values({
          id: crypto.randomUUID(), actorUserId: auth.user.id, action: "provider.connected",
          targetType: "provider", targetId: "deepseek",
          safeMetadataJson: JSON.stringify({ keyLast4, models: result.models.slice(0, 10) }), createdAt: now,
        }),
      ]);
      return c.json({ ok: true, data: { connected: true, status: "connected", maskedKey: maskedKey(keyPrefix, keyLast4), verifiedAt: now, models: result.models } });
    } catch (error) {
      const response = deepSeekErrorResponse(error);
      return c.json(response.body, response.status);
    }
  })
  .post("/api/settings/deepseek/retest", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) return c.json({ ok: false, error: { code: "ACCESS_REQUIRED" } }, 403);
    const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
    if (!masterKey) return c.json({ ok: false, error: { code: "NOT_CONFIGURED" } }, 503);
    const [credential] = await db.select().from(providerCredentials).where(and(
      eq(providerCredentials.userId, auth.user.id), eq(providerCredentials.provider, "deepseek"),
    )).limit(1);
    if (!credential) return c.json({ ok: false, error: { code: "NOT_CONNECTED", message: "请先填写 DeepSeek API Key" } }, 404);

    try {
      const apiKey = await decryptCredential(credential.ciphertext, credential.iv, masterKey, `${auth.user.id}:deepseek:${credential.keyVersion}`);
      const result = await testDeepSeekConnection(apiKey, getDeepSeekApiBase(vars.get("DEEPSEEK_API_BASE")));
      const now = Date.now();
      await db.update(providerCredentials).set({ status: "connected", verifiedAt: now, updatedAt: now }).where(eq(providerCredentials.id, credential.id));
      return c.json({ ok: true, data: { connected: true, status: "connected", maskedKey: maskedKey(credential.keyPrefix, credential.keyLast4), verifiedAt: now, models: result.models } });
    } catch (error) {
      await db.update(providerCredentials).set({ status: "error", updatedAt: Date.now() }).where(eq(providerCredentials.id, credential.id));
      const response = deepSeekErrorResponse(error);
      return c.json(response.body, response.status);
    }
  })
  .delete("/api/settings/deepseek", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    if (!(await hasActiveAccess(auth.user.id))) return c.json({ ok: false, error: { code: "ACCESS_REQUIRED" } }, 403);
    await db.delete(providerCredentials).where(and(
      eq(providerCredentials.userId, auth.user.id), eq(providerCredentials.provider, "deepseek"),
    ));
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(), actorUserId: auth.user.id, action: "provider.disconnected",
      targetType: "provider", targetId: "deepseek", safeMetadataJson: "{}", createdAt: Date.now(),
    });
    return c.json({ ok: true, data: { connected: false, status: "not_connected" } });
  });
