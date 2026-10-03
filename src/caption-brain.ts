import type { EditScene, SceneManifest } from "./scenes.js";

export type CaptionPreset = "16:9" | "9:16" | "1:1";

export type CaptionCue = {
  text: string;
  start: number;
  end: number;
  stepIndex: number;
};

export type CaptionPlan = {
  version: "caption-brain-v1";
  cues: CaptionCue[];
  safeZone: {
    alignment: 2;
    fontSize: number;
    marginV: number;
    marginH: number;
    outline: number;
  };
};

function secondsBetween(startIso: string, valueIso: string): number {
  return Math.max(0, (Date.parse(valueIso) - Date.parse(startIso)) / 1000);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function splitCaptionText(
  input: string,
  options: { maxWords?: number; maxChars?: number } = {},
): string[] {
  const text = normalize(input);
  if (!text) return [];

  const maxWords = options.maxWords ?? 9;
  const maxChars = options.maxChars ?? 44;
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    let current: string[] = [];

    const flush = () => {
      if (current.length) {
        chunks.push(current.join(" "));
        current = [];
      }
    };

    for (const word of words) {
      const candidate = [...current, word].join(" ");
      if (
        current.length > 0 &&
        (current.length >= maxWords || candidate.length > maxChars)
      ) {
        flush();
      }
      current.push(word);
    }

    flush();
  }

  return chunks;
}

function sceneForStep(
  stepIndex: number,
  scenes: EditScene[],
): EditScene | undefined {
  return scenes.find((scene) => scene.stepIndexes.includes(stepIndex));
}

function sourceToOutput(
  sourceSeconds: number,
  scene: EditScene,
): number {
  return scene.outputStart + Math.max(0, sourceSeconds - scene.sourceStart);
}

function safeZoneFor(preset: CaptionPreset): CaptionPlan["safeZone"] {
  if (preset === "9:16") {
    return {
      alignment: 2,
      fontSize: 20,
      marginV: 120,
      marginH: 62,
      outline: 0,
    };
  }

  if (preset === "1:1") {
    return {
      alignment: 2,
      fontSize: 9,
      marginV: 54,
      marginH: 44,
      outline: 1,
    };
  }

  return {
    alignment: 2,
    fontSize: 11,
    marginV: 42,
    marginH: 48,
    outline: 1,
  };
}

export function buildCaptionPlan(
  manifest: SceneManifest,
  scenes: EditScene[],
  preset: CaptionPreset,
): CaptionPlan {
  const cues: CaptionCue[] = [];
  let previousEnd = -1;

  for (const item of manifest.timeline) {
    if (!item.success) continue;

    const step = manifest.scenario.steps[item.index];
    const raw = normalize(step?.narration ?? step?.label ?? "");
    if (!raw) continue;

    const scene = sceneForStep(item.index, scenes);
    if (!scene) continue;

    const sourceStart = secondsBetween(manifest.startedAt, item.startedAt);
    const sourceEnd = secondsBetween(manifest.startedAt, item.finishedAt);
    const mappedStart = sourceToOutput(sourceStart, scene);
    const mappedEnd = Math.min(
      scene.outputEnd,
      sourceToOutput(sourceEnd, scene) + 0.45,
    );

    const chunks = splitCaptionText(raw, {
      maxWords: preset === "9:16" ? 7 : 9,
      maxChars: preset === "9:16" ? 34 : 44,
    });
    if (!chunks.length) continue;

    const availableStart = Math.max(
      scene.outputStart,
      mappedStart,
      previousEnd < 0 ? 0 : previousEnd + 0.08,
    );
    const availableEnd = Math.max(
      availableStart + 0.45,
      Math.min(scene.outputEnd, Math.max(mappedEnd, availableStart + 0.9)),
    );
    const available = Math.max(0.45, availableEnd - availableStart);

    let cursor = availableStart;

    chunks.forEach((chunk, chunkIndex) => {
      const remaining = chunks.length - chunkIndex;
      const words = chunk.split(/\s+/).length;
      const readingSeconds = Math.min(
        3.2,
        Math.max(0.72, words / 2.65 + 0.18),
      );
      const remainingWindow = Math.max(0.45, availableEnd - cursor);
      const fairShare = remainingWindow / remaining;
      const duration = Math.max(
        0.45,
        Math.min(readingSeconds, Math.max(0.45, fairShare)),
      );
      const end = Math.min(scene.outputEnd, cursor + duration);

      if (end > cursor + 0.05) {
        cues.push({
          text: chunk,
          start: cursor,
          end,
          stepIndex: item.index,
        });
        previousEnd = end;
        cursor = end + 0.08;
      }
    });
  }

  return {
    version: "caption-brain-v1",
    cues,
    safeZone: safeZoneFor(preset),
  };
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;

  return (
    [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(secs).padStart(2, "0"),
    ].join(":") +
    "," +
    String(millis).padStart(3, "0")
  );
}

export function captionPlanToSrt(plan: CaptionPlan): string {
  return (
    plan.cues
      .map((cue, index) =>
        [
          String(index + 1),
          `${srtTime(cue.start)} --> ${srtTime(cue.end)}`,
          cue.text,
        ].join("\n"),
      )
      .join("\n\n") + (plan.cues.length ? "\n" : "")
  );
}
