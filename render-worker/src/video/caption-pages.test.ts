import assert from "node:assert/strict";
import test from "node:test";
import type { CaptionToken } from "../types";
import { activeCaptionPage, applyScriptPhraseBreaks, createCaptionPages, normalizeCaptionTokens } from "./caption-pages";

function tokens(text: string, gapAfter = -1): CaptionToken[] {
  return Array.from(text).map((character, index) => {
    const extraGap = gapAfter >= 0 && index > gapAfter ? 600 : 0;
    return { text: character, startMs: index * 300 + extraGap, endMs: index * 300 + extraGap + 340 };
  });
}

test("a subtitle page remains fixed while the active character advances", () => {
  const pages = createCaptionPages(tokens("真正决定口播效果的不是工具而是内容结构"), { maxChars: 12, targetDurationMs: 10_000 });
  const early = activeCaptionPage(pages, 200);
  const later = activeCaptionPage(pages, 1700);

  assert.equal(early.tokens.map((item) => item.text).join(""), later.tokens.map((item) => item.text).join(""));
  assert.ok(later.active > early.active);
  assert.ok(pages.every((page) => page.tokens.length <= 12));
});

test("long speech is paginated by duration instead of becoming a marquee", () => {
  const pages = createCaptionPages(tokens("你知道为什么知识付费老师都在用Codex而不是豆包"), {
    maxChars: 18,
    minChars: 6,
    targetDurationMs: 1450,
  });
  assert.ok(pages.length >= 4);
  assert.ok(pages.every((page) => page.endMs - page.startMs < 3000));
});

test("provider chunks are split while an English word stays on one page", () => {
  const normalized = normalizeCaptionTokens([
    { text: "都在用Codex", startMs: 0, endMs: 1200 },
    { text: "而不是", startMs: 1200, endMs: 1900 },
  ]);
  assert.deepEqual(normalized.map((token) => token.text), ["都", "在", "用", "Codex", "而", "不", "是"]);
  const pages = createCaptionPages(normalized, { maxChars: 8, targetDurationMs: 10_000 });
  assert.ok(pages.some((page) => page.tokens.some((token) => token.text === "Codex")));
  assert.ok(pages.every((page) => !page.tokens.some((token) => token.text === "Co" || token.text === "dex")));
});

test("approved script punctuation creates semantic subtitle pages", () => {
  const marked = applyScriptPhraseBreaks(tokens("第一句第二句第三句"), "第一句，第二句。第三句");
  const pages = createCaptionPages(marked, { maxChars: 18, targetDurationMs: 10_000 });
  assert.deepEqual(pages.map((page) => page.tokens.map((token) => token.text).join("")), ["第一句", "第二句", "第三句"]);
});

test("director cue notes do not become subtitle phrase boundaries", () => {
  const marked = applyScriptPhraseBreaks(tokens("第一句第二句"), "第一句。【情绪：真诚】第二句。");
  const pages = createCaptionPages(marked, { maxChars: 18, targetDurationMs: 10_000 });
  assert.deepEqual(pages.map((page) => page.tokens.map((token) => token.text).join("")), ["第一句", "第二句"]);
});

test("a natural pause starts a new subtitle line", () => {
  const pages = createCaptionPages(tokens("第一句第二句", 2), { maxChars: 12, pauseBreakMs: 380 });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].tokens.map((item) => item.text).join(""), "第一句");
  assert.equal(pages[1].tokens.map((item) => item.text).join(""), "第二句");
});

test("punctuation ends a complete semantic subtitle line", () => {
  const pages = createCaptionPages(tokens("先讲结论，再讲原因"), { maxChars: 12, minChars: 4 });
  assert.equal(pages[0].tokens.map((item) => item.text).join(""), "先讲结论，");
  assert.equal(pages[1].tokens.map((item) => item.text).join(""), "再讲原因");
});
