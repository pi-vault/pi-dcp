# Strip Residual DCP Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip `MiniMax-M3`'s leaked `<dcp-message-id>` residual fragments and bare `m####` refs from assistant output, and notify the user when the sanitizer runs but leaves a residual shape.

**Architecture:** Extend the existing `stripHallucinationsFromString` pipeline in `src/messages/strip.ts` with one new regex constant (inline residual) and a state-aware `stripKnownRefsFromString` helper. Reuse the existing `state.messageIds.byRawId` as the source of truth for which `m####` refs are eligible to strip. Wire the known-refs set into the `message_end` handler in `src/index.ts`, and add a heuristic `looksLikeUnproductiveTurn` check that notifies the user when stripping is a no-op but residual metadata is still present. (Earlier versions of this plan also added an end-of-line residual regex; that regex was dropped after review confirmed it cannot distinguish truncated residuals from prose that merely mentions the namespace phrase — see `docs/07-addendum-residual-regex.md` "What this regex does NOT fix" §3.)

**Tech Stack:** TypeScript, Vitest, regex (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-16-strip-residual-metadata-design.md`

**Investigation:** `docs/01-minimax-dcp-tag-leak.md` and the chain `docs/02-` … `docs/08-` document the bug and the design rationale.

## Global Constraints

- TypeScript strict mode. No `any` in new code.
- Existing 9 cases in `tests/strip.test.ts` must continue to pass after every change.
- The sanitizer must never match the namespace phrase `dcp-message-id` / `dcp-system-reminder` in prose that merely mentions it (e.g. `dcp-message-id is generally safe` must be preserved). One documented false positive exists (`dcp-message-id foo>bar` → `bar`), see spec "Component 1" rationale. The end-of-line residual case (e.g. a line containing just `-dcp-message-id` with no closing `>`) is intentionally NOT addressed by a regex; it surfaces via the `looksLikeUnproductiveTurn` warning in Task 3.
- `state.messageIds.byRawId` is owned by `src/state/state.ts:resetSessionState`. Do not introduce a new state field.
- No new dependencies.
- Notifications use `ctx.ui.notify(message, level)` where level is `"info"` (sanitizer changed text) or `"warning"` (sanitizer unchanged but heuristic fired). Both calls are guarded by `ctx.hasUI`.

## File Structure

| file                                         | responsibility                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/messages/strip.ts`                      | Strip pipeline. Adds 1 regex constant, extends `stripHallucinationsFromString` signature, adds `stripKnownRefsFromString` helper.          |
| `src/index.ts`                               | `message_end` handler. Wires known-refs snapshot, adds `collectText` and `looksLikeUnproductiveTurn` helpers, sends info/warning notifies. |
| `tests/strip.test.ts`                        | Appends regression cases for the new residual regex and the known-refs helper. Existing cases unchanged.                                   |
| `tests/message-end-sanitize-failure.test.ts` | New file. Uses the existing `createMockApi` pattern from `tests/index.test.ts` to exercise the three notify branches.                      |

---

### Task 1: Add the inline-residual regex and its tests

**Files:**

- Modify: `src/messages/strip.ts` (add `DCP_RESIDUAL_INLINE` constant; add `.replace(DCP_RESIDUAL_INLINE, "")` as the 5th step in `stripHallucinationsFromString`)
- Modify: `tests/strip.test.ts` (append a `describe("inline residual")` block)

**Interfaces:**

- Consumes: existing `stripHallucinationsFromString` signature `string -> string`.
- Produces: same signature. New behavior: `>-terminated prefix-less dcp-message-id / dcp-system-reminder` fragments are stripped. The match group `(^|[^\w-])` is consumed, so a preceding space or newline is also removed.

- [ ] **Step 1: Append the failing tests**

Append to `tests/strip.test.ts`, inside the `describe("stripHallucinationsFromString")` block (before its closing brace), keeping the existing tests untouched:

```ts
it("strips inline prefix-less residual opener (line-174 case)", () => {
  expect(stripHallucinationsFromString("-dcp-message-id>")).toBe("");
});

it("strips inline prefix-less residual without leading hyphen", () => {
  expect(stripHallucinationsFromString("dcp-message-id>")).toBe("");
});

it("strips inline residual after a complete pair", () => {
  expect(
    stripHallucinationsFromString(
      '<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>',
    ),
  ).toBe("");
});

it("strips inline residual on its own line", () => {
  expect(stripHallucinationsFromString("hello\n-dcp-message-id>\nworld")).toBe(
    "hello\nworld",
  );
});

it("strips inline system-reminder residual", () => {
  // The inline regex matches `-dcp-system-reminder>` but stops at the
  // newline (the body class `[^<>\n]*` excludes newlines). The trailing
  // `\n` remains. This is fine — the message_end handler treats whitespace
  // as harmless and downstream code joins text parts with `\n` anyway.
  expect(stripHallucinationsFromString("-dcp-system-reminder>\n")).toBe("\n");
});

it("does not match prose that mentions the namespace without a >", () => {
  expect(
    stripHallucinationsFromString("dcp-message-id is generally safe"),
  ).toBe("dcp-message-id is generally safe");
  expect(stripHallucinationsFromString("dcp-system-reminder is active")).toBe(
    "dcp-system-reminder is active",
  );
});

it("does not match inside identifiers (boundary check)", () => {
  expect(stripHallucinationsFromString("m0103-dcp-message-id>")).toBe(
    "m0103-dcp-message-id>",
  );
});

it("documents the dcp-message-id foo>bar false positive", () => {
  // Documented false positive — see docs/07 in the investigation chain.
  // The inline residual requires `>` to be the terminator of the residual
  // itself; any prose between the tag-name and `>` is consumed because
  // attribute-bearing canonical tags may contain a space. False positive
  // is bounded: namespace phrase is rare in English prose, trailing `>`
  // is unusual, and the user-visible result is a slightly shorter
  // sentence rather than data loss.
  expect(stripHallucinationsFromString("dcp-message-id foo>bar")).toBe("bar");
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `pnpm vitest run tests/strip.test.ts`
Expected: 8 new tests fail with messages indicating the residual text was not modified.

- [ ] **Step 3: Add the inline-residual regex constant and step**

Edit `src/messages/strip.ts`. Add the constant below the existing four:

```ts
// 5. Inline residual: prefix-less dcp-* fragment with closing `>`.
// Anchored on (^|[^\w-]) so it doesn't match inside identifiers like
// "m0103-dcp-message-id>". Requires `>` so prose that merely mentions
// the namespace is not swallowed.
const DCP_RESIDUAL_INLINE =
  /(^|[^\w-])-?dcp-(?:message-id|system-reminder)\b[^<>\n]*>/gi;
```

Then add the `.replace(DCP_RESIDUAL_INLINE, "")` step to the pipeline. The full function body becomes:

```ts
export function stripHallucinationsFromString(text: string): string {
  return text
    .replace(DCP_COMPLETE_PAIR, "")
    .replace(DCP_TRUNCATED_PAIR, "")
    .replace(DCP_UNPAIRED_TAG, "")
    .replace(DCP_PARTIAL_TAG, "")
    .replace(DCP_RESIDUAL_INLINE, "");
}
```

- [ ] **Step 4: Run the tests and verify they all pass**

Run: `pnpm vitest run tests/strip.test.ts`
Expected: all 17 cases pass (9 existing + 8 new).

- [ ] **Step 5: Commit**

```bash
git add src/messages/strip.ts tests/strip.test.ts
git commit -m "feat(strip): add inline residual regex for prefix-less dcp-* fragments"
```

---

### Task 2: Add the state-aware known-refs strip helper

**Files:**

- Modify: `src/messages/strip.ts` (extend `stripHallucinationsFromString` signature with optional `knownRefs`; add `stripKnownRefsFromString` helper)
- Modify: `tests/strip.test.ts` (append tests for the new signature)

**Interfaces:**

- Consumes: optional `ReadonlySet<string>` of refs (`m####`) that were injected this session.
- Produces: text with bare `m####` refs from the set stripped, anchored on word boundaries so `m0103` doesn't match inside `xem0103y` or `m01034`. Sorted longest-first to prevent `m01` from matching inside `m0103`.

- [ ] **Step 1: Append the failing tests**

Append to `tests/strip.test.ts`, after the EOL tests:

```ts
describe("known-refs stripping", () => {
  it("is a no-op when no refs are known", () => {
    expect(stripHallucinationsFromString("m0103", new Set())).toBe("m0103");
    expect(stripHallucinationsFromString("m0103")).toBe("m0103");
  });

  it("strips a single bare known ref", () => {
    expect(stripHallucinationsFromString("m0103", new Set(["m0103"]))).toBe("");
  });

  it("strips a known ref embedded in prose (line-152 case)", () => {
    expect(
      stripHallucinationsFromString(
        "Sort the selected names alphabetically on enter:\n\n\n\nm0103",
        new Set(["m0103"]),
      ),
    ).toBe("Sort the selected names alphabetically on enter:\n\n\n\n");
  });

  it("does not strip a numeric token that looks like an m-id but isn't in the set", () => {
    expect(
      stripHallucinationsFromString("the m1024 model", new Set(["m0103"])),
    ).toBe("the m1024 model");
  });

  it("does not match inside identifiers (boundary check)", () => {
    expect(stripHallucinationsFromString("xem0103y", new Set(["m0103"]))).toBe(
      "xem0103y",
    );
  });

  it("does not match when the ref is a prefix of a longer token", () => {
    expect(stripHallucinationsFromString("m01034", new Set(["m0103"]))).toBe(
      "m01034",
    );
  });

  it("matches longest-first when multiple refs share a prefix", () => {
    // m0103 must not be stripped from inside m01034 even if m0103 is in
    // the set. The sort-longest-first logic on the alternation source
    // keeps m01034 from being shadowed.
    const refs = new Set(["m01", "m0103"]);
    expect(stripHallucinationsFromString("m01034", refs)).toBe("m01034");
    expect(stripHallucinationsFromString("m01", refs)).toBe("");
  });

  it("strips multiple distinct known refs", () => {
    const refs = new Set(["m0103", "m0117"]);
    expect(stripHallucinationsFromString("m0103 and m0117", refs)).toBe(
      " and ",
    );
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `pnpm vitest run tests/strip.test.ts`
Expected: 8 new tests fail (TypeError: stripHallucinationsFromString expects 1 argument, got 2 — or "is not a function" for the helper if exposed).

- [ ] **Step 3: Implement the helper and extend the signature**

Edit `src/messages/strip.ts`. Add the helper above `stripHallucinationsFromString`:

```ts
/**
 * Strip bare m#### message-id refs that were injected this session.
 * Anchored on word boundaries so legitimate numeric tokens (model numbers,
 * file sizes, hex suffixes) are not affected.
 *
 * The alternation source is sorted longest-first so a short ref like "m01"
 * doesn't match inside a longer injected ref like "m0103".
 */
function stripKnownRefsFromString(
  text: string,
  knownRefs: ReadonlySet<string>,
): string {
  if (knownRefs.size === 0) return text;
  const alts = [...knownRefs].sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`(?<![\\w-])(?:${alts})(?![\\w-])`, "g");
  return text.replace(re, "");
}
```

Change the signature and pipeline of `stripHallucinationsFromString`:

```ts
export function stripHallucinationsFromString(
  text: string,
  knownRefs?: ReadonlySet<string>,
): string {
  const stripped = text
    .replace(DCP_COMPLETE_PAIR, "")
    .replace(DCP_TRUNCATED_PAIR, "")
    .replace(DCP_UNPAIRED_TAG, "")
    .replace(DCP_PARTIAL_TAG, "")
    .replace(DCP_RESIDUAL_INLINE, "")
    .replace(DCP_RESIDUAL_EOL, "");
  return knownRefs ? stripKnownRefsFromString(stripped, knownRefs) : stripped;
}
```

- [ ] **Step 4: Run all strip tests and verify they pass**

Run: `pnpm vitest run tests/strip.test.ts`
Expected: all 25 cases pass (9 existing + 8 inline + 8 known-refs).

- [ ] **Step 5: Run the full check to catch downstream regressions**

Run: `pnpm check`
Expected: lint, typecheck, and the full vitest suite pass. The signature change is backward compatible (optional second argument) so no other call sites should break.

Note: the higher-level `stripHallucinations(messages)` function is intentionally NOT extended with a known-refs argument. Pipeline messages (`src/pipeline.ts`) are pre-sanitization and the bare-`m####` leak surfaces only on the assistant's emitted text at `message_end`. Keeping `stripHallucinations` signature-free avoids threading known-refs into the pipeline.

