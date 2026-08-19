import assert from "node:assert/strict";
import test from "node:test";
import { captionsFromRawTranscript, speechUnits } from "./transcript";

test("FunASR English words consume one timestamp each", () => {
  assert.deepEqual(speechUnits("学PPT用codex"), ["学", "PPT", "用", "codex"]);
  const result = captionsFromRawTranscript({
    text: "你用PPT和codex",
    timestamp: [[0, 100], [100, 220], [220, 520], [520, 650], [650, 980]],
  });
  assert.deepEqual(result.captions.map((item) => item.text), ["你", "用", "PPT", "和", "codex"]);
  assert.equal(result.captions.at(-1)?.endMs, 980);
});

test("punctuation is attached without consuming a speech timestamp", () => {
  const result = captionsFromRawTranscript({
    text: "第一句，第二句。",
    timestamp: [[0, 100], [100, 200], [200, 300], [400, 500], [500, 600], [600, 700]],
  });
  assert.deepEqual(result.captions.map((item) => item.text), ["第", "一", "句，", "第", "二", "句。"]);
  assert.equal(result.captions.at(-1)?.endMs, 700);
});

test("mismatched provider output still ends on the real final timestamp", () => {
  const result = captionsFromRawTranscript({ text: "甲乙丙丁", timestamp: [[100, 300], [300, 900]] });
  assert.equal(result.captions.at(0)?.startMs, 100);
  assert.equal(result.captions.at(-1)?.endMs, 900);
});
