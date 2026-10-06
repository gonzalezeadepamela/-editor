import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, type PlayerRef } from "@remotion/player";
import { getAudioData } from "@remotion/media-utils";
import { parseSrt, type Caption } from "@remotion/captions";
import { VideoEdit } from "./Video";
import { cutSilences, durationFrames, FPS, type Clip } from "./edit";
import "./style.css";
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Error de conexión");
  return data;
}
async function upload(file: File) {
  const data = new FormData();
  data.append("file", file);
  return request<{ src: string; duration?: number; hasAudio?: boolean }>(
    "/api/upload",
    { method: "POST", body: data },
  );
}
const time = (frames: number) => (frames / FPS).toFixed(2) + " s";
function App() {
  const [src, setSrc] = useState(""),
    [name, setName] = useState(""),
    [original, setOriginal] = useState(0),
    [clips, setClips] = useState<Clip[]>([]),
    [sticker, setSticker] = useState(""),
    [captions, setCaptions] = useState<Caption[]>([]),
    [threshold, setThreshold] = useState(0.015),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [job, setJob] = useState<{
      id: string;
      status: string;
      progress: number;
      url?: string;
      files?: { label: string; url: string }[];
    }>(),
    [frame, setFrame] = useState(0);
  const [hooks, setHooks] = useState(["GANCHO 1", "GANCHO 2", "GANCHO 3"]);
  const [selectedHook, setSelectedHook] = useState(0);
  const [demo, setDemo] = useState(false);
  const player = useRef<PlayerRef>(null);
  const mounted = useRef(true);
  const frames = durationFrames(clips);
  const locked = busy || job?.status === "rendering";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const update = ({ detail }: { detail: { frame: number } }) =>
      setFrame(detail.frame);
    p.addEventListener("frameupdate", update);
    return () => p.removeEventListener("frameupdate", update);
  }, [src, frames]);
  useEffect(() => {
    if (!job || job.status !== "rendering") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request<{
          status: string;
          progress: number;
          url?: string;
          files?: { label: string; url: string }[];
          error?: string;
        }>("/api/export/" + job.id);
        if (cancelled) return;
        setJob({ id: job.id, ...result });
        if (result.status === "error")
          setMessage(result.error || "Falló la exportación");
        else if (result.status === "rendering") timer = setTimeout(poll, 1000);
      } catch (error) {
        if (!cancelled) {
          setMessage(String(error));
          setJob({ ...job, status: "error" });
        }
      }
    };
    timer = setTimeout(poll, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  async function loadVideo(file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage("Subiendo y analizando el audio…");
    setJob(undefined);
    try {
      const data = await upload(file);
      if (!data.duration) throw new Error("El archivo no contiene video");
      const total = Math.max(1, Math.floor(data.duration * FPS));
      setSrc(data.src);
      setName(file.name);
      setOriginal(total);
      setCaptions([]);
      setDemo(false);
      setFrame(0);
      setClips([{ startFrame: 0, endFrame: total, label: "Normal" }]);
      if (!data.hasAudio) {
        setMessage("Video sin audio: se conserva completo.");
        return;
      }
      try {
        const audio = await getAudioData(data.src);
        const next = cutSilences(
          audio.channelWaveforms,
          audio.sampleRate,
          data.duration,
          threshold,
        );
        if (!next.length) {
          setMessage(
            "Todo el audio está bajo el umbral. Se conserva el video; baja el umbral y vuelve a analizar.",
          );
        }
        if (next.length) setClips(next);
        setMessage(
          `${next.length} clips · ${time(total - durationFrames(next))} de silencio eliminados.`,
        );
      } catch {
        setMessage(
          "El navegador no pudo decodificar el audio. Se conserva el video completo. Prueba MP4 con audio AAC.",
        );
      }
      await transcribe(data.src);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function transcribe(videoSrc = src) {
    setMessage("Generando subtítulos de demostración…");
    try {
      const result = await request<{ mode: string; captions: Caption[] }>(
        "/api/transcribe",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ src: videoSrc }),
        },
      );
      setCaptions(result.captions);
      setDemo(true);
      setMessage(
        "Subtítulos DEMO: texto de ejemplo, no transcripción de tu audio. Puedes reemplazarlos con SRT.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  async function analyze() {
    setBusy(true);
    setMessage("Analizando silencios…");
    setJob(undefined);
    try {
      const audio = await getAudioData(src);
      const next = cutSilences(
        audio.channelWaveforms,
        audio.sampleRate,
        original / FPS,
        threshold,
      );
      if (!next.length)
        throw new Error(
          "Todo el video es silencio con este umbral. Baja el umbral.",
        );
      setClips(next);
      setMessage(
        `${next.length} clips · ${time(original - durationFrames(next))} eliminados.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadSticker(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const data = await upload(file);
      setSticker(data.src);
      setJob(undefined);
      setMessage("Sticker visible durante todo el video.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadCaptions(file?: File) {
    if (!file) return;
    try {
      const parsed = parseSrt({ input: await file.text() });
      setDemo(false);
      setCaptions(
        parsed.captions.flatMap((c) => {
          const words = c.text.trim().split(/\s+/);
          return words.map((word, i) => ({
            ...c,
            text: " " + word,
            startMs: c.startMs + ((c.endMs - c.startMs) * i) / words.length,
            endMs: c.startMs + ((c.endMs - c.startMs) * (i + 1)) / words.length,
          }));
        }),
      );
      setJob(undefined);
      setMessage(
        `${parsed.captions.length} subtítulos importados y sincronizados con los cortes.`,
      );
    } catch {
      setMessage("No se pudo leer el archivo SRT.");
    }
  }
  async function exportVideo(batch = false) {
    setBusy(true);
    setMessage("");
    try {
      const result = await request<{ id: string }>(
        batch ? "/api/export-batch" : "/api/export",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            src,
            clips,
            sticker,
            captions,
            hook: hooks[selectedHook],
            hooks,
          }),
        },
      );
      setJob({ id: result.id, status: "rendering", progress: 0 });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  const updateClip = (index: number, changes: Partial<Clip>) => {
    setClips(clips.map((c, i) => (i === index ? { ...c, ...changes } : c)));
    setJob(undefined);
  };
  return (
    <div className="min-h-screen bg-[#0c0d12] text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500 text-xl">
            ▸
          </div>
          <h1 className="text-xl font-bold tracking-tight">
            clip
            <span className="ml-3 text-xs font-normal text-slate-500">
              PRODUCT STUDIO
            </span>
          </h1>
        </div>
        <span className="badge">9:16 · 1080 × 1920 · 30 FPS</span>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-7">
          <p className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-violet-400">
            De idea a publicación
          </p>
          <h2 className="text-3xl font-semibold">
            Tu producto, en primer plano.
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Elimina pausas, destaca el antes y después y crea un video vertical.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[320px_1fr_270px]">
          <aside className="panel space-y-6">
            <div>
              <h3>
                01 <span>Material</span>
              </h3>
              <label className="upload mt-4">
                <span className="text-3xl text-violet-400">＋</span>
                <strong>Subir video</strong>
                <span className="text-xs text-slate-500">
                  MP4, MOV o WebM · hasta 500 MB
                </span>
                <input
                  aria-label="Subir video"
                  disabled={locked}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={(e) => {
                    void loadVideo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {name && (
                <p className="mt-3 break-all text-xs text-slate-400">{name}</p>
              )}
            </div>
            <div>
              <h3>
                02 <span>Cortes inteligentes</span>
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                Se eliminan pausas de volumen bajo de más de 0.4 segundos.
              </p>
              <label className="mt-4 block text-xs text-slate-400">
                Umbral de silencio{" "}
                <span className="float-right text-violet-300">
                  {Math.round(20 * Math.log10(threshold))} dB
                </span>
                <input
                  aria-label="Umbral de silencio"
                  className="mt-3 w-full accent-violet-500"
                  type="range"
                  min="0.003"
                  max="0.06"
                  step="0.001"
                  value={threshold}
                  disabled={locked}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </label>
              <button
                className="secondary mt-3 w-full"
                disabled={!src || locked}
                onClick={() => void analyze()}
              >
                Volver a analizar
              </button>
              <button
                className="mt-3 text-xs text-slate-400 underline"
                disabled={!src || locked}
                onClick={() => {
                  setClips([
                    { startFrame: 0, endFrame: original, label: "Normal" },
                  ]);
                  setJob(undefined);
                }}
              >
                Restaurar video completo
              </button>
            </div>
            <div>
              <h3>
                03 <span>Sticker y subtítulos</span>
              </h3>
              <label className="secondary mt-4 block cursor-pointer text-center">
                {sticker ? "Cambiar sticker" : "Subir sticker de producto"}
                <input
                  aria-label="Subir sticker"
                  type="file"
                  disabled={locked}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    void loadSticker(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {sticker && (
                <div className="mt-3 flex items-center justify-between">
                  <img
                    src={sticker}
                    alt="Sticker de producto"
                    className="h-16 w-16 object-contain"
                  />
                  <button
                    disabled={locked}
                    className="text-xs text-slate-400"
                    onClick={() => {
                      setSticker("");
                      setJob(undefined);
                    }}
                  >
                    Quitar
                  </button>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Permanece abajo a la derecha. PNG transparente recomendado.
              </p>
              <button
                className="secondary mt-4 w-full"
                disabled={!src || locked}
                onClick={async () => {
                  setBusy(true);
                  setJob(undefined);
                  await transcribe();
                  setBusy(false);
                }}
              >
                Generar subtítulos DEMO
              </button>
              <label className="secondary mt-4 block cursor-pointer text-center">
                Importar subtítulos SRT
                <input
                  aria-label="Importar subtítulos"
                  type="file"
                  disabled={locked}
                  accept=".srt"
                  onChange={(e) => {
                    void loadCaptions(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {captions.length > 0 && (
                <button
                  className="mt-2 text-xs text-slate-400"
                  disabled={locked}
                  onClick={() => {
                    setCaptions([]);
                    setJob(undefined);
                  }}
                >
                  Quitar {captions.length} subtítulos
                </button>
              )}
            </div>
          </aside>
          <section className="panel flex flex-col items-center">
            <div className="mb-5 flex w-full justify-between text-xs text-slate-500">
              <span>VISTA PREVIA</span>
              <span>
                {time(frame)} / {time(frames)}
              </span>
            </div>
            <div className="mb-4 flex gap-2">
              {hooks.map((_, i) => (
                <button
                  key={i}
                  className={selectedHook === i ? "primary" : "secondary"}
                  onClick={() => {
                    setSelectedHook(i);
                    player.current?.seekTo(0);
                  }}
                  aria-label={`Ver gancho ${i + 1}`}
                >
                  Gancho {i + 1}
                </button>
              ))}
            </div>
            <div className="preview">
              {src && frames > 0 ? (
                <Player
                  ref={player}
                  component={VideoEdit}
                  inputProps={{
                    src,
                    clips,
                    sticker,
                    captions,
                    hook: hooks[selectedHook],
                  }}
                  durationInFrames={frames}
                  fps={30}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  controls
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <span className="mb-4 text-5xl text-violet-400">▹</span>
                  <p className="text-lg font-medium">
                    Aquí empieza tu historia
                  </p>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Sube un video para generar los cortes y ver el resultado.
                  </p>
                </div>
              )}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Encuadre vertical centrado · audio original
            </p>
          </section>
          <aside className="panel h-fit">
            <h3>
              04 <span>Ganchos y exportación</span>
            </h3>
            <p className="mt-3 text-xs text-slate-400">
              Tres versiones, cada una con un gancho pop en los primeros 3
              segundos.
            </p>
            <div className="mt-4 space-y-3">
              {hooks.map((hook, i) => (
                <label key={i} className="block text-xs text-slate-400">
                  GANCHO {i + 1}
                  <input
                    aria-label={`Texto gancho ${i + 1}`}
                    maxLength={120}
                    disabled={locked}
                    value={hook}
                    onChange={(e) => {
                      setHooks(
                        hooks.map((h, j) => (j === i ? e.target.value : h)),
                      );
                      setJob(undefined);
                    }}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-[#161821] p-2 text-slate-100"
                  />
                </label>
              ))}
            </div>
            <div className="my-5 space-y-3 text-sm">
              {[
                ["Formato", "MP4 · H.264"],
                ["Resolución", "1080 × 1920"],
                ["Fotogramas", "30 fps"],
                ["Duración", time(frames)],
                ["Silencios cortados", time(Math.max(0, original - frames))],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-slate-500">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <button
              className="primary w-full"
              disabled={!src || !frames || locked}
              onClick={() => void exportVideo()}
            >
              {job?.status === "rendering"
                ? `Exportando ${Math.round(job.progress * 100)}%`
                : "Exportar video ↗"}
            </button>
            <button
              className="primary mt-3 w-full"
              disabled={
                !src || !frames || locked || hooks.some((h) => !h.trim())
              }
              onClick={() => void exportVideo(true)}
            >
              Exportar los 3
            </button>
            {job?.status === "rendering" && (
              <progress
                className="mt-4 w-full accent-violet-500"
                value={job.progress}
                max={1}
              />
            )}{" "}
            {job?.status === "done" && job.files?.length === 1 && (
              <a
                className="secondary mt-4 block text-center"
                href={job.url}
                download="producto.mp4"
              >
                Descargar MP4 ↓
              </a>
            )}
            {job?.files && job.files.length > 1 && (
              <div className="mt-3 space-y-2">
                {job.files.map((file) => (
                  <a
                    key={file.url}
                    href={file.url}
                    download={file.label + ".mp4"}
                    className="secondary block text-center"
                  >
                    Descargar {file.label} ↓
                  </a>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-slate-500">
              La exportación se procesa en este servidor. Conserva esta pestaña
              para seguir el progreso.
            </p>
          </aside>
        </div>
        {demo && (
          <p className="my-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">
            MODO DEMO · Los subtítulos son texto de ejemplo. Importa un SRT para
            usar tus palabras reales.
          </p>
        )}
        <div
          role="status"
          aria-live="polite"
          className="my-5 min-h-6 text-sm text-violet-200"
        >
          {message}
        </div>
        <section className="panel">
          <div className="mb-5 flex items-center justify-between">
            <h3>
              Timeline{" "}
              <span className="ml-2 text-xs">{clips.length} clips</span>
            </h3>
            <span className="text-xs text-slate-500">
              Antes / Después → zoom 1.0 a 1.15
            </span>
          </div>
          {!clips.length ? (
            <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-slate-500">
              Tus clips aparecerán aquí después de subir un video.
            </div>
          ) : (
            <>
              <div className="mb-5 flex h-14 gap-1 overflow-hidden rounded-lg">
                {clips.map((c, i) => {
                  const before = durationFrames(clips.slice(0, i));
                  return (
                    <button
                      aria-label={`Ir al clip ${i + 1}`}
                      key={i}
                      onClick={() => player.current?.seekTo(before)}
                      className={`min-w-3 border border-violet-400/20 text-xs ${frame >= before && frame < before + c.endFrame - c.startFrame ? "bg-violet-500" : "bg-violet-500/30"}`}
                      style={{ flex: c.endFrame - c.startFrame }}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {clips.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/10 bg-white/[.025] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <strong className="text-sm">Clip {i + 1}</strong>
                      <button
                        className="text-xs text-slate-500"
                        disabled={locked || clips.length === 1}
                        onClick={() => {
                          setClips(clips.filter((_, j) => j !== i));
                          setJob(undefined);
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                    <p className="mb-3 text-xs text-slate-500">
                      Origen: {time(c.startFrame)} → {time(c.endFrame)}
                    </p>
                    <label className="text-xs text-slate-400">
                      Tipo de clip
                      <select
                        aria-label={`Tipo del clip ${i + 1}`}
                        className="mt-2 w-full rounded-lg border border-white/10 bg-[#161821] p-2 text-sm text-slate-200"
                        value={c.label}
                        disabled={locked}
                        onChange={(e) =>
                          updateClip(i, {
                            label: e.target.value as Clip["label"],
                          })
                        }
                      >
                        <option>Normal</option>
                        <option>Antes</option>
                        <option>Después</option>
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
      <footer className="px-6 py-6 text-center text-xs text-slate-600">
        CLIP / PRODUCT STUDIO · Hecho para historias que se ven.
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
