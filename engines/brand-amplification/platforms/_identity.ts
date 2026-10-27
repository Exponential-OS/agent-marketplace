/**
 * _identity.ts — who the operator is, and where their honey pot lives.
 *
 * ⛔ WHY THIS MODULE EXISTS. Both platform drivers had the author's identity
 * compiled in: linkedin.ts matched a literal name to decide "is this my own
 * post", and substack.ts navigated to a literal blog domain to create drafts.
 * In a shipped plugin that means every other user either cannot use the
 * feature at all, or — worse for the substack path — is driving toward
 * somebody else's publication.
 *
 * ⚠️ EVERY RESOLVER HERE FAILS CLOSED. These values gate actions that write to
 * a real audience. A missing config must make the plugin REFUSE, never fall
 * back to a default that happens to be one particular person's account, and
 * never to a permissive pattern that matches anyone.
 *
 * Source order is the same everywhere: explicit env first (testable, scriptable),
 * then the brand-spec that the onboarding skill already writes.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function specPath(): string | null {
  const home = (process.env.CAREER_HOME ?? "").trim();
  return home ? resolve(home, "brand-amplification/identity/brand-spec.json") : null;
}

function fromSpec(pick: (spec: any) => unknown): string | null {
  const p = specPath();
  if (!p) return null;
  try {
    if (!existsSync(p)) return null;
    const v = pick(JSON.parse(readFileSync(p, "utf8")));
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    // A malformed spec must not silently widen anything — treat as absent.
    return null;
  }
}

let ownerCache: string | null | undefined;
let domainCache: string | null | undefined;

/** Test seam; also lets a long-running session pick up an edited spec. */
export function resetIdentityCache() {
  ownerCache = undefined;
  domainCache = undefined;
}

export function resolveOwnerName(): string | null {
  if (ownerCache !== undefined) return ownerCache;
  const env = (process.env.BRAND_OWNER_NAME ?? "").trim();
  return (ownerCache = env || fromSpec((s) => s?.handles?.personal_name));
}

export function requireOwnerName(): string {
  const n = resolveOwnerName();
  if (!n)
    throw new Error(
      "⛔ owner name is not configured — ownership cannot be verified, so this refuses " +
        "rather than guessing. Fix: set BRAND_OWNER_NAME, or set CAREER_HOME with " +
        "handles.personal_name in brand-amplification/identity/brand-spec.json.",
    );
  return n;
}

export function resolveHoneyPotDomain(): string | null {
  if (domainCache !== undefined) return domainCache;
  const env = (process.env.HONEY_POT_DOMAIN ?? "").trim();
  return (domainCache = env || fromSpec((s) => s?.honey_pot_domain));
}

export function requireHoneyPotDomain(): string {
  const d = resolveHoneyPotDomain();
  if (!d)
    throw new Error(
      "⛔ honey-pot domain is not configured — refusing to open a publisher. " +
        "A default here would drive the browser at somebody else's publication. " +
        "Fix: set HONEY_POT_DOMAIN, or set CAREER_HOME with honey_pot_domain in " +
        "brand-amplification/identity/brand-spec.json.",
    );
  return d;
}

/** Escapes a config value before it is embedded in a RegExp. */
export function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
