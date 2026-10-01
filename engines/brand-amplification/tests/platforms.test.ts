import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import {
  primitive,
  realClick,
  assertClean,
  createFreshDraftTarget,
  explicitlyReuseExistingTarget,
  connectDraftTarget,
  assertWritable,
  CdpClient,
  type CDP,
  type BrowserTargets,
} from "../platforms/_cdp";
import {
  cascadeComment,
  groupPost,
  assertOwnPost,
  assertGroup,
  checkSpokeLinkTarget,
  bodyHtml,
  setBodyHtml,
  articleText,
  audit,
  countImages,
  verifyPersisted,
  checkHoneypotChain,
  checkNamedReferences,
  insertImageAt,
  deleteImage,
  insertParagraphAfter,
} from "../platforms/linkedin";
import {
  pushDraft,
  assertDraftControl,
  parseArgs,
  chunkHtml,
  stripFrontmatter,
  extractTitle,
  extractSubtitle,
  dropLeadingH1,
} from "../platforms/substack";
const noWait = async () => {};
const hub = "https://www.linkedin.com/feed/update/urn:li:activity:999/";
function browser(): BrowserTargets {
  let n = 0;
  return {
    list: async () => [
      {
        id: "old",
        url: "https://example.com",
        webSocketDebuggerUrl: "ws://old",
      },
    ],
    create: async (url) => ({
      id: `new-${++n}`,
      url,
      webSocketDebuggerUrl: `ws://new-${n}`,
    }),
  };
}
class DomCDP implements CDP {
  w = new Window({ url: "https://www.linkedin.com/article/edit/123/" });
  commands: { method: string; params: any }[] = [];
  scripts: string[] = [];
  closed = false;
  pastes = 0;
  inserts = 0;
  onReload = () => {};
  onFile = () => {};
  onKey = (p: any) => {};
  dropWrites = false;
  boxes = new Map<any, number>();
  constructor(html: string) {
    this.w.document.body.innerHTML = html;
    Object.assign(this.w, {
      Set,
      Map,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      JSON,
      Math,
      Error,
    });
    const self = this;
    this.w.HTMLElement.prototype.getBoundingClientRect = function () {
      if (!self.boxes.has(this)) self.boxes.set(this, self.boxes.size + 1);
      const x = self.boxes.get(this)! * 100;
      return {
        x,
        y: 10,
        left: x,
        top: 10,
        bottom: 50,
        right: x + 80,
        width: 80,
        height: 40,
        toJSON() {
          return this;
        },
      } as any;
    };
    this.w.HTMLElement.prototype.scrollIntoView = function () {};
    Object.defineProperty(this.w, "scrollY", { value: 0, writable: true });
    Object.defineProperty(this.w, "innerHeight", {
      value: 1000,
      writable: true,
    });
    Object.defineProperty(this.w.document.documentElement, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    (this.w.document as any).execCommand = (
      command: string,
      _show: any,
      html: string,
    ) => {
      if (command !== "insertHTML") throw Error(`Forbidden command ${command}`);
      this.inserts++;
      if (this.dropWrites) return true;
      const e = this.w.document.activeElement as any;
      const sel = this.w.getSelection();
      if (sel?.rangeCount && !sel.isCollapsed) {
        sel.getRangeAt(0).deleteContents();
        sel.removeAllRanges();
      }
      e.insertAdjacentHTML("beforeend", html);
      return true;
    };
    this.w.document.addEventListener("paste", (e: any) => {
      this.pastes++;
      if (!this.dropWrites)
        e.target.insertAdjacentHTML(
          "beforeend",
          e.clipboardData.getData("text/html"),
        );
    });
  }
  async evalSync(s: string) {
    this.scripts.push(s);
    return new Function("window", "with(window){return (" + s + ")}")(this.w);
  }
  async send(method: string, params: any = {}) {
    this.commands.push({ method, params });
    if (method === "Page.reload") this.onReload();
    if (method === "DOM.setFileInputFiles") this.onFile();
    if (method === "Runtime.evaluate") return { result: { objectId: "input" } };
    if (method === "Input.dispatchKeyEvent") this.onKey(params);
    if (
      method === "Input.dispatchMouseEvent" &&
      params.type === "mouseReleased"
    ) {
      const e = [...this.boxes].find(
        ([e, x]) => params.x >= x * 100 && params.x <= x * 100 + 80,
      )?.[0];
      e?.focus();
      e?.click();
    }
    return {};
  }
  close() {
    this.closed = true;
  }
}
async function writable(c: CDP) {
  const t = await createFreshDraftTarget("https://example.com", browser());
  await connectDraftTarget(t, async () => c);
  return c;
}
const options = (c: DomCDP) => ({
  browser: browser(),
  connect: async () => c,
  wait: noWait,
});
const article = (body: string) =>
  `<div contenteditable="true" aria-label="Article editor content">${body}</div>`;
const editor = (c: DomCDP) => c.w.document.querySelector("[contenteditable]")!;
function group(c: DomCDP, name = "Agentic AI Intelligence") {
  c.w.happyDOM.setURL("https://www.linkedin.com/groups/123/");
  c.w.document.body.innerHTML = `<nav>${"navigation ".repeat(100)}</nav><h1>${name}</h1><button id="start">Start a post</button>`;
  c.w.document.querySelector("#start")!.addEventListener("click", () => {
    c.w.document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="dialog"><div contenteditable="true" aria-label="Post editor"></div><button id="post">Post</button></div>',
    );
  });
}
function cascade(c: DomCDP, actor = "Anand Vallamsetla • You") {
  c.w.happyDOM.setURL(
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  );
  c.w.document.body.innerHTML = `<div data-urn="urn:li:activity:123" class="feed-shared-update-v2"><div class="update-components-actor">${actor}</div><button id="open">Comment</button></div>`;
  c.w.document.querySelector("#open")!.addEventListener("click", () => {
    c.w.document
      .querySelector("[data-urn]")!
      .insertAdjacentHTML(
        "beforeend",
        '<div contenteditable="true" aria-label="Comment"></div><button class="submit primary">Comment</button>',
      );
  });
}

