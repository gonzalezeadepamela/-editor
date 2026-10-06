import type { Caption } from "@remotion/captions";
export const FPS = 30;
export type Clip = {
  startFrame: number;
  endFrame: number;
  label: "Antes" | "Después" | "Normal";
};
export type Edit = {
  src: string;
  clips: Clip[];
  sticker: string;
  captions: Caption[];
  hook?: string;
};
export const durationFrames = (clips: Clip[]) =>
  clips.reduce((n, c) => n + c.endFrame - c.startFrame, 0);
/** RMS in 10 ms windows, across every channel. Only remove runs strictly > 400 ms.
 * Conservative frame rounding keeps audio adjacent to cut boundaries. */
export function cutSilences(
  channels: Float32Array[],
  sampleRate: number,
  duration: number,
  threshold = 0.015,
): Clip[] {
  if (!channels.length || !sampleRate || duration <= 0)
    throw new Error("Audio no válido");
  const length = Math.min(...channels.map((c) => c.length));
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const cuts: { start: number; end: number }[] = [];
  let silenceStart: number | null = null;
  const finish = (end: number) => {
    if (silenceStart !== null && (end - silenceStart) / sampleRate > 0.4 + 1e-9)
      cuts.push({ start: silenceStart / sampleRate, end: end / sampleRate });
    silenceStart = null;
  };
  for (let i = 0; i < length; i += window) {
    const end = Math.min(length, i + window);
    let sum = 0;
    for (const channel of channels)
      for (let j = i; j < end; j++) sum += channel[j] * channel[j];
    const rms = Math.sqrt(sum / ((end - i) * channels.length));
    if (rms < threshold) {
      if (silenceStart === null) silenceStart = i;
    } else finish(i);
  }
  finish(length);
  const total = Math.max(1, Math.floor(duration * FPS));
  let cursor = 0;
  const clips: Clip[] = [];
  for (const cut of cuts) {
    const start = Math.ceil(cut.start * FPS),
      end = Math.min(total, Math.floor(cut.end * FPS));
    if (end <= start) continue;
    if (start > cursor)
      clips.push({ startFrame: cursor, endFrame: start, label: "Normal" });
    cursor = Math.max(cursor, end);
  }
  if (cursor < total)
    clips.push({ startFrame: cursor, endFrame: total, label: "Normal" });
  return clips.map((c, i) => ({
    ...c,
    label: cuts.length > 0 ? (i === 0 ? "Antes" : "Después") : "Normal",
  }));
}
export function remapCaptions(captions: Caption[], clips: Clip[]): Caption[] {
  const output: Caption[] = [];
  let offset = 0;
  for (const clip of clips) {
    const start = (clip.startFrame / FPS) * 1000,
      end = (clip.endFrame / FPS) * 1000;
    for (const caption of captions) {
      const a = Math.max(start, caption.startMs),
        b = Math.min(end, caption.endMs);
      if (b > a)
        output.push({
          ...caption,
          startMs: offset + a - start,
          endMs: offset + b - start,
          timestampMs: null,
        });
    }
    offset += end - start;
  }
  return output;
}

/** Explicit demo words; these are sample text, never a speech recognition result. */
export function demoCaptions(duration: number): Caption[] {
  const words = "Descubre tu producto favorito y mira la diferencia".split(" ");
  const span = Math.min(duration, 6) * 1000;
  return words.map((word, i) => ({
    text: " " + word,
    startMs: (span * i) / words.length,
    endMs: (span * (i + 1)) / words.length,
    timestampMs: null,
    confidence: null,
  }));
}
