import { CheckCircle2, Film, PlayCircle, Upload, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { TutorialVideo } from "@/types/api";

interface UploadTicket {
  id: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

async function readDurationMs(file: File): Promise<number | null> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 5000);
      video.preload = "metadata";
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null); };
      video.onerror = () => { window.clearTimeout(timer); resolve(null); };
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function directUpload(file: File, ticket: UploadTicket, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.uploadUrl);
    Object.entries(ticket.requiredHeaders).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onerror = () => reject(new Error("视频上传中断，请检查网络后重试"));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`视频直传失败（${request.status}）`));
    request.send(file);
  });
}

export function AdminTutorialVideoCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<TutorialVideo | null>(null);
  const [title, setTitle] = useState("新手教学：从想法到成片");
  const [description, setDescription] = useState("跟着视频完成第一次文案、声音克隆和数字人成片。");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try { setCurrent(await apiRequest<TutorialVideo | null>("/api/admin/tutorial-video")); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "教学视频加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    const contentType = file.type || (file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4");
    if (!["video/mp4", "video/webm"].includes(contentType)) { setError("请上传 MP4 或 WebM 格式的视频"); return; }
    if (!file.size || file.size > 2 * 1024 * 1024 * 1024) { setError("教学视频不能超过 2GB"); return; }
    setUploading(true); setProgress(0); setError(""); setSuccess(""); setStage("正在检查视频");
    try {
      const durationMs = await readDurationMs(file);
      setStage("正在准备安全上传");
      const ticket = await apiRequest<UploadTicket>("/api/admin/tutorial-video/upload-ticket", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType, sizeBytes: file.size, durationMs, title, description }),
      });
      setStage("正在直传教学视频");
      await directUpload(file, ticket, setProgress);
      setStage("正在发布新版本");
      const published = await apiRequest<TutorialVideo>(`/api/admin/tutorial-video/${ticket.id}/finalize`, { method: "POST", body: "{}" });
      setCurrent(published); setProgress(100); setSuccess("新手教学视频已发布，用户端立即生效");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "教学视频上传失败");
    } finally {
      setUploading(false); setStage("");
    }
  };

  return <article className="admin-tutorial-card">
    <div className="admin-tutorial-copy">
      <div className="card-head"><div><span className="card-kicker">ONBOARDING VIDEO</span><h2>新手教学视频</h2></div><span className="tutorial-admin-icon"><Video size={23} /></span></div>
      <p>上传后会自动替换用户端当前的新手教学。建议使用 16:9 MP4，最大 2GB。</p>
      <div className="tutorial-admin-fields">
        <label className="field">视频标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></label>
        <label className="field">视频简介<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} /></label>
      </div>
      {uploading && <div className="tutorial-upload-progress" role="status"><div><span>{stage}</span><strong>{progress}%</strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>}
      {error && <div className="form-message error" role="alert">{error}</div>}
      {success && <div className="form-message success" aria-live="polite"><CheckCircle2 size={16} />{success}</div>}
      <button className="primary-button tutorial-upload-button" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? <span className="spinner" /> : <Upload size={18} />}{uploading ? "正在上传…" : current ? "替换教学视频" : "上传教学视频"}</button>
      <input ref={inputRef} hidden type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
    </div>
    <div className="admin-tutorial-preview">
      {loading ? <div className="tutorial-preview-empty"><span className="spinner" />正在加载…</div> : current ? <><video src={current.playbackUrl} controls preload="metadata" playsInline /><div><span><PlayCircle size={15} />当前线上版本</span><strong>{current.title}</strong><small>{new Date(current.updatedAt).toLocaleString("zh-CN")}</small></div></> : <div className="tutorial-preview-empty"><Film size={34} /><strong>尚未上传教学视频</strong><span>上传后这里会显示预览</span></div>}
    </div>
  </article>;
}
