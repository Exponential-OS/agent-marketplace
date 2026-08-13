import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const helperPath = join(import.meta.dir, "..", "hooks", "scripts", "_ledger-path.sh");
const roots: string[] = [];
const decoder = new TextDecoder();

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ledger-rotation-test-"));
  roots.push(root);
  return root;
}

function bash(script: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(["bash", "-c", script], {
    env: { ...process.env, HELPER: helperPath, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function resolveLedger(ledgerDir: string, day: string, stateDir: string, threshold = "10"): string {
  const result = bash('source "$HELPER"; resolve_active_ledger "$LEDGER_DIR" "$DAY"', {
    LEDGER_DIR: ledgerDir,
    DAY: day,
    STATE_DIR: stateDir,
    CAREER_OS_LEDGER_MAX_BYTES: threshold,
  });
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}

function writeBytes(path: string, bytes: number): void {
  writeFileSync(path, "x".repeat(bytes));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("session ledger shard resolver", () => {
  test("uses the base shard when no ledger file exists and keeps the lock out of the ledger dir", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.md`));
    expect(readdirSync(ledgerDir).some((name) => name.includes("ledger-rotate"))).toBe(false);
    expect(readdirSync(stateDir).some((name) => /^\.ledger-rotate\..+\.lock$/.test(name))).toBe(true);
  });

  test("continues appending to the base shard while it is under threshold", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 9);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.md`));
  });

  test("rolls from a full base shard to .02", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 10);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.02.md`));
  });

  test("uses .02 while it is the highest under-threshold shard", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 10);
    writeBytes(join(ledgerDir, `${day}.02.md`), 9);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.02.md`));
  });

  test("rolls from a full .02 shard to .03", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 10);
    writeBytes(join(ledgerDir, `${day}.02.md`), 10);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.03.md`));
  });

  test("tolerates non-contiguous shards by selecting the maximum existing shard number", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 10);
    writeBytes(join(ledgerDir, `${day}.03.md`), 9);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.03.md`));

    writeBytes(join(ledgerDir, `${day}.03.md`), 10);
    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.04.md`));
  }, 15000);

  test("honors CAREER_OS_LEDGER_MAX_BYTES", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 6);

    expect(resolveLedger(ledgerDir, day, stateDir, "7")).toBe(join(ledgerDir, `${day}.md`));
    expect(resolveLedger(ledgerDir, day, stateDir, "6")).toBe(join(ledgerDir, `${day}.02.md`));
  }, 15000);

  test("orders by numeric shard number, not lexical filename order", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 10);
    writeBytes(join(ledgerDir, `${day}.02.md`), 9);

    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.02.md`));

    writeBytes(join(ledgerDir, `${day}.09.md`), 10);
    expect(resolveLedger(ledgerDir, day, stateDir)).toBe(join(ledgerDir, `${day}.10.md`));
  }, 15000);

  test("fails open to the base shard on bad ledger or lock state", () => {
    const root = makeRoot();
    const badLedgerDir = join(root, "not-a-directory");
    const badStateDir = join(root, "not-a-state-directory");
    const day = "2026-07-05";
    writeFileSync(badLedgerDir, "not a dir");
    writeFileSync(badStateDir, "not a dir");

    const result = bash('source "$HELPER"; resolve_active_ledger "$LEDGER_DIR" "$DAY"', {
      LEDGER_DIR: badLedgerDir,
      DAY: day,
      STATE_DIR: badStateDir,
      CAREER_OS_LEDGER_MAX_BYTES: "10",
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(join(badLedgerDir, `${day}.md`));
  });

  test("two concurrent appenders at the roll boundary create one shard with one header", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const stateDir = join(root, "state");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeBytes(join(ledgerDir, `${day}.md`), 100);

    const result = bash(`
      source "$HELPER"
      append_once() {
        file="$(resolve_active_ledger "$LEDGER_DIR" "$DAY")"
        if [ ! -f "$file" ]; then
          (
            set -C
            {
              echo "# Session Ledger — $DAY"
              echo ""
            } > "$file"
          ) 2>/dev/null || true
        fi
        {
          echo "## test"
          echo ""
          echo "---"
          echo ""
        } >> "$file"
      }
      append_once &
      a=$!
      append_once &
      b=$!
      wait "$a"
      wait "$b"
    `, {
      LEDGER_DIR: ledgerDir,
      DAY: day,
      STATE_DIR: stateDir,
      CAREER_OS_LEDGER_MAX_BYTES: "100",
    });

    expect(result.code, result.stderr).toBe(0);
    const newShards = readdirSync(ledgerDir).filter((name) => name === `${day}.02.md`);
    expect(newShards).toHaveLength(1);
    const content = readFileSync(join(ledgerDir, `${day}.02.md`), "utf-8");
    expect((content.match(new RegExp(`# Session Ledger — ${day}`, "g")) ?? [])).toHaveLength(1);
  }, 15000);

  test("whole-day reader concatenates base, .02, and .10 in numeric order", () => {
    const root = makeRoot();
    const ledgerDir = join(root, "ledger");
    const day = "2026-07-05";
    mkdirSync(ledgerDir);
    writeFileSync(join(ledgerDir, `${day}.10.md`), "ten\n");
    writeFileSync(join(ledgerDir, `${day}.md`), "base\n");
    writeFileSync(join(ledgerDir, `${day}.02.md`), "two\n");

    const result = bash('source "$HELPER"; cat_ledger_day "$LEDGER_DIR" "$DAY"', {
      LEDGER_DIR: ledgerDir,
      DAY: day,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe("base\ntwo\nten\n");
  });
});
