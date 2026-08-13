export interface AudiencePreviewContact {
  name: string;
  company: string;
  relevance: number;
  warmth: number;
  score: number;
  matchedThemes?: string[];
}

export interface ScoreAudienceOptions {
  includeZeroRelevance?: boolean;
}

export interface FormatAudiencePreviewOptions {
  limit?: number;
}

const DEFAULT_COMPANY = "Unknown company";

export function normalizeWarmth(raw: unknown): number {
  if (raw === null || raw === undefined) return 1;

  if (typeof raw === "number") {
    return clampWarmth(raw);
  }

  if (typeof raw === "string") {
    const leadingInteger = raw.trim().match(/^[+-]?\d+/)?.[0];
    if (leadingInteger !== undefined) return clampWarmth(Number.parseInt(leadingInteger, 10));
    return 2;
  }

  return 1;
}

export function topicRelevance(postThemes: readonly string[], contact: unknown): number {
  const themeTokens = uniqueTokens(postThemes);
  if (themeTokens.length === 0) return 0;

  const contactTokens = new Set(tokenize(contactText(contact)));
  return themeTokens.filter((token) => contactTokens.has(token)).length;
}

export function scoreAudience(
  postThemes: readonly string[],
  people: readonly unknown[] | null | undefined,
  opts: ScoreAudienceOptions = {},
): AudiencePreviewContact[] {
  const ranked: AudiencePreviewContact[] = [];

  for (const rawContact of people ?? []) {
    if (!isRecord(rawContact)) continue;

    const name = cleanString(rawContact.name);
    if (!name) continue;

    const company = displayCompany(rawContact);
    const relevance = topicRelevance(postThemes, rawContact);
    // Default: EXCLUDE zero-topic-relevance contacts — an audience preview is
    // "who's likely to see THIS post" (topic match), so a contact matching no
    // theme isn't a candidate and must never fill the list. Opt in with
    // includeZeroRelevance: true.
    if (relevance === 0 && opts.includeZeroRelevance !== true) continue;

    const warmth = normalizeWarmth(rawContact.warmth);
    ranked.push({
      name,
      company,
      relevance,
      warmth,
      score: relevance * warmth,
      matchedThemes: matchedThemes(postThemes, rawContact),
    });
  }

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    if (b.warmth !== a.warmth) return b.warmth - a.warmth;
    return a.name.localeCompare(b.name);
  });
}

export function formatAudiencePreview(
  ranked: readonly AudiencePreviewContact[],
  opts: FormatAudiencePreviewOptions = {},
): string {
  const limit = normalizeLimit(opts.limit);
  const lines = ["Warm contacts likely to see this post:"];
  const displayed = ranked.slice(0, limit);

  if (displayed.length === 0) {
    lines.push("No warm contacts scored from the local people graph.");
    return lines.map(sanitizeLine).join("\n");
  }

  displayed.forEach((contact, index) => {
    const themes = contact.matchedThemes ?? [];
    const why = themes.length > 0
      ? `matched themes: ${themes.map(sanitizeInline).join(", ")}`
      : "no matched themes";

    lines.push(
      `${index + 1}. ${contact.name} — ${contact.company} — why: ${why} ` +
        `(relevance ${contact.relevance}, warmth ${contact.warmth}, score ${contact.score})`,
    );
  });

  return lines.map(sanitizeLine).join("\n");
}

function matchedThemes(postThemes: readonly string[], contact: unknown): string[] {
  const contactTokens = new Set(tokenize(contactText(contact)));
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const theme of postThemes) {
    const label = cleanString(theme);
    if (!label) continue;

    const normalized = label.toLowerCase();
    if (seen.has(normalized)) continue;

    const themeTokens = tokenize(label);
    if (themeTokens.some((token) => contactTokens.has(token))) {
      matches.push(label);
      seen.add(normalized);
    }
  }

  return matches;
}

function uniqueTokens(values: readonly string[]): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const token of tokenize(value)) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }

  return tokens;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function contactText(contact: unknown): string {
  if (!isRecord(contact)) return "";
  return [
    cleanString(contact.their_expertise),
    cleanString(contact.role),
    cleanString(contact.company),
    cleanString(contact.they_told_us),
  ].filter(Boolean).join(" ");
}

function displayCompany(contact: Record<string, unknown>): string {
  return cleanString(contact.company)
    ?? firstCleanString(contact.companies)
    ?? cleanString(contact.current_company)
    ?? DEFAULT_COMPANY;
}

function firstCleanString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const text = cleanString(item);
    if (text) return text;
  }
  return undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function clampWarmth(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 10;
  return Math.max(0, Math.floor(value));
}

function sanitizeLine(line: string): string {
  return sanitizeInline(line).trimEnd();
}

function sanitizeInline(value: string): string {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
