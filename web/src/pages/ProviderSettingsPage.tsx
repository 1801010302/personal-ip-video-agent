import { BrainCircuit, CheckCircle2, CircleHelp, ExternalLink, Eye, EyeOff, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Trash2, UserPlus, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { apiRequest } from "@/lib/api";
import type { ProviderConnection } from "@/types/api";

interface CredentialCardProps {
  kind: "deepseek" | "provider" | "imagegen";
  title: string;
  description: string;
  placeholder: string;
  onConnectionChanged: () => void;
}

function CredentialCard({ kind, title, description, placeholder, onConnectionChanged }: CredentialCardProps) {
  const [connection, setConnection] = useState<ProviderConnection | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const basePath = `/api/settings/${kind}`;
  const isDeepSeek = kind === "deepseek";
  const isImageGen = kind === "imagegen";
  const applicationUrl = isDeepSeek ? "https://platform.deepseek.com/api_keys" : isImageGen ? "https://openapi.yiminju.xyz/register" : "https://szr.yiminju.xyz/account";
  const applicationTitle = isDeepSeek ? "还没有 DeepSeek API Key？" : isImageGen ? "还没有 ImageGen API Key？" : "还没有益民居·数字人 API Key？";
  const applicationDescription = isDeepSeek
    ? "先注册 DeepSeek 开放平台账户，创建 API Key 后复制到上面的输入框。"
    : isImageGen ? "先注册 ImageGen 开放平台，创建生图 API Key，再复制到上面的输入框。"
    : "先注册益民居·数字人账户，进入“账户与 API”点击“创建 API Key”，再复制到上面的输入框。";

  useEffect(() => {
    void apiRequest<ProviderConnection>(basePath).then(setConnection).catch((loadError) => {
      setMessage({ tone: "error", text: loadError instanceof Error ? loadError.message : "无法读取连接状态" });
    }).finally(() => setLoading(false));
  }, [basePath]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitting(true); setMessage(null);
    try {
      const next = await apiRequest<ProviderConnection>(`${basePath}/test-and-save`, { method: "POST", body: JSON.stringify({ apiKey }) });
      setConnection(next); setApiKey("");
      setMessage({ tone: "success", text: isImageGen ? "ImageGen API Key 已加密保存，首次生成封面时会由国内节点验证。" : `${title}连接测试成功，API Key 已加密保存。` });
      onConnectionChanged();
    } catch (saveError) {
      setMessage({ tone: "error", text: saveError instanceof Error ? saveError.message : "连接测试失败" });
    } finally { setSubmitting(false); }
  };

  const retest = async () => {
    setSubmitting(true); setMessage(null);
    try {
      const next = await apiRequest<ProviderConnection>(`${basePath}/retest`, { method: "POST" });
      setConnection(next); setMessage({ tone: "success", text: "重新测试成功，连接状态已更新。" }); onConnectionChanged();
    } catch (retestError) {
      setMessage({ tone: "error", text: retestError instanceof Error ? retestError.message : "重新测试失败" });
    } finally { setSubmitting(false); }
  };

  const disconnect = async () => {
    if (!window.confirm(`确定删除 ${title} 连接吗？`)) return;
    setSubmitting(true);
    try {
      const next = await apiRequest<ProviderConnection>(basePath, { method: "DELETE" });
      setConnection(next); setMessage({ tone: "success", text: "加密密钥已从平台删除。" }); onConnectionChanged();
    } catch (deleteError) {
      setMessage({ tone: "error", text: deleteError instanceof Error ? deleteError.message : "删除连接失败" });
    } finally { setSubmitting(false); }
  };

  const connected = connection?.connected === true;
  return (
    <section className="settings-card provider-card credential-card">
      <div className="provider-title">
        <span className="provider-logo">{isDeepSeek ? <BrainCircuit size={23} /> : isImageGen ? <Sparkles size={23} /> : <KeyRound size={23} />}</span>
        <div><h2>{title}</h2><p>{description}</p></div>
        <StatusBadge tone={connected ? "success" : "neutral"}>{loading ? "读取中" : connected ? isImageGen ? "已保存" : "已连接" : "未连接"}</StatusBadge>
      </div>
      {connected && (
        <div className={`connection-summary ${isDeepSeek ? "two-cells" : ""}`}>
          <div><small>已保存的密钥</small><strong>{connection.maskedKey}</strong></div>
          <div><small>{isImageGen ? "保存时间" : "上次验证"}</small><strong>{connection.verifiedAt ? new Date(connection.verifiedAt).toLocaleString("zh-CN") : "—"}</strong></div>
          {!isDeepSeek && <div className="balance-cell"><small>{isImageGen ? "可用余额" : "可用积分"}</small><strong><WalletCards size={18} /> {isImageGen && typeof connection.availablePoints === "number" ? `¥${(connection.availablePoints / 100).toFixed(2)}` : connection.availablePoints?.toLocaleString("zh-CN") ?? "不可读取"}</strong></div>}
        </div>
      )}
      <form onSubmit={save} className="form-stack provider-form">
        <label className="field"><span>{connected ? `替换 ${title} API Key` : `${title} API Key`}</span>
          <div className="input-wrap"><LockKeyhole size={18} /><input type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connected ? "输入新 Key，测试成功后才会替换" : placeholder} autoComplete="off" required /><button type="button" className="input-action" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "隐藏密钥" : "显示密钥"}>{showKey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          <small><ShieldCheck size={14} /> 浏览器只提交一次，保存后不会再次显示完整密钥。</small>
        </label>
        <div className={`api-application-card ${isDeepSeek ? "deepseek" : isImageGen ? "imagegen" : "provider"}`}>
          <span className="api-application-icon"><CircleHelp size={22} /></span>
          <div className="api-application-copy">
            <span className="api-beginner-badge"><UserPlus size={14} />新手从这里开始</span>
            <strong>{applicationTitle}</strong>
            <p>API Key 可以理解为第三方平台发给你的“专属通行证”。{applicationDescription}</p>
          </div>
          <a className="api-application-button" href={applicationUrl} target="_blank" rel="noopener noreferrer" aria-label={`前往申请${title} API Key（新窗口打开）`}>
            立即注册并申请 <ExternalLink size={17} />
          </a>
        </div>
        {message && <div className={`form-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</div>}
        <div className="form-actions"><button className="primary-button" type="submit" disabled={submitting || apiKey.trim().length < 16}>{submitting ? <span className="spinner" /> : <CheckCircle2 size={18} />}{isImageGen ? connected ? "保存新密钥" : "加密保存并启用" : connected ? "测试并替换" : "测试连接并保存"}</button>{connected && !isImageGen && <button className="secondary-button" type="button" onClick={retest} disabled={submitting}><RefreshCw size={17} /> 重新测试</button>}</div>
      </form>
      {connected && <div className="danger-row"><div><strong>删除连接</strong><p>只删除本平台保存的加密密钥，不影响第三方账户。</p></div><button className="danger-button" onClick={disconnect} disabled={submitting}><Trash2 size={17} /> 删除</button></div>}
    </section>
  );
}

export function ProviderSettingsPage({ onConnectionChanged }: { onConnectionChanged: () => void }) {
  return (
    <div className="page settings-page">
      <section className="page-heading"><div><span className="eyebrow"><KeyRound size={15} /> 模型、数字人与生图接口</span><h1>连接你自己的 AI 能力</h1><p>文案、数字人和封面分别调用你自己的三个账户；平台不代充任何第三方余额。</p></div></section>
      <div className="credentials-layout">
        <div className="credentials-stack">
          <CredentialCard kind="deepseek" title="DeepSeek·文案模型" description="将零散想法整理成结构完整、适合短视频的口播文案" placeholder="粘贴完整的 sk-… 密钥" onConnectionChanged={onConnectionChanged} />
          <CredentialCard kind="provider" title="益民居·数字人" description="声音档案、声音克隆、数字人模板与视频生成" placeholder="粘贴完整的益民居·数字人 API Key" onConnectionChanged={onConnectionChanged} />
          <CredentialCard kind="imagegen" title="ImageGen·封面生图" description="根据核心标题和人物形象，一稿生成可直接下载的视频封面" placeholder="粘贴完整的 openapi_live_… 密钥" onConnectionChanged={onConnectionChanged} />
        </div>
        <aside className="settings-card guide-card dual-key-guide">
          <span className="card-kicker">三项都由你掌控</span><h2>三个 Key 分别做什么？</h2>
          <div className="key-flow"><span><BrainCircuit size={19} /></span><div><strong>DeepSeek Key</strong><p>负责把你的想法生成口播稿，费用由 DeepSeek 账户承担。</p></div></div>
          <div className="key-flow"><span><KeyRound size={19} /></span><div><strong>益民居·数字人 Key</strong><p>负责克隆声音、数字人形象和合成视频，费用由益民居·数字人账户承担。</p></div></div>
          <div className="key-flow"><span><Sparkles size={19} /></span><div><strong>ImageGen Key</strong><p>负责一稿生成三种视频封面，费用由你的生图账户承担。</p></div></div>
          <a className="secondary-button full" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">获取 DeepSeek API Key <ExternalLink size={16} /></a>
          <a className="secondary-button full" href="https://szr.yiminju.xyz/api-docs" target="_blank" rel="noreferrer">查看益民居·数字人 API 文档 <ExternalLink size={16} /></a>
          <a className="secondary-button full" href="https://openapi.yiminju.xyz/register" target="_blank" rel="noreferrer">获取 ImageGen API Key <ExternalLink size={16} /></a>
          <div className="security-note"><ShieldCheck size={19} /><div><strong>统一加密保护</strong><p>三项密钥都使用服务端 AES-GCM 加密，页面只返回掩码，日志不记录明文。</p></div></div>
        </aside>
      </div>
    </div>
  );
}
