import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { runCoverImageTask } from "./imagegen";
import { transcribe } from "./transcript";
import type { ClaimedCoverJob, ClaimedJob, RenderProps, TemplateId } from "./types";
import { applyScriptPhraseBreaks } from "./video/caption-pages";

const execFileAsync = promisify(execFile);
interface Backend { name: string; apiBase: string; token: string }
const edgeSparkBackend: Backend = { name: "edgespark", apiBase: (process.env.EDGESPARK_API_BASE || "https://your-app-domain.example").replace(/\/+$/u, ""), token: process.env.RENDER_WORKER_TOKEN || "" };
const miaoxiangToken = process.env.MIAOXIANG_RENDER_WORKER_TOKEN || "";
const miaoxiangApiBase = (process.env.MIAOXIANG_API_BASE || "").replace(/\/+$/u, "");
const miaoxiangBackend: Backend | null = miaoxiangToken && miaoxiangApiBase ? { name: "miaoxiang", apiBase: miaoxiangApiBase, token: miaoxiangToken } : null;
const renderBackends = [edgeSparkBackend, ...(miaoxiangBackend ? [miaoxiangBackend] : [])];
const workerId = process.env.RENDER_WORKER_ID || "volcano-render-1";
const workRoot = process.env.WORK_DIR || "/var/lib/personal-ip-render";
const python = process.env.FUNASR_PYTHON || "python3";
const pollMs = Math.max(2000, Number(process.env.RENDER_POLL_INTERVAL_MS || 5000));
const workerConcurrency = Math.max(1, Math.min(4, Math.floor(Number(process.env.RENDER_CONCURRENCY || 1))));
const cleanupIntervalMs = Math.max(15 * 60_000, Number(process.env.VIDEO_CLEANUP_INTERVAL_MS || 60 * 60_000));
const entryPoint = resolve(fileURLToPath(new URL("./index.ts", import.meta.url)));

if (!edgeSparkBackend.token) throw new Error("RENDER_WORKER_TOKEN is required");

