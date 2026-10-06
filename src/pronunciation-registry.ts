import fs from "node:fs";
import path from "node:path";

export type BrandPronunciation = {
  id: string;
  canonical: string;
  aliases: string[];
  spoken: {
    locale: string;
    text: string;
    ipa?: string;
  };
};

export type PronunciationRegistry = {
  russianStressOverrides: Record<string, string>;
  brands: BrandPronunciation[];
};

let cached: PronunciationRegistry | undefined;

export function loadPronunciationRegistry(): PronunciationRegistry {
  if (cached) return cached;
  const registryPath = path.resolve(process.cwd(), "config", "pronunciation-registry.json");
  cached = JSON.parse(fs.readFileSync(registryPath, "utf8")) as PronunciationRegistry;
  return cached;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceBrandAliases(
  text: string,
  replacementFor: (brand: BrandPronunciation) => string,
): string {
  let result = text;
  const brands = loadPronunciationRegistry().brands;

  for (const brand of brands) {
    const aliases = [...brand.aliases].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const pattern = new RegExp(
        "(?<![\\p{L}\\p{N}_])" + escapeRegExp(alias) + "(?![\\p{L}\\p{N}_])",
        "giu",
      );
      result = result.replace(pattern, replacementFor(brand));
    }
  }
  return result;
}

export function applyBrandSpokenAliases(text: string): string {
  return replaceBrandAliases(text, (brand) => brand.spoken.text);
}

export function brandPronunciationRules(): Array<{
  string_to_replace: string;
  type: "phoneme" | "alias";
  alphabet?: "ipa";
  phoneme?: string;
  alias?: string;
}> {
  const rules: Array<{
    string_to_replace: string;
    type: "phoneme" | "alias";
    alphabet?: "ipa";
    phoneme?: string;
    alias?: string;
  }> = [];

  for (const brand of loadPronunciationRegistry().brands) {
    for (const alias of brand.aliases) {
      if (brand.spoken.ipa) {
        rules.push({
          string_to_replace: alias,
          type: "phoneme",
          alphabet: "ipa",
          phoneme: brand.spoken.ipa,
        });
      } else {
        rules.push({
          string_to_replace: alias,
          type: "alias",
          alias: brand.spoken.text,
        });
      }
    }
  }
  return rules;
}
