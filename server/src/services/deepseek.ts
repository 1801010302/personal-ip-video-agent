const DEFAULT_API_BASE = "https://api.deepseek.com";

interface DeepSeekModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

export interface DeepSeekConnectionResult {
  models: string[];
}

export class DeepSeekRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "DeepSeekRequestError";
    this.status = status;
    this.code = code;
  }
}

interface ScriptResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export interface GeneratedScript {
  title: string;
  content: string;
  hook: string;
  closing: string;
  estimatedSeconds: number;
  model: string;
  structure: string;
  characterCount: number;
}

export interface ScriptAnimationCue {
  id: string;
  triggerText: string;
  type: "keyword" | "number" | "list" | "warning" | "quote" | "cta";
  headline: string;
  detail: string;
  intensity: "low" | "medium" | "high";
}

export interface ScriptAnalysis {
  coreTitle: string;
  alternativeTitles: string[];
  coverSubtitle: string;
  keywords: string[];
  contentType: string;
  emotion: string;
  animationPlan: ScriptAnimationCue[];
  model: string;
}

const MAX_SCRIPT_CHARS = 1300;
const TONE_STRUCTURES: Record<string, string> = {
  "真诚、有经验感": "结果或亲身经历钩子 → 点出问题 → 讲曾经的错误 → 出现转折 → 给出方法 → 真诚建议",
  "犀利、强观点": "反常识结论 → 普遍误区 → 错误代价 → 核心观点 → 案例论证 → 行动方法",
  "温暖、像朋友聊天": "生活场景 → 真实情绪 → 表达理解 → 分享自己的感受 → 温和建议 → 陪伴式结尾",
  "专业、结构清晰": "明确问题 → 分析原因 → 先给结论 → 分步解决 → 提醒常见误区 → 行动清单",
};

const LENGTH_RANGES = [
  { seconds: 30, min: 110, max: 150 },
  { seconds: 60, min: 220, max: 260 },
  { seconds: 90, min: 320, max: 390 },
  { seconds: 120, min: 480, max: 560 },
  { seconds: 180, min: 720, max: 820 },
  { seconds: 240, min: 950, max: 1080 },
  { seconds: 300, min: 1180, max: 1300 },
];

export function talkingScriptStructure(tone?: string): string {
  return TONE_STRUCTURES[tone || ""] || TONE_STRUCTURES["真诚、有经验感"];
}

function lengthRangeFor(duration: number) {
  return LENGTH_RANGES.find((item) => duration <= item.seconds) || LENGTH_RANGES.at(-1)!;
}

function effectiveLength(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

async function requestScript(apiKey: string, apiBase: string, system: string, prompt: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        temperature: 0.72,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new DeepSeekRequestError("DeepSeek 暂时无法连接，请稍后重试", 503, "DEEPSEEK_UNAVAILABLE");
  }
  const payload = await response.json().catch(() => null) as ScriptResponse | null;
  if (!response.ok) {
    throw new DeepSeekRequestError(payload?.error?.message || "DeepSeek 文案生成失败", response.status, "DEEPSEEK_ERROR");
  }
  const raw = payload?.choices?.[0]?.message?.content?.trim() || "";
  try {
    return JSON.parse(raw.replace(/^```json\s*/u, "").replace(/\s*```$/u, "")) as Record<string, unknown>;
  } catch {
    throw new DeepSeekRequestError("DeepSeek 返回了无法识别的文案格式，请重试", 502, "INVALID_MODEL_RESPONSE");
  }
}

