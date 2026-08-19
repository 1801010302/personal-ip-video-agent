import { ArrowLeft, Construction, Sparkles } from "lucide-react";

export function PlaceholderPage({ title, description, onBack }: { title: string; description: string; onBack: () => void }) {
  return (
    <div className="page placeholder-page">
      <section className="empty-state large">
        <span><Construction size={30} /></span>
        <small className="eyebrow"><Sparkles size={14} /> 第一阶段骨架已就绪</small>
        <h1>{title}</h1><p>{description}</p>
        <button className="secondary-button" onClick={onBack}><ArrowLeft size={17} /> 返回工作台</button>
      </section>
    </div>
  );
}
