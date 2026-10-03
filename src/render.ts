import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildCaptionPlan,
  captionPlanToSrt,
} from "./caption-brain.js";
import { buildEditorBrainPlan } from "./editor-brain.js";
import { reviewEditorPlan } from "./editor-critic.js";
import { alignScenesToBeatGrid } from "./music-brain.js";
import { resolvePresentationDesign } from "./presentation-design-brain.js";
import type { DesignContract, UxPreflight } from "./ux-design-brain.js";
import type {
  EditScene,
  SceneManifest,
  SceneTimelineEntry,
} from "./scenes.js";

export type RenderPreset = "16:9" | "9:16" | "1:1";

export type RenderOptions = {
  runDir: string;
  outputPath?: string;
  preset?: RenderPreset;
  captions?: boolean;
  captionsFilePath?: string;
  designContractPath?: string;
  uxPreflightPath?: string;
  voiceoverPath?: string;
  musicPath?: string;
  musicVolume?: number;
  musicBpm?: number;
  musicBeatOffsetSeconds?: number;
  brandLabel?: string;
  cta?: string;
  ctaSecondary?: string;
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

export function buildCaptions(
  manifest: Manifest,
  scenes: EditScene[] = buildEditorBrainPlan(manifest).scenes,
): string {
  return captionPlanToSrt(buildCaptionPlan(manifest, scenes, "16:9"));
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
    const child = spawn(executable, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(`ffmpeg exited with code ${code ?? "unknown"}.`),
        );
      }
    });
  });
}

