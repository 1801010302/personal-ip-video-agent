import { apiRequest } from "./api";
import type { ProviderAsset } from "@/types/api";

interface UploadTicket {
  assetId: string;
  uploadRequired: boolean;
  uploadUrl?: string;
  method: string;
  headers: Record<string, string>;
}

export type UploadStage = "validating" | "hashing" | "preparing" | "uploading" | "finalizing";

async function contentSha256(file: File): Promise<string | undefined> {
  // Web Crypto requires an in-memory buffer. Hash every allowed audio file and
  // reasonably sized templates; larger videos can still use the provider's
  // documented hash-optional upload path without risking a browser crash.
  if (file.size > 128 * 1024 * 1024) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mediaDuration(file: File, kind: "audio" | "template"): Promise<number | null> {
  const element = document.createElement(kind === "template" ? "video" : "audio");
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 5000);
      element.preload = "metadata";
      element.onloadedmetadata = () => { window.clearTimeout(timer); resolve(Number.isFinite(element.duration) ? element.duration : null); };
      element.onerror = () => { window.clearTimeout(timer); resolve(null); };
      element.src = url;
    });
  } finally {
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
  }
}

async function validateProviderFile(file: File, kind: "audio" | "template") {
  const maxBytes = kind === "template" ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
  if (!file.size || file.size > maxBytes) throw new Error(`${kind === "template" ? "数字人视频" : "参考音频"}不能超过 ${kind === "template" ? 500 : 100}MB`);
  const duration = await mediaDuration(file, kind);
  if (duration && kind === "audio" && duration < 5) throw new Error("参考音频至少需要 5 秒");
  if (duration && duration > (kind === "template" ? 120 : 300)) throw new Error(`${kind === "template" ? "数字人视频最长 2 分钟" : "参考音频最长 5 分钟"}`);
}

export async function finalizeProviderAsset(assetId: string): Promise<ProviderAsset> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await apiRequest<ProviderAsset>(`/api/assets/${assetId}/finalize`, { method: "POST", body: "{}" });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("素材确认失败");
}

export async function uploadProviderAsset(
  file: File,
  kind: "audio" | "template",
  onStage?: (stage: UploadStage) => void,
): Promise<ProviderAsset> {
  onStage?.("validating");
  await validateProviderFile(file, kind);
  onStage?.("hashing");
  const sha256 = await contentSha256(file);
  onStage?.("preparing");
  const ticket = await apiRequest<UploadTicket>("/api/assets/upload-ticket", {
    method: "POST",
    body: JSON.stringify({ kind, filename: file.name, contentType: file.type || (kind === "template" ? "video/mp4" : "audio/mpeg"), sizeBytes: file.size, ...(sha256 ? { contentSha256: sha256 } : {}) }),
  });
  if (ticket.uploadRequired) {
    if (!ticket.uploadUrl) throw new Error("益民居·数字人未返回上传地址");
    onStage?.("uploading");
    let response: Response;
    try {
      response = await fetch(ticket.uploadUrl, { method: ticket.method || "PUT", headers: ticket.headers, body: file });
    } catch {
      throw new Error("文件上传连接中断，请检查网络后重新选择文件；已经完成的数字人不会受影响。");
    }
    if (!response.ok) throw new Error(`素材直传失败（${response.status}）`);
  }
  onStage?.("finalizing");
  try {
    return await finalizeProviderAsset(ticket.assetId);
  } catch {
    throw new Error("文件已上传，但确认检测没有完成。请在列表中点击“重新确认上传”。");
  }
}

export function jobLabel(status: string): string {
  return ({ submitting: "提交中", created: "准备中", waiting_source: "等待基础成片", queued: "排队中", processing: "处理中", generating: "生成中", fetching: "获取成片", completed: "已完成", succeeded: "已完成", expired: "已过期", failed: "失败", cancelled: "已取消" } as Record<string, string>)[status] || status;
}

export function jobProgress(status: string, reportedProgress: number): number {
  if (["completed", "succeeded"].includes(status)) return 100;
  const fallback = ({ submitting: 5, created: 10, waiting_source: 4, queued: 20, processing: 55, generating: 70, fetching: 88 } as Record<string, number>)[status] ?? 8;
  const progress = Number.isFinite(reportedProgress) && reportedProgress > 0 ? reportedProgress : fallback;
  return Math.min(99, Math.max(0, progress));
}

export function assetStatusLabel(status: string): string {
  return ({ uploading: "上传中", processing: "检测中", probing: "检测中", ready: "已就绪", needs_review: "待校对", failed: "失败" } as Record<string, string>)[status] || status;
}
