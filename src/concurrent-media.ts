export type CaptureWithVoiceoverOptions<TCapture> = {
  capture: () => Promise<TCapture>;
  voiceover?: () => Promise<string>;
  parallel?: boolean;
};

export type CaptureWithVoiceoverResult<TCapture> = {
  capture: TCapture;
  voiceoverPath?: string;
};

export function parallelVoiceoverEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.DEMO_STUDIO_PARALLEL_VOICEOVER?.trim().toLowerCase();
  return !value || !["0", "false", "off", "no"].includes(value);
}

export async function runCaptureWithOptionalVoiceover<TCapture>(
  options: CaptureWithVoiceoverOptions<TCapture>,
): Promise<CaptureWithVoiceoverResult<TCapture>> {
  if (!options.voiceover) {
    return { capture: await options.capture() };
  }

  if (options.parallel === false) {
    const capture = await options.capture();
    const voiceoverPath = await options.voiceover();
    return { capture, voiceoverPath };
  }

  const captureTask = options.capture();
  const voiceoverTask = options.voiceover();
  const [captureResult, voiceoverResult] = await Promise.allSettled([
    captureTask,
    voiceoverTask,
  ]);

  if (captureResult.status === "rejected") {
    throw captureResult.reason;
  }
  if (voiceoverResult.status === "rejected") {
    throw voiceoverResult.reason;
  }

  return {
    capture: captureResult.value,
    voiceoverPath: voiceoverResult.value,
  };
}
