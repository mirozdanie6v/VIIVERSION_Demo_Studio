import type { VoicePersonaId, VoiceRequest } from "./voice-engine-types.js";

export type DirectedVoiceRequest = VoiceRequest & {
  persona: VoicePersonaId;
  directedText: string;
  resolvedInstructions: string;
};

const BASE_PERSONAS: Record<VoicePersonaId, string> = {
  "viiversion-presenter":
    "Sound like a skilled human presenter demonstrating a premium digital product to a client. " +
    "Use bright, natural conversational phrasing, confident but warm delivery, clear semantic emphasis, " +
    "short organic pauses, medium energetic pace, and varied intonation. Avoid grave/dark delivery, trailer voice, radio-advertising cadence, " +
    "overacting, whispering, monotone rhythm, synthetic sing-song prosody, and exaggerated pauses.",
  neutral:
    "Use clear, natural, neutral speech with human pacing and restrained expression.",
};

const LANGUAGE_DIRECTION: Record<string, string> = {
  ja: "Use natural Japanese presentation pacing and native sentence-final intonation.",
  zh: "Use natural Mandarin presentation phrasing and native lexical tones. Avoid foreign-accent rhythm.",
  ko: "Use natural Korean presentation cadence and native phrasing.",
  vi: "Use natural Vietnamese tones and native presentation cadence.",
  th: "Use natural Thai tones and native presentation rhythm.",
  ar: "Use natural Modern Standard Arabic pronunciation unless the supplied locale implies another variety.",
};

export function normalizeLocale(value: string): string {
  const locale = value.trim().replace(/_/g, "-");
  if (!locale) throw new Error("Voice locale is required.");
  return locale;
}

function languageOf(locale: string): string {
  return normalizeLocale(locale).split("-")[0].toLowerCase();
}

export function applyPronunciation(
  text: string,
  pronunciation: Record<string, string> = {},
): string {
  let result = text;
  for (const [source, replacement] of Object.entries(pronunciation)) {
    if (!source) continue;
    result = result.split(source).join(replacement);
  }
  return result;
}

export function directVoiceRequest(request: VoiceRequest): DirectedVoiceRequest {
  const locale = normalizeLocale(request.locale);
  const persona = request.persona ?? "viiversion-presenter";
  const directedText = applyPronunciation(
    request.text.trim(),
    request.pronunciation,
  );

  if (!directedText) throw new Error("Voice text is empty.");

  const language = languageOf(locale);
  const localeDirection = LANGUAGE_DIRECTION[language];
  const resolvedInstructions = [
    BASE_PERSONAS[persona],
    `Speak in locale ${locale}. Pronunciation and prosody must sound native to that locale.`,
    "Keep the delivery suitable for a product presentation rather than an audiobook or character performance.",
    localeDirection,
    request.instructions?.trim(),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...request,
    locale,
    persona,
    directedText,
    resolvedInstructions,
  };
}
