import { useMemo } from "react";
import { createTikTokStyleCaptions } from "@remotion/captions";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  spring,
} from "remotion";
import { FPS, remapCaptions, type Clip, type Edit } from "./edit";
function Shot({ src, clip }: { src: string; clip: Clip }) {
  const frame = useCurrentFrame();
  const duration = clip.endFrame - clip.startFrame;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={src}
        trimBefore={clip.startFrame}
        trimAfter={clip.endFrame}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${clip.label === "Normal" ? 1 : interpolate(frame, [0, Math.max(1, duration - 1)], [1, 1.15], { extrapolateRight: "clamp" })})`,
        }}
      />
      {clip.label !== "Normal" && (
        <div
          style={{
            position: "absolute",
            top: 120,
            left: 70,
            fontFamily: "sans-serif",
            fontSize: 42,
            fontWeight: 800,
            color: "white",
            background: "rgba(0,0,0,.5)",
            borderRadius: 24,
            padding: "16px 28px",
          }}
        >
          {clip.label}
        </div>
      )}
    </AbsoluteFill>
  );
}
export function VideoEdit({ src, clips, sticker, captions, hook = "" }: Edit) {
  const frame = useCurrentFrame();
  let offset = 0;
  const ms = (frame / FPS) * 1000;
  const pages = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions: remapCaptions(captions, clips),
        combineTokensWithinMilliseconds: 900,
        breakOnSilenceAfterMilliseconds: 300,
      }).pages,
    [captions, clips],
  );
  const page = pages.find(
    (p) => p.startMs <= ms && p.startMs + p.durationMs > ms,
  );
  return (
    <AbsoluteFill style={{ background: "#151820" }}>
      {clips.map((clip, i) => {
        const from = offset;
        offset += clip.endFrame - clip.startFrame;
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={clip.endFrame - clip.startFrame}
          >
            <Shot src={src} clip={clip} />
          </Sequence>
        );
      })}
      {hook && frame < 90 && (
        <div
          data-testid="hook"
          style={{
            position: "absolute",
            top: 260,
            left: 80,
            right: 80,
            textAlign: "center",
            fontFamily: "sans-serif",
            fontWeight: 900,
            fontSize: 82,
            lineHeight: 1.1,
            color: "white",
            opacity: interpolate(frame, [0, 4, 82, 90], [0, 1, 1, 0], {
              extrapolateRight: "clamp",
            }),
            transform: `scale(${0.8 + 0.2 * spring({ frame, fps: 30, config: { damping: 12, stiffness: 180 } })})`,
          }}
        >
          <span
            style={{
              display: "inline-block",
              padding: "32px 40px",
              background: "#7c3aed",
              borderRadius: 30,
              boxShadow: "0 12px 40px rgba(0,0,0,.3)",
              overflowWrap: "anywhere",
            }}
          >
            {hook}
          </span>
        </div>
      )}
      {page && (
        <div
          style={{
            position: "absolute",
            bottom: 350,
            left: 70,
            right: 70,
            textAlign: "center",
            fontSize: 58,
            lineHeight: 1.4,
            fontWeight: 800,
            fontFamily: "sans-serif",
            color: "white",
          }}
        >
          <div
            style={{
              display: "inline-block",
              background: "rgba(0,0,0,.78)",
              borderRadius: 22,
              padding: "18px 26px",
            }}
          >
            {page.tokens.map((token, i) => (
              <span
                key={i}
                style={{
                  color:
                    ms >= token.fromMs && ms < token.toMs ? "#c4b5fd" : "white",
                  background:
                    ms >= token.fromMs && ms < token.toMs
                      ? "#5b21b6"
                      : "transparent",
                  borderRadius: 10,
                  padding: "2px 5px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {token.text}
              </span>
            ))}
          </div>
        </div>
      )}
      {sticker && (
        <Img
          src={sticker}
          style={{
            position: "absolute",
            right: 54,
            bottom: 90,
            width: 230,
            height: 230,
            objectFit: "contain",
            filter: "drop-shadow(0 8px 18px rgba(0,0,0,.3))",
          }}
        />
      )}
    </AbsoluteFill>
  );
}
