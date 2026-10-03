export type VoiceProviderId = "elevenlabs" | "openai" | "piper";

export type VoicePersonaId = "viiversion-presenter" | "neutral";

export type VoiceTiming = {
  character: string;
  startSeconds: number;
  endSeconds: number;
};

export type VoiceRequest = {
  text: string;
  locale: string;
  outputPath: string;
  provider?: VoiceProviderId | "auto";
  voiceId?: string;
  model?: string;
  persona?: VoicePersonaId;
  instructions?: string;
  pronunciation?: Record<string, string>;
  requireNativeTimings?: boolean;
};

export type VoiceResult = {
  provider: VoiceProviderId;
  locale: string;
  model: string;
  voiceId: string;
  audioPath: string;
  timings: VoiceTiming[];
  hasNativeTimings: boolean;
  directedText: string;
  instructions: string;
};

export type VoiceProviderContext = {
  env?: NodeJS.ProcessEnv;
};

export interface VoiceProvider {
  readonly id: VoiceProviderId;
  readonly nativeTimings: boolean;
  isConfigured(request: VoiceRequest, context?: VoiceProviderContext): boolean;
  supportsLocale(locale: string, request: VoiceRequest, context?: VoiceProviderContext): boolean;
  synthesize(request: VoiceRequest, context?: VoiceProviderContext): Promise<VoiceResult>;
}
