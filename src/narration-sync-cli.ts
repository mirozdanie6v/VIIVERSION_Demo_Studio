import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEditorBrainPlan } from "./editor-brain.js";
import { reviewEditorPlan } from "./editor-critic.js";
import { alignScenesToBeatGrid } from "./music-brain.js";
import { splitCaptionText } from "./caption-brain.js";
import type { EditScene, SceneManifest, SceneTimelineEntry } from "./scenes.js";

type Manifest = SceneManifest & {
  scenario: SceneManifest["scenario"] & {
    name?: string;
    steps: Array<SceneManifest["scenario"]["steps"][number] & {
      voiceText?: string;
    }>;
  };
  timeline: SceneTimelineEntry[];
  success: boolean;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return (
    [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":") +
    "," +
    String(millis).padStart(3, "0")
  );
}

async function run(executable: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${executable} exited with code ${code ?? "unknown"}`));
    });
  });
}

function sceneForStep(stepIndex: number, scenes: EditScene[]): EditScene | undefined {
  return scenes.find((scene) => scene.stepIndexes.includes(stepIndex));
}

async function durationOf(file: string): Promise<number> {
  const raw = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nk=1:nw=1",
    file,
  ]);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid audio duration for ${file}`);
  return value;
}

async function main() {
  const runArg = arg("--run");
  if (!runArg) throw new Error("Usage: tsx src/narration-sync-cli.ts --run artifacts/<run-id> [--bpm 96]");

  const runDir = path.resolve(runArg);
  const manifest = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8")) as Manifest;
  if (!manifest.success) throw new Error("Cannot synchronize narration for an unsuccessful capture.");

  const editorBrain = buildEditorBrainPlan(manifest);
  if (!editorBrain.qualityGate.passed) {
    throw new Error("Editor Brain quality gate failed before narration sync.");
  }
  const critic = reviewEditorPlan(editorBrain);
  if (!critic.passed) throw new Error("Editor Critic rejected the edit plan before narration sync.");

  const bpm = Number(arg("--bpm") ?? "96");
  const scenes = alignScenesToBeatGrid(critic.revisedScenes, { bpm }).scenes;
  const contentDuration = scenes.at(-1)?.outputEnd ?? 0;

  const planned = [];
  for (const item of manifest.timeline) {
    if (!item.success) continue;
    const step = manifest.scenario.steps[item.index];
    const narration = step?.narration?.trim();
    if (!narration) continue;

    const scene = sceneForStep(item.index, scenes);
    if (!scene) continue;

    const sourceStart = secondsBetween(manifest.startedAt, item.startedAt);
    const mappedStart = Math.min(
      Math.max(scene.outputStart, scene.outputStart + Math.max(0, sourceStart - scene.sourceStart)),
      Math.max(scene.outputStart, scene.outputEnd - 0.15),
    );

    const clipPath = path.join(runDir, "voices", `step-${item.index}.mp3`);
    const clipDuration = await durationOf(clipPath);

    planned.push({
      stepIndex: item.index,
      narration,
      voiceText: step.voiceText?.trim() || narration,
      plannedStart: mappedStart,
      start: mappedStart,
      duration: clipDuration,
      clipPath,
      sceneStart: scene.outputStart,
      sceneEnd: scene.outputEnd,
    });
  }

  planned.sort((a, b) => a.plannedStart - b.plannedStart || a.stepIndex - b.stepIndex);

  let cursor = 0;
  for (let index = 0; index < planned.length; index += 1) {
    const segment = planned[index];
    segment.start = Math.max(segment.plannedStart, cursor);
    cursor = segment.start + segment.duration + 0.16;
  }

  const finalNarrationEnd = planned.reduce(
    (max, segment) => Math.max(max, segment.start + segment.duration),
    0,
  );
  if (finalNarrationEnd > contentDuration + 0.35) {
    throw new Error(
      `Narration exceeds edited content timeline: voice=${finalNarrationEnd.toFixed(2)}s, content=${contentDuration.toFixed(2)}s. Increase the relevant visual hold instead of allowing drift.`,
    );
  }

  const ffArgs: string[] = ["-y"];
  for (const segment of planned) ffArgs.push("-i", segment.clipPath);

  const filters: string[] = [];
  const labels: string[] = [];
  planned.forEach((segment, index) => {
    const delayMs = Math.round(segment.start * 1000);
    filters.push(`[${index}:a]aresample=44100,adelay=${delayMs}:all=1[v${index}]`);
    labels.push(`[v${index}]`);
  });
  filters.push(
    `${labels.join("")}amix=inputs=${planned.length}:duration=longest:normalize=0,alimiter=limit=0.95[voice]`,
  );

  ffArgs.push(
    "-filter_complex", filters.join(";"),
    "-map", "[voice]",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    path.join(runDir, "voiceover.mp3"),
  );
  await run("ffmpeg", ffArgs);

  const cues: Array<{ start: number; end: number; text: string; stepIndex: number }> = [];
  for (const segment of planned) {
    const chunks = splitCaptionText(segment.narration, { maxWords: 7, maxChars: 36 });
    const weights = chunks.map((chunk) => Math.max(1, chunk.replace(/\s+/g, "").length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cueStart = segment.start;

    chunks.forEach((chunk, index) => {
      const isLast = index === chunks.length - 1;
      const rawDuration = segment.duration * (weights[index] / totalWeight);
      const cueEnd = isLast
        ? segment.start + segment.duration
        : Math.min(segment.start + segment.duration, cueStart + rawDuration);

      cues.push({
        start: cueStart,
        end: Math.max(cueStart + 0.22, cueEnd),
        text: chunk,
        stepIndex: segment.stepIndex,
      });
      cueStart = cueEnd;
    });
  }

  const srt = cues
    .map((cue, index) =>
      [
        String(index + 1),
        `${srtTime(cue.start)} --> ${srtTime(cue.end)}`,
        cue.text,
      ].join("\n"),
    )
    .join("\n\n") + (cues.length ? "\n" : "");

  await writeFile(path.join(runDir, "synced-captions.srt"), srt, "utf8");
  await writeFile(
    path.join(runDir, "narration-sync.json"),
    JSON.stringify(
      {
        version: "narration-sync-v1",
        timingSource: "actual-tts-segment-duration",
        contentDurationSeconds: contentDuration,
        finalNarrationEndSeconds: finalNarrationEnd,
        segments: planned.map(({ clipPath, ...segment }) => ({
          ...segment,
          clip: path.basename(clipPath),
        })),
        cues,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(JSON.stringify({
    voiceover: path.join(runDir, "voiceover.mp3"),
    captions: path.join(runDir, "synced-captions.srt"),
    contentDuration,
    finalNarrationEnd,
    segmentCount: planned.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
