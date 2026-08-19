import { AudioLines } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="个人 IP 口播智能体">
      <span className="brand-mark" aria-hidden="true">
        <AudioLines size={compact ? 19 : 22} strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>口播智能体</strong>
          <small>想法到成片</small>
        </span>
      )}
    </div>
  );
}