- [ ] **Step 6: Commit**

```bash
git add src/messages/strip.ts tests/strip.test.ts
git commit -m "feat(strip): add state-aware known-refs strip helper"
```

---

### Task 3: Wire known-refs and the heuristic notify into message_end

**Files:**

- Modify: `src/index.ts` (extend the `message_end` handler; add `collectText` and `looksLikeUnproductiveTurn` helpers)
- Create: `tests/message-end-sanitize-failure.test.ts`

**Interfaces:**

- Consumes: `AgentMessage` from the `message_end` event, `ctx.hasUI` for notification gating, `state.messageIds.byRawId` as the source of truth for known refs.
- Produces: same handler return contract as today (`{ message: stripped }` only when stripping changed the message), plus two notify calls under the documented conditions.

- [ ] **Step 1: Read the existing handler and surrounding imports**

Open `src/index.ts` and confirm:

- The `pi.on("message_end", ...)` block at line 344 matches the spec exactly.
- `AgentMessage` is already imported.
- `ctx.ui` is used elsewhere in the file (lines 74, 447, 457) so the notify API is already in scope.

- [ ] **Step 2: Add the helpers near the top of `createExtension`**

Inside `createExtension(pi: ExtensionAPI): void {`, after the existing top-level state setup and before any handler registration, add:

