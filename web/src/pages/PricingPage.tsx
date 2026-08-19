import { ArrowRight, Check, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { Brand } from "@/components/Brand";

export function PricingPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <main className="pricing-page">
      <header className="pricing-header"><Brand /><button className="secondary-button" onClick={() => onNavigate("/login")}>登录</button></header>
      <section className="pricing-hero">
        <span className="eyebrow"><Sparkles size={16} /> 简单透明的价格</span>
        <h1>一套工具，完成从想法到数字人成片</h1>
        <p>平台会员费与模型、数字人服务费用分开。DeepSeek 和益民居·数字人都使用你自己的账号。</p>
      </section>
      <section className="pricing-options">
        <article className="price-card invite-plan">
          <span className="price-icon"><KeyRound size={24} /></span><small>受邀用户</small><h2>暗号免费版</h2>
          <div className="price-line"><strong>¥0</strong><span>长期</span></div>
          <ul><li><Check size={17} /> 完整文案创作能力</li><li><Check size={17} /> 完整数字人成片能力</li><li><Check size={17} /> 自己承担第三方 API 用量费</li></ul>
          <button className="secondary-button full" onClick={() => onNavigate("/register")}>使用暗号注册</button>
        </article>
        <article className="price-card annual-plan">
          <span className="recommended-badge">标准方案</span><span className="price-icon"><ShieldCheck size={24} /></span><small>没有暗号也能使用</small><h2>年费会员</h2>
          <div className="price-line"><strong>¥2,800</strong><span>/ 年</span></div>
          <ul><li><Check size={17} /> 与暗号用户相同的完整功能</li><li><Check size={17} /> 会员有效期 12 个月</li><li><Check size={17} /> DeepSeek、益民居·数字人 Key 自主管理</li></ul>
          <button className="primary-button full" onClick={() => onNavigate("/register")}>注册并开通 <ArrowRight size={17} /></button>
        </article>
      </section>
      <p className="pricing-note">平台不代充 DeepSeek 或益民居·数字人余额，第三方调用费用由用户自己的账户承担。</p>
    </main>
  );
}
