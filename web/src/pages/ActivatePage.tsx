import { ArrowRight, Check, CreditCard, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { apiRequest } from "@/lib/api";

interface ActivatePageProps {
  email: string;
  onActivated: () => void;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

export function ActivatePage({ email, onActivated, onNavigate, onSignOut }: ActivatePageProps) {
  const [inviteCode, setInviteCode] = useState("");
  const [pendingToken, setPendingToken] = useState(() => sessionStorage.getItem("pendingInviteToken") || "");
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");

  const redeem = async (token: string) => {
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/api/access/redeem", { method: "POST", body: JSON.stringify({ pendingToken: token }) });
      sessionStorage.removeItem("pendingInviteToken");
      sessionStorage.removeItem("pendingAccessMode");
      onActivated();
    } catch (redeemError) {
      setPendingToken("");
      sessionStorage.removeItem("pendingInviteToken");
      setError(redeemError instanceof Error ? redeemError.message : "激活失败，请重新输入暗号");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (pendingToken) {
      void redeem(pendingToken);
    } else {
      setSubmitting(true);
      void apiRequest<{ pendingToken: string }>("/api/public/access/preflight", {
        method: "POST",
        body: JSON.stringify({ email, inviteCode: "" }),
      }).then((result) => redeem(result.pendingToken)).catch(() => setSubmitting(false));
    }
    // Saved invite tokens are consumed once on page entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const preflight = await apiRequest<{ pendingToken: string }>("/api/public/access/preflight", {
        method: "POST",
        body: JSON.stringify({ email, inviteCode }),
      });
      await redeem(preflight.pendingToken);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暗号不可用，请重新检查");
      setSubmitting(false);
    }
  };

  const startCheckout = async () => {
    setPaying(true);
    setPaymentMessage("");
    try {
      await apiRequest("/api/billing/checkout", { method: "POST" });
    } catch (checkoutError) {
      setPaymentMessage(checkoutError instanceof Error ? checkoutError.message : "暂时无法发起支付");
    } finally {
      setPaying(false);
    }
  };

  return (
    <main className="activation-page access-choice-page">
      <header><Brand /></header>
      <section className="access-choice-heading">
        <span className="eyebrow"><ShieldCheck size={15} /> 账号已注册</span>
        <h1>{submitting ? "正在验证你的使用资格" : "选择一种开通方式"}</h1>
        <p>当前账号：<strong>{email}</strong></p>
      </section>

      {submitting ? <div className="access-checking"><span className="spinner large" /><strong>正在安全验证…</strong></div> : (
        <section className="access-choice-grid">
          <article className="access-option-card invite-option">
            <span className="access-option-icon"><KeyRound size={25} /></span><small>已有邀请资格</small><h2>使用暗号，永久免费</h2>
            <p>暗号验证成功后，无需支付平台年费。</p>
            <form className="form-stack" onSubmit={submitInvite}>
              <label className="field"><span>暗号</span><div className="input-wrap"><KeyRound size={18} /><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="例如 XING-XXXX-XXXX" required minLength={6} /></div></label>
              {error && <div className="form-message error" role="alert">{error}</div>}
              <button className="secondary-button full" type="submit"><ArrowRight size={17} /> 验证暗号并开通</button>
            </form>
          </article>

          <article className="access-option-card paid-option">
            <span className="recommended-badge">没有暗号</span><span className="access-option-icon"><CreditCard size={25} /></span><small>年费会员</small><h2>¥2,800 <span>/ 年</span></h2>
            <p>付款成功后获得 12 个月完整平台使用权。</p>
            <ul><li><Check size={16} /> DeepSeek 文案生成</li><li><Check size={16} /> 声音与数字人成片</li><li><Check size={16} /> 自主管理两项 API Key</li></ul>
            {paymentMessage && <div className="form-message error" role="alert">{paymentMessage}</div>}
            <button className="primary-button full" type="button" onClick={startCheckout} disabled={paying}>{paying ? <span className="spinner" /> : <CreditCard size={17} />}{paying ? "正在发起支付…" : "¥2,800 / 年开通"}</button>
            <button className="pricing-inline-link" type="button" onClick={() => onNavigate("/pricing")}>查看完整权益</button>
          </article>
        </section>
      )}
      <button className="text-button access-signout" onClick={onSignOut}><LogOut size={16} /> 换一个账号登录</button>
    </main>
  );
}