```ts
/**
 * Collect all text parts of an assistant message into a single string.
 * Returns "" if the message has no array content (e.g. plain-string user
 * content). Used by looksLikeUnproductiveTurn to inspect residual
 * metadata after stripping.
 */
function collectText(msg: AgentMessage): string {
  if (!("content" in msg) || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text",
    )
    .map((p) => p.text)
    .join("\n");
}

/**
 * Detect a turn that ended with stopReason "stop" but produced no tool
 * call AND still carries a residual dcp-* shape in the visible text.
 *
 * The strip pipeline should have caught any sane shape; this is the
 * defense-in-depth branch for shapes we haven't yet enumerated. Per
 * docs/06 in the investigation chain, notification is a UX safeguard,
 * not a replacement for provider validation.
 */
function looksLikeUnproductiveTurn(text: string, msg: AgentMessage): boolean {
  const stopReason = (msg as { stopReason?: string }).stopReason;
  if (stopReason !== "stop") return false;
  const content = (msg as { content?: unknown[] }).content;
  const hasToolCall =
    Array.isArray(content) &&
    content.some(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: string }).type === "toolCall",
    );
  if (hasToolCall) return false;
  return /[-]?dcp-(message-id|system-reminder)/.test(text);
}
```

- [ ] **Step 3: Extend the `message_end` handler**

