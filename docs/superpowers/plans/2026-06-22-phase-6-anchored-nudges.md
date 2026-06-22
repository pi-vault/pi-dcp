# Phase 6: Anchored Nudge System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "append to last text message" nudge injection with a persistent, deduplicated, message-anchored system that uses stable message IDs.

**Architecture:** Nudge anchors are stored as sets of stable message keys (from Phase 5). When a nudge trigger fires, the target message's key is added to the appropriate anchor set only if no recent anchor exists within `nudgeFrequency` messages. Nudge text is then injected at each anchored position during the application pass.

**Depends on:** Phase 5 (stable message IDs)

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                            | Responsibility                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/state/types.ts`            | Refactor `Nudges` to use string-based (message key) sets          |
| `src/state/state.ts`            | Update factory/reset                                              |
| `src/messages/inject.ts`        | Rewrite `injectCompressNudges` into decision + application stages |
| `src/state/persistence.ts`      | Serialize/deserialize anchor sets                                 |
| `tests/anchored-nudges.test.ts` | Unit tests for anchor logic                                       |

---

### Task 1: Refactor `Nudges` state type

**Files:**

- Modify: `src/state/types.ts`
- Modify: `src/state/state.ts`

- [ ] **Step 1: Update `Nudges` interface**

In `src/state/types.ts`, replace:

```typescript
export interface Nudges {
  contextLimitAnchors: Set<number>;
  turnAnchors: Set<number>;
  iterationAnchors: Set<number>;
}
```

With:

```typescript
export interface Nudges {
  /** Message keys where context limit nudges are anchored. */
  contextLimitAnchors: Set<string>;
  /** Message keys where turn nudges are anchored. */
  turnAnchors: Set<string>;
  /** Message keys where iteration nudges are anchored. */
  iterationAnchors: Set<string>;
}
```

- [ ] **Step 2: Update `createNudges` and `resetSessionState`**

No code change needed — `new Set()` works for both `Set<number>` and `Set<string>`. The `clear()` calls in `resetSessionState` are type-agnostic.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx tsc --noEmit`

