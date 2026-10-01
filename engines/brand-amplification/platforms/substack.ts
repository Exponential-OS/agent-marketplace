#!/usr/bin/env bun
/**
 * platforms/substack.ts
 *
 * Push a flywheel article's content/substack.md into a Substack draft (title,
 * subtitle, section, full rich-text body) via the persistent authenticated
 * Chrome instance on :9222 (see ~/anand-career-os/scripts/launch-mcp-browser.sh).
 * Creates a DRAFT only — never touches Publish/Send/Republish.
 *
 * Usage:
 *   bun run platforms/substack.ts <path-to-content/substack.md> [--section "Artificial Intelligence"]
 *
 * Frontmatter fields read: `name:` (-> title). Optional `subtitle:` field is
 * read if present; otherwise pass --subtitle "..." on the command line.
 *
 * Why this exists (2026-09-29, flywheel 15 "Never Delegate Judgment"):
 *   Substack's post body is a ProseMirror/TipTap contenteditable. `fill()` on
 *   it updates the DOM but the editor's own state never registers (silent
 *   no-op) — confirmed on both the body AND the subtitle field. The working
 *   method is a synthetic `paste` ClipboardEvent carrying `text/html`.
 *
 *   The single biggest trap: doing that inside an `async () => { await
 *   fetch(...) }` wrapper HANGS FOREVER at the CDP protocol level — Substack
 *   (HTTPS) silently stalls on a fetch to a local http:// origin (mixed
 *   content) instead of rejecting cleanly, and the hang is indistinguishable
 *   from a slow paste handler. Fix: never fetch from page-context JS here.
 *   All content must be embedded directly in the evaluated script text, and
 *   every evaluate call must be plain synchronous JS (no async/await/fetch).
 *
 *   Second trap: pasting the entire ~40K-char article in one paste event
 *   times out (ProseMirror chokes on parsing that much HTML synchronously).
 *   Fix: split at <hr> and heading boundaries into ~4-6KB chunks and paste
 *   sequentially — the cursor lands at the end after each paste, so chunks
 *   just append in order.
 *
 *   Third trap: `fill()` on the subtitle textarea reports success but the
 *   React-controlled value never updates. Fix: use the native
 *   HTMLTextAreaElement value setter + dispatch a real `input` event, which
 *   is what React's onChange actually listens for.
 */

import { spawnSync } from "bun";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { type CDP, type BrowserTargets, createFreshDraftTarget, connectDraftTarget,
  assertWritable, assertClean, primitive, sleep } from "./_cdp";

const CHUNK_MAX_CHARS = 6000;

const USAGE = 'Usage: bun run platforms/substack.ts <path-to-content.md> [--section "Name"] [--subtitle "..."]';

export function parseArgs(argv: string[]): { help: true } | { help: false; mdPath: string; section?: string; subtitle?: string } {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  const [mdPath, ...rest] = argv;
  if (!mdPath || mdPath.startsWith("-")) throw new Error(USAGE);
  let section: string | undefined;
  let subtitle: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if ((flag !== "--section" && flag !== "--subtitle") || !rest[i + 1] || rest[i + 1].startsWith("--")) {
      throw new Error(USAGE);
    }
    if (flag === "--section") section = rest[++i];
    else subtitle = rest[++i];
  }
  return { help: false, mdPath, section, subtitle };
}

export function stripFrontmatter(raw: string): { frontmatter: string; body: string } {
  const parts = raw.split(/^---\r?\n/m);
  if (parts.length < 3 || parts[0].trim() !== "") {
    return { frontmatter: "", body: raw };
  }
  return { frontmatter: parts[1], body: parts.slice(2).join("---\n") };
}

export function extractTitle(frontmatter: string): string {
  const m = frontmatter.match(/^name:\s*"?(.+?)"?\s*$/m);
  if (!m) throw new Error("Could not find `name:` in frontmatter for title");
  return m[1];
}

