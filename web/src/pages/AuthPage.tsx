import { ArrowRight, Check, CreditCard, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { client } from "@/lib/edgespark";
import { apiRequest } from "@/lib/api";

interface AuthPageProps {
  mode: "login" | "register" | "bootstrap";
  onNavigate: (path: string) => void;
  onAuthenticated: () => void;
}

export function AuthPage({ mode, onNavigate, onAuthenticated }: AuthPageProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [accessMode, setAccessMode] = useState<"invite" | "annual">("invite");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode !== "login";
  const isBootstrap = mode === "bootstrap";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (isRegister) {
        if (isBootstrap || accessMode === "invite") {
          const preflight = await apiRequest<{ pendingToken: string }>("/api/public/access/preflight", {
            method: "POST",
            body: JSON.stringify({ email, inviteCode: isBootstrap ? "" : inviteCode }),
          });
          sessionStorage.setItem("pendingInviteToken", preflight.pendingToken);
        } else {
          sessionStorage.removeItem("pendingInviteToken");
          sessionStorage.setItem("pendingAccessMode", "annual");
        }
        const result = await client.auth.signUp.email({ name: name.trim(), email: email.trim(), password });
        if (result.error) throw new Error(result.error.message || "注册失败，请检查填写内容");

        try {
          await client.auth.requireSession();
        } catch {
          const signInResult = await client.auth.signIn.email({ email: email.trim(), password });
          if (signInResult.error) throw new Error(signInResult.error.message || "账号已创建，但自动登录失败，请直接登录");
        }
        onAuthenticated();
        onNavigate("/activate");
      } else {
        const result = await client.auth.signIn.email({ email: email.trim(), password });
        if (result.error) throw new Error(result.error.message || "邮箱或密码不正确");
        onAuthenticated();
        onNavigate("/dashboard");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="产品介绍">
        <Brand />
        <div className="auth-story-content">
          <span className="eyebrow"><Sparkles size={16} /> 想法到成片</span>
          <h1>让你的每个观点，<br />都变成一条像你亲自说的视频。</h1>
          <p>DeepSeek 帮你整理口播稿，再通过你自己的益民居·数字人账号生成声音和数字人视频。</p>
          <ul>
            <li><Check size={17} /> 有暗号永久免费，无暗号 ¥2800/年</li>
            <li><Check size={17} /> DeepSeek 与益民居·数字人 Key 都由你自己配置</li>
            <li><Check size={17} /> 两项 Key 均只在服务端加密保存</li>
          </ul>
        </div>
        <div className="auth-proof"><ShieldCheck size={18} /> 你的声音、形象和密钥始终归你所有</div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-heading">
            <span className="auth-icon"><KeyRound size={21} /></span>
            <h2>{isBootstrap ? "创建首位管理员" : isRegister ? "创建你的创作账号" : "欢迎回来"}</h2>
            <p>{isBootstrap ? "仅限平台所有者首次开通，注册成功后自动激活。" : isRegister ? "输入邮箱和密码即可注册；有暗号免费使用，没有暗号可开通年费会员。" : "继续完成你的下一条口播视频。"}</p>
          </div>

          <form onSubmit={submit} className="form-stack">
            {isRegister && !isBootstrap && (
              <div className="access-mode-switch" role="group" aria-label="选择开通方式">
                <button type="button" className={accessMode === "invite" ? "active" : ""} onClick={() => setAccessMode("invite")}><KeyRound size={17} /><span><strong>我有暗号</strong><small>永久免费</small></span></button>
                <button type="button" className={accessMode === "annual" ? "active" : ""} onClick={() => setAccessMode("annual")}><CreditCard size={17} /><span><strong>没有暗号</strong><small>¥2800/年</small></span></button>
              </div>
            )}
            {isRegister && (
              <label className="field">
                <span>怎么称呼你</span>
                <div className="input-wrap"><Sparkles size={18} /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="例如：智多星" required minLength={2} /></div>
              </label>
            )}
            <label className="field">
              <span>邮箱</span>
              <div className="input-wrap"><Mail size={18} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required /></div>
            </label>
            <label className="field">
              <span>密码</span>
              <div className="input-wrap">
                <LockKeyhole size={18} />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isRegister ? "new-password" : "current-password"} placeholder="至少 8 位" required minLength={8} />
                <button type="button" className="input-action" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </label>
            {isRegister && !isBootstrap && accessMode === "invite" && (
              <label className="field">
                <span>暗号</span>
                <div className="input-wrap"><KeyRound size={18} /><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} autoComplete="off" placeholder="例如 XING-XXXX-XXXX" required minLength={6} /></div>
                <small>暗号仅用于验证使用资格，不会作为密码。</small>
              </label>
            )}
            {error && <div className="form-message error" role="alert">{error}</div>}
            <button className="primary-button full" type="submit" disabled={submitting}>
              {submitting ? <span className="spinner" /> : <ArrowRight size={18} />}
              {submitting ? "正在处理…" : isBootstrap ? "创建管理员账号" : isRegister && accessMode === "annual" ? "注册并继续开通年费" : isRegister ? "验证暗号并注册" : "登录"}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? "已经有账号？" : "还没有账号？"}
            <button onClick={() => onNavigate(isRegister ? "/login" : "/register")}>{isRegister ? "直接登录" : "注册账号"}</button>
          </p>
          {!isBootstrap && <button className="pricing-link" onClick={() => onNavigate("/pricing")}>查看年费方案与权益</button>}
        </div>
      </section>
    </main>
  );
}