async function api<T>(backend: Backend, pathname: string, body: unknown): Promise<T> {
  const response = await fetch(`${backend.apiBase}${pathname}`, { method: "POST", headers: { Authorization: `Bearer ${backend.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const payload = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || `Worker API ${response.status}`);
  return payload.data as T;
}

async function progress(backend: Backend, id: string, slotId: string, value: number, stage: string) {
  await api(backend, `/api/webhooks/render-worker/jobs/${id}/progress`, { workerId: slotId, progress: value, stage, leaseSeconds: 900 });
}

async function probe(input: string) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "json", input]);
  const stream = (JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number; duration?: string }> }).streams?.[0];
  if (!stream?.width || !stream.height) throw new Error("无法读取视频尺寸");
  return { width: stream.width, height: stream.height, durationMs: Math.max(1000, Math.round(Number(stream.duration || 0) * 1000)) };
}

async function download(url: string, path: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!response.ok) throw new Error(`下载源视频失败：${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function processJob(backend: Backend, job: ClaimedJob, slotId: string) {
  const dir = join(workRoot, job.id);
  const publicDir = join(dir, "public");
  const input = join(dir, "input.mp4");
  const wav = join(dir, "audio.wav");
  const transcriptJson = join(dir, "transcript.json");
  const output = join(dir, "output.mp4");
  await rm(dir, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });
  let completing = false;
  try {
    await progress(backend, job.id, slotId, 10, "download");
    await download(job.inputUrl, input);
    const metadata = await probe(input);
    const requested = job.request.orientation || "auto";
    const orientation = requested === "auto" ? (metadata.height >= metadata.width ? "portrait" : "landscape") : requested;
    await progress(backend, job.id, slotId, 22, "transcribe");
    await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: 20 * 60_000 });
    const transcript = await transcribe(wav, transcriptJson, python);
    await copyFile(input, join(publicDir, "input.mp4"));
    await progress(backend, job.id, slotId, 42, "bundle");
    const serveUrl = await bundle({ entryPoint, publicDir, webpackOverride: (config) => config });
    const captions = job.request.script ? applyScriptPhraseBreaks(transcript.captions, job.request.script) : transcript.captions;
    const props: RenderProps = {
      videoSrc: "input.mp4",
      coreTitle: job.request.coreTitle || "精彩内容",
      templateId: (job.request.templateId || "impact-yellow") as TemplateId,
      captions,
      durationMs: metadata.durationMs,
      orientation,
      subtitlesEnabled: job.request.subtitlesEnabled !== false,
      subtitleScale: Math.max(0.75, Math.min(1.35, Number(job.request.subtitleScale || 1))),
      subtitlePosition: job.request.subtitlePosition || "bottom",
    };
    const browserExecutable = process.env.CHROME_EXECUTABLE || undefined;
    const chromeMode = browserExecutable ? "chrome-for-testing" as const : undefined;
    const composition = await selectComposition({ serveUrl, id: "PackagedVideo", inputProps: props, browserExecutable, chromeMode });
    await progress(backend, job.id, slotId, 50, "render");
    let lastReportedProgress = 50;
    await renderMedia({ serveUrl, composition, codec: "h264", outputLocation: output, inputProps: props, browserExecutable, chromeMode, concurrency: 1, crf: 20, onProgress: ({ progress: renderProgress }) => {
      const value = 50 + Math.floor(renderProgress * 42);
      if (value >= lastReportedProgress + 3) {
        lastReportedProgress = value;
        void progress(backend, job.id, slotId, value, "render").catch(() => undefined);
      }
    } });
    await progress(backend, job.id, slotId, 94, "upload");
    const bytes = await readFile(output);
    const upload = await fetch(job.outputUrl, { method: "PUT", headers: job.outputHeaders, body: bytes, signal: AbortSignal.timeout(20 * 60_000) });
    if (!upload.ok) throw new Error(`上传包装成片失败：${upload.status}`);
    completing = true;
    await api(backend, `/api/webhooks/render-worker/jobs/${job.id}/complete`, { workerId: slotId, outputPath: job.request.outputPath, durationMs: metadata.durationMs, width: orientation === "portrait" ? 1080 : 1920, height: orientation === "portrait" ? 1920 : 1080, transcript: transcript.text, captions: transcript.captions.slice(0, 2000) });
  } catch (error) {
    if (!completing) await api(backend, `/api/webhooks/render-worker/jobs/${job.id}/fail`, { workerId: slotId, code: "RENDER_FAILED", message: error instanceof Error ? error.message : "字幕包装失败" }).catch(() => undefined);
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processCoverJob(job: ClaimedCoverJob, slotId: string) {
  try {
    const result = await runCoverImageTask(job, async ({ providerJobId, progress: value }) => {
      await api(edgeSparkBackend, `/api/webhooks/render-worker/cover-jobs/${job.id}/progress`, { workerId: slotId, providerJobId, progress: value, leaseSeconds: 900 });
    });
    await api(edgeSparkBackend, `/api/webhooks/render-worker/cover-jobs/${job.id}/complete`, { workerId: slotId, ...result });
  } catch (error) {
    const coded = error as Error & { code?: string };
    await api(edgeSparkBackend, `/api/webhooks/render-worker/cover-jobs/${job.id}/fail`, {
      workerId: slotId,
      code: coded.code || "IMAGEGEN_FAILED",
      message: coded.message || "封面生成失败",
    }).catch(() => undefined);
    throw error;
  }
}

await mkdir(workRoot, { recursive: true });
async function runSlot(index: number) {
  const slotId = workerConcurrency === 1 ? workerId : `${workerId}-${index + 1}`;
  let nextBackend = index % renderBackends.length;
  for (;;) {
    let handled = false;
    for (let offset = 0; offset < renderBackends.length; offset += 1) {
      const backendIndex = (nextBackend + offset) % renderBackends.length;
      const backend = renderBackends[backendIndex];
      try {
        const job = await api<ClaimedJob | null>(backend, "/api/webhooks/render-worker/claim", { workerId: slotId, leaseSeconds: 900 });
        if (!job) continue;
        nextBackend = (backendIndex + 1) % renderBackends.length;
        await processJob(backend, job, slotId);
        handled = true;
        break;
      } catch (error) {
        console.error(new Date().toISOString(), slotId, backend.name, error instanceof Error ? error.message : "worker error");
      }
    }
    if (!handled) await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
}

async function runCoverSlot() {
  const slotId = `${workerId}-cover`;
  for (;;) {
    try {
      const job = await api<ClaimedCoverJob | null>(edgeSparkBackend, "/api/webhooks/render-worker/cover-claim", { workerId: slotId, leaseSeconds: 900 });
      if (job) await processCoverJob(job, slotId);
      else await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    } catch (error) {
      console.error(new Date().toISOString(), slotId, error instanceof Error ? error.message : "cover worker error");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    }
  }
}

async function runCleanupLoop() {
  for (;;) {
    try {
      const result = await api<{ deleted: number; failed: number; retentionDays: number }>(edgeSparkBackend, "/api/webhooks/render-worker/cleanup", { limit: 100 });
      if (result.deleted || result.failed) console.log(new Date().toISOString(), `video cleanup: deleted=${result.deleted} failed=${result.failed} retention=${result.retentionDays}d`);
    } catch (error) {
      console.error(new Date().toISOString(), "video cleanup", error instanceof Error ? error.message : "cleanup error");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, cleanupIntervalMs));
  }
}

await Promise.all([...Array.from({ length: workerConcurrency }, (_, index) => runSlot(index)), runCoverSlot(), runCleanupLoop()]);
