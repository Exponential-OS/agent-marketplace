export const IDENTITY_HANDLES_PATH = "identity/handles.md";
export const IDENTITY_BRAND_VOICE_PATH = "identity/brand-voice.md";

export interface HandlesInput {
  name?: string;
  linkedin?: string;
  github?: string;
  substack?: string;
  twitter?: string;
  website?: string;
  email?: string;
}

export interface BrandVoiceInput {
  themes?: string[];
  voiceLine?: string;
}

export interface IdentityBootstrapInput extends HandlesInput, BrandVoiceInput {}

export interface IdentityBootstrapFile {
  path: string;
  content: string;
}

export interface IdentityBootstrapResult {
  files: IdentityBootstrapFile[];
  filesCreated: string[];
}

const HANDLE_FIELDS: ReadonlyArray<readonly [keyof HandlesInput, string]> = [
  ["name", "Name"],
  ["linkedin", "LinkedIn"],
  ["github", "GitHub"],
  ["substack", "Substack"],
  ["twitter", "Twitter/X"],
  ["website", "Website"],
  ["email", "Email"],
];

export function buildHandlesDoc(input: HandlesInput = {}): string {
  const lines = ["# Handles", ""];

  let wroteHandle = false;
  for (const [key, label] of HANDLE_FIELDS) {
    const value = clean(input[key]);
    if (!value) continue;

    lines.push(`- ${label}: ${value}`);
    wroteHandle = true;
  }

  if (!wroteHandle) {
    lines.push("TODO: Add identity handles and contact links.");
  }

  return `${lines.join("\n")}\n`;
}

export function buildBrandVoiceDoc(input: BrandVoiceInput = {}): string {
  const themes = (input.themes ?? []).map(clean).filter((theme): theme is string => Boolean(theme));
  const voiceLine = clean(input.voiceLine);

  const lines = ["# Brand Voice", "", "## Themes"];
  if (themes.length === 0) {
    lines.push("- TODO: Add recurring themes.");
  } else {
    for (const theme of themes) {
      lines.push(`- ${theme}`);
    }
  }

  lines.push("", "## Voice", voiceLine ?? "TODO: Add a one-line description of the user's voice.");

  return `${lines.join("\n")}\n`;
}

export function bootstrapIdentityFiles(input: IdentityBootstrapInput = {}): IdentityBootstrapResult {
  const files = [
    {
      path: IDENTITY_HANDLES_PATH,
      content: buildHandlesDoc(input),
    },
    {
      path: IDENTITY_BRAND_VOICE_PATH,
      content: buildBrandVoiceDoc(input),
    },
  ];

  return {
    files,
    filesCreated: files.map((file) => file.path),
  };
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
