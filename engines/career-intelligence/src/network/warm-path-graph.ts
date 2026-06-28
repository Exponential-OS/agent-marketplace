import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";

export type StrengthLabel = "very_strong" | "strong" | "moderate" | "weak";
export type WarmPathNodeType = "self" | "person" | "company";
export type WarmPathEdgeType = "self_person" | "person_person" | "company_affiliation";
export type WarmPathRelationshipKind = "direct" | "confirmed" | "ask_candidate" | "company_affiliation";

export interface WarmPathEvent {
  type: string;
  file?: string;
  reason?: string;
  [key: string]: unknown;
}

export type WarmPathEventSink = (event: WarmPathEvent) => void;

interface PeopleRecord {
  name?: unknown;
  companies?: unknown;
  company?: unknown;
  role?: unknown;
  relationship?: unknown;
  warmth?: unknown;
  connection_strength?: unknown;
  relationship_strength?: unknown;
  channel?: unknown;
  last_contact?: unknown;
  referral_status?: unknown;
  they_told_us?: unknown;
  family_context?: unknown;
  cohort?: unknown;
  cohorts?: unknown;
  [key: string]: unknown;
}

export interface WarmPathNode {
  id: string;
  type: WarmPathNodeType;
  name: string;
  company: string | null;
  currentCompanyNormalized: string | null;
  role: string | null;
  companies: string[];
  normalizedCompanies: string[];
  cohorts: string[];
  record?: PeopleRecord;
  file?: string;
  slug?: string;
}

export interface WarmPathEdge {
  from: string;
  to: string;
  type: WarmPathEdgeType;
  relationship_kind: WarmPathRelationshipKind;
  weight: number;
  strength_label: StrengthLabel;
  evidence: string[];
  stale: boolean;
  last_contact: string | null;
}

export interface WarmPathGraph {
  nodes: Map<string, WarmPathNode>;
  edges: WarmPathEdge[];
  adjacency: Map<string, WarmPathEdge[]>;
  people: WarmPathNode[];
  skipped: WarmPathEvent[];
}

export interface LoadWarmPathGraphOptions {
  eventSink?: WarmPathEventSink;
  now?: Date;
}

export interface WarmPathNodeView {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
}

export interface WarmPathTargetPerson {
  id: string;
  name: string;
  role: string | null;
  company: string | null;
}

export interface WarmPath {
  path_nodes: WarmPathNodeView[];
  path_length: 1 | 2;
  intermediary: { id: string; name: string } | null;
  target_person: WarmPathTargetPerson;
  evidence: string[];
  warmth_score: number;
  strength_label: StrengthLabel;
  stale: boolean;
  last_contact: string | null;
}

export interface WarmPathQueryResult {
  target_company: string;
  paths: WarmPath[];
}

const SELF_NODE_ID = "self";
const NEUTRAL_SCORE = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function defaultPeopleDir(): string {
  const careerHome = process.env.CAREER_HOME ?? process.env.CAREER_OS_HOME ?? null;
  return careerHome ? join(careerHome, "network", "people") : join(process.cwd(), "network", "people");
}

export function normalizeCompany(value: unknown): string {
  const display = displayCompany(value);
  return display ? display.toLowerCase() : "";
}

