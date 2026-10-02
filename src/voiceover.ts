import { writeFile } from "node:fs/promises";

export type VoiceoverOptions = {
  apiKey?: string;
  model?: string;
  voice?: string;
  instructions?: string;
};

export async function createVoiceover(
  text: string,
  outputPath: string,
  options: VoiceoverOptions = {},
): Promise<string> {
  const input = text.trim();
  if (!input) throw new Error("Voiceover text is empty.");
  if (input.length > 4_096) {
    throw new Error("Voiceover text exceeds the current 4096-character speech request limit.");
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for AI voiceover generation.");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice: options.voice ?? process.env.OPENAI_TTS_VOICE ?? "marin",
      input,
      instructions:
        options.instructions ??
        "Professional, warm product-demo narration. Clear pace, concise emphasis, natural pauses.",
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI speech generation failed (${response.status}): ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  return outputPath;
}
