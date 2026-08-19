import { client } from "@/lib/edgespark";
import type { ApiErrorBody, ApiSuccess } from "@/types/api";

export class AppApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;

  constructor(message: string, code: string, status: number, requestId?: string | null) {
    super(message);
    this.name = "AppApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId ?? null;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await client.api.fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as ApiSuccess<T> | ApiErrorBody | null;
  if (!response.ok || !payload?.ok) {
    const errorPayload = payload && !payload.ok ? payload.error : null;
    throw new AppApiError(
      errorPayload?.message || "服务暂时不可用，请稍后重试",
      errorPayload?.code || "REQUEST_FAILED",
      response.status,
      errorPayload?.requestId,
    );
  }
  return payload.data;
}
