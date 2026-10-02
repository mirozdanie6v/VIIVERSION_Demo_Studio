import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildScenePlan,
  editedDuration,
  type EditScene,
  type SceneManifest,
  type SceneTimelineEntry,
} from "./scenes.js";

export type RenderPreset = "16:9" | "9:16" | "1:1";

export type RenderOptions = {
  runDir: string;
  outputPath?: string;
  preset?: RenderPreset;
  captions?: boolean;
  voiceoverPath?: string;
  musicPath?: string;
  musicVolume?: number;
  brandLabel?: string;
  cta?: string;
  title?: string;
  intro?: boolean;
  outro?: boolean;
  introSeconds?: number;
  outroSeconds?: number;
  ffmpegPath?: string;
};

type Manifest = SceneManifest & {
  scenario: SceneManifest["scenario"] & {
    name?: string;
  };
  timeline: SceneTimelineEntry[];
  videoPath?: string;
  success: boolean;
};

const PRESETS: Record<RenderPreset, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0"),
  ].join(":") + "," + String(millis).padStart(3, "0");
}

function sanitizeCaption(text: string): string {
  return text.replace(/\r?\n/g, " ").trim();
}

function sceneForStep(
  index: number,
  scenes: EditScene[],
): EditScene | undefined {
  return scenes.find((scene) => scene.stepIndexes.includes(index));
}

export function buildCaptions(
  manifest: Manifest,
  scenes: EditScene[] = buildScenePlan(manifest),
): string {
  const entries: string[] = [];
  let counter = 1;

  for (const item of manifest.timeline) {
    if (!item.success) continue;
    const step = manifest.scenario.steps[item.index];
    const text = sanitizeCaption(step?.narration ?? step?.label ?? "");
    if (!text) continue;

    const sourceStart = secondsBetween(manifest.startedAt, item.startedAt);
    const sourceEnd = secondsBetween(manifest.startedAt, item.finishedAt);

    let start = sourceStart;
    let end = Math.max(sourceStart + 1.2, sourceEnd + 0.35);

    if (scenes.length > 0) {
      const scene = sceneForStep(item.index, scenes);
      if (!scene) continue;

      start =
        scene.outputStart +
        Math.max(0, sourceStart - scene.sourceStart);
      end =
        scene.outputStart +
        Math.min(
          scene.sourceEnd - scene.sourceStart,
          Math.max(
            sourceStart - scene.sourceStart + 1.2,
            sourceEnd - scene.sourceStart + 0.35,
          ),
        );
    }

    entries.push(
      [
        String(counter),
        `${srtTime(start)} --> ${srtTime(Math.max(start + 0.6, end))}`,
        text,
      ].join("\n"),
    );
    counter += 1;
  }

  return entries.join("\n\n") + (entries.length ? "\n" : "");
}