export function extractSubtitle(frontmatter: string): string | undefined {
  const m = frontmatter.match(/^subtitle:\s*"?(.+?)"?\s*$/m);
  return m?.[1];
}

export function dropLeadingH1(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let skipped = false;
  for (const line of lines) {
    if (!skipped && line.trim() === "") continue;
    if (!skipped && line.startsWith("# ")) {
      skipped = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Collapse every whitespace run in the HTML (both inside tags and inside
 * text content) to a single space. Pandoc line-wraps long lines — inside
 * tags (`<h2\nid="...">`) AND inside a heading's own text ("How\nto
 * actually implement..."). Both are spec-valid HTML (a browser collapses
 * whitespace on render regardless), but Substack's own paste-sanitizer
 * silently mishandles at least the embedded-newline-in-heading-text case:
 * the heading's opening tag gets dropped and its text glues onto the
 * PRECEDING paragraph with no space, even when the tag was correctly
 * isolated as its own chunk before pasting. Fixing only the tag case was
 * NOT sufficient — confirmed by testing (2026-09-29): the bug persisted
 * until text-content newlines were also collapsed. Normalizing everything
 * removes the newline before it ever reaches the paste mechanism, whatever
 * the exact cause on Substack's side. */
function normalizeTagWhitespace(html: string): string {
  return html.replace(/\s+/g, " ");
}

function markdownToHtml(md: string): string {
  const tmpIn = `/tmp/push-substack-${randomUUID()}.md`;
  writeFileSync(tmpIn, md);
  try {
    const res = spawnSync(["pandoc", "-f", "markdown", "-t", "html", tmpIn]);
    if (res.exitCode !== 0) {
      throw new Error(`pandoc failed: ${res.stderr.toString()}`);
    }
    return normalizeTagWhitespace(res.stdout.toString());
  } finally {
    unlinkSync(tmpIn);
  }
}

/** Split HTML at top-level <hr /> boundaries, then further split any chunk
 * over CHUNK_MAX_CHARS at <h2>/<h3> boundaries. Re-inserts a leading <hr>
 * on every piece that originally followed one, so section dividers survive
 * the split. */
export function chunkHtml(html: string): string[] {
  const hrParts = html.split(/<hr\s*\/?>/);
  const chunks: string[] = [];
  hrParts.forEach((part, i) => {
    const prefix = i > 0 ? "<hr>\n" : "";
    if (prefix.length + part.length <= CHUNK_MAX_CHARS) {
      chunks.push(prefix + part.trim());
      return;
    }
    const pieces = part.split(/(?=<h[23][\s>])/);
    let buf = prefix;
    for (const piece of pieces) {
      if (buf.length + piece.length > CHUNK_MAX_CHARS && buf.trim().length > 0) {
        chunks.push(buf.trim());
        buf = piece;
      } else {
        buf += piece;
      }
    }
    if (buf.trim().length > 0) chunks.push(buf.trim());
  });
  return chunks.filter((c) => c.length > 0);
}

// A fresh target is necessary but not sufficient: pushDraft also verifies the
// editor is empty before touching title, subtitle, section, or body.
type DraftTab = Pick<CDP, "evalSync">;
const TITLE = "Array.from(document.querySelectorAll('textarea')).find(t => t.placeholder === 'Title' || t.placeholder === 'Add a title...')";
const SUBTITLE = "Array.from(document.querySelectorAll('textarea')).find(t => t.placeholder && t.placeholder.startsWith('Add a subtitle'))";
const EDITOR = `document.querySelector('[contenteditable="true"]')`;

/** The only click paths are section selection. Inspect the actual element AND
 * its ancestors, including accessible labels, before any pointer/click event.
 * Section names are untrusted: a matching label never grants publish authority.
 * This function is embedded in synchronous page JS and tested with stub controls.
 */
function assertSectionElement(element: Element | null, purpose: "section-menu" | "section-option", section: string): void {
  const deny = (label = element?.textContent?.trim() || "unknown") => { throw new Error(`Draft-only control denied: ${label}. Fix: select a verified section control; publish manually outside this tool.`); };
  if (!element || !["section-menu", "section-option"].includes(purpose)) return deny();
  const forbidden = /\b(?:publish|republish|send|notify\s+subscribers|update|continue)\b/i;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const labels = [node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("name"), node.getAttribute("value"), node.getAttribute("data-testid")];
    if (node === element || ["BUTTON", "A"].includes(node.tagName) || ["button", "menuitem"].includes(node.getAttribute("role") || "")) labels.push(node.textContent);
    const denied = labels.find(label => label && forbidden.test(label));
    if (denied) return deny(denied);
    if (node.tagName === "A" || node.tagName === "FORM" || node.getAttribute("type") === "submit" || node.getAttribute("aria-disabled") === "true" || node.hasAttribute("disabled")) return deny();
  }
  const label = element.textContent?.trim();
  if (purpose === "section-menu") {
    if (element.tagName !== "BUTTON" || !(label?.includes("Choose a section") || label === section)) return deny();
  } else if (!["DIV", "SPAN", "BUTTON"].includes(element.tagName) || element.children.length !== 0 || label !== section) return deny();
}

/** Only section labels are authorized; matching a requested name cannot grant
 * permission to send, publish, or advance into the publishing flow. */
export function assertDraftControl(label: string, section: string): true {
  if (!label || /\b(?:publish|republish|send|notify\s+subscribers|update|continue)\b/i.test(label) ||
      (label !== "Choose a section" && label !== section))
    throw new Error(`Draft-only control denied: ${label}. Fix: choose a verified section; publishing is outside this draft-only tool.`);
  return true;
}

function checkedEval(cdp: DraftTab, name: string, pre: string, act: string, post: string, settleMs = 0, wait = sleep) {
  return primitive(name,
    async () => await cdp.evalSync(`(() => { return !!(${pre}); })()`) === true,
    async () => {
      const result = await cdp.evalSync(act);
      if (settleMs) await wait(settleMs);
      return result;
    },
    async () => await cdp.evalSync(`(() => { return !!(${post}); })()`) === true,
    "Inspect the draft and required control; correct its preconditions without repeating the action.");
}

async function setTextarea(cdp: DraftTab, name: string, selector: string, value: string) {
  await checkedEval(cdp, name,
    `(${selector}) && !(${selector}).disabled && !(${selector}).readOnly`,
    `(() => {
      const t = ${selector};
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(t, ${jsStringLiteral(value)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
    `(${selector})?.value === ${jsStringLiteral(value)}`);
}

export async function selectSection(cdp: DraftTab, section: string, wait = sleep): Promise<void> {
  assertDraftControl(section, section);
  const literal = jsStringLiteral(section);
  const button = `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Choose a section') || b.textContent.trim() === ${literal})`;
  const option = `Array.from(document.querySelectorAll('div,span,button')).find(el => el.textContent.trim() === ${literal} && el.children.length === 0)`;
  const guard = assertSectionElement.toString();
  await checkedEval(cdp, "Open section menu", `(${button}) != null`, `(() => {
    const btn = ${button};
    (${guard})(btn, 'section-menu', ${literal});
    if (btn.textContent.includes('Choose a section')) {
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width/2, cy = r.y + r.height/2;
      for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        (${guard})(btn, 'section-menu', ${literal});
        btn.dispatchEvent(new PointerEvent(type, {bubbles:true, cancelable:true, clientX:cx, clientY:cy, pointerId:1}));
      }
    }
    return true;
  })()`, `(${button})?.textContent.trim() === ${literal} || (${option}) != null`, 600, wait);
  await checkedEval(cdp, "Select section", `(${option}) != null`, `(() => {
    const opt = ${option};
    (${guard})(opt, 'section-option', ${literal});
    opt.click();
    return true;
  })()`, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${literal})`);
}

function jsStringLiteral(s: string): string {
  return JSON.stringify(s);
}

/** Extract {tag, text} for every chunk whose FIRST element (after an
 * optional leading <hr>) is an <h2>/<h3> heading. */
function leadingHeadingsOf(chunks: string[]): { tag: string; text: string }[] {
  const out: { tag: string; text: string }[] = [];
  for (const chunk of chunks) {
    const m = chunk.replace(/^<hr\s*\/?>\s*/, "").match(/^<(h[23])[^>]*>([\s\S]*?)<\/\1>/);
    if (m) out.push({ tag: m[1], text: m[2].replace(/<[^>]*>/g, "").trim() });
  }
  return out;
}

/** Verified trap (2026-09-29): when a pasted chunk's FIRST element is a
 * heading, Substack's paste handler sometimes drops the heading tag
 * entirely and glues its text onto the end of the PRECEDING paragraph with
 * no space — reproduced identically across multiple regenerated drafts,
 * independent of whitespace normalization in the source HTML. Root cause
 * on Substack's side not identified; this repairs the symptom
 * deterministically instead of requiring a human to notice it. */
async function repairGluedHeadings(cdp: DraftTab, chunks: string[]): Promise<void> {
  const expected = leadingHeadingsOf(chunks);
  for (const { tag, text } of expected) {
    const fixed = await checkedEval(cdp, `Repair heading: ${text}`, `${EDITOR} != null`, `(() => {
      const tagName = ${jsStringLiteral(tag.toUpperCase())};
      const headingText = ${jsStringLiteral(text)};
      const editor = document.querySelector('[contenteditable="true"]');
      const already = Array.from(editor.querySelectorAll(tagName.toLowerCase()))
        .some(h => h.textContent.trim() === headingText);
      if (already) return 'already-present';
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent.indexOf(headingText);
        if (idx > 0) {
          const before = node.textContent.slice(0, idx);
          const after = node.textContent.slice(idx + headingText.length);
          const parentP = node.parentElement.closest('p') || node.parentElement;
          node.textContent = before;
          const h = document.createElement(tagName.toLowerCase());
          h.textContent = headingText;
          parentP.after(h);
          if (after.trim().length > 0) {
            const p2 = document.createElement('p');
            p2.textContent = after;
            h.after(p2);
          }
          editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
          return 'repaired';
        }
      }
      return 'not-found';
    })()`, `Array.from((${EDITOR}).querySelectorAll(${jsStringLiteral(tag)})).some(h => h.textContent.trim() === ${jsStringLiteral(text)})`);
    if (fixed === "repaired") console.log(`  repaired glued heading: "${text}"`);
  }
}

export interface DraftContent {
  title: string;
  subtitle?: string;
  section?: string;
  chunks: string[];
}
export interface DraftOptions {
  browser?: BrowserTargets;
  connect?: (wsUrl: string) => Promise<CDP>;
  wait?: (ms: number) => Promise<void>;
}

/** Port of the production pusher: native textarea setters and synchronous,
 * sequential HTML paste. Never clear content, retry a no-op, or click publish.
 * Even a newly issued tab must prove empty, then prove persistence on reload. */
export async function pushDraft(content: DraftContent, options: DraftOptions = {}): Promise<string> {
  if (content.section !== undefined) assertDraftControl(content.section, content.section);
  if (!content.title?.trim() || !Array.isArray(content.chunks) || !content.chunks.length ||
      !content.chunks.every(c => typeof c === "string" && c.trim()))
    throw new Error("Invalid draft content. Fix: provide a title and nonempty HTML chunks.");
  const { title, subtitle, section, chunks } = content;
  const wait = options.wait ?? sleep;
  const target = await createFreshDraftTarget("https://www.thewhyman.blog/publish/post?type=newsletter", options.browser);
  const cdp = await connectDraftTarget(target, options.connect);
  const draftPage = `location.origin === 'https://www.thewhyman.blog' && /^\\/publish\\/post\\/[^/]+\\/?$/.test(location.pathname)`;
  try {
    await wait(4000); // Verified SPA redirect/editor mount delay, never an action retry.
    return await primitive("pushDraft", async () => {
      assertWritable(cdp, true);
      await assertClean(cdp);
      return await cdp.evalSync(`(() => {
        const e = ${EDITOR}, title = ${TITLE}, subtitle = ${SUBTITLE};
        return !!(${draftPage} && e && title && !title.value.trim() && (!subtitle || !subtitle.value.trim()) &&
          !e.textContent.trim() && !e.querySelector('img,video,audio,iframe,hr,table,figure'));
      })()`) === true;
    }, async () => {
      await setTextarea(cdp, "setTitle", TITLE, title);
      if (subtitle) await setTextarea(cdp, "setSubtitle", SUBTITLE, subtitle);
      if (section) await selectSection(cdp, section, wait);

      // Never selectAll/delete: an allegedly fresh editor with content aborts.
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const before = await cdp.evalSync(`(${EDITOR}).innerHTML`);
        await checkedEval(cdp, `pasteChunk ${i + 1}`, `${EDITOR} != null`, `(() => {
          const html = ${jsStringLiteral(chunk)};
          const editor = ${EDITOR};
          editor.focus();
          const dt = new DataTransfer();
          dt.setData('text/html', html);
          const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          editor.dispatchEvent(ev);
          return true;
        })()`, `(() => {
          const editor = ${EDITOR};
          const expected = new DOMParser().parseFromString(${jsStringLiteral(chunks.slice(0, i + 1).join(''))}, 'text/html').body.textContent.replace(/\\s+/g, '');
          return editor.innerHTML !== ${jsStringLiteral(before)} && editor.textContent.replace(/\\s+/g, '') === expected;
        })()`);
      }
      await repairGluedHeadings(cdp, chunks);
      // Compare all body blocks and fields across reload, not just a character count.
      const snapshot = `(() => {
        const e=${EDITOR}, title=${TITLE}, subtitle=${SUBTITLE};
        if (!e || !title || !(${draftPage})) return null;
        return JSON.stringify({title:title.value, subtitle:subtitle?.value || '',
          section:${section ? `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${jsStringLiteral(section)})` : 'null'},
          blocks:Array.from(e.children).map(n => n.outerHTML), text:e.textContent});
      })()`;
      const expected = await cdp.evalSync(snapshot);
      await primitive("verifySavedDraft", () => typeof expected === "string", async () => {
        await wait(3000);
        await cdp.send("Page.reload");
        await wait(4000);
        return await cdp.evalSync(snapshot);
      }, actual => actual === expected,
      "Inspect autosave and the reloaded draft; do not paste again or publish an unverified draft.");
      return await cdp.evalSync("window.location.href");
    }, url => typeof url === "string" && /^https:\/\/www\.thewhyman\.blog\/publish\/post\/[^/]+\/?$/.test(url),
    "Open a fresh, empty newsletter draft; preserve any existing content and inspect the page before continuing.");
  } finally {
    cdp.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help === true) { console.log(USAGE); return; }
  const { mdPath, section, subtitle: cliSubtitle } = args;
  const raw = readFileSync(mdPath, "utf-8");
  const { frontmatter, body } = stripFrontmatter(raw);
  const title = extractTitle(frontmatter);
  const subtitle = cliSubtitle ?? extractSubtitle(frontmatter);
  const html = markdownToHtml(dropLeadingH1(body));
  const chunks = chunkHtml(html);
  const finalUrl = await pushDraft({ title, subtitle, section, chunks });
  console.log(`Draft ready (not published): ${finalUrl}`);
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