Fix any type errors (likely in tests that used numeric anchors).

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/types.ts
git commit -m "refactor(nudges): change anchor sets from number (index) to string (message key)"
```

---

### Task 2: Implement `addAnchor` utility and rewrite nudge injection

**Files:**

- Modify: `src/messages/inject.ts`
- Test: `tests/anchored-nudges.test.ts` (create)

- [ ] **Step 1: Write tests for anchored nudge behavior**

Create `tests/anchored-nudges.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createSessionState } from "../src/state/state.ts";
import {
  assignMessageRefs,
  injectCompressNudges,
} from "../src/messages/inject.ts";
import {
  makeUserMessage,
  makeAssistantMessage,
  makeDefaultConfig,
} from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("anchored nudge system", () => {
  it("anchors nudge to specific message and persists anchor", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 3,
    });

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg1" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg2" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg3" }],
        timestamp: 3000,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    // Trigger turn nudge (last message is user, percent between min and max)
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Anchor should be stored
    expect(state.nudges.turnAnchors.size).toBe(1);
    expect(state.nudges.turnAnchors.has("user:3000")).toBe(true);
  });

  it("does not add anchor within nudgeFrequency distance of existing anchor", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 5,
    });

    // Pre-set an anchor at the 3rd message
    state.nudges.turnAnchors.add("user:3000");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg1" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg2" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg3" }],
        timestamp: 3000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg4" }],
        timestamp: 4000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg5" }],
        timestamp: 5000,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    // Last message (index 4) is only 2 messages from existing anchor (index 2).
    // nudgeFrequency=5 means no new anchor.
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(1); // Still just the original
  });

  it("adds new anchor when distance exceeds nudgeFrequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 2,
    });

    state.nudges.turnAnchors.add("user:1000");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg1" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg2" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg3" }],
        timestamp: 3000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg4" }],
        timestamp: 4000,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    // Last message (index 3) is 3 messages from anchor at index 0. nudgeFrequency=2, so OK.
    injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    expect(state.nudges.turnAnchors.size).toBe(2);
    expect(state.nudges.turnAnchors.has("user:4000")).toBe(true);
  });

  it("injects nudge text at all anchored positions", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 1,
    });

    // Pre-anchor at two positions
    state.nudges.turnAnchors.add("user:1000");
    state.nudges.turnAnchors.add("user:3000");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg1" }],
        timestamp: 1000,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "msg2" }],
        timestamp: 2000,
        stopReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      } as AgentMessage,
      {
        role: "user",
        content: [{ type: "text", text: "msg3" }],
        timestamp: 3000,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    const result = injectCompressNudges(state, config, messages, {
      tokens: 60000,
      contextWindow: 100000,
      percent: 60,
    });

    // Both anchored messages should have nudge text
    const text0 = (result[0] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    const text2 = (result[2] as unknown as { content: Array<{ text: string }> })
      .content[0].text;
    expect(text0).toContain("dcp-system-reminder");
    expect(text2).toContain("dcp-system-reminder");
  });

  it("context limit nudge always anchors regardless of frequency", () => {
    const state = createSessionState();
    const config = makeDefaultConfig({
      maxContextPercent: 80,
      minContextPercent: 50,
      nudgeFrequency: 100,
    });

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "msg1" }],
        timestamp: 1000,
      } as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    injectCompressNudges(state, config, messages, {
      tokens: 90000,
      contextWindow: 100000,
      percent: 90,
    });

    // Context limit nudge ignores frequency — always anchors
    expect(state.nudges.contextLimitAnchors.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/anchored-nudges.test.ts`

Expected: FAIL — current implementation doesn't anchor or respect frequency.

- [ ] **Step 3: Rewrite `injectCompressNudges` with decision + application stages**

Replace the `injectCompressNudges` function in `src/messages/inject.ts`:

```typescript
/**
 * Inject compress nudges using persistent anchored positions.
 * Two stages:
 *   1. Decision: determine nudge type, add anchor if frequency allows
 *   2. Application: inject nudge text at all anchored positions
 */
export function injectCompressNudges(
  state: SessionState,
  config: DcpConfig,
  messages: AgentMessage[],
  contextUsage: ContextUsage | undefined,
): AgentMessage[] {
  if (!contextUsage) return messages;
  if (messages.length === 0) return messages;
  if (state.manualMode) return messages;
  if (state.compressPermission === "deny") return messages;

  // --- Decision Stage ---
  const { overMaxLimit: overMax, overMinLimit: overMin } = isContextOverLimits(
    config,
    state,
    contextUsage,
  );

  // Summary buffer adjustment (from Phase 3)
  let effectiveOverMax = overMax;
  if (
    effectiveOverMax &&
    config.compress.summaryBuffer &&
    contextUsage.tokens != null
  ) {
    const summaryTokens = getActiveSummaryTokenUsage(state);
    if (summaryTokens > 0) {
      const effectiveTokens = contextUsage.tokens - summaryTokens;
      const adjusted = isContextOverLimits(config, state, {
        ...contextUsage,
        tokens: effectiveTokens,
        percent:
          contextUsage.contextWindow > 0
            ? (effectiveTokens / contextUsage.contextWindow) * 100
            : contextUsage.percent,
      });
      effectiveOverMax = adjusted.overMaxLimit;
    }
  }

  if (!overMin) return messages;

  // Determine which nudge to add
  let nudgeType: "contextLimit" | "turn" | "iteration" | undefined;
  if (effectiveOverMax) {
    nudgeType = "contextLimit";
  } else {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "user") {
      nudgeType = "turn";
    } else {
      let messagesSinceUser = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") break;
        if (messages[i].role === "assistant") messagesSinceUser++;
      }
      if (messagesSinceUser >= config.compress.iterationNudgeThreshold) {
        nudgeType = "iteration";
      }
    }
  }

  if (nudgeType) {
    const targetIndex = messages.length - 1;
    const targetKey = getMessageKey(messages[targetIndex]);
    const anchorSet =
      nudgeType === "contextLimit"
        ? state.nudges.contextLimitAnchors
        : nudgeType === "turn"
          ? state.nudges.turnAnchors
          : state.nudges.iterationAnchors;

    // Context limit nudges always anchor (ignore frequency)
    if (nudgeType === "contextLimit") {
      anchorSet.add(targetKey);
    } else {
      addAnchorIfAllowed(
        anchorSet,
        targetKey,
        targetIndex,
        messages,
        config.compress.nudgeFrequency,
        state,
      );
    }
  }

  // --- Application Stage ---
  return applyAnchoredNudges(state, messages);
}

/**
 * Add anchor only if the nearest existing anchor in the set is >= frequency messages away.
 */
