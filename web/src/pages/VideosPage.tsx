import { Clapperboard, Clock3, Download, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { jobLabel } from "@/lib/media";
import type { GenerationJob } from "@/types/api";

export function VideosPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<GenerationJob[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems((await apiRequest<GenerationJob[]>("/api/jobs")).filter((job) => ["digital_human", "video_packaging"].includes(job.type))); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "成片任务加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [load]);
  const download = async (job: GenerationJob) => {
    setBusy(job.id); setError("");
    try {
      const result = await apiRequest<{ url: string }>(`/api/jobs/${job.id}/download`, { method: "POST", body: "{}" });
      const link = document.createElement("a"); link.href = result.url; link.download = `${job.name}.mp4`; link.rel = "noreferrer"; document.body.appendChild(link); link.click(); link.remove();
    } catch (err) { setError(err instanceof Error ? err.message : "下载失败"); }
    finally { setBusy(null); }
  };
  const retry = async (job: GenerationJob) => {
    setBusy(job.id); setError("");
    try { await apiRequest(`/api/jobs/${job.id}/retry`, { method: "POST", body: "{}" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "重试失败"); }
    finally { setBusy(null); }
  };
  return <section className="workspace-page"><header className="page-heading"><div><span className="eyebrow"><Clapperboard size={15} /> VIDEO LIBRARY</span><h1>成片库</h1><p>查看基础数字人和字幕包装成片的独立进度，失败任务可单独重试。</p></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={17} />刷新状态</button></header><div className="video-retention-notice" role="note"><Clock3 size={22} /><div><strong>请尽快下载：原片和最终成片仅保存 7 天</strong><p>从视频生成完成起计算，7 天后服务器自动删除，平台不再保留。</p></div></div>{error && <div className="form-message error" role="alert">{error}</div>}{items.length === 0 ? <div className="empty-state large"><span><Clapperboard size={28} /></span><h2>还没有数字人成片</h2><p>在六步创作工作台中完成文案、声音、形象与包装选择后，任务会出现在这里。</p><button className="primary-button" onClick={() => onNavigate("/create")}>开始一条新视频</button></div> : <div className="job-table"><div className="job-table-head"><span>任务</span><span>状态</span><span>积分</span><span>时间</span><span>操作</span></div>{items.map((job) => { const expired = job.outputStatus === "expired"; return <article className="job-table-row" key={job.id}><div className="job-name"><span className="row-icon"><Clapperboard size={18} /></span><div><strong>{job.name}</strong><small>{job.type === "video_packaging" ? "字幕包装任务" : job.providerJobId || "等待云端任务 ID"}</small>{job.status === "completed" && <small className={expired ? "expired-copy" : "retention-copy"}>{expired ? "已按7天规则从服务器删除" : job.expiresAt ? `${new Date(job.expiresAt).toLocaleString("zh-CN")} 到期` : "仅保存7天，请尽快下载"}</small>}</div></div><span className={`state-pill ${expired ? "expired" : job.status}`}>{jobLabel(expired ? "expired" : job.status)}</span><span>{job.type === "video_packaging" ? "—" : job.finalPoints ?? job.estimatedPoints ?? "-"}</span><span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span><div className="row-actions">{job.status === "completed" && !expired && <button className="primary-button small" disabled={busy === job.id} onClick={() => void download(job)}><Download size={15} />下载</button>}{expired && <span className="expired-action">已自动清理</span>}{["failed", "cancelled"].includes(job.status) && <button className="secondary-button small" disabled={busy === job.id} onClick={() => void retry(job)}><RotateCcw size={15} />重试</button>}{!["completed", "failed", "cancelled"].includes(job.status) && <span className="progress-inline"><span className="spinner" />云端处理中</span>}</div>{job.errorMessage && <div className="job-error">{job.errorMessage}</div>}</article>; })}</div>}</section>;
}
