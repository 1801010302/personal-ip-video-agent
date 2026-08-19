import { ArrowLeft, ArrowRight, Bot, Check, Clapperboard, ClipboardPaste, Clock3, Download, FileImage, FileText, ImagePlus, KeyRound, Lightbulb, Mic2, RefreshCw, Save, Sparkles, Subtitles, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { assetStatusLabel, jobLabel, jobProgress } from "@/lib/media";
import type { AccessStatus, CoverReferenceRecord, GenerationJob, ProjectRecord, ProviderAsset, ScriptAnalysis, ScriptVersion, VoiceProfile } from "@/types/api";

interface ProjectDetail extends ProjectRecord { scripts: ScriptVersion[]; analyses: ScriptAnalysis[]; jobs: GenerationJob[]; }
type InputMode = "ai" | "manual";
const MAX_SCRIPT_CHARS = 1300;
const steps = [{ icon: Lightbulb, label: "内容" }, { icon: FileText, label: "标题与文案" }, { icon: Mic2, label: "声音" }, { icon: Bot, label: "形象" }, { icon: WandSparkles, label: "包装" }, { icon: Clapperboard, label: "结果" }];
const toneStructures: Record<string, string> = {
  "真诚、有经验感": "经历钩子 → 问题 → 错误 → 转折 → 方法 → 建议",
  "犀利、强观点": "反常识结论 → 普遍误区 → 错误代价 → 核心观点 → 案例 → 行动方法",
  "温暖、像朋友聊天": "生活场景 → 真实情绪 → 理解 → 感受 → 温和建议 → 陪伴式结尾",
  "专业、结构清晰": "问题 → 原因 → 结论 → 分步解决 → 常见误区 → 行动清单",
};
const videoTemplates = [
  { id: "impact-yellow", name: "爆款冲击", tone: "黑黄红", sample: "强钩子、大标题、关键词跳色" },
  { id: "clean-purple", name: "简洁专业", tone: "白紫橙", sample: "干净、可信、适合经验分享" },
  { id: "brand-gradient", name: "个人品牌", tone: "紫色渐变", sample: "品牌统一、质感更强" },
  { id: "news-red", name: "热点快评", tone: "新闻红", sample: "观点鲜明、节奏紧凑" },
  { id: "knowledge-blue", name: "知识讲解", tone: "科技蓝", sample: "列表、数字、步骤更清晰" },
  { id: "minimal-white", name: "极简访谈", tone: "黑白留白", sample: "克制、高级、不抢人物" },
] as const;
const countChars = (value: string) => Array.from(value.replace(/\s/gu, "")).length;
const formatEstimate = (count: number) => { const seconds = Math.max(1, Math.round(count / 4.2)); return seconds < 60 ? `约 ${seconds} 秒` : `约 ${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : "钟"}`; };

export function CreatePage({ access, onNavigate }: { access: AccessStatus; onNavigate: (path: string) => void }) {
  const [queryProjectId] = useState(() => new URLSearchParams(window.location.search).get("project"));
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
  const [ideas, setIdeas] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("ai");
  const [manualScript, setManualScript] = useState("");
  const [title, setTitle] = useState("");
  const [coverSubtitle, setCoverSubtitle] = useState("");
  const [tone, setTone] = useState("真诚、有经验感");
  const [audience, setAudience] = useState("");
  const [duration, setDuration] = useState(60);
  const [script, setScript] = useState("");
  const [assets, setAssets] = useState<ProviderAsset[]>([]);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(true);
  const [librariesSyncing, setLibrariesSyncing] = useState(false);
  const librariesBootstrapped = useRef(false);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [coverJobs, setCoverJobs] = useState<GenerationJob[]>([]);
  const [profileId, setProfileId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [voiceJobId, setVoiceJobId] = useState<string | null>(null);
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [packagingJobId, setPackagingJobId] = useState<string | null>(null);
  const [modelVersion, setModelVersion] = useState("V2");
  const [packagingTemplate, setPackagingTemplate] = useState<(typeof videoTemplates)[number]["id"]>("impact-yellow");
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const [generateCovers, setGenerateCovers] = useState(true);
  const [coverCount, setCoverCount] = useState<1 | 2 | 3>(3);
  const [coverRatio, setCoverRatio] = useState<"9:16" | "16:9">("9:16");
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState("");
  const [referencePreviewUrl, setReferencePreviewUrl] = useState("");
  const [referenceLibrary, setReferenceLibrary] = useState<CoverReferenceRecord[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const manualCount = countChars(manualScript);
  const scriptCount = countChars(script);

  const loadLibraries = useCallback(async (refresh = false, quiet = false) => {
    if (refresh) setLibrariesSyncing(true);
    else setLibrariesLoading(true);
    try {
      const query = refresh ? "" : "?refresh=0";
      const [nextAssets, nextProfiles] = await Promise.all([apiRequest<ProviderAsset[]>(`/api/assets${query}`), apiRequest<VoiceProfile[]>(`/api/voice-profiles${query}`)]);
      setAssets(nextAssets); setProfiles(nextProfiles);
      setProfileId((current) => nextProfiles.some((item) => item.id === current && item.status === "ready") ? current : nextProfiles.find((item) => item.status === "ready")?.id || "");
      setTemplateId((current) => nextAssets.some((item) => item.id === current && item.kind === "template" && item.status === "ready") ? current : nextAssets.find((item) => item.kind === "template" && item.status === "ready")?.id || "");
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "素材加载失败");
    } finally {
      if (refresh) setLibrariesSyncing(false);
      else setLibrariesLoading(false);
    }
  }, []);

  const pollTasks = useCallback(async () => {
    if (!projectId) return;
    const requests: Promise<GenerationJob[]>[] = [apiRequest<GenerationJob[]>("/api/jobs")];
    if (access.imagegenConnected) requests.push(apiRequest<GenerationJob[]>(`/api/covers?projectId=${encodeURIComponent(projectId)}`));
    const result = await Promise.allSettled(requests);
    if (result[0].status === "fulfilled") setJobs(result[0].value);
    if (result[1]?.status === "fulfilled") setCoverJobs(result[1].value);
  }, [access.imagegenConnected, projectId]);

  const loadCoverReferences = useCallback(async () => {
    if (!access.imagegenConnected) return;
    setReferencesLoading(true);
    try { setReferenceLibrary(await apiRequest<CoverReferenceRecord[]>("/api/cover-references")); }
    catch (err) { setError(err instanceof Error ? err.message : "历史人物图片加载失败"); }
    finally { setReferencesLoading(false); }
  }, [access.imagegenConnected]);

  useEffect(() => {
    if (!queryProjectId) return;
    void (async () => {
      try {
        const detail = await apiRequest<ProjectDetail>(`/api/projects/${queryProjectId}`);
        const latestScript = detail.scripts[0]; const latestAnalysis = detail.analyses?.[0] || null;
        const savedMode: InputMode = latestScript?.source === "manual" || latestScript?.settings?.inputMode === "manual" ? "manual" : "ai";
        setInputMode(savedMode); setIdeas(detail.rawIdeas); setTitle(latestAnalysis?.coreTitle || detail.title); setCoverSubtitle(latestAnalysis?.coverSubtitle || ""); setScript(latestScript?.content || ""); setAnalysis(latestAnalysis); setJobs(detail.jobs || []);
        if (savedMode === "manual") setManualScript(latestScript?.content || detail.rawIdeas);
        const latestVoice = detail.jobs.find((job) => job.type === "voice_clone"); const latestVideo = detail.jobs.find((job) => job.type === "digital_human"); const latestPackaging = detail.jobs.find((job) => job.type === "video_packaging");
        setVoiceJobId(latestVoice?.id || null); setVideoJobId(latestVideo?.id || null); setPackagingJobId(latestPackaging?.id || null);
        if (latestVideo || latestPackaging || detail.jobs.some((job) => job.type === "cover_image")) setStep(6); else if (latestVoice?.status === "completed") setStep(4); else if (latestVoice) setStep(3); else if (latestScript) setStep(2);
      } catch (err) { setError(err instanceof Error ? err.message : "项目加载失败"); }
    })();
  }, [queryProjectId]);

  useEffect(() => {
    if (!access.providerConnected || librariesBootstrapped.current) return;
    librariesBootstrapped.current = true;
    void (async () => {
      await loadLibraries(false);
      await loadLibraries(true, true);
    })();
  }, [access.providerConnected, loadLibraries]);
  useEffect(() => { if (step === 5 && generateCovers) void loadCoverReferences(); }, [step, generateCovers, loadCoverReferences]);
  useEffect(() => {
    if (!projectId || (step < 3 && step !== 6)) return;
    void pollTasks(); const timer = window.setInterval(() => void pollTasks(), 6000); return () => window.clearInterval(timer);
  }, [projectId, step, pollTasks]);

  const voiceJob = jobs.find((job) => job.id === voiceJobId) || null;
  const videoJob = jobs.find((job) => job.id === videoJobId) || null;
  const packagingJob = jobs.find((job) => job.id === packagingJobId) || null;
  const readyProfiles = profiles.filter((item) => item.status === "ready");
  const readyTemplates = assets.filter((item) => item.kind === "template" && item.status === "ready");
  const progress = (job: GenerationJob | null) => job ? jobProgress(job.status, job.progress) : 0;

  const ensureProject = async (raw: string, nextTitle?: string) => {
    if (projectId) { await apiRequest(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ rawIdeas: raw, title: nextTitle || undefined }) }); return projectId; }
    const created = await apiRequest<ProjectRecord>("/api/projects", { method: "POST", body: JSON.stringify({ title: nextTitle || undefined, rawIdeas: raw }) });
    setProjectId(created.id); window.history.replaceState({}, "", `/create?project=${created.id}`); return created.id;
  };

  const analyze = async (id: string, versionId: string) => {
    const next = await apiRequest<ScriptAnalysis>(`/api/projects/${id}/scripts/${versionId}/analyze`, { method: "POST", body: "{}" });
    setAnalysis(next); setTitle(next.coreTitle); setCoverSubtitle(next.coverSubtitle); return next;
  };

  const generate = async () => {
    if (!ideas.trim() || !access.deepseekConnected) { setError("请填写零散想法并先连接 DeepSeek API"); return; }
    setBusy("generate"); setError(""); setSuccess("");
    try { const id = await ensureProject(ideas); const result = await apiRequest<{ project: ProjectRecord; version: ScriptVersion }>(`/api/projects/${id}/scripts/generate`, { method: "POST", body: JSON.stringify({ ideas, tone, audience, durationSeconds: duration }) }); setScript(result.version.content); await analyze(id, result.version.id); setStep(2); setSuccess("文案和核心标题已生成，你可以继续校对"); }
    catch (err) { setError(err instanceof Error ? err.message : "文案生成失败"); } finally { setBusy(""); }
  };

  const submitManual = async () => {
    const content = manualScript.trim(); if (!content || manualCount > MAX_SCRIPT_CHARS) return;
    if (!access.deepseekConnected) { setError("现成稿不会让 DeepSeek 改写，但提炼核心标题仍需连接 DeepSeek API"); return; }
    setBusy("manual"); setError("");
    try { const id = await ensureProject(content, title || undefined); const version = await apiRequest<ScriptVersion>(`/api/projects/${id}/scripts`, { method: "POST", body: JSON.stringify({ content, source: "manual", settings: { inputMode: "manual", confirmed: false, estimatedSeconds: Math.max(1, Math.round(manualCount / 4.2)) } }) }); setScript(content); await analyze(id, version.id); setStep(2); setSuccess("原稿未改写，已为你提炼核心标题和封面重点"); }
    catch (err) { setError(err instanceof Error ? err.message : "文稿保存失败"); } finally { setBusy(""); }
  };

  const saveAndAnalyze = async () => {
    if (!projectId || !script.trim() || scriptCount > MAX_SCRIPT_CHARS) return;
    setBusy("analyze"); setError("");
    try { const version = await apiRequest<ScriptVersion>(`/api/projects/${projectId}/scripts`, { method: "POST", body: JSON.stringify({ content: script, source: inputMode === "manual" ? "manual" : "deepseek", settings: { tone, audience, durationSeconds: duration, inputMode, confirmed: false } }) }); await analyze(projectId, version.id); setSuccess("已按最新文案重新提炼标题与封面重点"); }
    catch (err) { setError(err instanceof Error ? err.message : "分析失败"); } finally { setBusy(""); }
  };

  const confirmAnalysis = async () => {
    if (!projectId || !analysis || !title.trim()) return;
    setBusy("confirm"); setError("");
    try { const next = await apiRequest<ScriptAnalysis>(`/api/projects/${projectId}/analyses/${analysis.id}`, { method: "PATCH", body: JSON.stringify({ coreTitle: title, coverSubtitle, confirmed: true }) }); setAnalysis(next); setSuccess("标题已确认，现在选择声音档案"); setStep(3); }
    catch (err) { setError(err instanceof Error ? err.message : "标题保存失败"); } finally { setBusy(""); }
  };

  const cloneVoice = async () => {
    if (!profileId || !projectId) return; setBusy("voice"); setError("");
    try { const job = await apiRequest<GenerationJob>("/api/voice-clones", { method: "POST", body: JSON.stringify({ profileId, projectId, name: `${title || "口播"} · 克隆声音`, text: script, speed: 1, idempotencyKey: crypto.randomUUID() }) }); setVoiceJobId(job.id); setJobs((current) => [job, ...current]); setSuccess("声音克隆任务已提交，可以离开本页"); }
    catch (err) { setError(err instanceof Error ? err.message : "声音克隆失败"); } finally { setBusy(""); }
  };

  const uploadReference = async (file: File) => {
    if (!projectId) return; setBusy("portrait"); setError("");
    const localPreview = URL.createObjectURL(file);
    setReferencePreviewUrl(localPreview); setReferenceName(file.name);
    try {
      const ticket = await apiRequest<{ id: string; uploadUrl: string; headers: Record<string, string> }>("/api/cover-references/upload-ticket", { method: "POST", body: JSON.stringify({ projectId, filename: file.name, contentType: file.type, sizeBytes: file.size }) });
      const response = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
      if (!response.ok) throw new Error(`形象照上传失败（${response.status}）`);
      const saved = await apiRequest<CoverReferenceRecord>(`/api/cover-references/${ticket.id}/finalize`, { method: "POST", body: "{}" });
      setReferenceId(saved.id); setReferenceName(saved.filename); setReferencePreviewUrl(saved.previewUrl);
      setReferenceLibrary((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSuccess("人物形象照已保存，下次可直接从历史图库选择");
    } catch (err) { setReferencePreviewUrl(""); setReferenceName(""); setError(err instanceof Error ? err.message : "形象照上传失败"); }
    finally { URL.revokeObjectURL(localPreview); setBusy(""); }
  };

  const selectReference = (reference: CoverReferenceRecord) => {
    setReferenceId(reference.id); setReferenceName(reference.filename); setReferencePreviewUrl(reference.previewUrl);
    setSuccess("已选择历史人物形象照");
  };

  const startAll = async () => {
    if (!templateId || !voiceJobId || !projectId || !analysis) return; setBusy("all"); setError(""); setSuccess("");
    const videoPromise = apiRequest<{ videoJob: GenerationJob; packagingJob: GenerationJob | null }>("/api/videos", { method: "POST", body: JSON.stringify({ projectId, templateAssetId: templateId, voiceJobId, modelVersion, name: title || "数字人口播成片", idempotencyKey: crypto.randomUUID(), packaging: { enabled: true, templateId: packagingTemplate, orientation, coreTitle: title, script, subtitleStyle: "keyword" } }) });
    const coverPromise = generateCovers && access.imagegenConnected ? apiRequest<GenerationJob[]>("/api/covers", { method: "POST", body: JSON.stringify({ projectId, analysisId: analysis.id, referenceId, ratio: coverRatio, count: coverCount }) }) : Promise.resolve([]);
    const [videoResult, coverResult] = await Promise.allSettled([videoPromise, coverPromise]);
    if (videoResult.status === "fulfilled") { setVideoJobId(videoResult.value.videoJob.id); setPackagingJobId(videoResult.value.packagingJob?.id || null); setJobs((current) => [videoResult.value.videoJob, ...(videoResult.value.packagingJob ? [videoResult.value.packagingJob] : []), ...current]); }
    if (coverResult.status === "fulfilled") setCoverJobs(coverResult.value);
    setStep(6); setBusy("");
    if (videoResult.status === "rejected") setError(videoResult.reason instanceof Error ? videoResult.reason.message : "数字人成片提交失败"); else if (coverResult.status === "rejected") setError(`视频已开始，但封面提交失败：${coverResult.reason instanceof Error ? coverResult.reason.message : "请重试"}`); else setSuccess(`视频包装与${generateCovers ? `${coverCount}张封面` : "视频任务"}已经开始生成`);
  };

  const downloadVideo = async (job: GenerationJob) => { setBusy(`download-${job.id}`); try { const result = await apiRequest<{ url: string }>(`/api/jobs/${job.id}/download`, { method: "POST", body: "{}" }); const link = document.createElement("a"); link.href = result.url; link.download = `${job.name}.mp4`; link.click(); } catch (err) { setError(err instanceof Error ? err.message : "下载失败"); } finally { setBusy(""); } };
  const refreshCover = async (job: GenerationJob) => { setBusy(`refresh-${job.id}`); setError(""); try { const next = await apiRequest<GenerationJob>(`/api/covers/${job.id}/refresh`, { method: "POST", body: "{}" }); setCoverJobs((current) => current.map((item) => item.id === next.id ? next : item)); } catch (err) { setError(err instanceof Error ? err.message : "封面重新载入失败"); } finally { setBusy(""); } };
  const downloadCover = async (job: GenerationJob) => { setBusy(`download-cover-${job.id}`); setError(""); try { const next = await apiRequest<GenerationJob>(`/api/covers/${job.id}/refresh`, { method: "POST", body: "{}" }); setCoverJobs((current) => current.map((item) => item.id === next.id ? next : item)); const urls = Array.isArray(next.result.imageUrls) ? next.result.imageUrls as string[] : []; if (!urls[0]) throw new Error("封面文件暂时不可下载"); const link = document.createElement("a"); link.href = urls[0]; link.download = `${job.name}.png`; link.rel = "noreferrer"; link.target = "_blank"; document.body.appendChild(link); link.click(); link.remove(); } catch (err) { setError(err instanceof Error ? err.message : "封面下载失败"); } finally { setBusy(""); } };
  const retryPackaging = async (job: GenerationJob) => { setBusy(`retry-${job.id}`); setError(""); try { const next = await apiRequest<GenerationJob>(`/api/jobs/${job.id}/retry`, { method: "POST", body: "{}" }); setJobs((current) => current.map((item) => item.id === next.id ? next : item)); } catch (err) { setError(err instanceof Error ? err.message : "视频包装重试失败"); } finally { setBusy(""); } };
  const retryCover = async (job: GenerationJob) => { setBusy(`retry-${job.id}`); setError(""); try { const next = await apiRequest<GenerationJob>(`/api/covers/${job.id}/retry`, { method: "POST", body: "{}" }); setCoverJobs((current) => current.map((item) => item.id === next.id ? next : item)); } catch (err) { setError(err instanceof Error ? err.message : "封面重试失败"); } finally { setBusy(""); } };
  const librarySyncControl = <div className="library-sync-control">
    <span>{librariesSyncing ? "正在后台同步益民居·数字人…" : "已优先读取本地档案"}</span>
    <button className="secondary-button small" disabled={librariesSyncing} onClick={() => void loadLibraries(true)}>
      {librariesSyncing ? <span className="spinner" /> : <RefreshCw size={15} />}{librariesSyncing ? "同步中" : "同步最新素材"}
    </button>
  </div>;

  return <section className="creator-page">
    <header className="creator-heading"><div><span className="eyebrow"><Sparkles size={15} /> AI CREATION FLOW</span><h1>{title || "创建一条数字人口播"}</h1><p>一份文稿，同时生成带字幕包装的视频和可下载封面。</p></div>{projectId && <button className="secondary-button" onClick={() => onNavigate("/projects")}><ArrowLeft size={16} />返回项目</button>}</header>
    <nav className="stepper six" aria-label="创作步骤">{steps.map(({ icon: Icon, label }, index) => { const number = index + 1; return <button key={label} className={`${number === step ? "active" : ""} ${number < step ? "completed" : ""}`} onClick={() => number <= step && setStep(number)} disabled={number > step}><span>{number < step ? <Check size={17} /> : <Icon size={17} />}</span><b>{number}. {label}</b></button>; })}</nav>
    {error && <div className="form-message error" role="alert">{error}</div>}{success && <div className="form-message success">{success}</div>}
    <div className="creator-panel">
      {step === 1 && <div className="content-entry"><div className="creation-mode-picker"><button className={`creation-mode-card ${inputMode === "ai" ? "active" : ""}`} onClick={() => setInputMode("ai")}><span><Sparkles size={23} /></span><div><strong>我还没想好</strong><small>输入零散想法，由 DeepSeek 生成口播稿</small></div>{inputMode === "ai" && <Check size={18} />}</button><button className={`creation-mode-card ${inputMode === "manual" ? "active" : ""}`} onClick={() => setInputMode("manual")}><span><ClipboardPaste size={23} /></span><div><strong>我有现成稿</strong><small>原稿不改写，只提炼标题与包装重点</small></div>{inputMode === "manual" && <Check size={18} />}</button></div>
        {inputMode === "ai" ? <div className="creator-grid"><section><span className="card-kicker">STEP 01 · RAW IDEAS</span><h2>把脑子里的碎片倒进来</h2><label className="field">零散想法<textarea rows={12} value={ideas} onChange={(event) => setIdeas(event.target.value)} placeholder="人物、事件、观点、情绪，想到什么写什么…" /></label></section><aside className="options-card"><h2>文案偏好</h2><label className="field">口吻<select value={tone} onChange={(event) => setTone(event.target.value)}>{Object.keys(toneStructures).map((item) => <option key={item}>{item}</option>)}</select></label><div className="structure-helper"><strong>爆款结构</strong><span>{toneStructures[tone]}</span></div><label className="field">目标受众<input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="例如：想做个人 IP 的创业者" /></label><label className="field">目标时长<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[30, 60, 90, 120, 180, 240, 300].map((item) => <option key={item} value={item}>{item < 60 ? `${item} 秒` : `${item / 60} 分钟`}</option>)}</select></label><button className="primary-button full" disabled={busy === "generate" || !ideas.trim() || !access.deepseekConnected} onClick={() => void generate()}>{busy === "generate" ? <span className="spinner" /> : <Sparkles size={17} />}生成文案和核心标题</button></aside></div> : <div className="manual-entry"><div className="section-copy"><span className="card-kicker">STEP 01 · READY SCRIPT</span><h2>粘贴完整口播稿</h2><p>DeepSeek 不会重写正文，只负责提炼核心标题、封面短句和关键词。</p></div><label className="field">完整文稿<textarea rows={18} value={manualScript} onChange={(event) => setManualScript(event.target.value)} placeholder="粘贴已经写好的直播口播稿或短视频文稿…" /></label><div className={`script-limit ${manualCount > MAX_SCRIPT_CHARS ? "over" : ""}`}><span><b>{manualCount}</b> / {MAX_SCRIPT_CHARS} 字 · {formatEstimate(manualCount)}</span>{manualCount > MAX_SCRIPT_CHARS && <strong>超过 {manualCount - MAX_SCRIPT_CHARS} 字，预计超过 5 分钟</strong>}</div><div className="manual-actions"><span>不会自动截断原稿。</span><button className="primary-button" disabled={!manualScript.trim() || manualCount > MAX_SCRIPT_CHARS || busy === "manual" || !access.deepseekConnected} onClick={() => void submitManual()}>{busy === "manual" ? <span className="spinner" /> : <ArrowRight size={17} />}保存原稿并提炼标题</button></div></div>}
      </div>}
      {step === 2 && <div className="script-analysis-layout"><section className="script-editor"><div className="section-copy"><span className="card-kicker">STEP 02 · SCRIPT</span><h2>校对文案</h2><p>修改正文后可重新提炼，核心标题始终与最新版本绑定。</p></div><textarea className="script-textarea" rows={18} value={script} onChange={(event) => setScript(event.target.value)} /><div className={`script-limit ${scriptCount > MAX_SCRIPT_CHARS ? "over" : ""}`}><span><b>{scriptCount}</b> / {MAX_SCRIPT_CHARS} 字 · {formatEstimate(scriptCount)}</span></div><button className="secondary-button" disabled={!script.trim() || scriptCount > MAX_SCRIPT_CHARS || busy === "analyze"} onClick={() => void saveAndAnalyze()}><RefreshCw size={16} />按最新文案重新提炼</button></section><aside className="analysis-card"><span className="card-kicker">CORE TITLE</span><h2>确认视频核心标题</h2><label className="field">核心标题<input value={title} maxLength={32} onChange={(event) => setTitle(event.target.value)} /></label><label className="field">封面辅助短句<input value={coverSubtitle} maxLength={40} onChange={(event) => setCoverSubtitle(event.target.value)} /></label>{analysis?.alternativeTitles?.length ? <div className="title-suggestions"><strong>备选标题</strong>{analysis.alternativeTitles.map((item) => <button key={item} onClick={() => setTitle(item)}>{item}</button>)}</div> : null}{analysis?.keywords?.length ? <div className="keyword-row">{analysis.keywords.map((item) => <span key={item}>{item}</span>)}</div> : null}<div className="analysis-summary"><span>{analysis?.contentType || "内容类型"}</span><span>{analysis?.emotion || "情绪"}</span></div><button className="primary-button full" disabled={!analysis || !title.trim() || busy === "confirm"} onClick={() => void confirmAnalysis()}><Save size={16} />确认标题并选择声音</button></aside></div>}
      {step === 3 && <div className="selection-step">
        <div className="library-step-heading"><div className="section-copy"><span className="card-kicker">STEP 03 · VOICE</span><h2>选择声音档案</h2><p>先显示平台已保存档案，远程更新在后台完成。</p></div>{access.providerConnected && librarySyncControl}</div>
        {!access.providerConnected ? <ApiEmpty title="声音生成需要益民居·数字人 API" action="配置益民居·数字人 API" onClick={() => onNavigate("/settings/provider")} /> : librariesLoading ? <div className="panel-loading"><span className="spinner" />正在读取声音档案…</div> : readyProfiles.length ? <div className="choice-grid">{readyProfiles.map((profile) => <button key={profile.id} className={`choice-card ${profileId === profile.id ? "selected" : ""}`} onClick={() => setProfileId(profile.id)}><span className="choice-icon"><Mic2 size={22} /></span><div><strong>{profile.name}</strong><small>{profile.promptText || "可用声音档案"}</small></div>{profileId === profile.id && <Check size={17} />}</button>)}</div> : librariesSyncing ? <div className="panel-loading"><span className="spinner" />首次同步声音档案…</div> : <ApiEmpty title="还没有可用的声音档案" action="去建立声音" onClick={() => onNavigate("/voices")} />}
        {voiceJob ? <TaskProgress title="克隆声音" job={voiceJob} progress={progress(voiceJob)}>{voiceJob.status === "completed" ? <button className="primary-button" onClick={() => setStep(4)}>选择数字人形象 <ArrowRight size={16} /></button> : <button className="secondary-button" onClick={() => void pollTasks()}><RefreshCw size={16} />刷新进度</button>}</TaskProgress> : readyProfiles.length > 0 && <div className="step-actions"><button className="secondary-button" onClick={() => setStep(2)}><ArrowLeft size={16} />上一步</button><button className="primary-button" disabled={!profileId || busy === "voice"} onClick={() => void cloneVoice()}><Mic2 size={16} />开始声音克隆</button></div>}
      </div>}
      {step === 4 && <div className="selection-step">
        <div className="library-step-heading"><div className="section-copy"><span className="card-kicker">STEP 04 · AVATAR</span><h2>选择数字人形象</h2><p>先显示平台已保存形象，切换步骤不会重复刷新。</p></div>{access.providerConnected && librarySyncControl}</div>
        {librariesLoading ? <div className="panel-loading"><span className="spinner" />正在读取数字人形象…</div> : readyTemplates.length ? <div className="template-grid">{readyTemplates.map((asset) => <button key={asset.id} className={`template-choice ${templateId === asset.id ? "selected" : ""}`} onClick={() => setTemplateId(asset.id)}><div>{asset.previewUrl ? <video src={asset.previewUrl} preload="metadata" muted playsInline /> : <Bot size={38} />}</div><strong>{asset.name}</strong><small>{assetStatusLabel(asset.status)}{asset.width ? ` · ${asset.width}×${asset.height}` : ""}</small>{templateId === asset.id && <span><Check size={15} /></span>}</button>)}</div> : librariesSyncing ? <div className="panel-loading"><span className="spinner" />首次同步数字人形象…</div> : <ApiEmpty title="还没有已就绪的数字人形象" action="去上传形象" onClick={() => onNavigate("/avatars")} />}
        <div className="model-row"><label className="field">数字人模型<select value={modelVersion} onChange={(event) => setModelVersion(event.target.value)}><option value="V2">V2 · 稳定高质量</option><option value="V1">V1 · 兼容模式</option></select></label></div>{readyTemplates.length > 0 && <div className="step-actions"><button className="secondary-button" onClick={() => setStep(3)}><ArrowLeft size={16} />上一步</button><button className="primary-button" disabled={!templateId || voiceJob?.status !== "completed"} onClick={() => setStep(5)}>下一步：选择包装 <ArrowRight size={16} /></button></div>}
      </div>}
      {step === 5 && <div className="packaging-step">
        <div className="section-copy"><span className="card-kicker">STEP 05 · PACKAGING</span><h2>视频包装与封面</h2><p>两条任务线互不影响：视频只添加标题和逐句字幕；封面可按预算生成 1～3 张。</p></div>
        <div className="packaging-columns">
          <section>
            <h3><Subtitles size={20} />选择标题字幕模板</h3>
            <div className="packaging-template-grid">{videoTemplates.map((item) => <button key={item.id} className={packagingTemplate === item.id ? "active" : ""} onClick={() => setPackagingTemplate(item.id)}><i className={`template-swatch ${item.id}`} /><strong>{item.name}</strong><small>{item.tone}</small><p>{item.sample}</p>{packagingTemplate === item.id && <Check size={16} />}</button>)}</div>
            <label className="field compact">成片方向<select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}><option value="auto">自动识别横竖版</option><option value="portrait">竖版 9:16</option><option value="landscape">横版 16:9</option></select></label>
          </section>
          <section className="cover-config">
            <div className="cover-config-head"><div><h3><FileImage size={20} />同时生成封面</h3><p>默认3张，也可以减少张数节省生图额度。</p></div><label className="switch"><input type="checkbox" checked={generateCovers} onChange={(event) => setGenerateCovers(event.target.checked)} /><span /></label></div>
            {generateCovers && <>{!access.imagegenConnected ? <ApiEmpty title="封面生成需要 ImageGen API" action="去配置 ImageGen" onClick={() => onNavigate("/settings/provider")} /> : <>
              <div className="cover-count-picker"><span>生成数量</span><div>{([1, 2, 3] as const).map((count) => <button key={count} type="button" className={coverCount === count ? "active" : ""} onClick={() => setCoverCount(count)}><strong>{count}张</strong><small>{count === 1 ? "省额度" : count === 2 ? "兼顾选择" : "默认推荐"}</small></button>)}</div><p>依次生成：强冲击、专业权威、悬念好奇。</p></div>
              <div className={`portrait-upload-card ${referenceId ? "ready" : ""}`}>
                {referencePreviewUrl ? <img src={referencePreviewUrl} alt="已选人物形象照缩略图" /> : <span><ImagePlus size={28} /></span>}
                <div><strong>{referenceId ? "已选择人物形象照" : "上传一张人物形象照"}</strong><small>{referenceName || "JPG / PNG / WebP，建议正脸清晰；也可以不上传。"}</small><label className="secondary-button small portrait-upload-button">{busy === "portrait" ? <span className="spinner" /> : <ImagePlus size={15} />}{referenceId ? "换一张" : "上传并保存"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy === "portrait"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); event.currentTarget.value = ""; }} /></label></div>
                {referenceId && <Check size={18} className="portrait-selected-check" />}
              </div>
              <div className="portrait-library">
                <div><strong>历史人物形象</strong><small>上传一次，以后可以直接复用</small></div>
                {referencesLoading ? <div className="portrait-library-loading"><span className="spinner" />正在加载…</div> : referenceLibrary.length ? <div className="portrait-library-grid">{referenceLibrary.map((item) => <button type="button" key={item.id} className={referenceId === item.id ? "selected" : ""} onClick={() => selectReference(item)}><img src={item.previewUrl} alt={item.filename} loading="lazy" /><span>{item.filename}</span>{referenceId === item.id && <Check size={15} />}</button>)}</div> : <p>还没有历史图片，本次上传后会自动保存在这里。</p>}
              </div>
              <label className="field compact">封面比例<select value={coverRatio} onChange={(event) => setCoverRatio(event.target.value as typeof coverRatio)}><option value="9:16">竖版 9:16</option><option value="16:9">横版 16:9</option></select></label>
            </>}</>}
          </section>
        </div>
        <div className="step-actions"><button className="secondary-button" onClick={() => setStep(4)}><ArrowLeft size={16} />上一步</button><button className="primary-button" disabled={busy === "all" || !templateId || !voiceJobId || !analysis || (generateCovers && !access.imagegenConnected)} onClick={() => void startAll()}>{busy === "all" ? <span className="spinner" /> : <WandSparkles size={17} />}同时开始生成</button></div>
      </div>}
      {step === 6 && <div className="results-step">
        <div className="section-copy centered"><span className="card-kicker">STEP 06 · PARALLEL RESULTS</span><h2>视频与封面正在并行生成</h2><p>可以离开本页，云端任务不会中断；两条线可独立完成、下载和重试。</p></div>
        <div className="video-retention-notice" role="note"><Clock3 size={22} /><div><strong>原片和最终成片仅保存 7 天</strong><p>请在生成完成后尽快下载到本地；7 天后服务器会自动删除，不再保留。</p></div></div>
        <div className="result-lanes">
          <section className="result-lane">
            <div className="lane-title"><span><Clapperboard size={22} /></span><div><strong>视频成片线</strong><small>数字人 → FunASR 逐句字幕 → 核心标题</small></div></div>
            {videoJob && <TaskProgress title="数字人基础成片" job={videoJob} progress={progress(videoJob)}>{videoJob.status === "completed" && videoJob.outputStatus !== "expired" && <button className="secondary-button" onClick={() => void downloadVideo(videoJob)}><Download size={16} />下载基础成片</button>}</TaskProgress>}
            {packagingJob && <TaskProgress title="标题字幕成片" job={packagingJob} progress={progress(packagingJob)}>{packagingJob.status === "completed" && packagingJob.outputStatus !== "expired" && <button className="primary-button" onClick={() => void downloadVideo(packagingJob)}><Download size={16} />下载包装成片</button>}{packagingJob.status === "failed" && <button className="secondary-button" disabled={busy === `retry-${packagingJob.id}`} onClick={() => void retryPackaging(packagingJob)}><RefreshCw size={16} />重试标题字幕</button>}</TaskProgress>}
          </section>
          <section className="result-lane">
            <div className="lane-title"><span><FileImage size={22} /></span><div><strong>封面图片线</strong><small>完成后保存到平台存储，避免外部图片失效</small></div></div>
            {coverJobs.length ? <div className="cover-result-grid">{coverJobs.slice(0, 3).map((job) => <CoverResultCard key={job.id} job={job} busy={busy} onRetry={retryCover} onRefresh={refreshCover} onDownload={downloadCover} />)}</div> : <div className="setup-empty compact"><FileImage size={26} /><h3>{generateCovers ? "封面任务正在提交" : "本次未生成封面"}</h3></div>}
          </section>
        </div>
        <div className="final-actions"><button className="secondary-button" onClick={() => void pollTasks()}><RefreshCw size={16} />刷新全部进度</button><button className="secondary-button" onClick={() => onNavigate("/videos")}>打开成片库</button><button className="text-button" onClick={() => onNavigate("/create")}>再创作一条</button></div>
      </div>}
    </div>
  </section>;
}