describe("shared safety", () => {
  test("fresh target returned differs from existing target", async () => {
    const b = browser();
    const t = await createFreshDraftTarget("https://example.com", b);
    expect(t.id).toBe("new-1");
    expect(t.webSocketDebuggerUrl).toBe("ws://new-1");
    expect((await createFreshDraftTarget("https://example.com", b)).id).toBe(
      "new-2",
    );
  });
  test("server returning an existing ID is rejected", async () => {
    const b = browser();
    b.create = async () => ({
      id: "old",
      url: "https://example.com",
      webSocketDebuggerUrl: "ws://other",
    });
    await expect(
      createFreshDraftTarget("https://example.com", b),
    ).rejects.toThrow("browser returned an existing or invalid target");
  });
  test("server returning an existing websocket is rejected", async () => {
    const b = browser();
    b.create = async () => ({
      id: "new",
      url: "https://example.com",
      webSocketDebuggerUrl: "ws://old",
    });
    await expect(
      createFreshDraftTarget("https://example.com", b),
    ).rejects.toThrow("browser returned an existing or invalid target");
  });
  test("omission cannot opt into target reuse", () => {
    expect(() =>
      explicitlyReuseExistingTarget(
        { id: "old", url: "https://x", webSocketDebuggerUrl: "ws://old" },
        undefined as any,
      ),
    ).toThrow("Existing target reuse denied");
  });
  test("explicit reuse works but is never fresh", async () => {
    const t = explicitlyReuseExistingTarget(
      { id: "old", url: "https://x", webSocketDebuggerUrl: "ws://old" },
      { allowDestructiveReuse: true },
    );
    const c = new DomCDP("");
    await connectDraftTarget(t, async () => c);
    expect(assertWritable(c)).toBe(true);
    expect(() => assertWritable(c, true)).toThrow(
      "Unapproved destructive target",
    );
  });
  test("forged targets do not grant write access", async () => {
    await expect(
      connectDraftTarget({
        id: "fake",
        url: "https://x",
        webSocketDebuggerUrl: "ws://fake",
      } as any),
    ).rejects.toThrow("Unissued target");
  });
  test("unbound client cannot overwrite a body", async () => {
    const c = new DomCDP(article("<p>precious</p>"));
    await expect(setBodyHtml(c, "<p>replacement</p>", noWait)).rejects.toThrow(
      "Unapproved destructive target",
    );
    expect(c.inserts).toBe(0);
  });
  test("failed precondition performs zero actions", async () => {
    let n = 0;
    await expect(
      primitive(
        "x",
        () => false,
        async () => ++n,
        () => true,
        "inspect",
      ),
    ).rejects.toThrow("x: precondition failed. Fix: inspect");
    expect(n).toBe(0);
  });
  test("failed postcondition executes once and never retries", async () => {
    let n = 0;
    await expect(
      primitive(
        "x",
        () => true,
        async () => ++n,
        () => false,
        "inspect",
      ),
    ).rejects.toThrow(
      "x: postcondition failed (no retry performed). Fix: inspect",
    );
    expect(n).toBe(1);
  });
  test("real click is moved/pressed/released, 80ms each", async () => {
    const c = new DomCDP("");
    const waits: number[] = [];
    await realClick(
      c,
      10,
      20,
      async () => true,
      async () => true,
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(c.commands.map((x) => x.params.type)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
    expect(waits).toEqual([80, 80, 80]);
  });
  test("invisible-to-editor modal blocks before mutation", async () => {
    const c = new DomCDP(
      article("<p>old</p>") + '<div role="dialog">Add image or video</div>',
    );
    await writable(c);
    await expect(setBodyHtml(c, "<p>new</p>", noWait)).rejects.toThrow(
      "BLOCKED — something is in front of the page",
    );
    expect(c.inserts).toBe(0);
  });
  test("malformed overlay response fails closed", async () => {
    const c = new DomCDP("");
    c.evalSync = async () => null;
    await expect(assertClean(c)).rejects.toThrow("postcondition failed");
  });
});

describe("single target and destination gates", () => {
  test("cascade rejects array before browser access", async () => {
    await expect(cascadeComment([] as any)).rejects.toThrow(
      "Exactly ONE target required",
    );
  });
  test("group rejects array before browser access", async () => {
    await expect(groupPost([] as any)).rejects.toThrow(
      "Exactly ONE target required",
    );
  });
  test("foreign actor aborts", () => {
    expect(() => assertOwnPost("123", "Someone Else • You")).toThrow(
      "⛔ ABORT 123 — not his post. Fix: select Anand's own post and verify its actor block.",
    );
  });
  test("name without You is insufficient", () => {
    expect(() => assertOwnPost("123", "Anand Vallamsetla")).toThrow(
      "⛔ ABORT 123 — not his post",
    );
  });
  test("group actor title still recognizes owner pairing", () => {
    expect(
      assertOwnPost(
        "123",
        "Agentic AI Intelligence\nAnand Vallamsetla • You\n2h",
      ),
    ).toBe(true);
  });
  test("URL matches but full name differs", () => {
    expect(() =>
      assertGroup(
        "123",
        "Agentic AI Intelligence",
        "https://www.linkedin.com/groups/123/",
        "Agentic AI Marketing",
      ),
    ).toThrow("⛔ GROUP GATE");
  });
  test("name matches but URL differs", () => {
    expect(() =>
      assertGroup("123", "AI", "https://www.linkedin.com/groups/1234/", "AI"),
    ).toThrow("⛔ GROUP GATE");
  });
  test("matching ID on attacker host rejected", () => {
    expect(() =>
      assertGroup(
        "123",
        "AI",
        "https://www.linkedin.com.evil/groups/123/",
        "AI",
      ),
    ).toThrow("⛔ GROUP GATE");
  });
  test("both exact group signals accepted", () => {
    expect(
      assertGroup(
        "123",
        "Agentic AI",
        "https://www.linkedin.com/groups/123/",
        "Agentic AI",
      ),
    ).toBe(true);
  });
  test("cascade points to exact hub", () => {
    expect(checkSpokeLinkTarget(`Method: ${hub}`, hub)).toBe(true);
  });
  test("article is not hub", () => {
    expect(() =>
      checkSpokeLinkTarget("https://www.linkedin.com/pulse/article", hub),
    ).toThrow("Cascade link skips the platform hub");
  });
  test("hub substring in another URL is not hub", () => {
    expect(() => checkSpokeLinkTarget(`${hub}evil`, hub)).toThrow(
      "Cascade link skips the platform hub",
    );
  });
  test("honey pot belongs to first comment, not cascade", () => {
    expect(() =>
      checkSpokeLinkTarget("https://thewhyman.blog/p/article", hub),
    ).toThrow("Cascade link skips the platform hub");
  });
  test("unowned post never opens composer or inserts text", async () => {
    const c = new DomCDP("");
    cascade(c, "Someone Else • You");
    await expect(
      cascadeComment(
        { urn: "123", hubUrl: hub, paragraphs: [`Read: ${hub}`] },
        options(c),
      ),
    ).rejects.toThrow("⛔ ABORT 123 — not his post");
    expect(c.commands.length).toBe(0);
    expect(c.inserts).toBe(0);
    expect(c.closed).toBe(true);
  });
  test("wrong group never opens composer or inserts text", async () => {
    const c = new DomCDP("");
    group(c, "Agentic AI Marketing");
    await expect(
      groupPost(
        { id: "123", name: "Agentic AI Intelligence", paragraphs: ["copy"] },
        options(c),
      ),
    ).rejects.toThrow("⛔ GROUP GATE");
    expect(c.commands.length).toBe(0);
    expect(c.inserts).toBe(0);
  });
  test("group stage reads heading beyond nav chrome, preserves paragraph order", async () => {
    const c = new DomCDP("");
    group(c);
    expect(
      await groupPost(
        {
          id: "123",
          name: "Agentic AI Intelligence",
          paragraphs: ["First paragraph.", "Second paragraph."],
        },
        options(c),
      ),
    ).toBe("staged");
    expect(editor(c).innerHTML).toBe(
      "<p>First paragraph.</p><p>Second paragraph.</p>",
    );
    expect(c.inserts).toBe(1);
  });
  test("cascade stage accepts group actor, does not submit", async () => {
    const c = new DomCDP("");
    cascade(c, "Agentic AI Intelligence\nAnand Vallamsetla • You");
    expect(
      await cascadeComment(
        { urn: "123", hubUrl: hub, paragraphs: ["First.", `Read: ${hub}`] },
        options(c),
      ),
    ).toBe("staged");
    expect(c.inserts).toBe(1);
  });
  test("no-op composer write fails once, never submits", async () => {
    const c = new DomCDP("");
    group(c);
    c.dropWrites = true;
    await expect(
      groupPost(
        { id: "123", name: "Agentic AI Intelligence", paragraphs: ["copy"] },
        { ...options(c), send: true },
      ),
    ).rejects.toThrow("stageComposer: postcondition failed");
    expect(c.inserts).toBe(1);
  });
  test("staged cascade text is not proof of sending", async () => {
    const c = new DomCDP("");
    cascade(c);
    await expect(
      cascadeComment(
        { urn: "123", hubUrl: hub, paragraphs: [`Read: ${hub}`] },
        { ...options(c), send: true },
      ),
    ).rejects.toThrow("postcondition failed");
    expect(c.inserts).toBe(1);
    expect(c.commands.filter((x) => x.method === "Page.reload").length).toBe(1);
  });
});

describe("article primitives", () => {
  test("strip only inter-tag whitespace", () => {
    expect(bodyHtml(" <h2>Heading</h2>\n  <p>Keep these words</p> ")).toBe(
      "<h2>Heading</h2><p>Keep these words</p>",
    );
  });
  test("article text excludes editor chrome", async () => {
    const c = new DomCDP(
      article(
        "<p>One</p><figure><button>Minimize image</button><button>Edit image</button><button>Delete image</button></figure><p>Two</p>",
      ),
    );
    expect((await articleText(c)).replace(/\s+/g, " ").trim()).toBe("One Two");
  });
  test("audit measures blank blocks and headings", async () => {
    const c = new DomCDP(
      article("<h2>Heading</h2><p></p><p></p><hr><p>text</p>"),
    );
    const a = await audit(c);
    expect(a.emptyParas).toBe(2);
    expect(a.longestBlankRun).toBe(2);
    expect(a.hrs).toBe(1);
    expect(a.headings).toEqual(["Heading"]);
  });
  test("body insertion preserves exact blocks and reloads", async () => {
    const c = new DomCDP(article("<p>old</p>"));
    await writable(c);
    await setBodyHtml(c, "<h2>New</h2>\n<p>Body</p>", noWait);
    expect(editor(c).innerHTML).toBe("<h2>New</h2><p>Body</p>");
    expect(c.inserts).toBe(1);
    expect(c.commands.map((x) => x.method)).toEqual(["Page.reload"]);
  });
  test("body no-op fails with exactly one insertion attempt", async () => {
    const c = new DomCDP(article("<p>old</p>"));
    await writable(c);
    c.dropWrites = true;
    await expect(
      setBodyHtml(c, "<h2>New</h2><p>Body</p>", noWait),
    ).rejects.toThrow("postcondition failed");
    expect(c.inserts).toBe(1);
  });
  test("autosave loss is detected after reload", async () => {
    const c = new DomCDP(article("<p>old</p>"));
    await writable(c);
    c.onReload = () => {
      editor(c).innerHTML = "<p>old</p>";
    };
    await expect(setBodyHtml(c, "<p>new</p>", noWait)).rejects.toThrow(
      "postcondition failed",
    );
    expect(c.inserts).toBe(1);
  });
  test("scroll accumulates lazily rendered images", async () => {
    const c = new DomCDP(article(""));
    let offset = 0;
    Object.defineProperty(c.w.document.documentElement, "scrollHeight", {
      get: () => 2500,
    });
    c.w.scrollTo = (() => {
      offset = 0;
      (c.w as any).scrollY = 0;
      show();
    }) as any;
    c.w.scrollBy = (() => {
      offset++;
      (c.w as any).scrollY = offset * 800;
      show();
    }) as any;
    function show() {
      editor(c).innerHTML = `<img src="https://cdn.test/${offset}.png">`;
      Object.defineProperty(editor(c).querySelector("img"), "naturalWidth", {
        value: 500,
      });
    }
    expect([...(await countImages(c, noWait))]).toEqual([
      "https://cdn.test/0.png",
      "https://cdn.test/1.png",
      "https://cdn.test/2.png",
    ]);
  });
  test("persisted image count mismatch throws instead of warning", async () => {
    const c = new DomCDP(article("<p>body</p>"));
    await expect(verifyPersisted(c, 1, noWait)).rejects.toThrow(
      "postcondition failed",
    );
  });
  test("honeypot check requires THIS article, not any domain link", async () => {
    const c = new DomCDP(
      article(
        '<p><a href="https://thewhyman.blog/p/previous">previous</a><a href="https://thewhyman.blog/subscribe">subscribe</a></p>',
      ),
    );
    await expect(
      checkHoneypotChain(c, "https://thewhyman.blog/p/current"),
    ).rejects.toThrow("postcondition failed");
  });
  test("honeypot exact canonical + subscribe passes", async () => {
    const c = new DomCDP(
      article(
        '<p><a href="https://thewhyman.blog/p/current">current</a><a href="https://thewhyman.blog/subscribe">subscribe</a></p>',
      ),
    );
    expect(
      (await checkHoneypotChain(c, "https://thewhyman.blog/p/current"))
        .canonical,
    ).toBe(true);
  });
  test("closing named reference must be linked in that block", async () => {
    const c = new DomCDP(
      article('<p><a href="https://example.com/one">#1</a></p><p>Read #1</p>'),
    );
    await expect(
      checkNamedReferences(c, { "#1": "https://example.com/one" }),
    ).rejects.toThrow("postcondition failed");
  });
  test("no range delete or broken techniques survive LinkedIn executable", () => {
    const source = readFileSync(
      new URL("../platforms/linkedin.ts", import.meta.url),
      "utf8",
    );
    expect(/execCommand\(['"]delete['"]/.test(source)).toBe(false);
    expect(/new (DragEvent|ClipboardEvent)\(/.test(source)).toBe(false);
  });
});

describe("Substack draft port", () => {
  function sub() {
    const c = new DomCDP(
      '<textarea placeholder="Title"></textarea><textarea placeholder="Add a subtitle..."></textarea><div contenteditable="true"></div><button>Publish</button>',
    );
    c.w.happyDOM.setURL("https://www.thewhyman.blog/publish/post/456");
    return c;
  }
  test("CLI shape and help remain browser free", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs(["a.md", "--section", "AI", "--subtitle", "Sub"])).toEqual(
      { help: false, mdPath: "a.md", section: "AI", subtitle: "Sub" },
    );
  });
  test("unknown arguments fail closed", () => {
    expect(() => parseArgs(["a.md", "--publish"])).toThrow("Usage:");
  });
  test("frontmatter conversion helpers preserved", () => {
    const s = stripFrontmatter(
      '---\nname: "Title"\nsubtitle: "Sub"\n---\n# Title\n\nText',
    );
    expect(extractTitle(s.frontmatter)).toBe("Title");
    expect(extractSubtitle(s.frontmatter)).toBe("Sub");
    expect(dropLeadingH1(s.body)).toBe("\nText");
  });
  test("chunks preserve dividers and heading boundaries", () => {
    expect(chunkHtml("<p>A</p><hr /><h2>B</h2>")).toEqual([
      "<p>A</p>",
      "<hr>\n<h2>B</h2>",
    ]);
  });
  for (const label of [
    "Publish",
    "Send",
    "Republish",
    "Send to all",
    "Notify subscribers",
    "Update",
    "Continue",
  ]) {
    test(`control ${label} rejected even if requested section matches`, async () => {
      expect(() => assertDraftControl(label, label)).toThrow(
        `Draft-only control denied: ${label}.`,
      );
      let connected = false;
      const c = sub();
      await expect(
        pushDraft(
          { title: "T", section: label, chunks: ["<p>B</p>"] },
          {
            ...options(c),
            connect: async () => {
              connected = true;
              return c;
            },
          },
        ),
      ).rejects.toThrow("Draft-only control denied");
      expect(connected).toBe(false);
    });
  }
  test("unknown button cannot masquerade as section", () => {
    expect(() => assertDraftControl("Mystery action", "AI")).toThrow(
      "Draft-only control denied: Mystery action.",
    );
  });
  test("preserved paste path verifies every block and persists title/subtitle", async () => {
    const c = sub();
    let publish = 0;
    c.w.document
      .querySelector("button")!
      .addEventListener("click", () => publish++);
    expect(
      await pushDraft(
        {
          title: "Title",
          subtitle: "Sub",
          chunks: ["<h2>First</h2><p>A</p>", "<hr><p>B</p>"],
        },
        options(c),
      ),
    ).toBe("https://www.thewhyman.blog/publish/post/456");
    expect(c.pastes).toBe(2);
    expect(c.inserts).toBe(0);
    expect(publish).toBe(0);
    expect(c.closed).toBe(true);
  });
  test("no-op paste throws once and never proceeds to next chunk", async () => {
    const c = sub();
    c.dropWrites = true;
    await expect(
      pushDraft({ title: "T", chunks: ["<p>A</p>", "<p>B</p>"] }, options(c)),
    ).rejects.toThrow("pasteChunk 1: postcondition failed");
    expect(c.pastes).toBe(1);
  });
  test("preexisting content is never cleared even in allegedly new tab", async () => {
    const c = sub();
    editor(c).innerHTML = "<p>precious</p>";
    await expect(
      pushDraft({ title: "T", chunks: ["<p>B</p>"] }, options(c)),
    ).rejects.toThrow("pushDraft: precondition failed");
    expect(c.pastes).toBe(0);
    expect(editor(c).innerHTML).toBe("<p>precious</p>");
  });
  test("reload detects failed persistence", async () => {
    const c = sub();
    c.onReload = () => {
      editor(c).innerHTML = "";
    };
    await expect(
      pushDraft({ title: "T", chunks: ["<p>B</p>"] }, options(c)),
    ).rejects.toThrow("verifySavedDraft: postcondition failed");
    expect(c.pastes).toBe(1);
  });
  test("section child inside publish button fails closed before click", async () => {
    const c = sub();
    c.w.document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="choose">Choose a section</button>',
    );
    let publish = 0;
    c.w.document.querySelector("#choose")!.addEventListener("click", () => {
      c.w.document.body.insertAdjacentHTML(
        "beforeend",
        '<button aria-label="Publish"><span>AI</span></button>',
      );
      c.w.document
        .querySelector("button[aria-label]")!
        .addEventListener("click", () => publish++);
    });
    await expect(
      pushDraft(
        { title: "T", section: "AI", chunks: ["<p>B</p>"] },
        options(c),
      ),
    ).rejects.toThrow("Draft-only control denied: Publish.");
    expect(publish).toBe(0);
    expect(c.pastes).toBe(0);
  });
});

describe("compile-time publishing boundary", () => {
  test("single-target and opt-in contracts are enforced by TypeScript", () => {
    const p = Bun.spawnSync([
      "bun",
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "--target",
      "esnext",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--types",
      "bun",
      "--lib",
      "esnext,dom",
      "--skipLibCheck",
      "platforms/_cdp.ts",
      "platforms/linkedin.ts",
      "platforms/substack.ts",
      "tests/platforms.types.ts",
    ]);
    expect(p.stdout.toString() + p.stderr.toString()).toBe("");
    expect(p.exitCode).toBe(0);
  });
});

describe("image and paragraph sequences", () => {
  function imageFixture() {
    const c = new DomCDP(
      article("<h2>Section</h2><p>Paragraph.</p>") +
        '<button aria-label="Image">Image</button>',
    );
    const steps: string[] = [];
    const paragraph = editor(c).querySelector("p")!;
    paragraph.addEventListener("click", () => {
      const r = c.w.document.createRange();
      r.selectNodeContents(paragraph);
      r.collapse(false);
      c.w.getSelection()!.removeAllRanges();
      c.w.getSelection()!.addRange(r);
      steps.push("caret");
    });
    c.w.document.querySelector("button")!.addEventListener("click", () => {
      steps.push("toolbar");
      c.w.document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog" class="article-editor__media-editor-modal"><input type="file"></div>',
      );
    });
    c.onFile = () => {
      steps.push("file");
      const m = c.w.document.querySelector('[role="dialog"]')!;
      m.insertAdjacentHTML(
        "beforeend",
        "<button>Select sample.png</button><button disabled>Next</button>",
      );
      m.querySelector("button")!.addEventListener("click", () => {
        steps.push("select");
        m.querySelectorAll("button")[1].disabled = false;
      });
      m.querySelectorAll("button")[1].addEventListener("click", () => {
        steps.push("next");
        m.remove();
        editor(c).insertAdjacentHTML(
          "beforeend",
          '<figure><img src="https://media.licdn.com/image.png"><button aria-label="Delete image">Delete image</button></figure>',
        );
        const img = editor(c).querySelector("img")!;
        Object.defineProperty(img, "naturalWidth", { value: 500 });
        editor(c)
          .querySelector("figure button")!
          .addEventListener("click", () => {
            steps.push("delete");
            editor(c).querySelector("figure")!.remove();
          });
      });
    };
    return { c, steps };
  }
  test("all five image steps run in order, then persisted CDN count is checked", async () => {
    const { c, steps } = imageFixture();
    await writable(c);
    const result = await insertImageAt(c, import.meta.path, "Section", noWait);
    expect(steps).toEqual(["caret", "toolbar", "file", "select", "next"]);
    expect([...result.images]).toEqual(["https://media.licdn.com/image.png"]);
    expect(
      c.commands
        .filter((x) => x.method === "DOM.setFileInputFiles")
        .map((x) => x.params.files),
    ).toEqual([[import.meta.path]]);
    expect(c.commands.filter((x) => x.method === "Page.reload").length).toBe(1);
  });
  test("missing Select does not skip straight to Next", async () => {
    const { c, steps } = imageFixture();
    await writable(c);
    c.onFile = () => {
      steps.push("file");
      c.w.document
        .querySelector('[role="dialog"]')!
        .insertAdjacentHTML("beforeend", "<button>Next</button>");
    };
    await expect(
      insertImageAt(c, import.meta.path, "Section", noWait),
    ).rejects.toThrow("chooseImageFile: postcondition failed");
    expect(steps).toEqual(["caret", "toolbar", "file"]);
  });
  test("Next that does nothing fails once and leaves modal for inspection", async () => {
    const { c, steps } = imageFixture();
    await writable(c);
    const file = c.onFile;
    c.onFile = () => {
      file();
      const next = c.w.document.querySelectorAll('[role="dialog"] button')[1];
      const clone = next.cloneNode(true);
      next.replaceWith(clone);
    };
    await expect(
      insertImageAt(c, import.meta.path, "Section", noWait),
    ).rejects.toThrow("postcondition failed");
    expect(steps).toEqual(["caret", "toolbar", "file", "select"]);
  });
  test("delete image uses its button, confirms persisted removal", async () => {
    const { c, steps } = imageFixture();
    await writable(c);
    await insertImageAt(c, import.meta.path, "Section", noWait);
    steps.length = 0;
    const state = await deleteImage(c, 0, noWait);
    expect(steps).toEqual(["delete"]);
    expect(state.images.size).toBe(0);
    expect(c.inserts).toBe(0);
  });
  test("paragraph flow presses Enter before inline insertion", async () => {
    const { c } = imageFixture();
    await writable(c);
    const order: string[] = [];
    c.onKey = (p) => {
      if (p.key === "Enter" && p.type === "char") {
        order.push("enter");
        const e = editor(c);
        e.insertAdjacentHTML("beforeend", "<p></p>");
        const paragraph = e.lastElementChild!;
        const r = c.w.document.createRange();
        r.selectNodeContents(paragraph);
        r.collapse(false);
        c.w.getSelection()!.removeAllRanges();
        c.w.getSelection()!.addRange(r);
      }
    };
    (c.w.document as any).execCommand = (
      name: string,
      _show: any,
      html: string,
    ) => {
      order.push(name);
      editor(c).lastElementChild!.innerHTML = html;
      return true;
    };
    await insertParagraphAfter(
      c,
      "Paragraph.",
      "Inline <strong>copy</strong>\n  <em>here</em>.",
      noWait,
    );
    expect(order).toEqual(["enter", "insertHTML"]);
    expect(editor(c).lastElementChild!.innerHTML).toBe(
      "Inline <strong>copy</strong><em>here</em>.",
    );
  });
});

describe("CDP transport", () => {
  async function serverClient(reply: (data: any, ws: any) => void) {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade required", { status: 400 });
      },
      websocket: {
        message(ws, msg) {
          reply(JSON.parse(String(msg)), ws);
        },
      },
    });
    const c = await CdpClient.connect(`ws://127.0.0.1:${server.port}`, 100);
    return {
      c,
      close() {
        c.close();
        server.stop(true);
      },
    };
  }
  test("CDP errors reject instead of being returned as success", async () => {
    const { c, close } = await serverClient((m, w) =>
      w.send(JSON.stringify({ id: m.id, error: { message: "bad command" } })),
    );
    try {
      await expect(c.send("Bad.method")).rejects.toThrow(
        'CDP: {"message":"bad command"}',
      );
    } finally {
      close();
    }
  });
  test("page exceptions reject instead of returning undefined", async () => {
    const { c, close } = await serverClient((m, w) =>
      w.send(
        JSON.stringify({
          id: m.id,
          result: { exceptionDetails: { text: "boom" } },
        }),
      ),
    );
    try {
      await expect(c.evalSync("throw Error()")).rejects.toThrow(
        'Page evaluation failed: {"text":"boom"}',
      );
    } finally {
      close();
    }
  });
  test("timeout rejects without resending", async () => {
    let n = 0;
    const { c, close } = await serverClient(() => {
      n++;
    });
    try {
      await expect(c.send("Page.navigate")).rejects.toThrow(
        "CDP Page.navigate timed out.",
      );
      expect(n).toBe(1);
    } finally {
      close();
    }
  });
  test("out of order replies are matched to request IDs", async () => {
    const queued: any[] = [];
    const { c, close } = await serverClient((m, w) => {
      queued.push(m);
      if (queued.length === 2)
        for (const q of queued.reverse())
          w.send(JSON.stringify({ id: q.id, result: { value: q.method } }));
    });
    try {
      expect(await Promise.all([c.send("first"), c.send("second")])).toEqual([
        { value: "first" },
        { value: "second" },
      ]);
    } finally {
      close();
    }
  });
});

