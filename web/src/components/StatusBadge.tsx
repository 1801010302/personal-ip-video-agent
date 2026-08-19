import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";

type Tone = "success" | "warning" | "neutral";

const icons = {
  success: CheckCircle2,
  warning: CircleAlert,
  neutral: CircleDashed,
};

export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = icons[tone];
  return (
    <span className={`status-badge status-${tone}`}>
      <Icon size={15} aria-hidden="true" />
      {children}
    </span>
  );
}
