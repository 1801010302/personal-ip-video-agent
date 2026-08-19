import type { CaptionToken } from "../types";

export type CaptionPage = {
  tokens: CaptionToken[];
  startMs: number;
  endMs: number;
};

export type CaptionPageOptions = {
  maxChars: number;
  minChars?: number;
  pauseBreakMs?: number;
  targetDurationMs?: number;
};

const PHRASE_END = /[。！？；，：,.!?;:]$/u;
const LATIN = /^[A-Za-z0-9+#._-]$/u;
const CUE_WORDS = /(情绪|音乐|停顿|动作|镜头|画面|语气|字幕|标题|转场|音效|节奏)/u;

function tokenLength(token: CaptionToken) {
  return Array.from(token.text.trim()).length;
}

/**
 * FunASR normally returns one timestamp per character, but cached or provider
 * transcripts can contain whole words. Split those chunks first, then keep an
 * English word together so a page never ends with "Co" and starts with "dex".
 */
export function normalizeCaptionTokens(captions: CaptionToken[]): CaptionToken[] {
  const characters = captions.flatMap((token) => {
    const values = Array.from(token.text).filter((value) => !/\s/u.test(value));
    if (values.length <= 1) return values.length ? [{ ...token, text: values[0] }] : [];
    const duration = Math.max(values.length, token.endMs - token.startMs);
    return values.map((text, index) => ({
      text,
      startMs: token.startMs + duration * index / values.length,
      endMs: token.startMs + duration * (index + 1) / values.length,
      breakAfter: index === values.length - 1 ? token.breakAfter : undefined,
    }));
  });

  const result: CaptionToken[] = [];
  for (const token of characters) {
    const previous = result[result.length - 1];
    if (previous && LATIN.test(previous.text.at(-1) || "") && LATIN.test(token.text)) {
      previous.text += token.text;
      previous.endMs = token.endMs;
      previous.breakAfter = token.breakAfter;
    } else {
      result.push({ ...token });
    }
  }
  return result;
}

function visibleScript(value: string) {
  return value
    .replace(/【([^】]*)】|\[([^\]]*)\]|（([^）]*)）/gu, (match, a, b, c) => CUE_WORDS.test(String(a || b || c || "")) ? "" : match)
    .replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+[.)、]\s*)/gmu, "")
    .trim();
}

function countVisibleChars(value: string) {
  return Array.from(value.replace(/[\s。！？；，：,.!?;:]/gu, "")).length;
}

/** Project punctuation and line breaks from the approved script onto ASR timestamps. */
export function applyScriptPhraseBreaks(captions: CaptionToken[], script: string): CaptionToken[] {
  const tokens: CaptionToken[] = normalizeCaptionTokens(captions).map((token) => ({ ...token, breakAfter: undefined }));
  const phrases = visibleScript(script)
    .split(/(?<=[。！？；，：,.!?;:]|\n)/u)
    .map((item) => countVisibleChars(item))
    .filter((length) => length > 0);
  const scriptLength = phrases.reduce((sum, length) => sum + length, 0);
  const captionLength = tokens.reduce((sum, token) => sum + tokenLength(token), 0);
  if (phrases.length < 2 || !scriptLength || !captionLength || Math.abs(scriptLength - captionLength) / scriptLength > 0.2) return tokens;

  let scriptCursor = 0;
  let tokenCursor = 0;
  let captionCursor = 0;
  for (const phraseLength of phrases.slice(0, -1)) {
    scriptCursor += phraseLength;
    const target = Math.round(scriptCursor / scriptLength * captionLength);
    while (tokenCursor < tokens.length - 1 && captionCursor + tokenLength(tokens[tokenCursor]) < target) {
      captionCursor += tokenLength(tokens[tokenCursor]);
      tokenCursor += 1;
    }
    tokens[tokenCursor].breakAfter = true;
  }
  return tokens;
}

export function createCaptionPages(
  captions: CaptionToken[],
  {
    maxChars,
    minChars = 5,
    pauseBreakMs = 260,
    targetDurationMs = 1450,
  }: CaptionPageOptions,
): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: CaptionToken[] = [];
  let currentLength = 0;
  const normalizedCaptions = normalizeCaptionTokens(captions);
  const hasScriptBreaks = normalizedCaptions.some((token) => token.breakAfter);

  const finalize = (items: CaptionPage[]) => items.map((page, index) => ({
    ...page,
    endMs: items[index + 1]?.startMs ?? page.endMs + 350,
  }));

  if (hasScriptBreaks) {
    const phrases: CaptionToken[][] = [];
    let phrase: CaptionToken[] = [];
    for (const token of normalizedCaptions) {
      phrase.push(token);
      if (token.breakAfter) {
        phrases.push(phrase);
        phrase = [];
      }
    }
    if (phrase.length) phrases.push(phrase);

    const groups: CaptionToken[][] = [];
    for (const phraseTokens of phrases) {
      const total = phraseTokens.reduce((sum, token) => sum + tokenLength(token), 0);
      const partCount = Math.max(1, Math.ceil(total / maxChars));
      const balancedTarget = Math.ceil(total / partCount);
      let group: CaptionToken[] = [];
      let length = 0;
      for (const token of phraseTokens) {
        if (group.length && length + tokenLength(token) > balancedTarget) {
          groups.push(group);
          group = [];
          length = 0;
        }
        group.push(token);
        length += tokenLength(token);
      }
      if (group.length) groups.push(group);
    }
    return finalize(groups.map((tokens) => ({
      tokens,
      startMs: tokens[0].startMs,
      endMs: tokens[tokens.length - 1].endMs,
    })));
  }

  const flush = () => {
    if (!current.length) return;
    pages.push({
      tokens: current,
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
    });
    current = [];
    currentLength = 0;
  };

  for (const token of normalizedCaptions) {
    const previous = current[current.length - 1];
    const length = tokenLength(token);
    const pause = previous ? token.startMs - previous.endMs : 0;
    const pageDuration = current.length ? token.endMs - current[0].startMs : 0;
    const startsAfterPause = !hasScriptBreaks && currentLength >= 3 && pause >= pauseBreakMs;
    const lastsTooLong = !hasScriptBreaks && currentLength >= minChars && pageDuration >= targetDurationMs && !PHRASE_END.test(token.text.trim());
    const wouldOverflow = current.length > 0 && currentLength + length > maxChars;

    if (startsAfterPause || lastsTooLong || wouldOverflow) flush();
    current.push(token);
    currentLength += length;

    if (token.breakAfter || (currentLength >= minChars && PHRASE_END.test(token.text.trim()))) flush();
    else if (currentLength >= maxChars) flush();
  }
  flush();

  // Keep the complete sentence visible until the next sentence starts. This
  // is the page-by-page behavior used by the accepted local previews.
  return finalize(pages);
}

export function activeCaptionPage(pages: CaptionPage[], timeMs: number) {
  const page = pages.find((item) => timeMs >= item.startMs && timeMs < item.endMs);
  if (!page) return { tokens: [] as CaptionToken[], active: -1, startMs: 0, endMs: 0 };

  let active = 0;
  page.tokens.forEach((token, index) => {
    if (timeMs >= token.startMs) active = index;
  });
  return { tokens: page.tokens, active, startMs: page.startMs, endMs: page.endMs };
}
