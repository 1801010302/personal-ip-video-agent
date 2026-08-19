import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import type { CaptionToken, RenderProps, TemplateId } from "../types";
import { activeCaptionPage, createCaptionPages } from "./caption-pages";
import { THEMES } from "./templates";

type VisualStyle = "clean" | "viral" | "brand";

const LABELS: Record<TemplateId, string> = {
  "clean-purple": "核心观点",
  "impact-yellow": "重点观点",
  "brand-gradient": "个人IP观点",
  "news-red": "热点快评",
  "knowledge-blue": "知识拆解",
  "minimal-white": "核心观点",
};

function themeFor(id: RenderProps["templateId"]) {
  return THEMES[id] || THEMES["impact-yellow"];
}

function styleFor(id: TemplateId): VisualStyle {
  if (id === "impact-yellow" || id === "news-red") return "viral";
  if (id === "brand-gradient" || id === "knowledge-blue") return "brand";
  return "clean";
}

function splitTitle(value: string, singleLineLimit: number) {
  const chars = Array.from(value.trim().replace(/\s+/gu, " ") || "精彩内容");
  if (chars.length <= singleLineLimit) return [chars.join("")];
  const middle = Math.ceil(chars.length / 2);
  const candidates = chars
    .map((character, index) => ({ character, index: index + 1 }))
    .filter(({ character, index }) => /[，,：:？！!?。]/u.test(character) && index >= Math.floor(chars.length * 0.32) && index <= Math.ceil(chars.length * 0.68));
  const splitAt = candidates.sort((a, b) => Math.abs(a.index - middle) - Math.abs(b.index - middle))[0]?.index ?? middle;
  return [chars.slice(0, splitAt).join(""), chars.slice(splitAt).join("")].filter(Boolean);
}