function buildMainVideoFilters(
  width: number,
  height: number,
  scenes: EditScene[],
): string[] {
  const filters: string[] = [];
  const vertical = width < height;
  const base = vertical
    ? `scale=900:1480:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:330:color=0x070A10,` +
      "setsar=1,fps=30,settb=AVTB"
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x070A10,` +
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

  const splitLabels = scenes
    .map((_, index) => `[source${index}]`)
    .join("");
  filters.push(
    `[0:v]${base},split=${scenes.length}${splitLabels}`,
  );

  scenes.forEach((scene, index) => {
    filters.push(
      `[source${index}]trim=start=${number(scene.sourceStart)}:end=${number(scene.sourceEnd)},setpts=PTS-STARTPTS[scene${index}]`,
    );
  });

  const sceneInputs = scenes
    .map((_, index) => `[scene${index}]`)
    .join("");
  filters.push(
    `${sceneInputs}concat=n=${scenes.length}:v=1:a=0[mainraw]`,
  );

  return filters;
}

export async function renderRun(options: RenderOptions): Promise<string> {
  const runDir = path.resolve(options.runDir);
  const manifestPath = path.join(runDir, "run.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as Manifest;

  if (!manifest.success) {
    throw new Error("Cannot render an unsuccessful capture run.");
  }

  const capturePath = manifest.videoPath
    ? path.resolve(manifest.videoPath)
    : path.join(runDir, "capture.webm");

  const preset = options.preset ?? "16:9";
  const { width, height } = PRESETS[preset];
  const outputPath = path.resolve(
    options.outputPath ??
      path.join(runDir, `final-${preset.replace(":", "x")}.mp4`),
  );

  let designContract: DesignContract | undefined;
  let uxPreflight: UxPreflight | undefined;

  if (options.designContractPath) {
    designContract = JSON.parse(
      await readFile(path.resolve(options.designContractPath), "utf8"),
    ) as DesignContract;
  }
  if (options.uxPreflightPath) {
    uxPreflight = JSON.parse(
      await readFile(path.resolve(options.uxPreflightPath), "utf8"),
    ) as UxPreflight;
  }

  const visualCritic = resolvePresentationDesign(
    manifest.timeline,
    preset,
    designContract,
    {
      preflightStatus: uxPreflight?.status,
      revisionLimit: 2,
    },
  );

  await Promise.all([
    writeFile(
      path.join(runDir, "overlay_plan.json"),
      JSON.stringify(visualCritic.plan, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(runDir, "visual_critic.json"),
      JSON.stringify(visualCritic, null, 2) + "\n",
      "utf8",
    ),
  ]);

  if (visualCritic.status === "BLOCKED") {
    throw new Error(
      "Visual Critic blocked render: " +
        visualCritic.findings
          .map((finding) => finding.message)
          .join(" "),
    );
  }

  const editorBrain = buildEditorBrainPlan(manifest);
  if (!editorBrain.qualityGate.passed) {
    throw new Error(
      "Editor Brain quality gate failed: " +
        JSON.stringify(editorBrain.qualityGate.checks),
    );
  }

  const critic = reviewEditorPlan(editorBrain);
  if (!critic.passed) {
    throw new Error(
      "Editor Critic rejected the edit plan: " +
        critic.findings.map((finding) => finding.code).join(", "),
    );
  }

  const musicBrain = alignScenesToBeatGrid(critic.revisedScenes, {
    bpm: options.musicBpm,
    beatOffsetSeconds: options.musicBeatOffsetSeconds,
  });
  const scenes = musicBrain.scenes;

  await Promise.all([
    writeFile(
      path.join(runDir, "editor_brain.json"),
      JSON.stringify(editorBrain, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(runDir, "editor_critic.json"),
      JSON.stringify(critic, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(runDir, "music_brain.json"),
      JSON.stringify(musicBrain, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(runDir, "scenes.json"),
      JSON.stringify(
        {
          sourceDurationSeconds: secondsBetween(
            manifest.startedAt,
            manifest.finishedAt ??
              manifest.timeline.at(-1)?.finishedAt ??
              manifest.startedAt,
          ),
          editedDurationSeconds:
            scenes.at(-1)?.outputEnd ?? 0,
          editorBrainVersion: editorBrain.version,
          criticVersion: critic.version,
          musicBrainVersion: musicBrain.version,
          scenes,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    ),
  ]);

  const captionPlan = buildCaptionPlan(manifest, scenes, preset);
  const captionsPath = path.join(runDir, "captions.srt");
  const captions = options.captionsFilePath
    ? await readFile(path.resolve(options.captionsFilePath), "utf8")
    : captionPlanToSrt(captionPlan);

  await writeFile(
    path.join(runDir, "captions.json"),
    JSON.stringify(
      {
        ...captionPlan,
        timingSource: options.captionsFilePath ? "voice-segment-duration" : "browser-timeline",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

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
    args.push(
      "-stream_loop",
      "-1",
      "-i",
      path.resolve(options.musicPath),
    );
  }

  const filterParts = buildMainVideoFilters(width, height, scenes);
  const mainDecor: string[] = [];
  const captionPlacement = visualCritic.plan.captionPlacement;
  const captionStyle = {
    ...captionPlan.safeZone,
    alignment: captionPlacement === "top" ? 8 : 2,
    marginV:
      preset === "9:16"
        ? 96
        : Math.round(height * visualCritic.plan.captionBandRatio * 0.2),
    marginH: Math.round(
      width * visualCritic.plan.horizontalMarginRatio,
    ),
  };

  if (preset === "9:16") {
    const bandHeight = Math.round(
      height * visualCritic.plan.captionBandRatio,
    );
    const bandY =
      captionPlacement === "top"
        ? 72
        : height - bandHeight - 72;
    mainDecor.push(
      `drawbox=x=0:y=${bandY}:w=${width}:h=${bandHeight}:color=0x0B111C@0.98:t=fill`,
      `drawbox=x=0:y=${captionPlacement === "top" ? bandY + bandHeight : bandY - 1}:w=${width}:h=1:color=white@0.10:t=fill`,
    );
  }

  if (options.captions !== false && captions) {
    mainDecor.push(
      `subtitles='${escapeFilterPath(captionsPath)}':force_style='FontName=DejaVu Sans,FontSize=${captionStyle.fontSize},PrimaryColour=&H00FFFFFF,BackColour=&H00000000,OutlineColour=&H00000000,BorderStyle=1,Outline=${captionStyle.outline},Shadow=0,Alignment=${captionStyle.alignment},MarginV=${captionStyle.marginV},MarginL=${captionStyle.marginH},MarginR=${captionStyle.marginH}'`,
    );
  }

  const brandLabel = options.brandLabel ?? "VIIVERSION";
  if (brandLabel) {
    const brandSize = preset === "9:16" ? 20 : 28;
    const brandMarginX = preset === "9:16" ? 42 : 42;
    const brandMarginY = preset === "9:16" ? 28 : 34;
    const corner = visualCritic.plan.brandCorner;
    const brandX = corner.endsWith("left")
      ? String(brandMarginX)
      : `w-tw-${brandMarginX}`;
    const brandY = corner.startsWith("top")
      ? String(brandMarginY)
      : `h-th-${brandMarginY}`;

    mainDecor.push(
      `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.86:fontsize=${brandSize}:x=${brandX}:y=${brandY}:box=1:boxcolor=black@0.24:boxborderw=7`,
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
  const introSeconds = introEnabled
    ? Math.max(0.4, options.introSeconds ?? 1.15)
    : 0;
  const outroSeconds = outroEnabled
    ? Math.max(0.6, options.outroSeconds ?? 1.55)
    : 0;
  const title =
    options.title ??
    manifest.scenario.name ??
    "Product demonstration";

  const finalVideoInputs: string[] = [];

  if (introEnabled) {
    const introBrandSize = preset === "9:16" ? 34 : 42;
    const introTitleSize = preset === "9:16" ? 54 : 50;
    filterParts.push(
      `color=c=0x070A10:s=${width}x${height}:r=30:d=${number(introSeconds)},` +
        `drawbox=x=72:y=${Math.round(height * 0.22)}:w=6:h=${Math.round(height * 0.18)}:color=white@0.9:t=fill,` +
        `drawbox=x=72:y=${Math.round(height * 0.42)}:w=${Math.round(width * 0.55)}:h=2:color=white@0.18:t=fill,` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.72:fontsize=${introBrandSize}:x=96:y=${Math.round(height * 0.20)},` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(title)}':fontcolor=white:fontsize=${introTitleSize}:x=96:y=${Math.round(height * 0.29)},` +
        `drawtext=font='DejaVu Sans':text='PRODUCT EXPERIENCE':fontcolor=white@0.46:fontsize=22:x=96:y=${Math.round(height * 0.45)},` +
        `fade=t=in:st=0:d=0.45,fade=t=out:st=${number(Math.max(0, introSeconds - 0.45))}:d=0.45,` +
        "format=yuv420p,settb=AVTB[intro]",
    );
    finalVideoInputs.push("[intro]");
  }

  finalVideoInputs.push("[main]");

  if (outroEnabled) {
    const outroText =
      options.cta ?? "Готовы показать такой путь вашим клиентам?";
    const outroSecondary =
      options.ctaSecondary ?? "Напишите нам — адаптируем решение под ваш бизнес.";
    filterParts.push(
      `color=c=0x070A10:s=${width}x${height}:r=30:d=${number(outroSeconds)},` +
        `drawbox=x=72:y=${Math.round(height * 0.24)}:w=6:h=${Math.round(height * 0.24)}:color=white@0.9:t=fill,` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.68:fontsize=30:x=96:y=${Math.round(height * 0.20)},` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(outroText)}':fontcolor=white:fontsize=${preset === "9:16" ? 46 : 42}:x=96:y=${Math.round(height * 0.31)},` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(outroSecondary)}':fontcolor=white@0.72:fontsize=24:x=96:y=${Math.round(height * 0.44)},` +
        `drawtext=font='DejaVu Sans':text='VIIVERSION.COM':fontcolor=white@0.48:fontsize=20:x=96:y=${Math.round(height * 0.70)},` +
        `fade=t=in:st=0:d=0.45,fade=t=out:st=${number(Math.max(0, outroSeconds - 0.55))}:d=0.55,` +
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
  const contentDurationSeconds = scenes.at(-1)?.outputEnd ?? 0;
  const finalDurationSeconds =
    introSeconds + contentDurationSeconds + outroSeconds;

  if (voiceIndex !== undefined && musicIndex !== undefined) {
    const volume = options.musicVolume ?? 0.16;
    filterParts.push(
      `[${voiceIndex}:a]adelay=${voiceDelayMs}|${voiceDelayMs},apad,asplit=2[voice_sidechain][voice_mix]`,
      `[${musicIndex}:a]volume=${volume}[music]`,
      "[music][voice_sidechain]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=350[ducked]",
      "[voice_mix][ducked]amix=inputs=2:duration=longest:normalize=0[mixed]",
      `[mixed]atrim=duration=${number(finalDurationSeconds)},asetpts=N/SR/TB[aout]`,
    );
  } else if (voiceIndex !== undefined) {
    filterParts.push(
      `[${voiceIndex}:a]adelay=${voiceDelayMs}|${voiceDelayMs},apad,atrim=duration=${number(finalDurationSeconds)},asetpts=N/SR/TB[aout]`,
    );
  } else if (musicIndex !== undefined) {
    filterParts.push(
      `[${musicIndex}:a]volume=${options.musicVolume ?? 0.16},atrim=duration=${number(finalDurationSeconds)},asetpts=N/SR/TB[aout]`,
    );
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", "[vout]");

  if (voiceIndex !== undefined || musicIndex !== undefined) {
    args.push(
      "-map",
      "[aout]",
      "-shortest",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
    );
  } else {
    args.push("-map", "0:a?");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    outputPath,
  );

  await runFfmpeg(
    options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg",
    args,
  );
  return outputPath;
}
