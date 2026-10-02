import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  ffmpegPath?: string;
};

type TimelineEntry = {
  index: number;
  label: string;
  action: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
};

type Manifest = {
  scenario: {
    steps: Array<{
      action: string;
      label?: string;
      narration?: string;
    }>;
  };
  timeline: TimelineEntry[];
  startedAt: string;
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

export function buildCaptions(manifest: Manifest): string {
  const entries: string[] = [];
  let counter = 1;

  for (const item of manifest.timeline) {
    if (!item.success) continue;
    const step = manifest.scenario.steps[item.index];
    const text = sanitizeCaption(step?.narration ?? step?.label ?? "");
    if (!text) continue;

    const start = secondsBetween(manifest.startedAt, item.startedAt);
    const rawEnd = secondsBetween(manifest.startedAt, item.finishedAt);
    const end = Math.max(start + 1.2, rawEnd + 0.35);

    entries.push(
      [
        String(counter),
        `${srtTime(start)} --> ${srtTime(end)}`,
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

  const captionsPath = path.join(runDir, "captions.srt");
  const captions = buildCaptions(manifest);
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

  const videoFilters = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
  ];

  if (options.captions !== false && captions) {
    videoFilters.push(
      `subtitles='${escapeFilterPath(captionsPath)}':force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=58'`,
    );
  }

  const brandLabel = options.brandLabel ?? "VIIVERSION";
  if (brandLabel) {
    videoFilters.push(
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.88:fontsize=28:x=w-tw-42:y=34`,
    );
  }

  if (options.cta) {
    videoFilters.push(
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(options.cta)}':fontcolor=white:fontsize=24:x=(w-tw)/2:y=h-th-38:box=1:boxcolor=black@0.42:boxborderw=12`,
    );
  }

  const filterParts = [`[0:v]${videoFilters.join(",")}[vout]`];

  if (voiceIndex !== undefined && musicIndex !== undefined) {
    const volume = options.musicVolume ?? 0.16;
    filterParts.push(
      `[${voiceIndex}:a]apad,asplit=2[voice_sidechain][voice_mix]`,
      `[${musicIndex}:a]volume=${volume}[music]`,
      "[music][voice_sidechain]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=350[ducked]",
      "[voice_mix][ducked]amix=inputs=2:duration=longest:normalize=0[aout]",
    );
  } else if (voiceIndex !== undefined) {
    filterParts.push(`[${voiceIndex}:a]apad[aout]`);
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