export function displayCompany(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function strengthLabelForScore(score: number): StrengthLabel {
  if (score >= 4.5) return "very_strong";
  if (score >= 3.5) return "strong";
  if (score >= 2.5) return "moderate";
  return "weak";
}

export function loadWarmPathGraph(
  peopleDir: string = defaultPeopleDir(),
  opts: LoadWarmPathGraphOptions = {},
): WarmPathGraph {
  const eventSink = opts.eventSink ?? (() => {});
  const now = opts.now ?? new Date();
  const skipped: WarmPathEvent[] = [];
  const nodes = new Map<string, WarmPathNode>();
  const edges: WarmPathEdge[] = [];
  const adjacency = new Map<string, WarmPathEdge[]>();
  const people: WarmPathNode[] = [];

  nodes.set(SELF_NODE_ID, {
    id: SELF_NODE_ID,
    type: "self",
    name: "Self",
    company: null,
    currentCompanyNormalized: null,
    role: null,
    companies: [],
    normalizedCompanies: [],
    cohorts: [],
  });

  const logSkip = (event: WarmPathEvent): void => {
    skipped.push(event);
    safeEmit(eventSink, event);
  };

  if (!existsSync(peopleDir)) {
    logSkip({ type: "people_dir_missing", file: peopleDir, reason: "people directory not found" });
    return { nodes, edges, adjacency, people, skipped };
  }

  let files: string[];
  try {
    files = readdirSync(peopleDir).filter((file) => file.endsWith(".json")).sort();
  } catch (e: unknown) {
    logSkip({
      type: "people_dir_unreadable",
      file: peopleDir,
      reason: e instanceof Error ? e.message : String(e),
    });
    return { nodes, edges, adjacency, people, skipped };
  }

  for (const file of files) {
    const filePath = join(peopleDir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (e: unknown) {
      logSkip({
        type: "people_file_skipped",
        file: filePath,
        reason: `invalid_json: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    if (!isRecord(parsed)) {
      logSkip({ type: "people_file_skipped", file: filePath, reason: "record is not a JSON object" });
      continue;
    }

    const record = parsed as PeopleRecord;
    const slug = basename(file, ".json");
    const companies = extractCompanies(record);
    const cohorts = extractCohorts(record);
    const node: WarmPathNode = {
      id: `person:${slug}`,
      type: "person",
      name: cleanString(record.name) ?? slug,
      company: companies.current?.display ?? null,
      currentCompanyNormalized: companies.current?.normalized ?? null,
      role: cleanString(record.role),
      companies: companies.display,
      normalizedCompanies: companies.normalized,
      cohorts,
      record,
      file: filePath,
      slug,
    };

    nodes.set(node.id, node);
    people.push(node);

    for (const company of companies.entries) {
      const companyId = companyNodeId(company.normalized);
      if (!nodes.has(companyId)) {
        nodes.set(companyId, {
          id: companyId,
          type: "company",
          name: company.display,
          company: company.display,
          currentCompanyNormalized: company.normalized,
          role: null,
          companies: [company.display],
          normalizedCompanies: [company.normalized],
          cohorts: [],
        });
      }
    }
  }

  const addEdge = (edge: WarmPathEdge): void => {
    edges.push(edge);
    const out = adjacency.get(edge.from) ?? [];
    out.push(edge);
    adjacency.set(edge.from, out);
  };

  for (const person of people) {
    const direct = scoreDirectRelationship(person.record ?? {}, now);
    addEdge({
      from: SELF_NODE_ID,
      to: person.id,
      type: "self_person",
      relationship_kind: "direct",
      weight: direct.score,
      strength_label: strengthLabelForScore(direct.score),
      evidence: direct.evidence,
      stale: direct.stale,
      last_contact: direct.lastContact,
    });

    for (const company of person.normalizedCompanies) {
      addEdge({
        from: person.id,
        to: companyNodeId(company),
        type: "company_affiliation",
        relationship_kind: "company_affiliation",
        weight: 0,
        strength_label: "weak",
        evidence: [`company: ${companyDisplayFor(person, company) ?? company}`],
        stale: false,
        last_contact: null,
      });
    }
  }

  for (const source of people) {
    for (const target of people) {
      if (source.id === target.id) continue;
      const edge = buildPersonEdge(source, target);
      if (edge) addEdge(edge);
    }
  }

  return { nodes, edges, adjacency, people, skipped };
}

export function findWarmPathsToCompany(graph: WarmPathGraph, company: string): WarmPathQueryResult {
  const targetCompany = displayCompany(company) ?? company.trim();
  const targetCompanyNorm = normalizeCompany(company);
  if (!targetCompanyNorm) return { target_company: targetCompany, paths: [] };

  const targets = graph.people.filter((person) => person.currentCompanyNormalized === targetCompanyNorm);
  const paths: WarmPath[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const direct = graph.adjacency.get(SELF_NODE_ID)?.find((edge) => edge.to === target.id && edge.type === "self_person");
    if (direct) {
      pushUniquePath(paths, seen, {
        path_nodes: [nodeView(graph.nodes.get(SELF_NODE_ID)), nodeView(target)],
        path_length: 1,
        intermediary: null,
        target_person: targetPersonView(target),
        evidence: withCompanyEvidence(direct.evidence, targetCompany),
        warmth_score: direct.weight,
        strength_label: direct.strength_label,
        stale: direct.stale,
        last_contact: direct.last_contact,
      });
    }

    for (const firstHop of graph.adjacency.get(SELF_NODE_ID) ?? []) {
      if (firstHop.type !== "self_person" || firstHop.to === target.id) continue;
      const intermediary = graph.nodes.get(firstHop.to);
      if (!intermediary || intermediary.type !== "person") continue;

      for (const secondHop of graph.adjacency.get(intermediary.id) ?? []) {
        if (secondHop.type !== "person_person" || secondHop.to !== target.id) continue;

        const pathScore = secondHop.relationship_kind === "ask_candidate"
          ? roundScore(Math.min(firstHop.weight, 2))
          : firstHop.weight;

        pushUniquePath(paths, seen, {
          path_nodes: [nodeView(graph.nodes.get(SELF_NODE_ID)), nodeView(intermediary), nodeView(target)],
          path_length: 2,
          intermediary: { id: intermediary.id, name: intermediary.name },
          target_person: targetPersonView(target),
          evidence: withCompanyEvidence([...firstHop.evidence, ...secondHop.evidence], targetCompany),
          warmth_score: pathScore,
          strength_label: strengthLabelForScore(pathScore),
          stale: firstHop.stale,
          last_contact: firstHop.last_contact,
        });
      }
    }
  }

  paths.sort((a, b) => {
    if (b.warmth_score !== a.warmth_score) return b.warmth_score - a.warmth_score;
    if (a.path_length !== b.path_length) return a.path_length - b.path_length;
    const targetCmp = a.target_person.name.localeCompare(b.target_person.name);
    if (targetCmp !== 0) return targetCmp;
    return (a.intermediary?.name ?? "").localeCompare(b.intermediary?.name ?? "");
  });

  return { target_company: targetCompany, paths };
}

function buildPersonEdge(source: WarmPathNode, target: WarmPathNode): WarmPathEdge | null {
  const nameEvidence = findNameEvidence(source, target);
  const cohortEvidence = findSharedCohortEvidence(source, target);
  const companyEvidence = findSharedCompanyEvidence(source, target);

  if (nameEvidence.length === 0 && cohortEvidence.length === 0 && companyEvidence.length === 0) {
    return null;
  }

  const confirmedEvidence = nameEvidence;
  const askCandidateEvidence = [...cohortEvidence, ...companyEvidence].map((item) => `ask candidate: ${item}`);
  const relationshipKind: WarmPathRelationshipKind =
    confirmedEvidence.length > 0 ? "confirmed" : "ask_candidate";
  const evidence = [...confirmedEvidence, ...askCandidateEvidence];

  return {
    from: source.id,
    to: target.id,
    type: "person_person",
    relationship_kind: relationshipKind,
    weight: relationshipKind === "confirmed" ? 3 : 1,
    strength_label: relationshipKind === "confirmed" ? "moderate" : "weak",
    evidence,
    stale: false,
    last_contact: null,
  };
}

function scoreDirectRelationship(record: PeopleRecord, now: Date): {
  score: number;
  evidence: string[];
  stale: boolean;
  lastContact: string | null;
} {
  const evidence: string[] = [];
  const semanticScores = [
    semanticRelationshipScore(record.warmth),
    semanticRelationshipScore(record.connection_strength),
    semanticRelationshipScore(record.relationship_strength),
    semanticRelationshipScore(record.relationship),
  ].filter((score): score is number => score !== null);

  let score = semanticScores.length > 0 ? Math.max(...semanticScores) : NEUTRAL_SCORE;

  const warmth = evidenceString(record.warmth);
  const connectionStrength = evidenceString(record.connection_strength);
  const relationshipStrength = evidenceString(record.relationship_strength);
  const relationship = evidenceString(record.relationship);
  const referralStatus = evidenceString(record.referral_status);
  const channel = evidenceString(record.channel);
  const lastContact = parseDatePart(record.last_contact);

  if (warmth) evidence.push(`warmth: ${warmth}`);
  if (connectionStrength) evidence.push(`connection strength: ${connectionStrength}`);
  if (relationshipStrength) evidence.push(`relationship strength: ${relationshipStrength}`);
  if (relationship) evidence.push(`relationship: ${relationship}`);
  if (referralStatus) evidence.push(`referral status: ${referralStatus}`);
  if (channel) evidence.push(`channel: ${channel}`);
  if (lastContact) evidence.push(`last contact: ${lastContact}`);

  if (referralStatus) {
    const referral = referralStatus.toLowerCase();
    if (/\b(active|open|yes|referred|will refer|intro)\b/.test(referral)) score += 0.5;
    if (/\b(no|declined|do not ask|do_not_ask|blocked)\b/.test(referral)) score -= 1;
  }

  if (channel) {
    const channelLc = channel.toLowerCase();
    if (/\b(text|sms|phone|call|in-person|offline|coffee|meetup)\b/.test(channelLc)) score += 0.3;
  }

  const days = daysSince(record.last_contact, now);
  const stale = days !== null && days > 90;
  if (days !== null) {
    if (days <= 30) score += 0.4;
    else if (days <= 90) score += 0.2;
    else score -= 0.4;
  }

  if (evidence.length === 0) evidence.push("contact profile present");

  return {
    score: roundScore(clamp(score, 1, 5)),
    evidence,
    stale,
    lastContact,
  };
}

function semanticRelationshipScore(value: unknown): number | null {
  const scores = relationshipScoreTextValues(value)
    .map((text) => scoreRelationshipText(text))
    .filter((score): score is number => score !== null);
  return scores.length > 0 ? Math.max(...scores) : null;
}

function scoreRelationshipText(value: string): number | null {
  const text = value.toLowerCase();
  if (!text) return null;

  const numeric = text.match(/\b([1-5])\b/);
  if (numeric) return Number(numeric[1]);

  if (/\b(inner circle|very strong|worked together closely|close friend|trusted)\b/.test(text)) return 5;
  if (/\b(warm offline|personal|friend|family|neighbor|social|strong)\b/.test(text)) return 4;
  if (/\b(warm professional|former colleague|colleague|coworker|co-worker|shared project|mentor|manager|moderate|warm)\b/.test(text)) return 3;
  if (/\b(network|linkedin|linked in|mutual|alma mater|alumni|weak)\b/.test(text)) return 2;
  if (/\b(cold|unknown|no existing relationship)\b/.test(text)) return 1;

  return null;
}

function relationshipScoreTextValues(value: unknown): string[] {
  const direct = cleanString(value);
  if (direct) return [direct];
  if (Array.isArray(value)) return value.flatMap((item) => relationshipScoreTextValues(item));
  if (isRecord(value)) return Object.values(value).flatMap((item) => relationshipScoreTextValues(item));
  return [];
}

function extractCompanies(record: PeopleRecord): {
  entries: Array<{ display: string; normalized: string }>;
  current: { display: string; normalized: string } | null;
  display: string[];
  normalized: string[];
} {
  const rawCompanies = valueList(record.companies);
  const raw = rawCompanies.length > 0 ? rawCompanies : valueList(record.company);
  const entries: Array<{ display: string; normalized: string; current: boolean }> = [];
  const seen = new Set<string>();

  for (const value of raw) {
    const companyText = companyTextValue(value);
    const display = displayCompany(companyText);
    const normalized = normalizeCompany(companyText);
    if (!display || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ display, normalized, current: isCurrentCompanyValue(value) });
  }

  const current = entries.find((entry) => entry.current) ?? entries[0] ?? null;

  return {
    entries: entries.map(({ display, normalized }) => ({ display, normalized })),
    current: current ? { display: current.display, normalized: current.normalized } : null,
    display: entries.map((entry) => entry.display),
    normalized: entries.map((entry) => entry.normalized),
  };
}

function extractCohorts(record: PeopleRecord): string[] {
  const values = [...cohortValues(record.cohort), ...cohortValues(record.cohorts)];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function valueList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function evidenceString(value: unknown): string | null {
  const direct = cleanString(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const values = value.map((item) => evidenceString(item)).filter((item): item is string => item !== null);
    return values.length > 0 ? values.join(", ") : null;
  }
  if (isRecord(value)) {
    for (const key of ["score", "strength", "value", "level", "label", "tier", "name"]) {
      const text = evidenceString(value[key]);
      if (text) return text;
    }
  }
  return null;
}

function companyTextValue(value: unknown): string | null {
  const direct = cleanString(value);
  if (direct) return direct;
  if (!isRecord(value)) return null;

  for (const key of ["company", "name", "employer", "organization", "display", "label", "value"]) {
    const text = cleanString(value[key]);
    if (text) return text;
  }
  return null;
}

function isCurrentCompanyValue(value: unknown): boolean {
  if (isRecord(value)) {
    for (const key of ["current", "is_current", "isCurrent"]) {
      if (value[key] === true) return true;
    }
    for (const key of ["status", "tenure", "kind", "type"]) {
      if (/\b(current|currently|present)\b/i.test(cleanString(value[key]) ?? "")) return true;
    }
  }

  return /\b(current|currently|present)\b/i.test(cleanString(value) ?? "");
}

function cohortValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => cohortValues(item));
  const direct = cleanString(value);
  if (direct) return [direct];
  if (!isRecord(value)) return [];

  for (const key of ["name", "id", "slug", "cohort", "value", "label"]) {
    const text = cleanString(value[key]);
    if (text) return [text];
  }

  const originCompany = cleanString(value.origin_company);
  const period = cleanString(value.period);
  if (originCompany && period) return [`${originCompany} ${period}`];
  return originCompany ? [originCompany] : [];
}

function findNameEvidence(source: WarmPathNode, target: WarmPathNode): string[] {
  const record = source.record ?? {};
  const fields: Array<{ name: string; value: unknown }> = [
    { name: "they_told_us", value: record.they_told_us },
    { name: "family_context", value: record.family_context },
  ];
  const evidence: string[] = [];

  for (const field of fields) {
    const chunks = flattenEvidenceText(field.value);
    if (chunks.some((chunk) => containsName(chunk, target.name))) {
      evidence.push(`${field.name} mentions ${target.name}`);
    }
  }

  return evidence;
}

function findSharedCompanyEvidence(source: WarmPathNode, target: WarmPathNode): string[] {
  const targetCompanies = new Set(target.normalizedCompanies);
  const evidence: string[] = [];
  for (const company of source.normalizedCompanies) {
    if (targetCompanies.has(company)) {
      evidence.push(`shared company: ${companyDisplayFor(source, company) ?? company}`);
    }
  }
  return evidence;
}

function findSharedCohortEvidence(source: WarmPathNode, target: WarmPathNode): string[] {
  const targetCohorts = new Set(target.cohorts);
  const evidence: string[] = [];
  for (const cohort of source.cohorts) {
    if (targetCohorts.has(cohort)) evidence.push(`shared cohort: ${cohort}`);
  }
  return evidence;
}

function flattenEvidenceText(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap((item) => flattenEvidenceText(item));
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...flattenEvidenceText(child)]);
  }
  return [];
}

function containsName(text: string, name: string): boolean {
  const tokens = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  const pattern = tokens.map(escapeRegExp).join("\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

function parseDatePart(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const datePart = text.split("(")[0].trim().split(/\s+/)[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const date = new Date(`${datePart}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : datePart;
}

function daysSince(value: unknown, now: Date): number | null {
  const datePart = parseDatePart(value);
  if (!datePart) return null;
  const then = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.getTime() - then.getTime()) / MS_PER_DAY);
}

function nodeView(node: WarmPathNode | undefined): WarmPathNodeView {
  if (!node) return { id: SELF_NODE_ID, name: "Self", company: null, role: null };
  return { id: node.id, name: node.name, company: node.company, role: node.role };
}

function targetPersonView(node: WarmPathNode): WarmPathTargetPerson {
  return { id: node.id, name: node.name, role: node.role, company: node.company };
}

function withCompanyEvidence(evidence: string[], targetCompany: string): string[] {
  const companyEvidence = `target company: ${targetCompany}`;
  return [...evidence, companyEvidence];
}

function pushUniquePath(paths: WarmPath[], seen: Set<string>, path: WarmPath): void {
  const key = `${path.path_length}:${path.intermediary?.id ?? "direct"}:${path.target_person.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  paths.push(path);
}

function companyNodeId(normalizedCompany: string): string {
  return `company:${normalizedCompany}`;
}

function companyDisplayFor(person: WarmPathNode, normalizedCompany: string): string | null {
  const index = person.normalizedCompanies.indexOf(normalizedCompany);
  return index >= 0 ? person.companies[index] ?? null : null;
}

function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeEmit(eventSink: WarmPathEventSink, event: WarmPathEvent): void {
  try {
    eventSink(event);
  } catch {
    // Query results should not depend on telemetry/logging plumbing.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
