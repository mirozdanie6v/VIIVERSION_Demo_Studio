import { ElevenLabsVoiceProvider } from "./voice-provider-elevenlabs.js";
import { OpenAIVoiceProvider } from "./voice-provider-openai.js";
import { PiperVoiceProvider } from "./voice-provider-piper.js";
import type {
  VoiceProvider,
  VoiceProviderContext,
  VoiceProviderId,
  VoiceRequest,
  VoiceResult,
} from "./voice-engine-types.js";

const DEFAULT_ORDER: VoiceProviderId[] = ["elevenlabs", "openai", "piper"];

function providerOrder(env: NodeJS.ProcessEnv): VoiceProviderId[] {
  const requested = (env.VOICE_PROVIDER_ORDER ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is VoiceProviderId =>
      ["elevenlabs", "openai", "piper"].includes(value),
    );

  const result = [...requested];
  for (const id of DEFAULT_ORDER) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

export type VoiceRouterOptions = {
  providers?: VoiceProvider[];
  context?: VoiceProviderContext;
};

export type VoiceRouteDecision = {
  selected?: VoiceProviderId;
  candidates: Array<{
    provider: VoiceProviderId;
    configured: boolean;
    localeSupported: boolean;
    nativeTimings: boolean;
    score: number;
  }>;
};

export class VoiceRouter {
  private readonly providers: VoiceProvider[];
  private readonly context: VoiceProviderContext;

  constructor(options: VoiceRouterOptions = {}) {
    this.providers =
      options.providers ??
      [
        new ElevenLabsVoiceProvider(),
        new OpenAIVoiceProvider(),
        new PiperVoiceProvider(),
      ];
    this.context = options.context ?? {};
  }

  inspect(request: VoiceRequest): VoiceRouteDecision {
    const env = this.context.env ?? process.env;
    const order = providerOrder(env);
    const explicit = request.provider && request.provider !== "auto"
      ? request.provider
      : undefined;

    const candidates = this.providers.map((provider) => {
      const configured = provider.isConfigured(request, this.context);
      const localeSupported = provider.supportsLocale(
        request.locale,
        request,
        this.context,
      );
      const orderIndex = order.indexOf(provider.id);
      let score = 100 - Math.max(0, orderIndex) * 10;

      if (request.requireNativeTimings) {
        score += provider.nativeTimings ? 35 : -60;
      }
      if (explicit) {
        score += provider.id === explicit ? 1000 : -1000;
      }
      if (!configured) score -= 10000;
      if (!localeSupported) score -= 10000;

      return {
        provider: provider.id,
        configured,
        localeSupported,
        nativeTimings: provider.nativeTimings,
        score,
      };
    });

    const selected = [...candidates]
      .filter((item) => item.configured && item.localeSupported)
      .sort((a, b) => b.score - a.score)[0]?.provider;

    return { selected, candidates };
  }

  async synthesize(request: VoiceRequest): Promise<VoiceResult> {
    const decision = this.inspect(request);
    if (!decision.selected) {
      const summary = decision.candidates
        .map(
          (item) =>
            `${item.provider}: configured=${item.configured}, locale=${item.localeSupported}, nativeTimings=${item.nativeTimings}`,
        )
        .join("; ");
      throw new Error(
        `No configured voice provider can synthesize locale ${request.locale}. ${summary}`,
      );
    }

    const provider = this.providers.find(
      (candidate) => candidate.id === decision.selected,
    );
    if (!provider) throw new Error("Voice router selected an unknown provider.");

    if (request.requireNativeTimings && !provider.nativeTimings) {
      throw new Error(
        `Provider ${provider.id} does not supply native timing metadata required for this request.`,
      );
    }

    return provider.synthesize(request, this.context);
  }
}

export async function synthesizeVoice(
  request: VoiceRequest,
  options: VoiceRouterOptions = {},
): Promise<VoiceResult> {
  return new VoiceRouter(options).synthesize(request);
}
