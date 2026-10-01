#!/usr/bin/env bun
/**
 * name: linkedin-platform; type: executable; scope: BAE; created: 2026-09-29
 * who: Codex for Anand; why: XOS-310, port surface_driver/cascade_one/group_post_one.
 * Campaign 20's lost hour was a missing PRECONDITION, not a broken input method.
 * A modal invisible to an editor query ate every click. Inspect the whole page.
 * Images are lazy-rendered: scroll and accumulate; autosave then reload before
 * claiming persistence. Re-measure coordinates after image load/layout settles.
 * Image upload has FIVE required steps: real caret, Image, file, Select, Next.
 * Paragraph insertion is a different flow: End, ENTER FIRST, then INLINE HTML.
 * Never use DragEvent, clipboard paste, insertParagraph, or range-delete figures.
 * insertHTML is verified; strip inter-tag whitespace or it creates blank blocks.
 * Cascade/group calls take ONE target by design: bulk loops changed the action's
 * authorization scope. Callers must not quietly turn a single send into a batch.
 * Ownership includes 'Anand Vallamsetla • You' inside GROUP actor blocks; their
 * title is a group name. Cascade -> platform HUB POST; hub FIRST COMMENT -> honey pot.
 * Source: flywheel-execution-lessons.md (campaigns 12/14/20), Python headers.
 * Dropped stale tab matching, fixed coordinates, hardcoded campaign text, first-word
 * group matching, silent parse fallbacks, auto-dismiss and body-text send guesses.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CDP,
  type BrowserTargets,
  primitive,
  assertClean,
  blockingOverlays,
  realClick,
  sleep,
  assertWritable,
  createFreshDraftTarget,
  connectDraftTarget,
  browserTargets,
  explicitlyReuseExistingTarget,
} from "./_cdp";
const J = JSON.stringify;
export const EDITOR = `[...document.querySelectorAll('[contenteditable="true"]')].find(x=>/Article editor content/i.test(x.getAttribute('aria-label')||''))`;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const bodyHtml = (html: string) => html.trim().replace(/>\s+</g, "><");
const page = (c: CDP, code: string) => c.evalSync(`(() => {${code}})()`);
async function articleReady(c: CDP, write = false) {
  if (write) assertWritable(c);
  await assertClean(c);
  return !!(await page(c, `return !!(${EDITOR});`));
}
async function readArticle<T>(
  c: CDP,
  name: string,
  code: string,
  validate: (x: T) => boolean,
): Promise<T> {
  return primitive(
    name,
    () => articleReady(c),
    () => page(c, `const b=${EDITOR};${code}`),
    validate,
    "Open the article editor and inspect its rendered content.",
  );
}
export async function articleText(c: CDP): Promise<string> {
  return readArticle(
    c,
    "articleText",
    `return [...b.children].map(n=>(n.innerText||'').trim()).filter(Boolean).join('\\n').replace(/\\s*(Minimize image|Edit image|Delete image)\\s*/g,' ');`,
    (x) => typeof x === "string",
  );
}
export async function audit(c: CDP) {
  return readArticle<any>(
    c,
    "audit",
    `const k=[...b.children];let section='(top)',empty=0,run=0,longestBlankRun=0,hrs=0;const placement=[];
    for(const n of k){if(/^H[23]$/.test(n.tagName))section=n.innerText.trim();
      if(n.tagName==='HR'){hrs++;run=0;continue;}
      const im=n.matches('img')?n:n.querySelector('img');
      if(im){placement.push({section,w:im.naturalWidth,h:im.naturalHeight});run=0;continue;}
      if(!(n.innerText||'').trim()){empty++;run++;longestBlankRun=Math.max(run,longestBlankRun);}else run=0;}
    return {chars:b.innerText.length,blocks:k.length,emptyParas:empty,longestBlankRun,hrs,blankRatio:empty/Math.max(1,k.length),headings:[...b.querySelectorAll('h2,h3')].map(x=>x.innerText),placement};`,
    (x) => Number.isFinite(x?.blankRatio) && Array.isArray(x?.placement),
  );
}
export async function countImages(c: CDP, wait = sleep): Promise<Set<string>> {
  return primitive(
    "countImages",
    () => articleReady(c),
    async () => {
      await c.evalSync("window.scrollTo(0,0)");
      await wait(1500);
      const seen = new Set<string>();
      let ended = false;
      for (let i = 0; i < 200; i++) {
        // read-only scroll, NEVER a repeated publish action
        const state = await page(
          c,
          `const b=${EDITOR};return {srcs:[...b.querySelectorAll('img')].filter(i=>i.naturalWidth>300).map(i=>i.src),end:scrollY+innerHeight>=document.documentElement.scrollHeight-2};`,
        );
        if (!Array.isArray(state?.srcs))
          throw new Error("invalid image measurement");
        state.srcs.forEach((s: string) => seen.add(s));
        if (state.end) {
          ended = true;
          break;
        }
        await c.evalSync("window.scrollBy(0,innerHeight*0.8)");
        await wait(1000);
      }
      if (!ended) throw new Error("document exceeded bounded scroll scan");
      return seen;
    },
    (v) => v instanceof Set,
    "Inspect the full document; point queries miss off-screen images.",
  );
}
async function key(c: CDP, name: "End" | "Enter") {
  const n = name === "End" ? 35 : 13;
  for (const type of name === "Enter"
    ? ["rawKeyDown", "char", "keyUp"]
    : ["rawKeyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: name,
      code: name,
      windowsVirtualKeyCode: n,
      nativeVirtualKeyCode: n,
      ...(type === "char" ? { text: "\r" } : {}),
    });
}
async function caret(
  c: CDP,
  prefix: string,
  afterHeading: boolean,
  wait = sleep,
) {
  const find = `const b=${EDITOR}; const k=[...b.children];const i=k.findIndex(n=>${afterHeading ? "/^H[23]$/.test(n.tagName)&&" : ""}(n.innerText||'').trim().startsWith(${J(prefix)}));const p=i<0?null:k[i+${afterHeading ? 1 : 0}];`;
  return primitive(
    "placeCaret",
    () => articleReady(c, true),
    async () => {
      if (
        !(await page(
          c,
          `${find}if(!p||p.tagName!=='P'||p.querySelector('img'))return false;p.scrollIntoView({block:'center'});return true;`,
        ))
      )
        throw new Error("paragraph not found after requested heading/block");
      await wait(4000);
      const box = await page(
        c,
        `${find}const r=p.getBoundingClientRect();return {x:r.left+40,y:r.bottom-8};`,
      );
      const inBlock = () =>
        page(
          c,
          `${find}const s=getSelection();return !!p&&!!s&&p.contains(s.anchorNode);`,
        );
      await realClick(
        c,
        box.x,
        box.y,
        () => articleReady(c, true),
        inBlock,
        wait,
      );
      await key(c, "End");
      // End is only a visual-line end. Refuse a wrapped paragraph split.
      return page(
        c,
        `${find}const s=getSelection();if(!p.contains(s.anchorNode)||!s.isCollapsed)return false;const r=document.createRange();r.selectNodeContents(p);r.setStart(s.anchorNode,s.anchorOffset);return r.toString().trim()==='';`,
      );
    },
    (x) => x === true,
    "Inspect the actual caret and layout; it must be at the end of the intended paragraph.",
  );
}
export const placeCaretAfterHeading = (c: CDP, heading: string, wait = sleep) =>
  caret(c, heading, true, wait);
async function clickElement(
  c: CDP,
  expression: string,
  pre: () => Promise<boolean>,
  post: () => Promise<boolean>,
  wait = sleep,
) {
  const box = await page(
    c,
    `const b=${expression};if(!b||b.disabled)return null; b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;`,
  );
  if (!box)
    throw new Error(
      "Control absent, hidden or disabled. Fix: inspect the intended dialog; do not substitute another control.",
    );
  return realClick(c, box.x, box.y, pre, post, wait);
}
const MEDIA = `document.querySelector('.article-editor__media-editor-modal')`;
async function mediaReady(c: CDP) {
  const overlays = await blockingOverlays(c);
  return overlays.length === 1 && !!(await page(c, `return !!(${MEDIA});`));
}
export async function insertImageAt(
  c: CDP,
  file: string,
  heading: string,
  wait = sleep,
) {
  const path = resolve(file);
  let before = new Set<string>();
  return primitive(
    "insertImageAt",
    async () => existsSync(path) && (await articleReady(c, true)),
    async () => {
      before = await countImages(c, wait);
      // Interception suppresses the native dialog. DOM.setFileInputFiles accepts
      // the input's objectId; consuming Page.fileChooserOpened is not required.
      // https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json
      await c.send("Page.setInterceptFileChooserDialog", { enabled: true });
      await placeCaretAfterHeading(c, heading, wait); // 1
      const toolbar = `[...document.querySelectorAll('button')].find(b=>/^(Image|Add image|Insert image)$/i.test(b.getAttribute('aria-label')||b.innerText.trim())||b.querySelector('[data-test-icon="image-medium"]'))`;
      await clickElement(
        c,
        toolbar,
        () => articleReady(c, true),
        async () => {
          await wait(3000);
          return mediaReady(c);
        },
        wait,
      ); // 2
      await primitive(
        "chooseImageFile",
        () => mediaReady(c),
        async () => {
          const r = await c.send("Runtime.evaluate", {
            expression: `${MEDIA}?.querySelector('input[type=file]') || document.querySelector('input[type=file]')`,
            returnByValue: false,
          });
          const objectId = r.result?.objectId;
          if (!objectId) throw new Error("no file input appeared");
          await c.send("DOM.setFileInputFiles", { files: [path], objectId });
          await wait(5000);
        },
        () =>
          page(
            c,
            `const m=${MEDIA};return !!m&&[...m.querySelectorAll('button')].some(b=>/^Select /.test(b.innerText.trim()));`,
          ),
        "Complete the image modal; a file alone is not an insertion.",
      ); // 3
      const modalButton = (pattern: string) =>
        `[...${MEDIA}.querySelectorAll('button')].find(b=>new RegExp(${J(pattern)},'i').test(b.innerText.trim()))`;
      await clickElement(
        c,
        modalButton("^Select "),
        () => mediaReady(c),
        async () => {
          await wait(2000);
          return page(
            c,
            `const b=${modalButton("^Next$")};return !!b&&!b.disabled;`,
          );
        },
        wait,
      ); // 4, mandatory
      await clickElement(
        c,
        modalButton("^Next$"),
        () => mediaReady(c),
        async () => {
          await wait(9000);
          return (await blockingOverlays(c)).length === 0;
        },
        wait,
      ); // 5
      const state = await verifyPersisted(c, before.size + 1, wait);
      return state;
    },
    (x) => x.images.size === before.size + 1,
    "Inspect Select/Next, autosave and the heading; never repeat an uncertain image insertion.",
  );
}
export async function deleteImage(c: CDP, index: number, wait = sleep) {
  let before = new Set<string>();
  let src = "";
  return primitive(
    "deleteImage",
    async () =>
      Number.isInteger(index) && index >= 0 && (await articleReady(c, true)),
    async () => {
      before = await countImages(c, wait);
      src = [...before][index];
      if (!src) throw new Error("no such image");
      // Re-find the actual figure by stable src while scrolling. No range deletion.
      await c.evalSync("window.scrollTo(0,0)");
      let found = false;
      for (let i = 0; i < 200; i++) {
        found = await page(
          c,
          `const b=${EDITOR};const img=[...b.querySelectorAll('img')].find(x=>x.src===${J(src)});if(!img)return false;img.scrollIntoView({block:'center'});return true;`,
        );
        if (found) break;
        if (
          await c.evalSync(
            "scrollY+innerHeight>=document.documentElement.scrollHeight-2",
          )
        )
          break;
        await c.evalSync("window.scrollBy(0,innerHeight*0.8)");
        await wait(500);
      }
      if (!found) throw new Error("image could not be re-located");
      const button = `(()=>{const b=${EDITOR};const f=[...b.children].find(n=>[...n.querySelectorAll('img')].some(i=>i.src===${J(src)}));return f&&[...f.querySelectorAll('button')].find(x=>/Delete image/i.test(x.getAttribute('aria-label')||''));})()`;
      await clickElement(
        c,
        button,
        () => articleReady(c, true),
        async () => {
          await wait(4000);
          return !(await page(
            c,
            `return [...${EDITOR}.querySelectorAll('img')].some(i=>i.src===${J(src)});`,
          ));
        },
        wait,
      );
      return verifyPersisted(c, before.size - 1, wait);
    },
    (x) => !x.images.has(src) && x.images.size === before.size - 1,
    "Inspect the figure and its Delete image button; never delete a range spanning a figure.",
  );
}
export async function setBodyHtml(c: CDP, html: string, wait = sleep) {
  const clean = bodyHtml(html);
  let expected: any;
  return primitive(
    "setBodyHtml",
    async () => !!clean && (await articleReady(c, true)),
    async () => {
      expected = await page(
        c,
        `const d=document.createElement('div');d.innerHTML=${J(clean)};return [...d.children].map(n=>({tag:n.tagName,text:n.textContent.replace(/\\s+/g,' ').trim()}));`,
      );
      await page(
        c,
        `const b=${EDITOR};b.focus();const s=getSelection(),r=document.createRange();r.selectNodeContents(b);s.removeAllRanges();s.addRange(r);if(!document.execCommand('insertHTML',false,${J(clean)}))throw Error('insertHTML refused');return true;`,
      );
      await wait(9000);
      await c.send("Page.reload");
      await wait(18000);
      return page(
        c,
        `const b=${EDITOR};return b&&[...b.children].map(n=>({tag:n.tagName,text:n.textContent.replace(/\\s+/g,' ').trim()}));`,
      );
    },
    (actual) => JSON.stringify(actual) === JSON.stringify(expected),
    "Compare persisted block structure against source; do not accept a character count.",
  );
}
export async function insertParagraphAfter(
  c: CDP,
  prefix: string,
  inlineHtml: string,
  wait = sleep,
) {
  inlineHtml = bodyHtml(inlineHtml);
  let expected = "";
  return primitive(
    "insertParagraphAfter",
    async () =>
      !!inlineHtml &&
      !/<\/?(?:p|h[1-6]|div|figure)\b/i.test(inlineHtml) &&
      (await articleReady(c, true)),
    async () => {
      expected = await page(
        c,
        `const d=document.createElement('div');d.innerHTML=${J(inlineHtml)};return d.textContent.replace(/\\s+/g,' ').trim();`,
      );
      await caret(c, prefix, false, wait);
      await key(c, "Enter");
      await wait(1500);
      if (
        !(await page(
          c,
          `const s=getSelection();const n=s?.anchorNode;const p=(n?.nodeType===1?n:n?.parentElement)?.closest('p');return !!p&&p.innerText.trim()==='';`,
        ))
      )
        throw new Error("Enter did not create an empty paragraph");
      await c.evalSync(
        `document.execCommand('insertHTML',false,${J(inlineHtml)})`,
      );
      await wait(2000);
    },
    () =>
      page(
        c,
        `const k=[...${EDITOR}.children];const i=k.findIndex(n=>(n.innerText||'').trim().startsWith(${J(prefix)}));return i>=0&&k[i+1]?.tagName==='P'&&k[i+1].innerText.replace(/\\s+/g,' ').trim()===${J(expected)};`,
      ),
    "Verify a new paragraph after the original; do not paste a p wrapper at an existing caret.",
  );
}
export async function verifyPersisted(
  c: CDP,
  expectImages?: number,
  wait = sleep,
) {
  return primitive(
    "verifyPersisted",
    () => articleReady(c),
    async () => {
      await wait(9000);
      await c.send("Page.reload");
      await wait(18000);
      const health = await audit(c);
      const images = await countImages(c, wait);
      const cover = await c.evalSync(
        `/Add a cover image/i.test(document.body.innerText)?'MISSING':'SET'`,
      );
      return { ...health, images, cover };
    },
    (s) =>
      (expectImages === undefined || s.images.size === expectImages) &&
      [...s.images].every((src: string) => /^https:\/\//.test(src)),
    "Wait for autosave, inspect CDN images across the whole document, then verify persistence without repeating edits.",
  );
}
export async function checkHoneypotChain(
  c: CDP,
  pieceUrl: string,
  domain = "thewhyman.blog",
) {
  return readArticle<any>(
    c,
    "checkHoneypotChain",
    `const links=[...b.querySelectorAll('a')].map(a=>({text:a.innerText,href:a.href}));return {links,canonical:links.some(a=>a.href.replace(/[/]$/,'')===${J(pieceUrl.replace(/\/$/, ""))}),subscribe:links.some(a=>{const u=new URL(a.href);return (u.hostname===${J(domain)}||u.hostname==='www.'+${J(domain)})&&u.pathname==='/subscribe'})};`,
    (x) => x?.canonical === true && x?.subscribe === true,
  );
}
export async function checkNamedReferences(
  c: CDP,
  refs: Record<string, string>,
  tail = 4,
) {
  const blocks = await readArticle<any[]>(
    c,
    "readNamedReferences",
    `return [...b.children].map(n=>({text:n.innerText,hrefs:[...n.querySelectorAll('a')].map(a=>a.href)}));`,
    Array.isArray,
  );
  return primitive(
    "checkNamedReferences",
    () => tail > 0,
    async () => {
      const missing: any[] = [];
      for (const [pattern, url] of Object.entries(refs)) {
        let first = true;
        blocks.forEach((b, i) => {
          if (!new RegExp(pattern).test(b.text)) return;
          const required = first || i >= blocks.length - tail;
          first = false;
          if (
            required &&
            !b.hrefs.some(
              (h: string) => h.replace(/\/$/, "") === url.replace(/\/$/, ""),
            )
          )
            missing.push({ block: i, pattern, url });
        });
      }
      return missing;
    },
    (v) => v.length === 0,
    "Link each named reference at its first mention and in the closing blocks.",
  );
}
export function assertOwnPost(urn: string, actor: string) {
  if (!/Anand Vallamsetla\s*•?\s*You\b/.test(norm(actor)))
    throw new Error(
      `⛔ ABORT ${urn} — not his post. Fix: select Anand's own post and verify its actor block.`,
    );
  return true;
}
export function assertGroup(
  gid: string,
  name: string,
  actualUrl: string,
  visibleName: string,
) {
  let idOk = false;
  try {
    const u = new URL(actualUrl);
    idOk =
      u.hostname === "www.linkedin.com" &&
      u.pathname.replace(/\/$/, "") === `/groups/${gid}`;
  } catch {}
  if (
    !idOk ||
    !name.trim() ||
    norm(name).toLowerCase() !== norm(visibleName).toLowerCase()
  )
    throw new Error(
      "⛔ GROUP GATE — URL id and visible name must both match. Fix: open the intended group and verify its full heading before typing.",
    );
  return true;
}
export function checkSpokeLinkTarget(text: string, hubUrl: string) {
  const hub = new URL(hubUrl);
  if (
    hub.hostname !== "www.linkedin.com" ||
    !/^\/feed\/update\/urn:li:activity:\d+\/?$/.test(hub.pathname)
  )
    throw new Error(
      "Invalid hub post. Fix: supply the LinkedIn feed activity URL, not the article or honey pot.",
    );
  const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  if (
    !urls.length ||
    urls.some((u) => u.replace(/\/$/, "") !== hubUrl.replace(/\/$/, ""))
  )
    throw new Error(
      "Cascade link skips the platform hub. Fix: point every cascade link at the exact hub POST; the hub first comment uses the honey pot separately.",
    );
  return true;
}
export interface CascadeTarget {
  urn: string;
  hubUrl: string;
  paragraphs: string[];
}
export interface GroupTarget {
  id: string;
  name: string;
  paragraphs: string[];
}
export interface Execution {
  browser?: BrowserTargets;
  connect?: (url: string) => Promise<CDP>;
  wait?: typeof sleep;
  send?: boolean;
}
function single(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Exactly ONE target required. Fix: supply a single target object; batch posting is not this primitive.",
    );
}
function validateParagraphs(p: string[]) {
  if (
    !Array.isArray(p) ||
    !p.length ||
    p.some((x) => typeof x !== "string" || !x.trim() || /[\r\n]/.test(x))
  )
    throw new Error(
      "Invalid paragraphs. Fix: supply one nonempty line per intended block.",
    );
}
const groupEditor = `document.querySelector('[role="dialog"] [contenteditable="true"],.artdeco-modal [contenteditable="true"]')`;
const post = (urn: string) =>
  `document.querySelector('[data-urn="urn:li:activity:${urn}"], [data-id="urn:li:activity:${urn}"]')`;
