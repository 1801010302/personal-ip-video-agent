import { ArrowRight, Bot, FileText, GraduationCap, KeyRound, Mic2, Play, PlayCircle, Sparkles, Video } from "lucide-react";
import type { AccessStatus } from "@/types/api";
import { StatusBadge } from "@/components/StatusBadge";

export function DashboardPage({ access, onNavigate }: { access: AccessStatus; onNavigate: (path: string) => void }) {
  const ready = access.providerConnected;
  const accessLabel = access.accessSource === "invite_code" || access.accessSource === "admin_bootstrap" ? "暗号免费资格" : "年费会员";
  return (
    <div className="page page-dashboard">
      <section className="page-heading dashboard-heading">
        <div><span className="eyebrow"><Sparkles size={15} /> 创作工作台</span><h1>今天想讲点什么？</h1><p>把零散想法丢进来，我们把它整理成口播稿，再生成一条像你亲自说的视频。</p></div>
        <button className="primary-button" onClick={() => onNavigate("/create")}>
          <FileText size={18} />开始一条新视频
        </button>
      </section>

      <button className="dashboard-tutorial-feature" onClick={() => onNavigate("/tutorial")}>
        <span className="dashboard-tutorial-icon"><GraduationCap size={28} /></span>
        <span className="dashboard-tutorial-copy"><small>NEW · 新手必看</small><strong>第一次使用？先看新手教学</strong><em>从零散想法、声音档案到数字人成片，跟着视频完整走一遍。</em></span>
        <span className="dashboard-tutorial-action"><PlayCircle size={20} />立即观看<ArrowRight size={17} /></span>
      </button>

      {(!access.providerConnected || !access.deepseekConnected) && (
        <section className="setup-banner">
          <div className="setup-banner-icon"><KeyRound size={22} /></div>
          <div><strong>按创作方式配置需要的 API</strong><p>AI 写稿需要 DeepSeek；生成声音和数字人需要益民居·数字人。已有文稿可以直接开始。</p></div>
          <button className="secondary-button" onClick={() => onNavigate("/settings/provider")}>去配置 <ArrowRight size={17} /></button>
        </section>
      )}

      <section className="dashboard-grid">
        <article className="hero-card">
          <div className="hero-card-copy">
            <span className="card-kicker">最快创作路径</span><h2>一句想法，四步变成短视频</h2>
            <div className="flow-steps"><span><FileText size={18} /> 输入想法</span><i /><span><Sparkles size={18} /> 生成文案</span><i /><span><Mic2 size={18} /> 克隆声音</span><i /><span><Video size={18} /> 合成视频</span></div>
            <button className="primary-button" onClick={() => onNavigate("/create")}>开始创作 <ArrowRight size={17} /></button>
          </div>
          <div className="video-stage" aria-label="视频生成流程示意">
            <div className="stage-avatar"><Bot size={46} /><span><Play size={20} fill="currentColor" /></span></div>
            <div className="stage-caption">“你只管表达，剩下的交给 AI。”</div>
          </div>
        </article>

        <article className="status-card">
          <div className="card-head"><div><span className="card-kicker">准备状态</span><h2>按需完成配置</h2></div><StatusBadge tone={ready ? "success" : "warning"}>{ready ? "可生成成片" : "可先写稿"}</StatusBadge></div>
          <div className="check-list">
            <button className="check-row completed" onClick={() => onNavigate("/account")}><span><strong>1</strong></span><div><b>{accessLabel}</b><small>{access.accessExpiresAt ? `有效至 ${new Date(access.accessExpiresAt).toLocaleDateString("zh-CN")}` : "平台使用资格已生效"}</small></div><ArrowRight size={17} /></button>
            <button className={`check-row ${access.deepseekConnected ? "completed" : ""}`} onClick={() => onNavigate("/settings/provider")}><span><strong>2</strong></span><div><b>连接 DeepSeek API</b><small>{access.deepseekConnected ? "连接正常，可以 AI 生成口播文案" : "仅在选择 AI 帮我写时需要"}</small></div><ArrowRight size={17} /></button>
            <button className={`check-row ${access.providerConnected ? "completed" : ""}`} onClick={() => onNavigate("/settings/provider")}><span><strong>3</strong></span><div><b>连接益民居·数字人 API</b><small>{access.providerConnected ? "连接正常，可生成声音与数字人" : "进入声音与数字人生成时需要"}</small></div><ArrowRight size={17} /></button>
          </div>
        </article>
      </section>

      <section className="section-block">
        <div className="section-title"><div><span className="card-kicker">最近项目</span><h2>继续上一次创作</h2></div></div>
        <div className="empty-state"><span><FileText size={27} /></span><h3>还没有创作项目</h3><p>可以让 AI 整理零散想法，也可以直接粘贴已经写好的口播稿。</p><button className="secondary-button" onClick={() => onNavigate("/create")}>创建第一个项目</button></div>
      </section>
    </div>
  );
}
