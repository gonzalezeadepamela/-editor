import { createHash } from "node:crypto";
// Run against npm run dev. Exercises real browser audio decoding and MP4 rendering.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(".local/fixtures", { recursive: true });
execFileSync("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=360x640:rate=30:duration=4",
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=if(between(t\\,1\\,1.7)\\,0\\,0.3*sin(2*PI*440*t)):s=44100:d=4",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-c:a",
  "aac",
  "-shortest",
  ".local/fixtures/input.mp4",
]);
execFileSync("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=lime:s=180x180",
  "-frames:v",
  "1",
  ".local/fixtures/sticker.png",
]);
writeFileSync(
  ".local/fixtures/captions.srt",
  "1\n00:00:00,000 --> 00:00:01,000\nHola producto\n\n2\n00:00:02,000 --> 00:00:04,000\nAhora luce mejor\n",
);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173");
  await page
    .getByLabel("Subir video", { exact: true })
    .setInputFiles(".local/fixtures/input.mp4");
  await page.getByLabel("Tipo del clip 2").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Exportar video ↗" }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('input[aria-label="Subir sticker"]').disabled,
    { timeout: 60000 },
  );
  assert.ok(await page.getByText("MODO DEMO", { exact: false }).isVisible());
  for (let i = 1; i <= 3; i++) {
    await page.getByRole("button", { name: `Ver gancho ${i}` }).click();
    await page.getByRole("button", { name: "Ir al clip 2" }).click();
    assert.equal(await page.getByTestId("hook").textContent(), `GANCHO ${i}`);
  }
  await page.getByRole("button", { name: "Ver gancho 1" }).click();
  await page.getByRole("button", { name: "Ir al clip 2" }).click();
  await page.getByLabel("Tipo del clip 1").selectOption("Antes");
  await page
    .getByLabel("Subir sticker", { exact: true })
    .setInputFiles(".local/fixtures/sticker.png");
  await page.getByAltText("Sticker de producto").waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector('input[aria-label="Importar subtítulos"]')
        .disabled,
  );
  await page
    .getByLabel("Importar subtítulos", { exact: true })
    .setInputFiles(".local/fixtures/captions.srt");
  await page
    .getByRole("status")
    .filter({ hasText: "subtítulos importados" })
    .waitFor();
  await page.screenshot({ path: ".local/editor-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Exportar los 3", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Descargar GANCHO 3 ↓" })
    .waitFor({ timeout: 600000 });
  const hashes = [];
  const outputs = [];
  for (let i = 1; i <= 3; i++) {
    const url = await page
      .getByRole("link", { name: `Descargar GANCHO ${i} ↓` })
      .getAttribute("href");
    const response = await page.request.get("http://127.0.0.1:5173" + url);
    assert.equal(response.status(), 200);
    const data = await response.body();
    hashes.push(createHash("sha256").update(data).digest("hex"));
    const output = `.local/fixtures/result-${i}.mp4`;
    writeFileSync(output, data);
    const info = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
        { encoding: "utf8" },
      ),
    );
    const video = info.streams.find((s) => s.codec_type === "video");
    assert.equal(video.width, 1080);
    assert.equal(video.height, 1920);
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(video.codec_name, "h264");
    assert.ok(info.streams.some((s) => s.codec_type === "audio"));
    assert.ok(
      Number(info.format.duration) < 3.5 && Number(info.format.duration) > 3.2,
    );
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0.3",
      "-i",
      output,
      "-frames:v",
      "1",
      `.local/rendered-hook-${i}.png`,
    ]);
    outputs.push({
      hook: i,
      width: video.width,
      height: video.height,
      fps: video.r_frame_rate,
      duration: info.format.duration,
    });
  }
  assert.equal(new Set(hashes).size, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/editor-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      clips: 2,
      exports: outputs,
      uniqueFiles: 3,
      browserErrors: errors,
    }),
  );
} finally {
  await browser.close();
}