function ApiEmpty({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <div className="setup-empty api-required"><KeyRound size={28} /><h3>{title}</h3><button className="primary-button" onClick={onClick}>{action}</button></div>; }
function CoverResultCard({ job, busy, onRetry, onRefresh, onDownload }: { job: GenerationJob; busy: string; onRetry: (job: GenerationJob) => Promise<void>; onRefresh: (job: GenerationJob) => Promise<void>; onDownload: (job: GenerationJob) => Promise<void> }) {
  const urls = Array.isArray(job.result.imageUrls) ? job.result.imageUrls as string[] : [];
  const url = urls[0] || "";
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const failed = job.status === "failed";
  return <article className="cover-result-card">
    {url && !broken ? <img src={url} alt={job.name} onError={() => setBroken(true)} /> : <div className="cover-loading">
      {!failed && !broken && <span className="spinner large" />}
      <span>{failed ? "封面交付失败" : broken ? "图片暂时未载入" : jobLabel(job.status)}</span>
      {broken && <button className="secondary-button small" disabled={busy === `refresh-${job.id}`} onClick={() => void onRefresh(job)}><RefreshCw size={15} />重新载入</button>}
    </div>}
    <div><strong>{String(job.request.styleName || job.name)}</strong><span>{jobProgress(job.status, job.progress)}%</span></div>
    {url && !broken && <button className="secondary-button small" disabled={busy === `download-cover-${job.id}`} onClick={() => void onDownload(job)}><Download size={15} />下载封面</button>}
    {failed && <button className="secondary-button small" disabled={busy === `retry-${job.id}`} onClick={() => void onRetry(job)}><RefreshCw size={15} />单张重试</button>}
    {job.errorMessage && <p className="error-text">{job.errorMessage}</p>}
  </article>;
}
function TaskProgress({ title, job, progress, children }: { title: string; job: GenerationJob; progress: number; children?: React.ReactNode }) { const expired = job.outputStatus === "expired"; return <div className="task-progress"><div><span>{title}</span><strong>{jobLabel(expired ? "expired" : job.status)}</strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div>{job.status === "completed" && <p className={`retention-deadline ${expired ? "expired" : ""}`}>{expired ? "服务器文件已按7天规则自动删除" : job.expiresAt ? `请在 ${new Date(job.expiresAt).toLocaleString("zh-CN")} 前下载` : "生成后仅保存7天，请尽快下载"}</p>}{job.errorMessage && <p className="error-text">{job.errorMessage}</p>}{children}</div>; }
