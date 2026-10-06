import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { z } from "zod";
import { durationFrames, demoCaptions, type Edit } from "../src/edit";
const app = express();
const storage = path.resolve(".local/media"),
  exportsDir = path.resolve(".local/exports");
mkdirSync(storage, { recursive: true });
mkdirSync(exportsDir, { recursive: true });
const types: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const upload = multer({
  storage: multer.diskStorage({
    destination: storage,
    filename: (_req, file, cb) => cb(null, randomUUID() + types[file.mimetype]),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(types[file.mimetype])),
});
app.use(express.json({ limit: "2mb" }));
app.use("/media", express.static(storage));
app.use("/exports", express.static(exportsDir));
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    transcriptionMode: "demo",
  }),
);
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({
      error: "Formato no compatible. Usa MP4, MOV, WebM, PNG, JPG o WebP.",
    });
    return;
  }
  let duration: number | undefined, hasAudio: boolean | undefined;
  if (req.file.mimetype.startsWith("video/")) {
    try {
      const { stdout } = await promisify(execFile)("ffprobe", [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        req.file.path,
      ]);
      const info = JSON.parse(stdout);
      duration = Number(info.format.duration);
      hasAudio = info.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      );
      if (
        !Number.isFinite(duration) ||
        !info.streams.some(
          (s: { codec_type: string }) => s.codec_type === "video",
        )
      )
        throw new Error();
    } catch {
      res.status(400).json({
        error: "No se pudo leer el video. Usa un archivo de video válido.",
      });
      return;
    }
  }
  res.json({ src: "/media/" + req.file.filename, duration, hasAudio });
});
const media = z
  .string()
  .regex(/^\/media\/[a-f0-9-]{36}\.(mp4|mov|webm|png|jpg|webp)$/)
  .refine((s) => existsSync(path.join(storage, path.basename(s))));
const schema = z.object({
  hook: z.string().max(120).default(""),
  src: media,
  sticker: z.union([media, z.literal("")]),
  clips: z
    .array(
      z
        .object({
          startFrame: z.number().int().min(0),
          endFrame: z.number().int().positive(),
          label: z.enum(["Antes", "Después", "Normal"]),
        })
        .refine((c) => c.endFrame > c.startFrame),
    )
    .min(1)
    .max(500),
  captions: z
    .array(
      z.object({
        text: z.string().max(2000),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        timestampMs: z.number().nullable(),
        confidence: z.number().nullable(),
      }),
    )
    .max(10000),
});
type ExportFile = { label: string; url: string };
type Job = {
  status: "rendering" | "done" | "error";
  progress: number;
  url?: string;
  files?: ExportFile[];
  error?: string;
};
const jobs = new Map<string, Job>();
let busy = false;
let bundlePromise: Promise<string> | undefined;
const browserExecutable = existsSync("/usr/bin/chromium")
  ? "/usr/bin/chromium"
  : undefined;
function beginExport(
  req: express.Request,
  res: express.Response,
  batch: boolean,
) {
  const parsed = schema.safeParse(req.body);
  const hooks = batch
    ? z
        .array(z.string().trim().min(1).max(120))
        .length(3)
        .safeParse(req.body.hooks)
    : null;
  if (!parsed.success || (batch && !hooks?.success)) {
    res.status(400).json({ error: "Timeline, archivos o ganchos no válidos." });
    return;
  }
  if (durationFrames(parsed.data.clips) > 30 * 60 * 30) {
    res.status(400).json({ error: "El límite de exportación es 30 minutos." });
    return;
  }
  if (busy) {
    res.status(409).json({ error: "Ya hay una exportación en curso." });
    return;
  }
  const id = randomUUID();
  const job: Job = { status: "rendering", progress: 0, files: [] };
  jobs.set(id, job);
  busy = true;
  res.json({ id });
  const variants = hooks?.success ? hooks.data : [parsed.data.hook];
  void (async () => {
    try {
      bundlePromise ??= bundle({ entryPoint: path.resolve("src/remotion.ts") });
      const serveUrl = await bundlePromise;
      for (let index = 0; index < variants.length; index++) {
        const inputProps: Edit = {
          ...parsed.data,
          hook: variants[index],
          src: "http://127.0.0.1:3001" + parsed.data.src,
          sticker: parsed.data.sticker
            ? "http://127.0.0.1:3001" + parsed.data.sticker
            : "",
        };
        const composition = await selectComposition({
          serveUrl,
          id: "ProductVideo",
          inputProps,
          browserExecutable,
        });
        const filename = id + "-" + (index + 1) + ".mp4";
        await renderMedia({
          composition,
          serveUrl,
          codec: "h264",
          audioCodec: "aac",
          pixelFormat: "yuv420p",
          inputProps,
          outputLocation: path.join(exportsDir, filename),
          browserExecutable,
          concurrency: 1,
          onProgress: ({ progress }) => {
            job.progress = (index + progress) / variants.length;
          },
        });
        job.files!.push({
          label: batch ? "GANCHO " + (index + 1) : "Video",
          url: "/exports/" + filename,
        });
      }
      Object.assign(job, {
        status: "done",
        progress: 1,
        url: job.files![0].url,
      });
    } catch (error) {
      bundlePromise = undefined;
      Object.assign(job, {
        status: "error",
        error: error instanceof Error ? error.message : "Error al exportar",
      });
    } finally {
      busy = false;
    }
  })();
}
app.post("/api/export", (req, res) => beginExport(req, res, false));
app.post("/api/export-batch", (req, res) => beginExport(req, res, true));
app.get("/api/export/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Exportación no encontrada" });
    return;
  }
  res.json(job);
});
// Demo mode intentionally uses sample words instead of downloading a speech model.
app.post("/api/transcribe", async (req, res) => {
  const input = z.object({ src: media }).safeParse(req.body);
  if (!input.success || !/\.(mp4|mov|webm)$/.test(input.data.src)) {
    res.status(400).json({ error: "Video no válido" });
    return;
  }
  try {
    const { stdout } = await promisify(execFile)("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      path.join(storage, path.basename(input.data.src)),
    ]);
    const duration = Number(JSON.parse(stdout).format.duration);
    res.json({ mode: "demo", captions: demoCaptions(duration) });
  } catch {
    res.status(400).json({ error: "No se pudo leer el video" });
  }
});
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => res.status(400).json({ error: error.message }),
);
app.listen(3001, "0.0.0.0", () => console.log("API lista en puerto 3001"));