Replace the existing handler body (around line 344):

```ts
pi.on("message_end", async (event, ctx) => {
  if (!config.enabled) return;
  if (event.message.role !== "assistant") return;

  const knownRefs = new Set(state.messageIds.byRawId.values());
  const stripped = mapText(event.message, (t) =>
    stripHallucinationsFromString(t, knownRefs),
  );

  if (stripped !== event.message) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "dcp: stripped residual metadata from model output",
        "info",
      );
    }
    return { message: stripped };
  }

  // Sanitizer returned the message unchanged (no strip matched). If the
  // visible text still carries a dcp-* shape AND the turn produced no
  // tool call, the strip pipeline missed a case we need to investigate.
  // Per docs/06: notification is a UX safeguard, not a replacement for
  // provider validation. This branch is expected to be rare — it fires
  // only on shapes the regex set doesn't yet cover.
  const text = collectText(event.message);
  if (looksLikeUnproductiveTurn(text, event.message)) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "dcp: model output looked malformed (no tool call, residual metadata present). Try re-prompting.",
        "warning",
      );
    }
  }
});
```

- [ ] **Step 4: Run typecheck to confirm the handler compiles**

Run: `pnpm exec tsc --noEmit`
Expected: passes with no errors. If `AgentMessage` is not imported, add it to the top-of-file imports next to the other `@earendil-works/pi-agent-core` imports.

- [ ] **Step 5: Write the integration tests**

