import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildCaptionPlan,
  captionPlanToSrt,
  subtitleAlignmentForPlacement,
} from "./caption-brain.js";
import { buildEditorBrainPlan } from "./editor-brain.js";
import { reviewEditorPlan } from "./editor-critic.js";
import {
  hybridRenderEnabled,
  hybridRenderStrictEnabled,
  planHybridComposition,
  type HybridCompositionPlan,
  type HybridRenderManifest,
} from "./hybrid-compose.js";
import { alignScenesToBeatGrid } from "./music-brain.js";
import { MAX_AUTOMATIC_NARRATION_TAIL_HOLD_SECONDS } from "./narration-timing.js";
import { resolvePresentationDesign } from "./presentation-design-brain.js";
import type { DesignContract, UxPreflight } from "./ux-design-brain.js";
import type {
  EditScene,
  SceneManifest,
  SceneTimelineEntry,
} from "./scenes.js";

export type RenderPreset = "16:9" | "9:16" | "1:1";
export type RenderEncoderPreset = "fast" | "faster" | "veryfast";

const RENDER_ENCODER_PRESETS = new Set<RenderEncoderPreset>([
  "fast",
  "faster",
  "veryfast",
]);

export function resolveRenderEncoderPreset(
  explicit?: RenderEncoderPreset,
  env: NodeJS.ProcessEnv = process.env,
): RenderEncoderPreset {
  if (explicit) return explicit;
  const configured = env.DEMO_STUDIO_FFMPEG_PRESET?.trim().toLowerCase();
  return RENDER_ENCODER_PRESETS.has(configured as RenderEncoderPreset)
    ? configured as RenderEncoderPreset
    : "veryfast";
}

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
  encoderPreset?: RenderEncoderPreset;
  hybrid?: boolean;
  hybridStrict?: boolean;
};

