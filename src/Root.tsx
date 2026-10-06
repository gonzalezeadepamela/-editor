import { Composition } from "remotion";
import { VideoEdit } from "./Video";
import { durationFrames, type Edit } from "./edit";
const defaults: Edit = {
  src: "",
  clips: [],
  sticker: "",
  captions: [],
  hook: "GANCHO 1",
};
export const Root = () => (
  <Composition
    id="ProductVideo"
    component={VideoEdit}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={defaults}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, durationFrames(props.clips)),
    })}
  />
);
