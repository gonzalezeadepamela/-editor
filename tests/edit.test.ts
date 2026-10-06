import { describe, it, expect } from "vitest";
import {
  cutSilences,
  durationFrames,
  remapCaptions,
  demoCaptions,
} from "../src/edit";
const wave = (parts: [number, number][]) =>
  new Float32Array(
    parts.flatMap(([seconds, value]) =>
      Array(Math.round(seconds * 1000)).fill(value),
    ),
  );
describe("silence cutting", () => {
  it("removes only silence longer than 400ms", () => {
    const audio = wave([
      [1, 0.3],
      [0.4, 0],
      [1, 0.3],
      [0.6, 0],
      [1, 0.3],
    ]);
    const clips = cutSilences([audio], 1000, 4);
    expect(clips).toEqual([
      { startFrame: 0, endFrame: 72, label: "Antes" },
      { startFrame: 90, endFrame: 120, label: "Después" },
    ]);
    expect(durationFrames(clips)).toBe(102);
  });
  it("keeps audio if either stereo channel is audible", () => {
    expect(
      durationFrames(cutSilences([wave([[2, 0]]), wave([[2, 0.3]])], 1000, 2)),
    ).toBe(60);
  });
  it("cuts leading and trailing silence", () => {
    expect(
      cutSilences(
        [
          wave([
            [0.5, 0],
            [1, 0.3],
            [0.5, 0],
          ]),
        ],
        1000,
        2,
      ),
    ).toEqual([{ startFrame: 15, endFrame: 45, label: "Antes" }]);
  });
  it("returns no clips for an entirely silent video", () =>
    expect(cutSilences([wave([[1, 0]])], 1000, 1)).toEqual([]));
  it("retains a fully audible video", () =>
    expect(durationFrames(cutSilences([wave([[1, 0.3]])], 1000, 1))).toBe(30));
  it("remaps and splits subtitles around cuts", () => {
    const result = remapCaptions(
      [
        {
          text: "Hola",
          startMs: 500,
          endMs: 2500,
          timestampMs: null,
          confidence: null,
        },
      ],
      [
        { startFrame: 0, endFrame: 30, label: "Antes" },
        { startFrame: 60, endFrame: 90, label: "Después" },
      ],
    );
    expect(result.map((c) => [c.startMs, c.endMs])).toEqual([
      [500, 1000],
      [1000, 1500],
    ]);
  });
});

describe("demo captions", () => {
  it("creates explicitly simulated captions within the video duration", () => {
    const captions = demoCaptions(2);
    expect(captions).toHaveLength(8);
    expect(captions[0].startMs).toBe(0);
    expect(captions.at(-1)?.endMs).toBe(2000);
    expect(
      captions.every((c) => c.confidence === null && c.endMs > c.startMs),
    ).toBe(true);
  });
});
