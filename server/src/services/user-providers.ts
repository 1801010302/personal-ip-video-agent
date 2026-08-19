import { and, eq } from "drizzle-orm";
import { db, secret } from "edgespark";
import { accessGrants, providerCredentials } from "@defs";
import { decryptCredential } from "./crypto";

export class AppRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503 = 400,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "AppRequestError";
  }
}

export async function requireActiveAccess(userId: string): Promise<void> {
  const [grant] = await db
    .select({ status: accessGrants.status, expiresAt: accessGrants.expiresAt })
    .from(accessGrants)
    .where(eq(accessGrants.userId, userId))
    .limit(1);
  if (grant?.status !== "active" || (grant.expiresAt !== null && grant.expiresAt <= Date.now())) {
    throw new AppRequestError("ACCESS_REQUIRED", "请先使用暗号或年费会员开通账号", 403);
  }
}

export async function getUserProviderKey(
  userId: string,
  provider: "deepseek" | "chuanshenyun" | "imagegen",
): Promise<string> {
  const masterKey = secret.get("USER_CREDENTIAL_MASTER_KEY");
  if (!masterKey) throw new AppRequestError("NOT_CONFIGURED", "密钥保险箱尚未配置", 503);
  const [credential] = await db
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, provider)))
    .limit(1);
  if (!credential || credential.status !== "connected") {
    throw new AppRequestError(
      "PROVIDER_NOT_CONNECTED",
      provider === "deepseek" ? "请先在 API 设置中连接 DeepSeek" : provider === "imagegen" ? "请先在 API 设置中连接 ImageGen" : "请先在 API 设置中连接益民居·数字人",
      422,
    );
  }
  return decryptCredential(
    credential.ciphertext,
    credential.iv,
    masterKey,
    `${userId}:${provider}:${credential.keyVersion}`,
  );
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function asAppError(error: unknown): AppRequestError {
  if (error instanceof AppRequestError) return error;
  return new AppRequestError("INTERNAL_ERROR", "服务暂时不可用，请稍后重试", 503);
}