describe("retained live-composer lint", () => {
  test("all nine source rule identities remain implemented", async () => {
    const { lintComposerText } = await import("../platforms/linkedin");
    const cases: [string, string, string[]][] = [
      [
        "keycap_numerals",
        "1. First point",
        [
          "keycap_numerals:BLOCK",
          "hashtags:BLOCK",
          "ends_with_engagement:WARN",
        ],
      ],
      [
        "line_grouping",
        "One\nTwo\nThree\nFour",
        ["line_grouping:WARN", "hashtags:BLOCK", "ends_with_engagement:WARN"],
      ],
      [
        "markdown_bleed",
        "**bold**",
        ["markdown_bleed:BLOCK", "hashtags:BLOCK", "ends_with_engagement:WARN"],
      ],
      [
        "body_links",
        "https://example.com",
        ["body_links:WARN", "hashtags:BLOCK", "ends_with_engagement:WARN"],
      ],
      ["hashtags", "A claim", ["hashtags:BLOCK", "ends_with_engagement:WARN"]],
      [
        "witness_claims",
        "Everyone agreed.",
        ["hashtags:BLOCK", "witness_claims:BLOCK", "ends_with_engagement:WARN"],
      ],
      [
        "hook_is_claim",
        "I asked a question",
        ["hashtags:BLOCK", "hook_is_claim:WARN", "ends_with_engagement:WARN"],
      ],
      [
        "engagement_bait",
        "Comment YES",
        [
          "hashtags:BLOCK",
          "engagement_bait:BLOCK",
          "ends_with_engagement:WARN",
        ],
      ],
      [
        "ends_with_engagement",
        "A closed statement.",
        ["hashtags:BLOCK", "ends_with_engagement:WARN"],
      ],
    ];
    for (const [_rule, text, expected] of cases)
      expect(
        lintComposerText(text, "feed_post").findings.map(
          (f) => `${f.rule}:${f.severity}`,
        ),
      ).toEqual(expected);
  });
  test("groups/comments accept body links without hashtag requirement", async () => {
    const { lintComposerText } = await import("../platforms/linkedin");
    for (const profile of ["group_post", "comment"] as const) {
      const r = lintComposerText(
        "Details: https://example.com\nWhat do you think?",
        profile,
      );
      expect(r.PASS).toBe(true);
      expect(r.findings).toEqual([]);
    }
  });
  test("bare feed link is warning, not obsolete block", async () => {
    const { lintComposerText } = await import("../platforms/linkedin");
    expect(
      lintComposerText(
        "https://example.com\nWhat do you think?\n#a #b #c",
        "feed_post",
      ).findings.find((f) => f.rule === "body_links")?.severity,
    ).toBe("WARN");
  });
});