Create `tests/message-end-sanitize-failure.test.ts`. Reuse the `createMockApi` helper from `tests/index.test.ts` (same file is fine, copy verbatim — it's a self-contained local helper, ~30 lines). Pattern: build a mock api with `createMockApi()`, call `createExtension(api)`, fetch the handler via `handlers.get("message_end")?.[0]`, and call it with a real-shape event payload + mock context.

To test the bare-ref branch, the test must inject a known ref into `state.messageIds.byRawId` before firing `message_end`. Since `state` is a closure inside `createExtension`, the cleanest way is to drive a real `context` pass first (which fills `byRawId`) and then fire `message_end`. That mirrors what would happen in production. Alternatively, expose `state` for test purposes via a test-only seam — but adding production surface for tests is not worth it; prefer the realistic flow.

```ts
import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

const agentDir = vi.hoisted(
  () => `/tmp/dcp-message-end-test-${Date.now()}-${Math.random()}`,
);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDir,
}));

type Handler = (...args: never[]) => unknown;

function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const commands = new Map<string, unknown>();
  const tools = new Map<string, unknown>();
  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
  return { api, handlers, entries, commands, tools };
}

function makeSessionStartCtx() {
  return {
    sessionManager: {
      getSessionDir: () => "/tmp/dcp-test-session",
      getSessionId: () => "test-session",
      getBranch: () => [] as unknown[],
    },
    getContextUsage: () => undefined,
  };
}

describe("message_end sanitizer failure handling", () => {
  it("emits info notify when sanitizer strips inline residual metadata", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0];
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Let me cast:\n\n\n\n-dcp-message-id>" },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("stripped residual"),
      "info",
    );
    // Handler must return the stripped message so the agent sees the
    // sanitized text on its next pass.
    expect(result).toHaveProperty("message");
    const strippedContent = (
      result as { message: { content: Array<{ text: string }> } }
    ).message.content;
    expect(strippedContent[0].text).not.toContain("dcp-message-id");
  });

  it("emits info notify when sanitizer strips a bare known ref", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    // Drive a context pass so byRawId is populated with m0001.
    const context = handlers.get("context")?.[0];
    await context(
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hi" }],
            timestamp: 1,
          },
        ],
      },
      {
        ...makeSessionStartCtx(),
        getContextUsage: () => undefined,
        hasUI: false,
      },
    );

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0];
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Sort the selected names alphabetically on enter:\n\n\n\nm0001",
            },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("stripped residual"),
      "info",
    );
    const strippedText = (
      result as { message: { content: Array<{ text: string }> } }
    ).message.content[0].text;
    expect(strippedText).not.toContain("m0001");
  });

  it("emits warning notify when sanitizer is a no-op but residual pattern remains", async () => {
    // Shape the residual regex can't catch: dcp-message-id embedded in a
    // larger identifier. The boundary check `(^|[^\w-])` prevents matching
    // inside `xdcp-message-idy`, so the strip pipeline returns the text
    // unchanged. The heuristic still detects the substring and fires the
    // warning. Defense-in-depth branch.
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0];
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "all clear xdcp-message-idy still here" },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("model output looked malformed"),
      "warning",
    );
    expect(notify).not.toHaveBeenCalledWith(
      expect.stringContaining("stripped residual"),
      "info",
    );
    // No stripping happened, so no message replacement.
    expect(result).toBeUndefined();
  });

  it("does not notify on a clean message with a tool call", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0];
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "All done." },
            {
              type: "toolCall",
              id: "tc-1",
              name: "read",
              arguments: { path: "/tmp/x" },
            },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the new tests and verify they pass**

Run: `pnpm vitest run tests/message-end-sanitize-failure.test.ts`
Expected: 4 tests pass. If a test errors on `getContextUsage` being undefined or on missing `sessionManager` keys, add them to the mock context — the `context` handler is invoked during the bare-ref test to populate `state.messageIds.byRawId`.

- [ ] **Step 7: Run the full check suite**

Run: `pnpm check`
Expected: biome lint clean, tsc clean, all vitest tests pass (existing 25 strip tests + 4 new message-end tests + everything else).

- [ ] **Step 8: Commit**

```bash
git add src/index.ts tests/message-end-sanitize-failure.test.ts
git commit -m "feat(message-end): notify on sanitizer strip or unproductive turn"
```

---

### Task 4: Final verification and documentation

**Files:**

- Modify: `CHANGELOG.md` (add a single line under the next version section, or under `[Unreleased]` if the next version is not yet cut)
- Modify: `README.md` (no change expected; verify nothing contradicts the new behavior)

**Interfaces:**

- Consumes: nothing.
- Produces: a changelog entry matching the project's existing changelog style.

- [ ] **Step 1: Inspect the existing CHANGELOG style**

Run: `head -40 CHANGELOG.md`
Expected: see existing entries. Note whether they use `### Added` / `### Changed` / `### Fixed` headers or a flat list. Match the style.

- [ ] **Step 2: Add the changelog entry**

Add to the appropriate section (most likely `[Unreleased]` or the next version's section if one exists). Match the project's existing wording style. Suggested text:

```markdown
- Strip residual `<dcp-message-id>` and `<dcp-system-reminder>` fragments and bare `m####` refs that some models (notably `MiniMax-M3`) leak into assistant output. Notify the user when a turn produces no tool call but still contains residual metadata, so silent stops become visible.
```

- [ ] **Step 3: Smoke-test against the documented leak shapes**

Create a one-off smoke script to confirm the four documented cases all clean up correctly:

```ts
// tmp/smoke-strip.ts — not committed, for manual verification only.
import { stripHallucinationsFromString } from "../src/messages/strip.ts";

const knownRefs = new Set(["m0103", "m0117", "m0152", "m0174"]);
const cases = [
  ["-dcp-message-id>", ""],
  ["dcp-message-id>", ""],
  ["Sort:\n\n\n\nm0103", "Sort:\n\n\n\n"],
  ['<dcp-message-id priority="5"></dcp-message-id>-dcp-message-id>', ""],
] as const;
for (const [input, expected] of cases) {
  const got = stripHallucinationsFromString(input, knownRefs);
  console.log(
    got === expected ? "PASS" : "FAIL",
    JSON.stringify(input),
    "->",
    JSON.stringify(got),
  );
}
```

Run: `pnpm exec tsx tmp/smoke-strip.ts`
Expected: 4 PASS lines. Delete the file after.

- [ ] **Step 4: Run the full check suite one more time**

Run: `pnpm check`
Expected: clean.

- [ ] **Step 5: Commit the changelog entry**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for residual metadata stripping"
```

---

## Self-Review

**1. Spec coverage:**

| spec requirement                                                  | task                                      |
| ----------------------------------------------------------------- | ----------------------------------------- |
| Component 1 — inline residual regex addition                      | Task 1                                    |
| Component 2 — state-aware bare-ref stripping                      | Task 2                                    |
| Component 3 — known-refs wiring in `message_end`                  | Task 3                                    |
| Component 3 — `collectText` + `looksLikeUnproductiveTurn` helpers | Task 3                                    |
| Existing 9 strip.test.ts cases continue to pass                   | Tasks 1, 2 (each runs full strip.test.ts) |
| New tests for inline residual regex                               | Task 1                                    |
| New tests for known-refs stripping                                | Task 2                                    |
| New tests for `message_end` notify behavior                       | Task 3                                    |
| `pnpm check` clean                                                | Tasks 2, 3, 4                             |
| Changelog entry                                                   | Task 4                                    |
| EOL residual NOT addressed by regex (per `docs/07`)               | covered by Task 3 warning notify          |

No gaps.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" — each task has full code. ✓

**3. Type consistency:**

- `stripHallucinationsFromString` signature: `(text: string, knownRefs?: ReadonlySet<string>) => string` — defined once in Task 1 (extended in Task 2), used in Tasks 2 and 3. Caller in `message_end` (Task 3) builds the set as `new Set(state.messageIds.byRawId.values())`. State field name verified against `src/state/state.ts:50`.
- `stripKnownRefsFromString`: defined in Task 2, only used inside `stripHallucinationsFromString` in the same file. No cross-task name drift.
- `collectText(msg: AgentMessage): string` and `looksLikeUnproductiveTurn(text: string, msg: AgentMessage): boolean` — defined once in Task 3, used once in Task 3's handler. No cross-task drift.
- `mapText(msg, (t) => stripHallucinationsFromString(t, knownRefs))` — `mapText` already imported in `src/index.ts`. Reused unchanged.

`stripHallucinations(messages)` deliberately keeps its single-arg signature: the bare-`m####` leak is an end-of-turn phenomenon, not a pipeline-pruning one. Pipeline messages pass through `stripHallucinations` unchanged (no known-refs available there), and the `message_end` handler re-strips with known-refs as the final sanitization pass.

All consistent.