type Manifest = SceneManifest & {
  scenario: SceneManifest["scenario"] & {
    name?: string;
  };
  timeline: SceneTimelineEntry[];
  videoPath?: string;
  success: boolean;
  captureMode?: "standard" | "hybrid-prototype";
  hybridManifestPath?: string;
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
  sourceLabel = "0:v",
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
    filters.push(`[${sourceLabel}]${base}[mainraw]`);
    return filters;
  }

  if (scenes.length === 1) {
    const scene = scenes[0];
    filters.push(
      `[${sourceLabel}]${base},trim=start=${number(scene.sourceStart)}:end=${number(scene.sourceEnd)},setpts=PTS-STARTPTS[mainraw]`,
    );
    return filters;
  }

  const splitLabels = scenes
    .map((_, index) => `[source${index}]`)
    .join("");
  filters.push(
    `[${sourceLabel}]${base},split=${scenes.length}${splitLabels}`,
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

function buildHybridSourceFilters(
  plan: HybridCompositionPlan,
  imageInputIndexes: Map<string, number>,
): string[] {
  const filters: string[] = [];
  const realtimeIndexes = plan.segments.flatMap((segment, index) =>
    segment.kind === "realtime" ? [index] : [],
  );
  const realtimeSources = new Map<number, string>();

  if (realtimeIndexes.length === 1) {
    realtimeSources.set(realtimeIndexes[0], "0:v");
  } else if (realtimeIndexes.length > 1) {
    const labels = realtimeIndexes
      .map((_, index) => `[hybridrt${index}]`)
      .join("");
    filters.push(`[0:v]split=${realtimeIndexes.length}${labels}`);
    realtimeIndexes.forEach((segmentIndex, splitIndex) => {
      realtimeSources.set(segmentIndex, `hybridrt${splitIndex}`);
    });
  }

  plan.segments.forEach((segment, index) => {
    if (segment.kind === "realtime") {
      const source = realtimeSources.get(index);
      if (!source) {
        throw new Error(
          `Hybrid realtime segment ${index} has no FFmpeg source label.`,
        );
      }
      filters.push(
        `[${source}]trim=start=${number(segment.sourceStart)}:end=${number(segment.sourceEnd)},` +
          `setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p,settb=AVTB[hyseg${index}]`,
      );
      return;
    }

    const inputIndex = imageInputIndexes.get(segment.path);
    if (inputIndex === undefined) {
      throw new Error(
        `Hybrid keyframe segment ${index} has no FFmpeg image input.`,
      );
    }
    filters.push(
      `[${inputIndex}:v]trim=duration=${number(segment.duration)},` +
        `setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p,settb=AVTB[hyseg${index}]`,
    );
  });

  const segmentInputs = plan.segments
    .map((_, index) => `[hyseg${index}]`)
    .join("");
  filters.push(
    `${segmentInputs}concat=n=${plan.segments.length}:v=1:a=0[hybridsrc]`,
  );
  return filters;
}

export async function renderRun(options: RenderOptions): Promise<string> {
  const runDir = path.resolve(options.runDir);
  const manifestPath = path.join(runDir, "run.json");
  let manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as Manifest;

  if (!manifest.success) {
    throw new Error("Cannot render an unsuccessful capture run.");
  }

  const standardCapturePath = manifest.videoPath
    ? path.resolve(manifest.videoPath)
    : path.join(runDir, "capture.webm");
  const hybridRequested = options.hybrid ?? hybridRenderEnabled();
  const hybridStrict = options.hybridStrict ?? hybridRenderStrictEnabled();
  let hybridComposition: HybridCompositionPlan | undefined;

  if (hybridRequested && manifest.captureMode === "hybrid-prototype") {
    try {
      hybridComposition = await planHybridComposition(
        runDir,
        manifest as HybridRenderManifest,
      );
      manifest = hybridComposition.manifest as Manifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeFile(
        path.join(runDir, "hybrid_composition_fallback.json"),
        JSON.stringify(
          {
            version: "hybrid-composition-fallback-v1",
            reason: message,
            fallback: "standard",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      if (hybridStrict) throw error;
    }
  } else if (hybridRequested) {
    const message =
      "Hybrid render requested for a run that is not hybrid-prototype.";
    await writeFile(
      path.join(runDir, "hybrid_composition_fallback.json"),
      JSON.stringify(
        {
          version: "hybrid-composition-fallback-v1",
          reason: message,
          fallback: "standard",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    if (hybridStrict) throw new Error(message);
  }

  const capturePath =
    hybridComposition?.sourceVideoPath ?? standardCapturePath;

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

  let narrationTailHoldSeconds = 0;
  try {
    const narrationSync = JSON.parse(
      await readFile(path.join(runDir, "narration-sync.json"), "utf8"),
    ) as { tailHoldSeconds?: number };
    const requestedTailHold = Number(narrationSync.tailHoldSeconds ?? 0);
    if (
      !Number.isFinite(requestedTailHold) ||
      requestedTailHold < 0 ||
      requestedTailHold > MAX_AUTOMATIC_NARRATION_TAIL_HOLD_SECONDS + 1e-6
    ) {
      throw new Error(
        `Invalid narration tail hold: ${String(narrationSync.tailHoldSeconds)}`,
      );
    }
    narrationTailHoldSeconds = requestedTailHold;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const editorContentDurationSeconds = scenes.at(-1)?.outputEnd ?? 0;
  const contentDurationSeconds =
    editorContentDurationSeconds + narrationTailHoldSeconds;

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
          editedDurationSeconds: editorContentDurationSeconds,
          narrationTailHoldSeconds,
          finalContentDurationSeconds: contentDurationSeconds,
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
  let inputCount = 1;
  const hybridImageInputIndexes = new Map<string, number>();

  if (hybridComposition) {
    for (const segment of hybridComposition.segments) {
      if (segment.kind !== "keyframe") continue;
      if (hybridImageInputIndexes.has(segment.path)) continue;
      hybridImageInputIndexes.set(segment.path, inputCount);
      inputCount += 1;
      args.push("-loop", "1", "-framerate", "30", "-i", segment.path);
    }
  }

  let voiceIndex: number | undefined;
  let musicIndex: number | undefined;

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

  const filterParts = [
    ...(hybridComposition
      ? buildHybridSourceFilters(
          hybridComposition,
          hybridImageInputIndexes,
        )
      : []),
    ...buildMainVideoFilters(
      width,
      height,
      scenes,
      hybridComposition ? "hybridsrc" : "0:v",
    ),
  ];
  let mainVideoLabel = "mainraw";
  if (narrationTailHoldSeconds > 0) {
    filterParts.push(
      `[mainraw]tpad=stop_mode=clone:stop_duration=${number(narrationTailHoldSeconds)}[mainrawheld]`,
    );
    mainVideoLabel = "mainrawheld";
  }
  const mainDecor: string[] = [];
  const captionPlacement = visualCritic.plan.captionPlacement;
  const captionStyle = {
    ...captionPlan.safeZone,
    alignment: subtitleAlignmentForPlacement(captionPlacement),
    marginV:
      preset === "9:16"
        ? 96
        : Math.round(height * visualCritic.plan.captionBandRatio * 0.2),
    marginH: Math.round(
      width * visualCritic.plan.horizontalMarginRatio,
    ),
  };

  await writeFile(
    path.join(runDir, "captions.json"),
    JSON.stringify(
      {
        ...captionPlan,
        resolvedPlacement: captionPlacement,
        resolvedStyle: captionStyle,
        timingSource: options.captionsFilePath
          ? "voice-segment-duration"
          : "browser-timeline",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

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
    const isAss = options.captionsFilePath?.toLowerCase().endsWith(".ass");
    mainDecor.push(
      isAss
        ? `ass='${escapeFilterPath(captionsPath)}'`
        : `subtitles='${escapeFilterPath(captionsPath)}':original_size=${width}x${height}:force_style='FontName=DejaVu Sans,FontSize=${captionStyle.fontSize},PrimaryColour=&H00FFFFFF,BackColour=&H00000000,OutlineColour=&H00000000,BorderStyle=1,Outline=${captionStyle.outline},Shadow=0,Alignment=${captionStyle.alignment},MarginV=${captionStyle.marginV},MarginL=${captionStyle.marginH},MarginR=${captionStyle.marginH}'`,
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
      ? `[${mainVideoLabel}]${mainDecor.join(",")}[main]`
      : `[${mainVideoLabel}]null[main]`,
  );

  const introEnabled = options.intro !== false;
  const outroEnabled = options.outro !== false;
  const introSeconds = introEnabled
    ? Math.max(0.8, options.introSeconds ?? 2.2)
    : 0;
  const outroSeconds = outroEnabled
    ? Math.max(1.2, options.outroSeconds ?? 4.8)
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
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.66:fontsize=${introBrandSize}:x=84:y=${Math.round(height * 0.28)},` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(title)}':fontcolor=white:fontsize=${introTitleSize}:x=84:y=${Math.round(height * 0.37)},` +
        `drawtext=font='DejaVu Sans':text='PRODUCT EXPERIENCE':fontcolor=white@0.42:fontsize=22:x=84:y=${Math.round(height * 0.50)},` +
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
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(brandLabel)}':fontcolor=white@0.64:fontsize=30:x=84:y=${Math.round(height * 0.24)},` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(outroText)}':fontcolor=white:fontsize=${preset === "9:16" ? 50 : 44}:x=84:y=${Math.round(height * 0.35)},` +
        `drawtext=font='DejaVu Sans':text='${escapeDrawText(outroSecondary)}':fontcolor=white@0.74:fontsize=26:x=84:y=${Math.round(height * 0.49)},` +
        `drawtext=font='DejaVu Sans':text='VIIVERSION.COM':fontcolor=white@0.46:fontsize=20:x=84:y=${Math.round(height * 0.72)},` +
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
    resolveRenderEncoderPreset(options.encoderPreset),
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
