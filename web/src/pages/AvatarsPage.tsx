import { Bot, CheckCircle2, Film, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { assetStatusLabel, finalizeProviderAsset, uploadProviderAsset, type UploadStage } from "@/lib/media";
import type { ProviderAsset } from "@/types/api";

export function AvatarsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ProviderAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems(await apiRequest<ProviderAsset[]>("/api/assets?kind=template")); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "数字人模板加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!items.some((item) => !["ready", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => void load(), 3500);
    return () => window.clearInterval(timer);
  }, [items, load]);
  const upload = async (file: File) => {
    setUploading(true); setError("");
    try { await uploadProviderAsset(file, "template", setUploadStage); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "上传失败"); }
    finally { setUploading(false); setUploadStage(null); await load(); }
  };
  const recoverUpload = async (assetId: string) => {
    setRecovering(assetId); setError("");
    try { await finalizeProviderAsset(assetId); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "重新确认失败"); }
    finally { setRecovering(null); }
  };
  const stageLabel = uploadStage === "validating" ? "正在检查文件" : uploadStage === "hashing" ? "正在校验完整性" : uploadStage === "preparing" ? "正在准备上传" : uploadStage === "uploading" ? "正在安全上传" : uploadStage === "finalizing" ? "正在转交并检测" : "上传形象视频";
  return <section className="workspace-page">
    <header className="page-heading"><div><span className="eyebrow"><Bot size={15} /> DIGITAL AVATARS</span><h1>数字人形象</h1><p>上传你的数字人模板视频，益民居·数字人检测完成后即可反复生成。</p></div><button className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? <span className="spinner" /> : <Upload size={17} />}{stageLabel}</button><input hidden ref={inputRef} type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></header>
    <div className="info-strip"><Film size={18} /><span>视频最长 2 分钟、最大 500MB。文件先安全直传临时存储，再流式转交益民居·数字人；完成后临时文件会自动删除。</span><button className="icon-button" onClick={() => void load()} aria-label="刷新"><RefreshCw size={17} /></button></div>
    {error && <div className="form-message error" role="alert">{error}</div>}
    {loading ? <div className="panel-loading"><span className="spinner" />加载模板…</div> : items.length === 0 ? <div className="empty-state large"><span><Bot size={28} /></span><h2>还没有数字人形象</h2><p>先上传一段符合益民居·数字人要求的数字人模板视频。</p><button className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={17} />上传第一个形象</button></div> : <div className="asset-grid">{items.map((item) => { const orientation = item.width && item.height ? item.height > item.width ? "竖屏" : item.width > item.height ? "横屏" : "方形" : ""; const needsReselect = Boolean(item.errorMessage?.includes("重新选择文件上传") || item.errorMessage?.includes("完整的上传文件")); return <article className="asset-card" key={item.id}><div className="asset-preview avatar-preview">{item.previewUrl ? <video src={item.previewUrl} controls preload="metadata" playsInline /> : <Bot size={42} />}</div><div className="asset-card-body"><div className="asset-title-row"><h2>{item.name}</h2><span className={`state-pill ${item.status}`}>{item.status === "ready" && <CheckCircle2 size={13} />}{assetStatusLabel(item.status)}</span></div><p>{orientation ? `${orientation} · ` : ""}{item.width && item.height ? `${item.width} × ${item.height}` : "画面尺寸检测中"}{item.durationMs ? ` · ${Math.round(item.durationMs / 1000)} 秒` : ""}</p>{item.status === "uploading" && (needsReselect ? <button className="secondary-button small asset-recovery-button" disabled={uploading} onClick={() => inputRef.current?.click()}><Upload size={15} />重新选择原文件</button> : <button className="secondary-button small asset-recovery-button" disabled={recovering === item.id} onClick={() => void recoverUpload(item.id)}>{recovering === item.id ? <span className="spinner" /> : <RotateCcw size={15} />}重新确认上传</button>)}{item.errorMessage && <div className="form-message error">{item.errorMessage}</div>}</div></article>; })}</div>}
  </section>;
}