const Title = ({ title, portrait, templateId }: { title: string; portrait: boolean; templateId: TemplateId }) => {
  const frame = useCurrentFrame();
  const theme = themeFor(templateId);
  const visual = styleFor(templateId);
  const lines = splitTitle(title, portrait ? (visual === "brand" ? 12 : 8) : (visual === "brand" ? 9 : 6));
  const titleLength = Array.from(title).length;
  const opacity = interpolate(frame, [0, 16, 210, 240], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const y = interpolate(frame, [0, 18], [-28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const shared: CSSProperties = portrait
    ? { position: "absolute", left: 60, right: 60, top: 62, opacity, translate: `0 ${y}px`, textAlign: "center" }
    : { position: "absolute", left: 70, top: 64, opacity, translate: `0 ${y}px` };
  const fontSize = portrait ? (titleLength > 24 ? 50 : titleLength > 18 ? 57 : 66) : (titleLength > 24 ? 42 : titleLength > 18 ? 49 : 58);
  const cardWidth = portrait ? 850 : titleLength > 22 ? 650 : 560;

  if (visual === "viral") {
    return <div style={shared}>
      <div style={{ display: "inline-flex", padding: portrait ? "10px 22px" : "9px 18px", borderRadius: 999, background: theme.accent, color: templateId === "news-red" ? "white" : "#171A24", fontSize: portrait ? 31 : 27, fontWeight: 950, boxShadow: "0 10px 26px rgba(0,0,0,.22)" }}>
        {LABELS[templateId]}
      </div>
      <div style={{ margin: portrait ? "12px auto 0" : "11px 0 0", width: cardWidth, padding: portrait ? "19px 26px 22px" : "22px 28px 25px", borderRadius: 22, color: "white", background: "rgba(16,18,25,.90)", borderLeft: portrait ? undefined : `10px solid ${theme.accent2}`, borderBottom: portrait ? `8px solid ${theme.accent2}` : undefined, boxShadow: "0 18px 48px rgba(0,0,0,.28)", boxSizing: "border-box" }}>
        {lines.map((line, index) => <div key={`${index}-${line}`} style={{ marginTop: index ? 5 : 0, color: index ? theme.accent2 : "white", fontSize: index ? fontSize + 4 : fontSize, fontWeight: 950, lineHeight: 1.08, letterSpacing: -1.5, overflowWrap: "anywhere" }}>{line}</div>)}
      </div>
    </div>;
  }

  if (visual === "brand") {
    return <div style={{ ...shared, width: cardWidth, padding: portrait ? "20px 30px 23px" : "23px 30px 27px", borderRadius: 26, color: "white", background: theme.titleBg, boxShadow: "0 20px 52px rgba(37,38,110,.32)", textAlign: portrait ? "center" : "left", boxSizing: "border-box" }}>
      <div style={{ fontSize: portrait ? 27 : 23, fontWeight: 850, letterSpacing: 4, color: "rgba(255,255,255,.86)" }}>{LABELS[templateId]}</div>
      <div style={{ marginTop: 8, fontSize, fontWeight: 950, lineHeight: 1.1, letterSpacing: -1.3 }}>
        {lines.map((line, index) => <div key={`${index}-${line}`} style={{ overflowWrap: "anywhere" }}>{line}</div>)}
      </div>
    </div>;
  }

  const cleanAccent = templateId === "minimal-white" ? theme.accent2 : theme.accent;
  return <div style={shared}>
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: portrait ? "10px 20px" : "9px 16px", borderRadius: 999, background: "rgba(255,255,255,.93)", color: cleanAccent, fontSize: portrait ? 29 : 24, fontWeight: 900, boxShadow: "0 12px 30px rgba(0,0,0,.14)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: theme.accent2 }} />{LABELS[templateId]}
    </div>
    <div style={{ margin: portrait ? "13px auto 0" : "11px 0 0", width: cardWidth, padding: portrait ? "18px 28px 21px" : "21px 26px 24px", borderRadius: 22, background: "rgba(255,255,255,.93)", color: "#171A24", boxShadow: "0 18px 48px rgba(23,26,36,.18)", fontSize, fontWeight: 950, lineHeight: 1.08, letterSpacing: -1.5, boxSizing: "border-box" }}>
      {lines.map((line, index) => <div key={`${index}-${line}`} style={{ color: index ? cleanAccent : "#171A24", overflowWrap: "anywhere" }}>{line}</div>)}
    </div>
  </div>;
};

const CaptionLayer = ({ captions, portrait, templateId, scale = 1, position = "bottom" }: { captions: CaptionToken[]; portrait: boolean; templateId: TemplateId; scale?: number; position?: "bottom" | "middle" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const visual = styleFor(templateId);
  const pageOptions = portrait
    ? { maxChars: visual === "viral" ? 10 : 14, minChars: 6, targetDurationMs: visual === "viral" ? 1150 : 1500, pauseBreakMs: 260 }
    : { maxChars: visual === "viral" ? 10 : visual === "brand" ? 16 : 18, minChars: visual === "viral" ? 5 : 8, targetDurationMs: visual === "viral" ? 1050 : 1450, pauseBreakMs: 240 };
  const pages = useMemo(() => createCaptionPages(captions, pageOptions), [captions, pageOptions.maxChars, pageOptions.minChars, pageOptions.pauseBreakMs, pageOptions.targetDurationMs]);
  const page = activeCaptionPage(pages, timeMs);
  if (!page.tokens.length) return null;

  const base: CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: position === "middle" ? (portrait ? 680 : 360) : portrait ? (visual === "viral" ? 275 : 285) : (visual === "viral" ? 112 : visual === "brand" ? 78 : 82),
    width: portrait ? (visual === "viral" ? 960 : 900) : (visual === "brand" ? 1450 : 1500),
    minHeight: portrait ? 150 : (visual === "viral" ? 150 : visual === "brand" ? 142 : 132),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    padding: portrait ? (visual === "viral" ? "20px" : "23px 30px") : (visual === "viral" ? "18px 28px" : "20px 32px"),
    borderRadius: portrait ? 25 : 22,
    translate: "-50% 0",
    textAlign: "center",
    boxSizing: "border-box",
  };
  const wrapper: CSSProperties = {
    ...base,
    background: "rgba(13,15,21,.84)",
    boxShadow: "0 14px 42px rgba(0,0,0,.26)",
  };

  return <div style={wrapper}>{page.tokens.map((token, index) => {
    const active = timeMs >= token.startMs && timeMs < token.endMs;
    const common: CSSProperties = {
      display: "inline-block",
      margin: visual === "viral" ? "0 2px" : "0 1px",
      whiteSpace: "pre",
      fontFamily: '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif',
      fontWeight: 950,
      lineHeight: 1.28,
    };
    return <span key={`${token.startMs}-${index}`} style={{
      ...common,
      color: active ? "#FFD447" : "#FFFFFF",
      fontSize: (visual === "viral" ? (portrait ? 82 : 74) : (portrait ? 67 : 55)) * scale,
      textShadow: active ? "0 0 14px rgba(255,212,71,.48)" : undefined,
    }}>{token.text}</span>;
  })}</div>;
};

export const PackagedVideo = ({ videoSrc, coreTitle, templateId, captions, orientation, subtitlesEnabled = true, subtitleScale = 1, subtitlePosition = "bottom" }: RenderProps) => {
  const portrait = orientation === "portrait";
  return <AbsoluteFill style={{ backgroundColor: "#080A0F", fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif', overflow: "hidden" }}>
    <Video src={videoSrc.startsWith("http") ? videoSrc : staticFile(videoSrc)} objectFit="contain" style={{ width: "100%", height: "100%" }} />
    <AbsoluteFill style={{ background: portrait ? "linear-gradient(180deg,rgba(0,0,0,.10),transparent 38%,rgba(0,0,0,.15))" : "linear-gradient(180deg,rgba(20,22,34,.07),transparent 45%,rgba(10,12,20,.15))" }} />
    <Sequence from={0} durationInFrames={245}><Title title={coreTitle} portrait={portrait} templateId={templateId} /></Sequence>
    {subtitlesEnabled && <CaptionLayer captions={captions} portrait={portrait} templateId={templateId} scale={subtitleScale} position={subtitlePosition} />}
  </AbsoluteFill>;
};
