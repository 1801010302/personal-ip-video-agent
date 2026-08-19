import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { CaptionToken } from "./types";

const execFileAsync = promisify(execFile);

export type RawTranscript = { text?: string; timestamp?: unknown[]; sentence_info?: Array<{ text?: string; start?: number; end?: number; timestamp?: unknown[] }> };

const LATIN = /^[A-Za-z0-9+#._-]$/u;
const PUNCTUATION = /^[。！？；，：,.!?;:]$/u;

/** FunASR gives one timestamp to a whole English word, not to each letter. */
export function speechUnits(value: string) {
  const units: string[] = [];
  for (const character of Array.from(value.replace(/\s/gu, ""))) {
    const previous = units[units.length - 1];
    if (previous && LATIN.test(previous.at(-1) || "") && LATIN.test(character)) units[units.length - 1] += character;
    else units.push(character);
  }
  return units;
}

function timestampPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const start = Number(value[0]); const end = Number(value[1]);
  return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
}

function captionsForText(value: string, pairs: Array<[number, number]>): CaptionToken[] {
  const units = speechUnits(value);
  if (!units.length) return [];
  if (pairs.length >= units.length) return units.map((text, index) => ({ text, startMs: pairs[index][0], endMs: pairs[index][1] }));

  const spokenUnits = units.filter((unit) => !PUNCTUATION.test(unit));
  if (pairs.length >= spokenUnits.length && spokenUnits.length > 0) {
    const captions: CaptionToken[] = [];
    let pairIndex = 0;
    for (const unit of units) {
      if (PUNCTUATION.test(unit)) {
        if (captions.length) captions[captions.length - 1].text += unit;
        continue;
      }
      captions.push({ text: unit, startMs: pairs[pairIndex][0], endMs: pairs[pairIndex][1] });
      pairIndex += 1;
    }
    return captions;
  }

  if (pairs.length) {
    // A rare provider mismatch should still end on the real audio timestamp.
    // Proportional mapping is safer than the old fixed 240 ms per character,
    // which accumulated several seconds of drift over a short video.
    return units.map((text, index) => {
      const first = Math.min(pairs.length - 1, Math.floor(index * pairs.length / units.length));
      const last = Math.min(pairs.length - 1, Math.max(first, Math.ceil((index + 1) * pairs.length / units.length) - 1));
      return { text, startMs: pairs[first][0], endMs: pairs[last][1] };
    });
  }
  return [];
}

export function captionsFromRawTranscript(raw: RawTranscript): { text: string; captions: CaptionToken[] } {
  const text = raw.text || "";
  const pairs = (raw.timestamp || []).map(timestampPair).filter((item): item is [number, number] => Boolean(item));
  const direct = captionsForText(text, pairs);
  if (direct.length) return { text, captions: direct };

  const captions: CaptionToken[] = [];
  for (const sentence of raw.sentence_info || []) {
    const sentencePairs = (sentence.timestamp || []).map(timestampPair).filter((item): item is [number, number] => Boolean(item));
    const timed = captionsForText(sentence.text || "", sentencePairs);
    if (timed.length) {
      captions.push(...timed);
      continue;
    }
    const units = speechUnits(sentence.text || "");
    if (!units.length) continue;
    const start = Number(sentence.start || 0); const end = Number(sentence.end || start + units.length * 240);
    units.forEach((unit, index) => captions.push({ text: unit, startMs: start + (end - start) * index / units.length, endMs: start + (end - start) * (index + 1) / units.length }));
  }
  if (!captions.length) {
    const units = speechUnits(text);
    units.forEach((unit, index) => captions.push({ text: unit, startMs: index * 240, endMs: (index + 1) * 240 }));
  }
  return { text, captions };
}

export async function transcribe(inputWav: string, outputJson: string, python: string): Promise<{ text: string; captions: CaptionToken[] }> {
  await execFileAsync(python, [fileURLToPath(new URL("../python/transcribe.py", import.meta.url)), inputWav, outputJson], { timeout: 45 * 60_000, maxBuffer: 10 * 1024 * 1024 });
  return captionsFromRawTranscript(JSON.parse(await readFile(outputJson, "utf8")) as RawTranscript);
}
