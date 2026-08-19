import {
  Activity, AlertTriangle, BarChart3, Check, CheckCircle2, Clock3, Copy,
  ListVideo, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  TicketCheck, UserPlus, UsersRound, XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminTutorialVideoCard } from "@/components/AdminTutorialVideoCard";
import { apiRequest } from "@/lib/api";
import { jobLabel, jobProgress } from "@/lib/media";
import type { AdminOperations, InviteCodeRecord } from "@/types/api";

export type AdminTab = "overview" | "users" | "jobs" | "settings";

function formatDate(value: number | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

function formatInviteDate(value: number | null): string {
  if (!value) return "长期有效";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(value);
}

function formatDuration(createdAt: number, updatedAt: number): string {
  const seconds = Math.max(0, Math.round((updatedAt - createdAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分${seconds % 60 ? ` ${seconds % 60} 秒` : "钟"}`;
}

const jobTypeNames: Record<string, string> = {
  voice_clone: "声音克隆",
  digital_human: "数字人成片",
  video_packaging: "标题字幕包装",
  cover_image: "封面生成",
};

const providerNames: Record<string, string> = { deepseek: "DeepSeek", chuanshenyun: "益民居·数字人", imagegen: "ImageGen" };

export function AdminInvitesPage({ activeTab, onTabChange }: { activeTab: AdminTab; onTabChange: (tab: AdminTab) => void }) {
  const [operations, setOperations] = useState<AdminOperations | null>(null);
  const [invites, setInvites] = useState<InviteCodeRecord[]>([]);
  const [query, setQuery] = useState("");
  const [userAccess, setUserAccess] = useState("all");
  const [jobStatus, setJobStatus] = useState("all");
  const [jobType, setJobType] = useState("all");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresOn, setExpiresOn] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    setError("");
    try {
      const [nextOperations, inviteResult] = await Promise.all([
        apiRequest<AdminOperations>("/api/admin/operations"),
        apiRequest<{ invites: InviteCodeRecord[] }>("/api/admin/invite-codes"),
      ]);
      setOperations(nextOperations);
      setInvites(inviteResult.invites);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "运营数据加载失败");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const users = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (operations?.users || []).filter((user) => {
      const matchesQuery = !keyword || user.email.toLowerCase().includes(keyword) || user.name.toLowerCase().includes(keyword);
      const matchesAccess = userAccess === "all" || (userAccess === "active" ? user.accessStatus === "active" : user.accessStatus !== "active");
      return matchesQuery && matchesAccess;
    });
  }, [operations, query, userAccess]);

  const jobs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (operations?.jobs || []).filter((job) => {
      const matchesQuery = !keyword || job.name.toLowerCase().includes(keyword) || (job.userEmail || "").toLowerCase().includes(keyword) || (job.projectTitle || "").toLowerCase().includes(keyword);
      const matchesStatus = jobStatus === "all" || (jobStatus === "failed" ? ["failed", "cancelled"].includes(job.status) : jobStatus === "active" ? !job.terminal : job.status === jobStatus);
      return matchesQuery && matchesStatus && (jobType === "all" || job.type === jobType);
    });
  }, [jobStatus, jobType, operations, query]);

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setGeneratedCode(""); setCopied(false); setSubmitting(true);
    try {
      const result = await apiRequest<{ code: string; invite: InviteCodeRecord }>("/api/admin/invite-codes", { method: "POST", body: JSON.stringify({ label, maxUses: maxUses ? Number(maxUses) : null, expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).getTime() : null }) });
      setGeneratedCode(result.code); setInvites((current) => [result.invite, ...current]); setLabel(""); setMaxUses("1"); setExpiresOn("");
    } catch (createError) { setError(createError instanceof Error ? createError.message : "暗号生成失败"); }
    finally { setSubmitting(false); }
  };

  const copyCode = async () => { await navigator.clipboard.writeText(generatedCode); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };

  const toggleStatus = async (invite: InviteCodeRecord) => {
    setError(""); setUpdatingId(invite.id);
    try {
      const result = await apiRequest<{ invite: InviteCodeRecord }>(`/api/admin/invite-codes/${invite.id}`, { method: "PATCH", body: JSON.stringify({ status: invite.status === "active" ? "disabled" : "active" }) });
      setInvites((current) => current.map((item) => item.id === invite.id ? result.invite : item));
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "暗号状态更新失败"); }
    finally { setUpdatingId(""); }
  };

  const maxDaily = Math.max(1, ...(operations?.daily.map((item) => Math.max(item.jobs, item.users)) || [1]));
  const failedJobs = operations?.jobs.filter((job) => ["failed", "cancelled"].includes(job.status)).slice(0, 5) || [];
  const openTab = (tab: AdminTab) => { onTabChange(tab); setQuery(""); };

  return (
    <section className="page admin-operations-page">
      <div className="page-heading admin-page-heading">
        <div><span className="eyebrow"><ShieldCheck size={16} /> 运营管理中心</span><h1>管理后台</h1><p>查看用户增长、API 配置、生成任务和失败问题，及时掌握平台运行情况。</p></div>
        <button className="secondary-button" type="button" onClick={() => void loadData(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} />{refreshing ? "刷新中…" : "刷新数据"}</button>
      </div>

      <nav className="admin-tabs" aria-label="管理后台栏目">
        {([
          ["overview", BarChart3, "运营概览"], ["users", UsersRound, "用户管理"], ["jobs", ListVideo, "生成记录"], ["settings", Settings2, "内容与暗号"],
        ] as const).map(([id, Icon, text]) => <button type="button" key={id} className={activeTab === id ? "active" : ""} onClick={() => openTab(id)}><Icon size={17} />{text}</button>)}
      </nav>

      {error && <div className="form-message error" role="alert">{error}</div>}
      {loading ? <div className="ops-loading"><span className="spinner" />正在汇总运营数据…</div> : !operations ? <div className="empty-state"><AlertTriangle size={28} /><h3>暂时无法读取运营数据</h3><button className="secondary-button" onClick={() => void loadData()}>重新加载</button></div> : <>
        {activeTab === "overview" && <div className="ops-overview">
          <div className="ops-metric-grid">
            <MetricCard icon={<UsersRound />} label="累计注册用户" value={operations.metrics.totalUsers} note={`今日新增 ${operations.metrics.todayUsers}`} tone="purple" />
            <MetricCard icon={<UserPlus />} label="已开通使用" value={operations.metrics.activeAccessUsers} note={`暗号用户 ${operations.metrics.invitedUsers}`} tone="blue" />
            <MetricCard icon={<ListVideo />} label="近 7 天任务" value={operations.metrics.sevenDayJobs} note={`今日提交 ${operations.metrics.todayJobs}`} tone="orange" />
            <MetricCard icon={<CheckCircle2 />} label="近 7 天成功率" value={`${operations.metrics.sevenDaySuccessRate}%`} note={`累计成功 ${operations.metrics.completedJobs}`} tone="green" />
          </div>

          <div className="ops-health-grid queue">
            <div><span className="ops-health-icon active"><ListVideo size={19} /></span><p><small>标题字幕视频排队</small><strong>{operations.metrics.packagingQueuedJobs}</strong></p><em>{operations.metrics.packagingProcessingJobs} 个渲染中</em></div>
            <div><span className="ops-health-icon"><BarChart3 size={19} /></span><p><small>封面图片排队</small><strong>{operations.metrics.coverQueuedJobs}</strong></p><em>{operations.metrics.coverProcessingJobs} 个生成中</em></div>
            <div><span className="ops-health-icon active"><Activity size={19} /></span><p><small>数字人生成中</small><strong>{operations.metrics.digitalHumanActiveJobs}</strong></p><em>益民居·数字人任务</em></div>
            <div><span className="ops-health-icon danger"><XCircle size={19} /></span><p><small>今日失败</small><strong>{operations.metrics.todayFailedJobs}</strong></p><em>{operations.metrics.oldestQueuedAt ? `最长等待 ${formatDuration(operations.metrics.oldestQueuedAt, Date.now())}` : "当前无积压"}</em></div>
          </div>

          <div className="ops-dashboard-grid">
            <article className="ops-panel ops-trend-panel">
              <div className="ops-panel-head"><div><span className="card-kicker">7 DAY TREND</span><h2>注册与生成趋势</h2></div><span>北京时间</span></div>
              <div className="ops-trend" aria-label="近七天注册与生成趋势">
                {operations.daily.map((day) => <div className="ops-day" key={day.date}><div className="ops-bars"><i style={{ height: `${Math.max(4, day.jobs / maxDaily * 100)}%` }} title={`生成 ${day.jobs}`} /><i style={{ height: `${Math.max(4, day.users / maxDaily * 100)}%` }} title={`注册 ${day.users}`} /></div><strong>{day.date.slice(5)}</strong><small>{day.jobs}任务 · {day.users}人</small></div>)}
              </div>
              <div className="ops-legend"><span><i />生成任务</span><span><i />新增用户</span></div>
            </article>

            <article className="ops-panel">
              <div className="ops-panel-head"><div><span className="card-kicker">ISSUES</span><h2>最近失败问题</h2></div><button className="text-button" onClick={() => openTab("jobs")}>查看全部</button></div>
              {failedJobs.length ? <div className="ops-issue-list">{failedJobs.map((job) => <button key={job.id} type="button" onClick={() => { openTab("jobs"); setJobStatus("failed"); setQuery(job.userEmail || job.name); }}><span><XCircle size={16} /></span><div><strong>{job.name}</strong><small>{job.userEmail || "未知用户"} · {formatDate(job.createdAt)}</small><p>{job.errorMessage || job.errorCode || "上游服务返回失败"}</p></div></button>)}</div> : <div className="ops-good-state"><CheckCircle2 size={28} /><strong>最近没有失败任务</strong><span>平台运行正常</span></div>}
            </article>
          </div>

          <article className="ops-panel">
            <div className="ops-panel-head"><div><span className="card-kicker">RECENT USERS</span><h2>最近注册用户</h2></div><button className="text-button" onClick={() => openTab("users")}>查看全部</button></div>
            <div className="ops-compact-users">{operations.users.slice(0, 6).map((user) => <div key={user.id}><span className="ops-avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{user.name || "未填写昵称"}</strong><small>{user.email}</small></div><span className={`ops-state ${user.accessStatus === "active" ? "success" : "muted"}`}>{user.accessStatus === "active" ? "已开通" : "待开通"}</span><time>{formatDate(user.createdAt)}</time></div>)}</div>
          </article>
        </div>}

        {activeTab === "users" && <div className="ops-list-page">
          <div className="ops-toolbar"><label className="ops-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" /></label><select aria-label="筛选用户权限" value={userAccess} onChange={(event) => setUserAccess(event.target.value)}><option value="all">全部权限状态</option><option value="active">已开通</option><option value="inactive">待开通 / 已停用</option></select><span>共 {users.length} 位用户</span></div>
          <article className="ops-table ops-users-table"><div className="ops-table-head"><span>用户</span><span>注册与登录</span><span>使用权限</span><span>API 配置</span><span>创作数据</span></div>{users.map((user) => <div className="ops-table-row" key={user.id}><div className="ops-user-identity"><span className="ops-avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span><p><strong>{user.name || "未填写昵称"}{user.role === "admin" && <em>管理员</em>}</strong><small>{user.email}</small></p></div><div className="ops-time-stack"><span>注册 {formatDate(user.createdAt)}</span><small>最近登录 {formatDate(user.lastLoginAt)}</small></div><div><span className={`ops-state ${user.accessStatus === "active" ? "success" : "muted"}`}>{user.accessStatus === "active" ? "已开通" : user.accessStatus === "pending" ? "待开通" : "已停用"}</span><small className="ops-cell-note">{user.accessSource === "invite_code" ? "暗号免费" : user.accessSource || "未激活"}</small></div><div className="ops-provider-list">{["deepseek", "chuanshenyun", "imagegen"].map((provider) => { const connected = user.providers.some((item) => item.provider === provider && item.status === "connected"); return <span key={provider} className={connected ? "connected" : ""}>{connected ? <Check size={11} /> : null}{providerNames[provider]}</span>; })}</div><div className="ops-creation-metrics"><strong>{user.projectCount}<small>项目</small></strong><strong>{user.completedJobCount}<small>成功</small></strong><strong className={user.failedJobCount ? "danger" : ""}>{user.failedJobCount}<small>失败</small></strong></div></div>)}</article>
          {!users.length && <div className="empty-state"><UsersRound size={28} /><h3>没有符合条件的用户</h3><p>换一个关键词或筛选条件试试。</p></div>}
        </div>}

        {activeTab === "jobs" && <div className="ops-list-page">
          <div className="ops-toolbar"><label className="ops-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、用户或项目" /></label><select aria-label="筛选任务状态" value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">成功</option><option value="failed">失败</option></select><select aria-label="筛选任务类型" value={jobType} onChange={(event) => setJobType(event.target.value)}><option value="all">全部类型</option>{Object.entries(jobTypeNames).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><span>共 {jobs.length} 条</span></div>
          <article className="ops-table ops-jobs-table"><div className="ops-table-head"><span>任务与用户</span><span>类型</span><span>状态</span><span>消耗 / 进度</span><span>创建时间 / 总耗时</span></div>{jobs.map((job) => <div className="ops-table-row" key={job.id}><div className="ops-job-identity"><span className={`ops-job-icon ${["failed", "cancelled"].includes(job.status) ? "failed" : job.status === "completed" ? "completed" : ""}`}>{["failed", "cancelled"].includes(job.status) ? <XCircle size={17} /> : job.status === "completed" ? <CheckCircle2 size={17} /> : <Activity size={17} />}</span><p><strong>{job.name}</strong><small>{job.userEmail || "未知用户"}{job.projectTitle ? ` · ${job.projectTitle}` : ""}</small>{job.errorMessage && <em>{job.errorMessage}</em>}</p></div><span className="ops-job-type">{jobTypeNames[job.type] || job.type}</span><span className={`ops-state ${job.status === "completed" ? "success" : ["failed", "cancelled"].includes(job.status) ? "danger" : "active"}`}>{jobLabel(job.status)}</span><div className="ops-progress-cell"><span>{job.finalPoints ?? job.estimatedPoints ?? "—"} 积分</span><div><i style={{ width: `${jobProgress(job.status, job.progress)}%` }} /></div></div><div className="ops-time-stack"><span>{formatDate(job.createdAt)}</span><small>{job.terminal ? `总耗时 ${formatDuration(job.createdAt, job.updatedAt)}` : `已等待/运行 ${formatDuration(job.createdAt, Date.now())}`}</small></div></div>)}</article>
          {!jobs.length && <div className="empty-state"><ListVideo size={28} /><h3>没有符合条件的生成记录</h3><p>换一个关键词或筛选条件试试。</p></div>}
        </div>}

        {activeTab === "settings" && <div className="ops-settings-tab">
          <AdminTutorialVideoCard />
          <div className="admin-section-heading"><span className="card-kicker">ACCESS CODES</span><h2>暗号管理</h2><p>为获准使用平台的用户生成暗号。暗号明文只在创建后显示一次，请立即复制发送。</p></div>
          <div className="admin-invite-grid"><article className="settings-card invite-create-card"><div className="card-head"><div><span className="card-kicker">NEW ACCESS CODE</span><h2>生成新暗号</h2></div><span className="invite-card-icon"><Plus size={21} /></span></div><form className="form-stack invite-form" onSubmit={createInvite}><label className="field"><span>用途备注</span><div className="input-wrap"><TicketCheck size={18} /><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：8 月内测用户" required minLength={2} maxLength={80} /></div></label><div className="invite-form-row"><label className="field"><span>最多可用次数</span><div className="input-wrap"><UsersRound size={18} /><input type="number" inputMode="numeric" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} min={1} max={10000} placeholder="留空则不限" /></div></label><label className="field"><span>有效期至（可选）</span><div className="input-wrap"><Clock3 size={18} /><input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></div></label></div><button className="primary-button full" type="submit" disabled={submitting}>{submitting ? <span className="spinner" /> : <Plus size={18} />}{submitting ? "正在生成…" : "生成新暗号"}</button></form>{generatedCode && <div className="generated-code" role="status"><div><span><Check size={15} /> 已生成，仅本次显示</span><strong>{generatedCode}</strong></div><button className="secondary-button" type="button" onClick={copyCode}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "已复制" : "复制暗号"}</button></div>}</article><aside className="invite-security-card"><ShieldCheck size={23} /><div><strong>暗号不会明文保存</strong><p>系统只存储不可逆摘要。关闭当前提示后，无法再次查看原暗号，只能重新生成。</p></div></aside></div>
          <article className="section-block invite-list-card"><div className="section-title"><div><span className="card-kicker">ACCESS HISTORY</span><h2>已创建的暗号</h2></div><span className="invite-count">{invites.length} 个</span></div>{invites.length === 0 ? <div className="empty-state"><span><TicketCheck size={27} /></span><h3>还没有暗号</h3><p>创建第一个暗号后，它的使用次数和状态会显示在这里。</p></div> : <div className="invite-list">{invites.map((invite) => { const expired = invite.expiresAt !== null && invite.expiresAt <= Date.now(); const exhausted = invite.maxUses !== null && invite.usedCount >= invite.maxUses; const stateLabel = expired ? "已过期" : exhausted ? "已用完" : invite.status === "active" ? "可使用" : "已停用"; return <div className="invite-row" key={invite.id}><span className={`invite-status-dot ${stateLabel === "可使用" ? "active" : ""}`} /><div className="invite-row-main"><strong>{invite.label}</strong><small>创建于 {formatInviteDate(invite.createdAt)}</small></div><div className="invite-metric"><small>使用次数</small><strong>{invite.usedCount} / {invite.maxUses ?? "不限"}</strong></div><div className="invite-metric"><small>有效期</small><strong>{formatInviteDate(invite.expiresAt)}</strong></div><span className={`invite-state ${stateLabel === "可使用" ? "active" : ""}`}>{stateLabel}</span><button className="text-button invite-toggle" type="button" onClick={() => toggleStatus(invite)} disabled={updatingId === invite.id || expired || exhausted}>{updatingId === invite.id ? "处理中…" : invite.status === "active" ? "停用" : "重新启用"}</button></div>; })}</div>}</article>
        </div>}
      </>}
    </section>
  );
}

function MetricCard({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: number | string; note: string; tone: string }) {
  return <article className="ops-metric-card"><span className={`ops-metric-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}