export function buildNarration(manifest: Manifest): string {
  return manifest.scenario.steps
    .map((step) => step.narration?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function escapeDrawText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

function number(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

async function runFfmpeg(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}.`));
    });
  });
}

function buildMainVideoFilters(
  width: number,
  height: number,
  scenes: EditScene[],
): string[] {
  const filters: string[] = [];
  const base =
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,` +
    "setsar=1,fps=30,settb=AVTB";

  if (scenes.length === 0) {
    filters.push(`[0:v]${base}[mainraw]`);
    return filters;
  }

  if (scenes.length === 1) {
    const scene = scenes[0];
    filters.push(
      `[0:v]${base},trim=start=${number(scene.sourceStart)}:end=${number(scene.sourceEnd)},setpts=PTS-STARTPTS[mainraw]`,
    );
    return filters;
  }

  const splitLabels = scenes.map((_, index) => `[source${index}]`).join("");
  filters.push(`[0:v]${base},split=${scenes.length}${splitLabels}`);

  scenes.forEach((scene, index) => {
    filters.push(
      `[source${index}]trim=start=${number(scene.sourceStart)}:end=${number(scene.sourceEnd)},setpts=PTS-STARTPTS[scene${index}]`,
    );
  });

  const sceneInputs = scenes.map((_, index) => `[scene${index}]`).join("");
  filters.push(
    `${sceneInputs}concat=n=${scenes.length}:v=1:a=0[mainraw]`,
  );

  return filters;
}

export async function renderRun(options: RenderOptions): Promise<string> {
  const runDir = path.resolve(options.runDir);
  const manifestPath = path.join(runDir, "run.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  if (!manifest.success) {
    throw new Error("Cannot render an unsuccessful capture run.");
  }

  const capturePath = manifest.videoPath
    ? path.resolve(manifest.videoPath)
    : path.join(runDir, "capture.webm");

  const preset = options.preset ?? "16:9";
  const { width, height } = PRESETS[preset];
  const outputPath = path.resolve(
    options.outputPath ?? path.join(runDir, `final-${preset.replace(":", "x")}.mp4`),
  );

  const scenes = buildScenePlan(manifest);
  await writeFile(
    path.join(runDir, "scenes.json"),
    JSON.stringify(
      {
        sourceDurationSeconds: secondsBetween(
          manifest.startedAt,
          manifest.finishedAt ?? manifest.timeline.at(-1)?.finishedAt ?? manifest.startedAt,
        ),
        editedDurationSeconds: editedDuration(manifest, scenes),
        scenes,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const captionsPath = path.join(runDir, "captions.srt");
  const captions = buildCaptions(manifest, scenes);
  if (options.captions !== false && captions) {
    await writeFile(captionsPath, captions, "utf8");
  }

  const args: string[] = ["-y", "-i", capturePath];
  let voiceIndex: number | undefined;
  let musicIndex: number | undefined;
  let inputCount = 1;

  if (options.voiceoverPath) {
    voiceIndex = inputCount;
    inputCount += 1;
    args.push("-i", path.resolve(options.voiceoverPath));
  }

  if (options.musicPath) {
    musicIndex = inputCount;
    inputCount += 1;
    args.push("-stream_loop", "-1", "-i", path.resolve(options.musicPath));
  }

  const filterParts = buildMainVideoFilters(width, height, scenes);
  const mainDecor: string[] = [];

  if (options.captions !== false && captions) {
    mainDecor.push(
      `subtitles='${escapeFilterPath(captionsPath)}':force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=58'`,
    );
  }

  const brandLabel = options.brandLabel ?? "VIIVERSION";
  if (brandLabel) {
    mainDecor.push(
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.88:fontsize=28:x=w-tw-42:y=34`,
    );
  }

  if (options.cta && options.outro === false) {
    mainDecor.push(
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(options.cta)}':fontcolor=white:fontsize=24:x=(w-tw)/2:y=h-th-38:box=1:boxcolor=black@0.42:boxborderw=12`,
    );
  }

  filterParts.push(
    mainDecor.length > 0
      ? `[mainraw]${mainDecor.join(",")}[main]`
      : "[mainraw]null[main]",
  );

  const introEnabled = options.intro !== false;
  const outroEnabled = options.outro !== false;
  const introSeconds = introEnabled ? Math.max(0.4, options.introSeconds ?? 1.15) : 0;
  const outroSeconds = outroEnabled ? Math.max(0.6, options.outroSeconds ?? 1.55) : 0;
  const title = options.title ?? manifest.scenario.name ?? "Product demonstration";

  const finalVideoInputs: string[] = [];

  if (introEnabled) {
    filterParts.push(
      `color=c=0x090B10:s=${width}x${height}:r=30:d=${number(introSeconds)},` +
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white:fontsize=46:x=(w-tw)/2:y=(h-th)/2-34,` +
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(title)}':fontcolor=white@0.72:fontsize=24:x=(w-tw)/2:y=(h-th)/2+32,` +
      "format=yuv420p,settb=AVTB[intro]",
    );
    finalVideoInputs.push("[intro]");
  }

  finalVideoInputs.push("[main]");

  if (outroEnabled) {
    const outroText = options.cta ?? "Powered by VIIVERSION Demo Studio";
    filterParts.push(
      `color=c=0x090B10:s=${width}x${height}:r=30:d=${number(outroSeconds)},` +
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white:fontsize=44:x=(w-tw)/2:y=(h-th)/2-26,` +
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(outroText)}':fontcolor=white@0.8:fontsize=24:x=(w-tw)/2:y=(h-th)/2+34,` +
      "format=yuv420p,settb=AVTB[outro]",
    );
    finalVideoInputs.push("[outro]");
  }

  if (finalVideoInputs.length === 1) {
    filterParts.push("[main]null[vout]");
  } else {
    filterParts.push(
      `${finalVideoInputs.join("")}concat=n=${finalVideoInputs.length}:v=1:a=0[vout]`,
    );
  }

  const voiceDelayMs = Math.round(introSeconds * 1000);

  if (voiceIndex !== undefined && musicIndex !== undefined) {
    const volume = options.musicVolume ?? 0.16;
    filterParts.push(
      `[${voiceIndex}:a]adelay=${voiceDelayMs}|${voiceDelayMs},apad,asplit=2[voice_sidechain][voice_mix]`,
      `[${musicIndex}:a]volume=${volume}[music]`,
      "[music][voice_sidechain]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=350[ducked]",
      "[voice_mix][ducked]amix=inputs=2:duration=longest:normalize=0[aout]",
    );
  } else if (voiceIndex !== undefined) {
    filterParts.push(
      `[${voiceIndex}:a]adelay=${voiceDelayMs}|${voiceDelayMs},apad[aout]`,
    );
  } else if (musicIndex !== undefined) {
    filterParts.push(`[${musicIndex}:a]volume=${options.musicVolume ?? 0.16}[aout]`);
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", "[vout]");

  if (voiceIndex !== undefined || musicIndex !== undefined) {
    args.push("-map", "[aout]", "-shortest", "-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-map", "0:a?");
  }

  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-r", "30",
    outputPath,
  );

  await runFfmpeg(options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg", args);
  return outputPath;
}
