import { ArrowLeft, ArrowRight, CheckCircle2, Clapperboard, FileText, GraduationCap, Mic2, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { TutorialVideo } from "@/types/api";

export function TutorialPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [video, setVideo] = useState<TutorialVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void apiRequest<TutorialVideo | null>("/api/tutorial-video")
      .then(setVideo)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "教学视频加载失败"))
      .finally(() => setLoading(false));
  }, []);

  return <section className="tutorial-page">
    <header className="tutorial-heading"><button className="secondary-button" onClick={() => onNavigate("/dashboard")}><ArrowLeft size={16} />返回工作台</button><div><span className="eyebrow"><GraduationCap size={16} /> NEW USER GUIDE</span><h1>{video?.title || "新手教学：从想法到成片"}</h1><p>{video?.description || "跟着教学完成你的第一条数字人口播视频。"}</p></div></header>
    {error && <div className="form-message error" role="alert">{error}</div>}
    {loading ? <div className="tutorial-loading"><span className="spinner" />正在加载教学视频…</div> : video ? <div className="tutorial-layout">
      <div className="tutorial-player-shell"><div className="tutorial-player-top"><span><PlayCircle size={16} />新手必看</span><small>点击播放，按自己的节奏学习</small></div><video src={video.playbackUrl} controls preload="metadata" playsInline aria-label={video.title} /></div>
      <aside className="tutorial-outline"><span className="card-kicker">YOU WILL LEARN</span><h2>看完你会掌握</h2><div className="tutorial-outline-list"><div><span><FileText size={18} /></span><p><strong>整理口播文案</strong><small>从零散想法生成可直接使用的文案</small></p></div><div><span><Mic2 size={18} /></span><p><strong>建立声音档案</strong><small>上传、校对并保存自己的声音</small></p></div><div><span><Clapperboard size={18} /></span><p><strong>生成数字人成片</strong><small>选择形象并持续查看云端进度</small></p></div></div><button className="primary-button full" onClick={() => onNavigate("/create")}><CheckCircle2 size={17} />我学会了，开始创作<ArrowRight size={16} /></button></aside>
    </div> : <div className="tutorial-empty"><span><GraduationCap size={32} /></span><h2>教学视频正在准备中</h2><p>管理员上传后会自动出现在这里。你也可以先进入创作工作台体验。</p><button className="primary-button" onClick={() => onNavigate("/create")}>先开始创作<ArrowRight size={16} /></button></div>}
  </section>;
}
