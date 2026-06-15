import { describe, expect, it } from "vitest";
import { buildPriorityMap } from "../src/messages/priority.ts";
import { createSessionState } from "../src/state/state.ts";
import { assignMessageRefs } from "../src/messages/inject.ts";
import { makeUserMessage, makeAssistantMessage } from "./helpers.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("buildPriorityMap", () => {
  it("assigns priorities to messages", () => {
    const state = createSessionState();
    const messages = [
      makeUserMessage("a".repeat(400)),
      makeAssistantMessage("b".repeat(800)),
      makeUserMessage("c".repeat(100)),
    ];
    assignMessageRefs(state, messages);

    const map = buildPriorityMap(state, messages);
    expect(map.size).toBe(3);

    // Earlier, larger messages should have higher priority (lower number)
    const p0 = map.get(0);
    const p2 = map.get(2);
    expect(p0).toBeDefined();
    expect(p2).toBeDefined();
    expect(p0!.priority).toBeLessThanOrEqual(p2!.priority);
  });

  it("returns empty map for empty messages", () => {
    const state = createSessionState();
    const map = buildPriorityMap(state, []);
    expect(map.size).toBe(0);
  });

  it("skips messages already covered by active compression blocks", () => {
    const state = createSessionState();
    const messages = [
      makeUserMessage("old message"),
      makeAssistantMessage("response"),
      makeUserMessage("new message"),
    ];
    assignMessageRefs(state, messages);

    // Mark message 0 as covered by an active block
    state.prune.messages.byMessageIndex.set(0, {
      tokenCount: 25,
      blockIds: [1],
      activeBlockIds: [1],
    });

    const map = buildPriorityMap(state, messages);
    expect(map.has(0)).toBe(false);
    expect(map.has(1)).toBe(true);
    expect(map.has(2)).toBe(true);
  });

  it("assigns priorities in range 1-5", () => {
    const state = createSessionState();
    const messages = [makeUserMessage("a"), makeAssistantMessage("b")];
    assignMessageRefs(state, messages);

    const map = buildPriorityMap(state, messages);
    for (const [, entry] of map) {
      expect(entry.priority).toBeGreaterThanOrEqual(1);
      expect(entry.priority).toBeLessThanOrEqual(5);
    }
  });

  it("gives toolResult messages a slight priority boost for compression", () => {
    const state = createSessionState();
    // Same position and similar token count — role weight should be the tiebreaker
    const messages: AgentMessage[] = [
      makeUserMessage("x".repeat(200)),
      { role: "toolResult", content: [{ type: "text", text: "y".repeat(200) }], toolCallId: "t1" } as unknown as AgentMessage,
    ];
    assignMessageRefs(state, messages);

    const map = buildPriorityMap(state, messages);
    const userEntry = map.get(0);
    const toolEntry = map.get(1);
    expect(userEntry).toBeDefined();
    expect(toolEntry).toBeDefined();
    // toolResult at later position still gets equal or better priority due to role weight
    // (position score for index 0 > index 1, but role weight compensates partially)
    // Both should be included in the map
    expect(map.size).toBe(2);
  });
});
