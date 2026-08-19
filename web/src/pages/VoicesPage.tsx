import { CheckCircle2, ChevronDown, FileAudio, History, Mic2, RefreshCw, RotateCcw, Save, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { assetStatusLabel, finalizeProviderAsset, uploadProviderAsset, type UploadStage } from "@/lib/media";
import type { ProviderAsset, VoiceProfile } from "@/types/api";

const stableNewestFirst = <T extends { id: string; createdAt: number }>(items: T[]) =>
  [...items].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));

export function VoicesPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<ProviderAsset[]>([]);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [autoProfileAssetId, setAutoProfileAssetId] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextAssets, nextProfiles] = await Promise.all([
        apiRequest<ProviderAsset[]>("/api/assets?kind=audio"),
        apiRequest<VoiceProfile[]>("/api/voice-profiles"),
      ]);
      setAssets(nextAssets);
      setProfiles(nextProfiles);
      setError("");
      setDrafts((current) => Object.fromEntries(
        nextProfiles
          .filter((profile) => profile.status === "needs_review")
          .map((profile) => [profile.id, current[profile.id] ?? profile.promptText ?? ""]),
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "声音库加载失败");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sourceAssets = useMemo(
    () => stableNewestFirst(assets.filter((asset) => asset.metadata.localUploadOrigin === true)),
    [assets],
  );
  const readyProfiles = useMemo(
    () => stableNewestFirst(profiles.filter((profile) => profile.status === "ready")),
    [profiles],
  );
  const pendingProfiles = useMemo(
    () => stableNewestFirst(profiles.filter((profile) => !["ready", "archived"].includes(profile.status))),
    [profiles],
  );
  const autoAsset = sourceAssets.find((asset) => asset.id === autoProfileAssetId) || null;
  const shouldPoll = profiles.some((profile) => profile.status === "processing")
    || sourceAssets.some((asset) => !["ready", "failed", "archived"].includes(asset.status));

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, shouldPoll]);

  const createProfile = useCallback(async (asset: ProviderAsset) => {
    setCreating(asset.id);
    setError("");
    setNotice("音频检测完成，正在识别录音文字…");
    try {
      await apiRequest("/api/voice-profiles", {
        method: "POST",
        body: JSON.stringify({ assetId: asset.id, name: asset.name.replace(/\.[^.]+$/u, "") || "我的声音" }),
      });
      setAutoProfileAssetId(null);
      await load();
    } catch (err) {
      setAutoProfileAssetId(null);
      setNotice("");
      setError(err instanceof Error ? err.message : "声音建档失败");
    } finally {
      setCreating(null);
    }
  }, [load]);

  useEffect(() => {
    if (!autoProfileAssetId || !autoAsset || creating || uploading) return;
    const linkedProfile = profiles.find((profile) => profile.referenceAssetId === autoAsset.id && profile.status !== "archived");
    if (linkedProfile) {
      setAutoProfileAssetId(null);
      setNotice(linkedProfile.status === "ready" ? "这个声音已经在“我的可用声音”中，可以直接创作。" : "声音已进入识别流程，请等待文字校对。");
      return;
    }
    if (autoAsset.status === "ready") {
      void createProfile(autoAsset);
      return;
    }
    if (autoAsset.status === "failed") {
      setAutoProfileAssetId(null);
      setNotice("");
      setError(autoAsset.errorMessage || "声音检测失败，请重新上传一段清晰原声");
    }
  }, [autoAsset, autoProfileAssetId, createProfile, creating, profiles, uploading]);

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const uploaded = await uploadProviderAsset(file, "audio", setUploadStage);
      setAutoProfileAssetId(uploaded.id);
      setNotice("上传完成，正在检测音频并准备识别文字…");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      setUploadStage(null);
      await load();
    }
  };

  const recoverUpload = async (assetId: string) => {
    setCreating(assetId);
    setError("");
    try {
      const recovered = await finalizeProviderAsset(assetId);
      setAutoProfileAssetId(recovered.id);
      setNotice("文件已恢复，正在检测并准备识别文字…");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新确认失败");
    } finally {
      setCreating(null);
    }
  };

  const savePrompt = async (profile: VoiceProfile) => {
    setCreating(profile.id);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/voice-profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({ promptText: drafts[profile.id] }),
      });
      setNotice("声音档案已保存，现在可以在创作页面直接选择。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "校对保存失败");
    } finally {
      setCreating(null);
    }
  };

  const stageLabel = uploadStage === "validating" ? "正在检查文件"
    : uploadStage === "hashing" ? "正在校验完整性"
      : uploadStage === "preparing" ? "正在准备上传"
        : uploadStage === "uploading" ? "正在安全上传"
          : uploadStage === "finalizing" ? "正在转交并检测"
            : "上传参考声音";

  return <section className="workspace-page voice-workflow">
    <header className="page-heading">
      <div>
        <span className="eyebrow"><Mic2 size={15} /> MY VOICES</span>
        <h1>我的声音</h1>
        <p>左侧声音可直接用于创作；添加新声音只需上传、校对文字并保存。</p>
      </div>
    </header>

    <div className="info-strip">
      <CheckCircle2 size={18} />
      <span>创作页面只显示“我的可用声音”。新上传的声音完成文字校对并保存后，会自动进入可用列表。</span>
      <button className="icon-button" onClick={() => void load()} aria-label="刷新声音列表"><RefreshCw size={17} /></button>
    </div>
    {error && <div className="form-message error" role="alert">{error}</div>}
    {notice && <div className="form-message success" aria-live="polite">{notice}</div>}

    <div className="voice-simple-layout">
      <section className="surface-panel available-voice-panel">
        <div className="panel-heading">
          <div><span className="card-kicker">AVAILABLE IN CREATION</span><h2>我的可用声音</h2></div>
          <span>{readyProfiles.length} 个</span>
        </div>
        <p className="panel-helper">这里的声音都已完成校对，会出现在创作流程的“选择声音”步骤中。</p>
        <div className="saved-voice-list">
          {readyProfiles.length ? readyProfiles.map((profile) => <article className="saved-voice-row" key={profile.id}>
            <span className="row-icon"><Mic2 size={18} /></span>
            <div>
              <strong>{profile.name}</strong>
              <small>可直接用于生成口播</small>
            </div>
            <span className="state-pill ready"><CheckCircle2 size={13} />可用</span>
          </article>) : <div className="voice-guided-empty">
            <span><Mic2 size={25} /></span>
            <strong>还没有可用声音</strong>
            <p>请在右侧上传一段清晰原声，完成校对后就能在创作时使用。</p>
          </div>}
        </div>
      </section>

      <section className="surface-panel add-voice-panel" aria-live="polite">
        <div className="panel-heading">
          <div><span className="card-kicker">ADD A NEW VOICE</span><h2>添加新声音</h2></div>
          <button className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <span className="spinner" /> : <Upload size={17} />}{stageLabel}
          </button>
        </div>
        <input
          hidden
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />

        <ol className="voice-flow-steps" aria-label="添加声音步骤">
          <li><span>1</span><div><strong>上传原声</strong><small>建议 10–30 秒</small></div></li>
          <li><span>2</span><div><strong>自动识别</strong><small>无需额外操作</small></div></li>
          <li><span>3</span><div><strong>校对保存</strong><small>保存后即可创作</small></div></li>
        </ol>

        {autoAsset && !profiles.some((profile) => profile.referenceAssetId === autoAsset.id && profile.status !== "archived") && <article className="voice-processing-card">
          <span className="row-icon"><FileAudio size={19} /></span>
          <div><strong>{autoAsset.name}</strong><small>{creating === autoAsset.id ? "正在建立声音档案" : `${assetStatusLabel(autoAsset.status)}，完成后将自动识别文字`}</small></div>
          <span className="spinner" />
        </article>}

        <div className="profile-list">
          {pendingProfiles.map((profile) => <article className="profile-card" key={profile.id}>
            <header>
              <div><span className="row-icon"><Mic2 size={18} /></span><div><strong>{profile.name}</strong><small>{assetStatusLabel(profile.status)}</small></div></div>
              <span className={`state-pill ${profile.status}`}>{assetStatusLabel(profile.status)}</span>
            </header>
            {profile.status === "needs_review" ? <>
              <label className="field">请确认录音对应的文字
                <textarea
                  value={drafts[profile.id] || ""}
                  onChange={(event) => setDrafts((current) => ({ ...current, [profile.id]: event.target.value }))}
                  rows={4}
                />
                <small className="field-helper">文字有误可以直接修改，确认与录音一致后再保存。</small>
              </label>
              <button className="primary-button" disabled={!drafts[profile.id]?.trim() || creating === profile.id} onClick={() => void savePrompt(profile)}>
                {creating === profile.id ? <span className="spinner" /> : <Save size={15} />}保存并用于创作
              </button>
            </> : profile.status === "failed"
              ? <p className="voice-profile-error">声音识别失败，请点击上方按钮重新上传一段清晰原声。</p>
              : <p>正在识别声音特征和录音文字，完成后会自动出现文字校对框…</p>}
          </article>)}
          {!pendingProfiles.length && !autoAsset && <div className="voice-add-empty">
            <span><Upload size={24} /></span>
            <strong>上传一段你的清晰原声</strong>
            <p>系统会自动识别文字；你只需最后检查并保存。</p>
            <button className="secondary-button" disabled={uploading} onClick={() => inputRef.current?.click()}><Upload size={16} />选择声音文件</button>
          </div>}
        </div>
      </section>
    </div>

    <details className="voice-upload-history">
      <summary>
        <span><History size={17} /><strong>上传记录</strong><small>仅用于查看或继续未完成的建档</small></span>
        <span>{sourceAssets.length} 条 <ChevronDown size={17} /></span>
      </summary>
      <div className="compact-list">
        {sourceAssets.length ? sourceAssets.map((asset) => {
          const linkedProfile = profiles.find((profile) => profile.referenceAssetId === asset.id && profile.status !== "archived");
          const needsReselect = Boolean(asset.errorMessage?.includes("重新选择文件上传") || asset.errorMessage?.includes("完整的上传文件"));
          return <article key={asset.id} className="compact-row">
            <span className="row-icon"><FileAudio size={19} /></span>
            <div>
              <strong>{asset.name}</strong>
              <small>{assetStatusLabel(asset.status)}{asset.durationMs ? ` · ${Math.round(asset.durationMs / 1000)} 秒` : ""}</small>
              {asset.errorMessage && <small className="asset-error-inline">{asset.errorMessage}</small>}
            </div>
            {asset.status === "ready" && !linkedProfile
              ? <button className="secondary-button small" disabled={creating === asset.id} onClick={() => void createProfile(asset)}>{creating === asset.id ? <span className="spinner" /> : <Mic2 size={15} />}继续建档</button>
              : linkedProfile?.status === "ready"
                ? <span className="state-pill ready"><CheckCircle2 size={13} />已成为可用声音</span>
                : linkedProfile?.status === "needs_review"
                  ? <span className="state-pill needs_review">等待校对</span>
                  : linkedProfile
                    ? <span className={`state-pill ${linkedProfile.status}`}>{assetStatusLabel(linkedProfile.status)}</span>
                    : asset.status === "uploading" && needsReselect
                      ? <button className="secondary-button small" disabled={uploading} onClick={() => inputRef.current?.click()}><Upload size={15} />重新选择文件</button>
                      : asset.status === "uploading"
                        ? <button className="secondary-button small" disabled={creating === asset.id} onClick={() => void recoverUpload(asset.id)}>{creating === asset.id ? <span className="spinner" /> : <RotateCcw size={15} />}恢复上传</button>
                        : <span className={`state-pill ${asset.status}`}>{assetStatusLabel(asset.status)}</span>}
          </article>;
        }) : <div className="mini-empty">还没有上传记录</div>}
      </div>
    </details>
  </section>;
}
