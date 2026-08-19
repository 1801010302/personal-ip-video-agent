import { ArrowRight, FileText, FolderKanban, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { jobLabel } from "@/lib/media";
import type { ProjectRecord } from "@/types/api";

export function ProjectsPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [items, setItems] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems(await apiRequest<ProjectRecord[]>("/api/projects")); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "项目加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="workspace-page"><header className="page-heading"><div><span className="eyebrow"><FolderKanban size={15} /> PROJECTS</span><h1>我的项目</h1><p>每一条零散想法、现成原稿、文案版本、克隆声音和数字人成片都会串在同一个项目里。</p></div><button className="primary-button" onClick={() => onNavigate("/create")}><Plus size={17} />新建口播项目</button></header>{error && <div className="form-message error">{error}</div>}{loading ? <div className="panel-loading"><span className="spinner" />加载项目…</div> : items.length === 0 ? <div className="empty-state large"><span><FolderKanban size={28} /></span><h2>你的第一个口播项目还没开始</h2><p>让 DeepSeek 整理零散想法，或直接粘贴一份完整口播稿。</p><button className="primary-button" onClick={() => onNavigate("/create")}><Plus size={17} />开始创作</button></div> : <div className="project-grid">{items.map((item) => <button key={item.id} className="project-card" onClick={() => onNavigate(`/create?project=${item.id}`)}><div className="project-card-top"><span className="project-icon"><FileText size={21} /></span><div className="project-card-labels"><span className={`source-pill ${item.latestScript?.source || "draft"}`}>{item.latestScript?.source === "manual" ? "用户原稿" : item.latestScript?.source === "deepseek" ? "AI生成" : "未定稿"}</span><span className={`state-pill ${item.latestJobStatus || item.status}`}>{item.latestJobStatus ? jobLabel(item.latestJobStatus) : item.status === "script_ready" ? "文案已就绪" : "草稿"}</span></div></div><h2>{item.title}</h2><p>{item.latestScript?.content || item.rawIdeas}</p><footer><span>{new Date(item.updatedAt).toLocaleString("zh-CN")} · {item.jobCount || 0} 个任务</span><ArrowRight size={17} /></footer></button>)}</div>}</section>;
}
