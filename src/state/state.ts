import type {
  MessageIdState,
  Nudges,
  Prune,
  PruneMessagesState,
  SessionState,
  SessionStats,
} from "./types.ts";

export function createSessionState(): SessionState {
  return {
    sessionId: null,
    manualMode: false,
    compressPermission: undefined,
    pendingManualTrigger: null,
    prune: createPrune(),
    nudges: createNudges(),
    stats: createStats(),
    toolParameters: new Map(),
    toolIdList: [],
    messageIds: createMessageIdState(),
    lastCompaction: 0,
    currentTurn: 0,
    modelContextWindow: undefined,
  };
}

export function resetSessionState(state: SessionState): void {
  state.sessionId = null;
  state.manualMode = false;
  state.compressPermission = undefined;
  state.pendingManualTrigger = null;
  state.prune.tools.clear();
  resetPruneMessages(state.prune.messages);
  state.nudges.contextLimitAnchors.clear();
  state.nudges.turnAnchors.clear();
  state.nudges.iterationAnchors.clear();
  state.stats.pruneTokenCounter = 0;
  state.stats.totalPruneTokens = 0;
  state.stats.toolsPruned = 0;
  state.stats.messagesCompressed = 0;
  state.toolParameters.clear();
  state.toolIdList = [];
  state.messageIds.byIndex.clear();
  state.messageIds.nextRefIndex = 1;
  state.lastCompaction = 0;
  state.currentTurn = 0;
  state.modelContextWindow = undefined;
}

function createPrune(): Prune {
  return {
    tools: new Map(),
    messages: createPruneMessages(),
  };
}

function createPruneMessages(): PruneMessagesState {
  return {
    byMessageIndex: new Map(),
    blocksById: new Map(),
    activeBlockIds: new Set(),
    activeByAnchorIndex: new Map(),
    nextBlockId: 1,
    nextRunId: 1,
  };
}

function resetPruneMessages(m: PruneMessagesState): void {
  m.byMessageIndex.clear();
  m.blocksById.clear();
  m.activeBlockIds.clear();
  m.activeByAnchorIndex.clear();
  m.nextBlockId = 1;
  m.nextRunId = 1;
}

function createNudges(): Nudges {
  return {
    contextLimitAnchors: new Set(),
    turnAnchors: new Set(),
    iterationAnchors: new Set(),
  };
}

function createStats(): SessionStats {
  return {
    pruneTokenCounter: 0,
    totalPruneTokens: 0,
    toolsPruned: 0,
    messagesCompressed: 0,
  };
}

function createMessageIdState(): MessageIdState {
  return {
    byIndex: new Map(),
    nextRefIndex: 1,
  };
}
