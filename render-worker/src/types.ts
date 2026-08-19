export type TemplateId = "clean-purple" | "impact-yellow" | "brand-gradient" | "news-red" | "knowledge-blue" | "minimal-white";

export interface CaptionToken {
  text: string;
  startMs: number;
  endMs: number;
  breakAfter?: boolean;
}

export interface RenderProps extends Record<string, unknown> {
  videoSrc: string;
  coreTitle: string;
  templateId: TemplateId;
  captions: CaptionToken[];
  durationMs: number;
  orientation: "portrait" | "landscape";
  subtitlesEnabled?: boolean;
  subtitleScale?: number;
  subtitlePosition?: "bottom" | "middle";
}

export interface ClaimedJob {
  id: string;
  leaseExpiresAt: number;
  inputUrl: string;
  outputUrl: string;
  outputHeaders: Record<string, string>;
  request: {
    sourceJobId: string;
    templateId?: TemplateId;
    orientation?: "auto" | "portrait" | "landscape";
    coreTitle?: string;
    script?: string;
    subtitlesEnabled?: boolean;
    subtitleScale?: number;
    subtitlePosition?: "bottom" | "middle";
    outputPath: string;
  };
}

export interface ClaimedCoverJob {
  id: string;
  leaseExpiresAt: number;
  apiKey: string;
  apiBase: string;
  idempotencyKey: string;
  request: {
    prompt: string;
    size: "16:9" | "9:16";
    imageUrls: string[];
  };
}
