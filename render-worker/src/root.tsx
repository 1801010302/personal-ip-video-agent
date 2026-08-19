import { Composition } from "remotion";
import { PackagedVideo } from "./video/PackagedVideo";
import type { RenderProps } from "./types";

const defaults: RenderProps = {
  videoSrc: "",
  coreTitle: "核心标题",
  templateId: "impact-yellow",
  captions: [],
  durationMs: 10_000,
  orientation: "portrait",
};

export const Root = () => (
  <Composition
    id="PackagedVideo"
    component={PackagedVideo}
    defaultProps={defaults}
    durationInFrames={300}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.ceil(props.durationMs / 1000 * 30)),
      width: props.orientation === "landscape" ? 1920 : 1080,
      height: props.orientation === "landscape" ? 1080 : 1920,
      fps: 30,
    })}
  />
);