describe("single-send result evidence", () => {
  const target = {
    id: "123",
    name: "Agentic AI Intelligence",
    paragraphs: ["An original thought."],
  };
  test("group duplicate aborts before staging", async () => {
    const c = new DomCDP("");
    group(c);
    c.w.document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="feed-shared-update-v2"><div class="update-components-text">An original thought.</div></div>',
    );
    await expect(groupPost(target, options(c))).rejects.toThrow(
      "matching group post already exists",
    );
    expect(c.inserts).toBe(0);
  });
  test("moderated submission is reported separately from publication", async () => {
    const c = new DomCDP("");
    group(c);
    let sent = 0;
    c.w.document.querySelector("#start")!.addEventListener("click", () => {
      c.w.document.querySelector("#post")!.addEventListener("click", () => {
        sent++;
        c.w.document.querySelector('[role="dialog"]')!.remove();
        c.w.document.body.insertAdjacentHTML(
          "beforeend",
          '<div role="status">Submitted to the group admin</div>',
        );
      });
    });
    expect(await groupPost(target, { ...options(c), send: true })).toBe(
      "submitted-for-approval",
    );
    expect(sent).toBe(1);
  });
  test("publication requires exact rendered group copy on fresh page", async () => {
    const c = new DomCDP("");
    group(c);
    let sent = 0;
    c.w.document.querySelector("#start")!.addEventListener("click", () => {
      c.w.document.querySelector("#post")!.addEventListener("click", () => {
        sent++;
        c.w.document.querySelector('[role="dialog"]')!.remove();
      });
    });
    c.onReload = () => {
      c.w.document.body.insertAdjacentHTML(
        "beforeend",
        '<div class="feed-shared-update-v2"><div class="update-components-actor">Anand Vallamsetla • You</div><div class="update-components-text">An original thought.</div></div>',
      );
    };
    expect(await groupPost(target, { ...options(c), send: true })).toBe(
      "posted",
    );
    expect(sent).toBe(1);
  });
  test("composer disappearing with no result fails without a second send", async () => {
    const c = new DomCDP("");
    group(c);
    let sent = 0;
    c.w.document.querySelector("#start")!.addEventListener("click", () => {
      c.w.document.querySelector("#post")!.addEventListener("click", () => {
        sent++;
        c.w.document.querySelector('[role="dialog"]')!.remove();
      });
    });
    await expect(
      groupPost(target, { ...options(c), send: true }),
    ).rejects.toThrow("submission unconfirmed on fresh group page");
    expect(sent).toBe(1);
  });
  test("cascade success requires a rendered comment after reload", async () => {
    const c = new DomCDP("");
    cascade(c);
    let sent = 0;
    c.w.document.querySelector("#open")!.addEventListener("click", () => {
      c.w.document
        .querySelector("button.submit")!
        .addEventListener("click", () => {
          sent++;
          editor(c).innerHTML = "";
        });
    });
    c.onReload = () => {
      c.w.document
        .querySelector("[data-urn]")!
        .insertAdjacentHTML(
          "beforeend",
          `<div class="comments-comment-item">Read: ${hub}</div>`,
        );
    };
    expect(
      await cascadeComment(
        { urn: "123", hubUrl: hub, paragraphs: [`Read: ${hub}`] },
        { ...options(c), send: true },
      ),
    ).toBe("posted");
    expect(sent).toBe(1);
  });
});

test("hub URL slash is optional without weakening exact destination matching", () => {
  const without = hub.slice(0, -1);
  expect(checkSpokeLinkTarget(`Read: ${without}`, without)).toBe(true);
  expect(checkSpokeLinkTarget(`Read: ${hub}`, without)).toBe(true);
  expect(() => checkSpokeLinkTarget(`${without}0`, without)).toThrow(
    "Cascade link skips the platform hub",
  );
});
