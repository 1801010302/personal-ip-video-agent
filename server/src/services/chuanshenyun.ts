const DEFAULT_API_BASE = "https://szr.yiminju.xyz/api/v1";

interface ProviderEnvelope<T> {
  ok?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  requestId?: string;
}

export interface ProviderBalance {
  availablePoints: number | null;
  frozenPoints: number | null;
  requestId: string | null;
}

export class ProviderRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, status: number, code: string, requestId?: string) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.code = code;
    this.requestId = requestId ?? null;
  }
}

export async function providerRequest<T>(
  apiKey: string,
  apiBase: string,
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ProviderRequestError("暂时无法连接益民居·数字人，请稍后重试", 503, "PROVIDER_UNAVAILABLE");
  }
  const payload = await response.json().catch(() => null) as ProviderEnvelope<T> | T | null;
  const envelope = payload as ProviderEnvelope<T> | null;
  if (response.ok && envelope?.ok !== false) {
    return (envelope && "data" in envelope && envelope.data !== undefined ? envelope.data : payload) as T;
  }
  throw new ProviderRequestError(
    envelope?.error?.message || `益民居·数字人请求失败（${response.status}）`,
    response.status,
    envelope?.error?.code || "PROVIDER_ERROR",
    envelope?.requestId,
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getProviderApiBase(value: string | null): string {
  const base = (value || DEFAULT_API_BASE).replace(/\/+$/u, "");
  if (base !== DEFAULT_API_BASE) {
    throw new Error("益民居·数字人 API 基础地址与受信任地址不一致");
  }
  return base;
}

export async function testProviderConnection(
  apiKey: string,
  apiBase: string,
): Promise<ProviderBalance> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new ProviderRequestError("暂时无法连接益民居·数字人，请稍后重试", 503, "PROVIDER_UNAVAILABLE");
  }

  const payload = (await response.json().catch(() => null)) as ProviderEnvelope<Record<string, unknown>> | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    const unauthorized = response.status === 401 || response.status === 403;
    throw new ProviderRequestError(
      unauthorized ? "这个 API Key 无效或缺少 balance:read 权限" : "益民居·数字人连接测试失败",
      response.status,
      payload?.error?.code || (unauthorized ? "INVALID_API_KEY" : "PROVIDER_ERROR"),
      payload?.requestId,
    );
  }

  return {
    availablePoints: numberOrNull(payload.data.availablePoints ?? payload.data.availableFen),
    frozenPoints: numberOrNull(payload.data.frozenPoints ?? payload.data.frozenFen),
    requestId: payload.requestId ?? null,
  };
}
