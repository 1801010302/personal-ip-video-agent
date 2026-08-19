import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { CaptionToken, RenderProps } from "./types";
import { applyScriptPhraseBreaks } from "./video/caption-pages";

const execFileAsync = promisify(execFile);
const input = process.argv[2];
const output = process.argv[3] || resolve("sample-output.mp4");
const requestedOrientation = process.argv[4];
const requestedTemplate = process.argv[5];
if (!input) throw new Error("Usage: npm run render:sample -- input.mp4 output.mp4 [portrait|landscape|auto] [templateId]");
const temp = resolve(`.sample-runtime-${process.pid}`);
const publicDir = resolve(temp, "public");
await rm(temp, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await execFileAsync("ffmpeg", ["-y", "-i", resolve(input), "-t", "8", "-c", "copy", resolve(publicDir, "input.mp4")]);
const { stdout: dimensions } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", resolve(input)]);
const [width, height] = dimensions.trim().split("x").map(Number);
const orientation = requestedOrientation === "portrait" || requestedOrientation === "landscape" ? requestedOrientation : height > width ? "portrait" : "landscape";
const templateId = (requestedTemplate || "impact-yellow") as RenderProps["templateId"];
const fallbackPhrase = Array.from("真正决定口播效果的不是工具而是内容结构");
let captions: CaptionToken[] = fallbackPhrase.map((text, index) => ({ text, startMs: index * 360, endMs: index * 360 + 420 }));
try {
  captions = JSON.parse(await readFile(resolve(dirname(resolve(input)), "captions.json"), "utf8")) as CaptionToken[];
} catch {
  // Standalone samples use the deterministic fallback above.
}
const samplePhrases = orientation === "portrait"
  ? ["都2026年了", "别再免费送鸡蛋", "拉群做团购了", "群里全是僵尸粉", "三个月亏光退场", "这种老路早就走不通了"]
  : ["很多父母", "拼尽全力爱孩子", "却把孩子越推越远", "为什么", "因为你给的爱", "全是控制", "你管他几点睡", "管他交什么朋友"];
const sampleText = captions.map((token) => token.text).join("");
const samplePrefixLength = samplePhrases.reduce((sum, phrase) => sum + Array.from(phrase).length, 0);
captions = applyScriptPhraseBreaks(captions, `${samplePhrases.join("，")}，${Array.from(sampleText).slice(samplePrefixLength).join("")}`);
const coreTitle = orientation === "portrait" ? "别再送鸡蛋拉群做团购" : "别让爱变成控制";
const props: RenderProps = { videoSrc: "input.mp4", coreTitle, templateId, captions, durationMs: 8000, orientation };
const browserExecutable = process.env.CHROME_EXECUTABLE || undefined;
const chromeMode = browserExecutable ? "chrome-for-testing" as const : undefined;
const serveUrl = await bundle({ entryPoint: resolve(fileURLToPath(new URL("./index.ts", import.meta.url))), publicDir });
const composition = await selectComposition({ serveUrl, id: "PackagedVideo", inputProps: props, browserExecutable, chromeMode });
await renderMedia({ serveUrl, composition, codec: "h264", outputLocation: output, inputProps: props, concurrency: 1, crf: 22, browserExecutable, chromeMode });
await rm(temp, { recursive: true, force: true });
console.log(JSON.stringify({ output }));
