import type { CSSProperties } from "react";
import type { TemplateId } from "../types";

export interface Theme {
  accent: string;
  accent2: string;
  titleBg: string;
  titleColor: string;
  subtitleBg: string;
  subtitleColor: string;
  titleStyle: CSSProperties;
}

export const THEMES: Record<TemplateId, Theme> = {
  "clean-purple": { accent: "#5B5CE2", accent2: "#FF684F", titleBg: "rgba(255,255,255,.95)", titleColor: "#151722", subtitleBg: "rgba(255,255,255,.94)", subtitleColor: "#171923", titleStyle: { borderBottom: "8px solid #5B5CE2" } },
  "impact-yellow": { accent: "#FFD447", accent2: "#FF5D45", titleBg: "rgba(16,18,25,.92)", titleColor: "#FFFFFF", subtitleBg: "rgba(13,15,21,.90)", subtitleColor: "#FFFFFF", titleStyle: { borderBottom: "9px solid #FF5D45" } },
  "brand-gradient": { accent: "#8587F5", accent2: "#FF7C63", titleBg: "linear-gradient(135deg,#35369A,#5B5CE2 62%,#8587F5)", titleColor: "#FFFFFF", subtitleBg: "rgba(53,54,154,.94)", subtitleColor: "#FFFFFF", titleStyle: {} },
  "news-red": { accent: "#FF344D", accent2: "#FFE047", titleBg: "rgba(156,8,30,.94)", titleColor: "#FFFFFF", subtitleBg: "rgba(24,20,22,.92)", subtitleColor: "#FFFFFF", titleStyle: { borderLeft: "12px solid #FFE047" } },
  "knowledge-blue": { accent: "#29A6FF", accent2: "#74F0C3", titleBg: "rgba(8,38,72,.94)", titleColor: "#FFFFFF", subtitleBg: "rgba(8,30,54,.90)", subtitleColor: "#FFFFFF", titleStyle: { borderTop: "7px solid #29A6FF" } },
  "minimal-white": { accent: "#20242F", accent2: "#5B5CE2", titleBg: "rgba(255,255,255,.96)", titleColor: "#181A21", subtitleBg: "rgba(255,255,255,.94)", subtitleColor: "#181A21", titleStyle: { border: "2px solid rgba(20,25,35,.12)" } },
};
