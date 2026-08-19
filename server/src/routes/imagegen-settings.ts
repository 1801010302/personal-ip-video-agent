import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, secret } from "edgespark";
import { auth } from "edgespark/http";
import { auditLogs, providerCredentials } from "@defs";
import { decryptCredential, encryptCredential } from "../services/crypto";
import { requireActiveAccess } from "../services/user-providers";

function view(credential: { keyPrefix: string; keyLast4: string; status: string; availablePoints: number | null; verifiedAt: number } | undefined) {
  return credential ? {
    connected: credential.status === "connected",
    status: credential.status,
    maskedKey: `${credential.keyPrefix}••••••••${credential.keyLast4}`,
    availablePoints: credential.availablePoints,
    verifiedAt: credential.verifiedAt,
  } : { connected: false, status: "not_connected" };
}

function fail(error: unknown) {
  return { status: 400 as const, body: { ok: false as const, error: { code: "INVALID_REQUEST", message: "无法保存这个 ImageGen API Key" } } };
}

export const imageGenSettingsRoutes = new Hono()
  .get("/api/settings/imagegen", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try { await requireActiveAccess(auth.user.id); } catch { return c.json({ ok: false, error: { code: "ACCESS_REQUIRED" } }, 403); }
    const [credential] = await db.select({
      keyPrefix: providerCredentials.keyPrefix,
      keyLast4: providerCredentials.keyLast4,
      status: providerCredentials.status,
      availablePoints: providerCredentials.availablePoints,
      verifiedAt: providerCredentials.verifiedAt,
    }).from(providerCredentials).where(and(eq(providerCredentials.userId, auth.user.id), eq(providerCredentials.provider, "imagegen"))).limit(1);
    return c.json({ ok: true, data: view(credential) });
  })
  .post("/api/settings/imagegen/test-and-save", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try { await requireActiveAccess(auth.user.id); } catch { return c.json({ ok: false, error: { code: "ACCESS_REQUIRED" } }, 403); }
    const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
    if (!masterKey) return c.json({ ok: false, error: { code: "NOT_CONFIGURED", message: "密钥保险箱尚未配置" } }, 503);
    const body = await c.req.json<{ apiKey?: string }>().catch(() => ({} as { apiKey?: string }));
    const apiKey = (body.apiKey || "").trim();
    if (apiKey.length < 16 || apiKey.length > 512) return c.json({ ok: false, error: { code: "INVALID_API_KEY", message: "请输入完整的 ImageGen API Key" } }, 400);
    try {
      const now = Date.now();
      const keyVersion = 1;
      const encrypted = await encryptCredential(apiKey, masterKey, `${auth.user.id}:imagegen:${keyVersion}`);
      const keyPrefix = apiKey.slice(0, Math.min(8, Math.max(4, apiKey.length - 4)));
      const keyLast4 = apiKey.slice(-4);
      await db.batch([
        db.insert(providerCredentials).values({
          id: crypto.randomUUID(), userId: auth.user.id, provider: "imagegen",
          ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyVersion, keyPrefix, keyLast4,
          status: "connected", availablePoints: null, frozenPoints: null,
          verifiedAt: now, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [providerCredentials.userId, providerCredentials.provider],
          set: { ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyVersion, keyPrefix, keyLast4, status: "connected", availablePoints: null, verifiedAt: now, updatedAt: now },
        }),
        db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: auth.user.id, action: "provider.connected", targetType: "provider", targetId: "imagegen", safeMetadataJson: JSON.stringify({ keyLast4, verification: "deferred_to_domestic_worker" }), createdAt: now }),
      ]);
      return c.json({ ok: true, data: { ...view({ keyPrefix, keyLast4, status: "connected", availablePoints: null, verifiedAt: now }), models: [], currency: "CNY", verification: "deferred" } });
    } catch (error) { const response = fail(error); return c.json(response.body, response.status); }
  })
  .post("/api/settings/imagegen/retest", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try { await requireActiveAccess(auth.user.id); } catch { return c.json({ ok: false, error: { code: "ACCESS_REQUIRED" } }, 403); }
    const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
    if (!masterKey) return c.json({ ok: false, error: { code: "NOT_CONFIGURED" } }, 503);
    const [credential] = await db.select().from(providerCredentials).where(and(eq(providerCredentials.userId, auth.user.id), eq(providerCredentials.provider, "imagegen"))).limit(1);
    if (!credential) return c.json({ ok: false, error: { code: "NOT_CONNECTED", message: "请先填写 ImageGen API Key" } }, 404);
    await decryptCredential(credential.ciphertext, credential.iv, masterKey, `${auth.user.id}:imagegen:${credential.keyVersion}`);
    const now = Date.now();
    await db.update(providerCredentials).set({ status: "connected", verifiedAt: now, updatedAt: now }).where(eq(providerCredentials.id, credential.id));
    return c.json({ ok: true, data: { ...view({ ...credential, status: "connected", verifiedAt: now }), models: [], currency: "CNY", verification: "deferred" } });
  })
  .delete("/api/settings/imagegen", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try { await requireActiveAccess(auth.user.id); } catch { return c.json({ ok: false, error: { code: "ACCESS_REQUIRED" } }, 403); }
    await db.delete(providerCredentials).where(and(eq(providerCredentials.userId, auth.user.id), eq(providerCredentials.provider, "imagegen")));
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: auth.user.id, action: "provider.disconnected", targetType: "provider", targetId: "imagegen", safeMetadataJson: "{}", createdAt: Date.now() });
    return c.json({ ok: true, data: { connected: false, status: "not_connected" } });
  });