export async function generateTalkingScript(
  apiKey: string,
  apiBase: string,
  input: {
    ideas: string;
    tone?: string;
    audience?: string;
    durationSeconds?: number;
    extra?: string;
  },
): Promise<GeneratedScript> {
  const duration = Math.min(300, Math.max(15, Math.round(input.durationSeconds || 60)));
  const range = lengthRangeFor(duration);
  const structure = talkingScriptStructure(input.tone);
  const system = [
    "你是一名中文短视频口播文案策划师。",
    "把用户的零散想法整理成可直接口播的稿子，开头必须有3秒钩子，中段逻辑清晰，结尾有自然行动召唤。",
    "句子要短，说人话，避免书面腔、空洞金句和夸张承诺。",
    "不要在口播正文中写出结构名称、章节标题、字数说明或创作解释。",
    `正文去除空格和换行后绝对不能超过 ${MAX_SCRIPT_CHARS} 个汉字或字符。`,
    "只返回 JSON，字段为 title、content、hook、closing、estimatedSeconds。",
  ].join("\n");
  const prompt = [
    `零散想法：${input.ideas}`,
    `目标受众：${input.audience || "普通短视频用户"}`,
    `口吻：${input.tone || "真诚、有经验感"}`,
    `爆款结构：${structure}`,
    `目标时长：${duration}秒`,
    `正文目标字数：去除空格和换行后 ${range.min} 至 ${range.max} 字，最多不能超过 ${range.max} 字`,
    `其他要求：${input.extra || "无"}`,
  ].join("\n");
  let parsed = await requestScript(apiKey, apiBase, system, prompt);
  let content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!content) throw new DeepSeekRequestError("DeepSeek 未生成有效文案，请重试", 502, "EMPTY_MODEL_RESPONSE");
  let characterCount = effectiveLength(content);
  if (characterCount > range.max || characterCount > MAX_SCRIPT_CHARS) {
    parsed = await requestScript(apiKey, apiBase, system, [
      "请压缩下面这份口播稿，保留原观点、开头钩子、论证和自然结尾。",
      `压缩后正文去除空格和换行必须在 ${range.min} 至 ${range.max} 字之间，绝不能超过 ${range.max} 字。`,
      `仍然只返回规定的 JSON。原结果：${JSON.stringify(parsed)}`,
    ].join("\n"));
    content = typeof parsed.content === "string" ? parsed.content.trim() : "";
    characterCount = effectiveLength(content);
  }
  if (!content || characterCount > range.max || characterCount > MAX_SCRIPT_CHARS) {
    throw new DeepSeekRequestError("生成文案超过目标时长，请重试", 502, "SCRIPT_TOO_LONG");
  }
  return {
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : Array.from(content).slice(0, 18).join(""),
    content,
    hook: typeof parsed.hook === "string" ? parsed.hook.trim() : "",
    closing: typeof parsed.closing === "string" ? parsed.closing.trim() : "",
    estimatedSeconds: Math.min(300, typeof parsed.estimatedSeconds === "number" ? parsed.estimatedSeconds : duration),
    model: "deepseek-chat",
    structure,
    characterCount,
  };
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, max)
    : [];
}

export async function analyzeTalkingScript(apiKey: string, apiBase: string, content: string): Promise<ScriptAnalysis> {
  const system = [
    "你是中文短视频内容总监，负责把已经定稿的口播文案提炼成视频标题和封面文案。",
    "核心标题必须能准确概括内容，又能制造好奇、冲突或明确利益点；不允许标题党与虚假承诺。",
    "只返回JSON：coreTitle、alternativeTitles、coverSubtitle、keywords、contentType、emotion。",
  ].join("\n");
  const parsed = await requestScript(apiKey, apiBase, system, `定稿口播文案：\n${content}`);
  const fallback = Array.from(content.replace(/\s/gu, "")).slice(0, 18).join("");
  return {
    coreTitle: typeof parsed.coreTitle === "string" && parsed.coreTitle.trim() ? parsed.coreTitle.trim().slice(0, 32) : fallback,
    alternativeTitles: stringList(parsed.alternativeTitles, 3).map((item) => item.slice(0, 32)),
    coverSubtitle: typeof parsed.coverSubtitle === "string" ? parsed.coverSubtitle.trim().slice(0, 40) : "",
    keywords: stringList(parsed.keywords, 8),
    contentType: typeof parsed.contentType === "string" && parsed.contentType.trim() ? parsed.contentType.trim() : "观点口播",
    emotion: typeof parsed.emotion === "string" && parsed.emotion.trim() ? parsed.emotion.trim() : "有力量",
    animationPlan: [],
    model: "deepseek-chat",
  };
}

export function getDeepSeekApiBase(value: string | null): string {
  const base = (value || DEFAULT_API_BASE).replace(/\/+$/u, "");
  if (base !== DEFAULT_API_BASE) throw new Error("DeepSeek API 基础地址与受信任地址不一致");
  return base;
}

export async function testDeepSeekConnection(
  apiKey: string,
  apiBase: string,
): Promise<DeepSeekConnectionResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new DeepSeekRequestError("暂时无法连接 DeepSeek，请稍后重试", 503, "DEEPSEEK_UNAVAILABLE");
  }

  const payload = (await response.json().catch(() => null)) as DeepSeekModelsResponse | null;
  if (!response.ok || !payload?.data) {
    const unauthorized = response.status === 401 || response.status === 403;
    throw new DeepSeekRequestError(
      unauthorized ? "这个 DeepSeek API Key 无效" : payload?.error?.message || "DeepSeek 连接测试失败",
      response.status,
      unauthorized ? "INVALID_API_KEY" : "DEEPSEEK_ERROR",
    );
  }

  return { models: payload.data.map((model) => model.id).filter((id): id is string => Boolean(id)) };
}