const commentEditor = (urn: string) =>
  `[...${post(urn)}.querySelectorAll('[contenteditable="true"]')].find(x=>/comment/i.test((x.getAttribute('aria-label')||'')+(x.getAttribute('data-placeholder')||'')))`;
async function composerState(c: CDP, expression: string) {
  return page(
    c,
    `const e=${expression};return e?{text:e.innerText,blocks:[...e.children].filter(n=>(n.innerText||'').trim()).map(n=>n.innerText.replace(/\\s+/g,' ').trim())}:null;`,
  );
}
export type ComposerProfile = "feed_post" | "group_post" | "comment";
export interface LintFinding {
  rule: string;
  severity: "BLOCK" | "WARN";
  detail: string;
  fix: string;
}
/** Port of the live linter's nine checks. Its September 13 correction supersedes
 * older prose: links in feed bodies are WARN only when bare; inline tags are OK.
 * Groups/comments skip both link-context and hashtag rules. */
export function lintComposerText(text: string, profile: ComposerProfile) {
  const findings: LintFinding[] = [];
  const add = (
    rule: string,
    severity: "BLOCK" | "WARN",
    detail: string,
    fix: string,
  ) => findings.push({ rule, severity, detail, fix });
  const blocks = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    keycap = /[0-9]️?⃣/;
  if (!keycap.test(text)) {
    const markers = text.match(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/gm) || [];
    if (markers.length)
      add(
        "keycap_numerals",
        "BLOCK",
        `${markers.length} plain list markers`,
        "Use keycap numerals (1️⃣ 2️⃣ 3️⃣ 4️⃣) for enumerable points.",
      );
    else {
      let run = 0;
      for (const b of blocks) {
        run =
          b.length > 25 && b.length < 145 && !b.startsWith("#") ? run + 1 : 0;
        if (run >= 4) {
          add(
            "keycap_numerals",
            "WARN",
            "Consecutive short blocks resemble an unnumbered list.",
            "Use keycaps if these are parallel points.",
          );
          break;
        }
      }
    }
  }
  const short = blocks.filter(
    (b) => b.length < 60 && !b.startsWith("#") && !keycap.test(b.slice(0, 3)),
  );
  if (blocks.length >= 4 && short.length / blocks.length > 0.5)
    add(
      "line_grouping",
      "WARN",
      "Most blocks are short.",
      "Join related lines; Quill renders every line as a separate paragraph.",
    );
  if (
    /\*\*[^*]+\*\*|(?<!\w)_[^_]+_(?!\w)|\||`[^`]+`|^\s*#{1,6}\s+\S|^\s*>/m.test(
      text,
    )
  )
    add(
      "markdown_bleed",
      "BLOCK",
      "Markdown renders literally.",
      "Use plain prose and paragraph breaks.",
    );
  if (/\[[A-Z][A-Z _-]+\]/.test(text))
    add(
      "placeholder",
      "BLOCK",
      "Unresolved placeholder.",
      "Resolve the destination or content before staging.",
    );
  if (profile === "feed_post") {
    const urls = (text.match(/https?:\/\/[^\s]+/g) || []).filter(
      (u) => !u.includes("linkedin.com"),
    );
    if (
      urls.some(
        (u) =>
          (text.split("\n").find((l) => l.includes(u)) || u).trim().length -
            u.length <
          12,
      )
    )
      add(
        "body_links",
        "WARN",
        "Bare URL lacks context.",
        "Introduce the link and explain its source or purpose.",
      );
    const tags = (text.match(/(?<!\w)#\w+/g) || []).length;
    if (tags === 0)
      add(
        "hashtags",
        "BLOCK",
        "0 hashtags.",
        "Add 3–5 brand, niche and reach hashtags; inline is allowed.",
      );
    else if (tags < 3 || tags > 5)
      add(
        "hashtags",
        "WARN",
        `${tags} hashtags.`,
        "Use 3–5 relevant hashtags.",
      );
  }
  if (
    /\b(?:not one\b(?:\s+of\s+them)?\s+(?:said|mentioned|raised|named)|none\b(?:\s+of\s+them)?\s+(?:said|mentioned|raised|named)|no\s+one\s+(?:said|mentioned|raised|named)|nobody\s+(?:said|mentioned|raised|named)|every\s+one\s+of\s+them|all\s+of\s+them\s+(?:said|agreed)|they\s+all\s+said|each\s+of\s+them\s+said|unanimously|everyone\s+(?:said|agreed)|to\s+a\s+person)\b/i.test(
      text,
    )
  )
    add(
      "witness_claims",
      "BLOCK",
      "Absolute claim about what others said.",
      "Ground it in what Anand reported or cut the absolute; the agent was not in the room.",
    );
  if (
    /^\s*(?:I|We)\s+(?:asked|was|went|sat|spoke|talked|met|attended|ran|did|spent|had|noticed|realised|realized|started|decided|wanted)\b/i.test(
      blocks[0] || "",
    )
  )
    add(
      "hook_is_claim",
      "WARN",
      "Opens with setup instead of a claim.",
      "Lead with the arguable sentence; put context below it.",
    );
  if (
    /comment\s+(?:["']?yes["']?|below\s+if|if\s+you)|like\s+if\s+you|drop\s+a\s+["']?\w+["']?\s+(?:below|in\s+the\s+comments)|tag\s+someone\s+who|repost\s+if|who\s+else\s+(?:agrees|is\s+with\s+me)/i.test(
      text,
    )
  )
    add(
      "engagement_bait",
      "BLOCK",
      "Asks for a reaction instead of a thought.",
      "Ask a genuine question, not Comment YES or Like if.",
    );
  const tail = blocks
    .filter((b) => !/^#\w+/.test(b))
    .slice(-2)
    .join("\n");
  if (
    tail &&
    !/\?|\b(?:what|how|where|would you|curious|tell me|your take|disagree|push back)\b/i.test(
      tail,
    )
  )
    add(
      "ends_with_engagement",
      "WARN",
      "Closing blocks do not invite discussion.",
      "Close with an open question or idea.",
    );
  return {
    PASS: !findings.some((f) => f.severity === "BLOCK"),
    profile,
    findings,
  };
}
export async function lintLiveComposer(
  c: CDP,
  expression: string,
  profile: ComposerProfile,
) {
  return primitive(
    "lintLiveComposer",
    () => ["feed_post", "group_post", "comment"].includes(profile),
    async () => {
      const state = await composerState(c, expression);
      if (!state?.text?.trim()) throw new Error("composer is empty");
      const lint = lintComposerText(state.text, profile);
      const blocks = lint.findings.filter((f) => f.severity === "BLOCK");
      if (blocks.length)
        throw new Error(
          blocks.map((f) => `${f.rule}: ${f.detail} Fix: ${f.fix}`).join("\n"),
        );
      return { ...state, lint };
    },
    (s) => s.blocks.length > 0,
    "Inspect the live composer, not just the file; use the correct surface profile.",
  );
}
async function stage(
  c: CDP,
  expression: string,
  paragraphs: string[],
  ready: () => Promise<boolean>,
  wait: typeof sleep,
) {
  return primitive(
    "stageComposer",
    async () =>
      assertWritable(c) &&
      (await ready()) &&
      (await composerState(c, expression))?.text.trim() === "",
    async () => {
      await clickElement(
        c,
        expression,
        ready,
        () =>
          page(
            c,
            `const e=${expression};return e===document.activeElement||e.contains(document.activeElement);`,
          ),
        wait,
      );
      const html = paragraphs.map((x) => `<p>${escape(x)}</p>`).join("");
      await page(
        c,
        `const e=${expression};e.focus();return document.execCommand('insertHTML',false,${J(html)});`,
      );
      await wait(3000);
      return composerState(c, expression);
    },
    (s) => JSON.stringify(s?.blocks) === JSON.stringify(paragraphs.map(norm)),
    "Compare every live paragraph and its order with the source; never retry a silent no-op.",
  );
}
export async function cascadeComment(
  target: CascadeTarget,
  options: Execution = {},
) {
  single(target);
  if (!/^\d+$/.test(target.urn))
    throw new Error(
      "Invalid activity urn. Fix: supply one numeric activity ID.",
    );
  validateParagraphs(target.paragraphs);
  checkSpokeLinkTarget(target.paragraphs.join("\n"), target.hubUrl);
  const wait = options.wait ?? sleep;
  const t = await createFreshDraftTarget(
    `https://www.linkedin.com/feed/update/urn:li:activity:${target.urn}/`,
    options.browser,
  );
  const c = await connectDraftTarget(t, options.connect);
  try {
    await wait(13000);
    const p = post(target.urn),
      ed = commentEditor(target.urn);
    const own = async () => {
      await assertClean(c);
      const actor = await page(
        c,
        `const p=${p};return p?.querySelector('.update-components-actor')?.innerText||'';`,
      );
      return assertOwnPost(target.urn, actor);
    };
    const rendered = () =>
      page(
        c,
        `const p=${p};return p?[...p.querySelectorAll('.comments-comment-item')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()):[];`,
      );
    const copy = norm(target.paragraphs.join(" "));
    await primitive(
      "cascadeComment",
      own,
      async () => {
        if ((await rendered()).some((x: string) => x.includes(copy)))
          throw new Error("comment already exists");
        await clickElement(
          c,
          `[...${p}.querySelectorAll('button')].find(b=>/^Comment$/i.test(b.innerText.trim())||/^comment$/i.test(b.getAttribute('aria-label')||''))`,
          own,
          async () => {
            await wait(4000);
            return !!(await composerState(c, ed));
          },
          wait,
        );
        await stage(c, ed, target.paragraphs, own, wait);
        await lintLiveComposer(c, ed, "comment");
        if (!options.send) return "staged";
        await clickElement(
          c,
          `[...${p}.querySelectorAll('button')].find(b=>/^Comment$/i.test(b.innerText.trim())&&/submit|primary/.test(b.className))`,
          async () =>
            (await own()) &&
            JSON.stringify((await composerState(c, ed))?.blocks) ===
              JSON.stringify(target.paragraphs.map(norm)),
          async () => {
            await wait(8000);
            await c.send("Page.reload");
            await wait(13000);
            return (await rendered()).some((x: string) => x.includes(copy));
          },
          wait,
        );
        return "posted";
      },
      (s) => s === (options.send ? "posted" : "staged"),
      "Inspect the specific post/comment after a fresh read; do not submit again.",
    );
    return options.send ? "posted" : "staged";
  } finally {
    c.close();
  }
}
export async function groupPost(target: GroupTarget, options: Execution = {}) {
  single(target);
  if (!/^\d+$/.test(target.id))
    throw new Error("Invalid group ID. Fix: supply one numeric group ID.");
  validateParagraphs(target.paragraphs);
  const wait = options.wait ?? sleep;
  const t = await createFreshDraftTarget(
    `https://www.linkedin.com/groups/${target.id}/`,
    options.browser,
  );
  const c = await connectDraftTarget(t, options.connect);
  try {
    await wait(15000);
    const gate = async () => {
      const state = await page(
        c,
        `return {url:location.href,name:document.querySelector('h1')?.innerText||''};`,
      );
      return assertGroup(target.id, target.name, state.url, state.name);
    };
    const ready = async () =>
      (await gate()) &&
      (await blockingOverlays(c)).length === 1 &&
      !!(await composerState(c, groupEditor));
    return await primitive(
      "groupPost",
      async () => (await assertClean(c)) && (await gate()),
      async () => {
        const duplicate = await page(
          c,
          `return [...document.querySelectorAll('.feed-shared-update-v2')].some(p=>(p.querySelector('.update-components-text')?.innerText||'').replace(/\\s+/g,' ').trim()===${J(norm(target.paragraphs.join(" ")))});`,
        );
        if (duplicate) throw new Error("matching group post already exists");
        await clickElement(
          c,
          `[...document.querySelectorAll('button')].find(b=>/start a (public )?post|share something|new post/i.test(b.innerText+' '+(b.getAttribute('aria-label')||'')))`,
          async () => (await assertClean(c)) && (await gate()),
          async () => {
            await wait(6000);
            return ready();
          },
          wait,
        );
        await stage(c, groupEditor, target.paragraphs, ready, wait);
        await lintLiveComposer(c, groupEditor, "group_post");
        if (!options.send) return "staged";
        await clickElement(
          c,
          `[...document.querySelectorAll('[role="dialog"] button,.artdeco-modal button')].find(b=>/^Post$/.test(b.innerText.trim())&&!b.disabled)`,
          async () =>
            (await ready()) &&
            JSON.stringify((await composerState(c, groupEditor))?.blocks) ===
              JSON.stringify(target.paragraphs.map(norm)),
          async () => {
            await wait(9000);
            return !(await composerState(c, groupEditor));
          },
          wait,
        );
        // A moderated submission is not a visible published post. Return it distinctly.
        const pending = await page(
          c,
          `return [...document.querySelectorAll('[role="status"],.artdeco-toast-item')].some(e=>/submitted to the group admin|submitted for approval/i.test(e.innerText));`,
        );
        if (pending) return "submitted-for-approval";
        await c.send("Page.reload");
        await wait(15000);
        await gate();
        const posted = await page(
          c,
          `return [...document.querySelectorAll('.feed-shared-update-v2')].some(p=>/Anand Vallamsetla\\s*•?\\s*You\\b/.test((p.querySelector('.update-components-actor')?.innerText||'').replace(/\\s+/g,' '))&&(p.querySelector('.update-components-text')?.innerText||'').replace(/\\s+/g,' ').trim()===${J(norm(target.paragraphs.join(" ")))});`,
        );
        if (!posted)
          throw new Error("submission unconfirmed on fresh group page");
        return "posted";
      },
      (s) =>
        options.send
          ? ["posted", "submitted-for-approval"].includes(s)
          : s === "staged",
      "Inspect the exact group, pending moderation and rendered post; never retry an uncertain send.",
    );
  } finally {
    c.close();
  }
}
const USAGE = `Usage:
  bun run platforms/linkedin.ts cascade <activity-id> <hub-post-url> <copy-file> [--send]
  bun run platforms/linkedin.ts group <group-id> "<Full Group Name>" <copy-file> [--send]
  bun run platforms/linkedin.ts article <target-id> audit|text|images|verify
  bun run platforms/linkedin.ts article <target-id> body <html-file> --allow-destructive-reuse
  bun run platforms/linkedin.ts article <target-id> insert-image <image-file> "<heading>" --allow-destructive-reuse
  bun run platforms/linkedin.ts article <target-id> delete-image <index> --allow-destructive-reuse
  bun run platforms/linkedin.ts article <target-id> paragraph "<block prefix>" <inline-html-file> --allow-destructive-reuse
Staging is the default. Each cascade/group invocation accepts exactly one target.`;
async function main(args: string[]) {
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const [mode, id, a, b, ...rest] = args;
  if (mode === "cascade" || mode === "group") {
    if (!id || !a || !b || rest.some((x) => x !== "--send"))
      throw new Error(USAGE);
    const paragraphs = readFileSync(b, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(
      mode === "cascade"
        ? await cascadeComment(
            { urn: id, hubUrl: a, paragraphs },
            { send: rest.includes("--send") },
          )
        : await groupPost(
            { id, name: a, paragraphs },
            { send: rest.includes("--send") },
          ),
    );
    return;
  }
  if (mode === "article") {
    const target = (await browserTargets().list()).find(
      (t) =>
        t.id === id &&
        /^https:\/\/www.linkedin.com\/article\/edit\//.test(t.url),
    );
    if (!target)
      throw new Error(
        "Article target missing. Fix: supply its exact target ID.",
      );
    const write = [
      "body",
      "insert-image",
      "delete-image",
      "paragraph",
    ].includes(a);
    if (write && !args.includes("--allow-destructive-reuse"))
      throw new Error(
        "Existing draft write denied. Fix: explicitly pass --allow-destructive-reuse after reviewing the draft.",
      );
    const c = write
      ? await connectDraftTarget(
          explicitlyReuseExistingTarget(target, {
            allowDestructiveReuse: true,
          }),
        )
      : await (
          await import("./_cdp")
        ).CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      const result =
        a === "audit"
          ? await audit(c)
          : a === "text"
            ? await articleText(c)
            : a === "images"
              ? [...(await countImages(c))]
              : a === "verify"
                ? await verifyPersisted(c)
                : a === "body"
                  ? await setBodyHtml(c, readFileSync(b, "utf8"))
                  : a === "insert-image"
                    ? await insertImageAt(c, b, rest[0])
                    : a === "delete-image"
                      ? await deleteImage(c, Number(b))
                      : a === "paragraph"
                        ? await insertParagraphAfter(
                            c,
                            b,
                            readFileSync(rest[0], "utf8"),
                          )
                        : null;
      if (result === null) throw new Error(USAGE);
      console.log(result);
    } finally {
      c.close();
    }
    return;
  }
  throw new Error(USAGE);
}
if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