function addAnchorIfAllowed(
  anchorSet: Set<string>,
  targetKey: string,
  targetIndex: number,
  messages: AgentMessage[],
  frequency: number,
  state: SessionState,
): void {
  if (anchorSet.has(targetKey)) return;

  // Find the closest existing anchor by message distance
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const existingKey of anchorSet) {
    // Find index of existing anchor in current messages
    for (let i = 0; i < messages.length; i++) {
      if (getMessageKey(messages[i]) === existingKey) {
        closestDistance = Math.min(closestDistance, Math.abs(targetIndex - i));
        break;
      }
    }
  }

  if (closestDistance >= frequency) {
    anchorSet.add(targetKey);
  }
}

/**
 * Inject nudge text at all anchored message positions.
 */
function applyAnchoredNudges(
  state: SessionState,
  messages: AgentMessage[],
): AgentMessage[] {
  const result = [...messages];
  let changed = false;

  for (let i = 0; i < result.length; i++) {
    const key = getMessageKey(result[i]);
    let nudgeText: string | undefined;

    if (state.nudges.contextLimitAnchors.has(key)) {
      nudgeText = CONTEXT_LIMIT_NUDGE;
    } else if (state.nudges.turnAnchors.has(key)) {
      nudgeText = TURN_NUDGE;
    } else if (state.nudges.iterationAnchors.has(key)) {
      nudgeText = ITERATION_NUDGE;
    }

    if (!nudgeText) continue;

    const msg = result[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    // Skip if already has nudge text
    const hasNudge = hasExistingNudge(msg);
    if (hasNudge) continue;

    result[i] = appendText(msg, `\n\n${nudgeText}`);
    changed = true;
  }

  return changed ? result : messages;
}

function hasExistingNudge(msg: AgentMessage): boolean {
  if (!("content" in msg)) return false;
  if (typeof msg.content === "string")
    return msg.content.includes("<dcp-system-reminder>");
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((p) => {
    if (typeof p !== "object" || p === null) return false;
    const part = p as unknown as Record<string, unknown>;
    return (
      part.type === "text" &&
      typeof part.text === "string" &&
      (part.text as string).includes("<dcp-system-reminder>")
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npx vitest run tests/anchored-nudges.test.ts`

Expected: All PASS.

- [ ] **Step 5: Run full check (fix any broken existing tests)**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Existing nudge tests in `tests/inject.test.ts` should mostly pass since they trigger nudge conditions that would anchor and apply. If any fail due to the new frequency logic, adjust `nudgeFrequency` in those test configs to 1 (always allow).

- [ ] **Step 6: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/messages/inject.ts tests/anchored-nudges.test.ts
git commit -m "feat(nudges): implement anchored nudge system with frequency throttling

Nudges are now anchored to specific messages via stable keys.
Deduplication prevents nudge spam via nudgeFrequency config.
Context limit nudges always anchor (ignore frequency)."
```

---

### Task 3: Persist anchor sets

**Files:**

- Modify: `src/state/persistence.ts`

- [ ] **Step 1: Add anchor serialization to `saveSessionState`**

In the serialized object, add:

```typescript
nudges: {
  contextLimitAnchors: [...state.nudges.contextLimitAnchors],
  turnAnchors: [...state.nudges.turnAnchors],
  iterationAnchors: [...state.nudges.iterationAnchors],
},
```

- [ ] **Step 2: Add anchor restoration to `loadSessionState`**

```typescript
if (parsed.nudges && typeof parsed.nudges === "object") {
  const n = parsed.nudges as Record<string, unknown>;
  if (Array.isArray(n.contextLimitAnchors))
    result.nudges = {
      contextLimitAnchors: new Set(
        n.contextLimitAnchors.filter((x): x is string => typeof x === "string"),
      ),
      turnAnchors: new Set(
        Array.isArray(n.turnAnchors)
          ? n.turnAnchors.filter((x): x is string => typeof x === "string")
          : [],
      ),
      iterationAnchors: new Set(
        Array.isArray(n.iterationAnchors)
          ? n.iterationAnchors.filter((x): x is string => typeof x === "string")
          : [],
      ),
    };
}
```

- [ ] **Step 3: Run full check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-dcp && npm run check`

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-dcp
git add src/state/persistence.ts
git commit -m "feat(nudges): persist anchor sets across sessions"
```

---

## Verification Checklist

- [ ] `npm run check` passes
- [ ] Anchors stored as stable message keys (not indices)
- [ ] `nudgeFrequency` throttles anchor additions (except context limit)
- [ ] Nudge text injected at all anchored positions
- [ ] Anchors survive session resume
- [ ] Existing nudge behavior preserved for frequency=1 configs
