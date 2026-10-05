import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEvent,
  ExtensionToolContext,
  RegisteredCommand,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export interface HarnessModel {
  provider: string;
  id: string;
}

export interface HarnessContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface ExtensionHarnessOptions {
  /** Tools initially active in the host. Default: ["read"]. */
  activeTools?: string[];
  /** Optional host allowlist. When set, only these tools are registered. */
  allowedTools?: string[];
  /** Optional host denylist. */
  excludedTools?: string[];
  /** Host "no tools" mode. */
  noTools?: "all" | "builtin";
  cwd?: string;
  projectTrusted?: boolean;
  model?: HarnessModel;
  branch?: unknown[];
  sessionId?: string;
  sessionDir?: string;
  hasUI?: boolean;
  contextUsage?: HarnessContextUsage | undefined;
}

export interface PersistedEntry {
  customType: string;
  data: unknown;
}

export interface SentMessage {
  message: unknown;
  options: unknown;
}

type EventName = ExtensionEvent["type"];
type Handler = (event: unknown, ctx: unknown) => unknown;

const DEFAULT_SESSION_DIR = "/tmp/dcp-harness-session";

/**
 * A typed in-memory stand-in for Pi's extension host.
 *
 * Models registration, activation, and host exclusions closely enough to test
 * DCP's lifecycle reconciliation without mocking Pi internals. Necessary casts
 * are confined to the adapter objects below; the exposed observation helpers
 * are typed.
 */
export function createExtensionHarness(options: ExtensionHarnessOptions = {}) {
  const allowedTools = options.allowedTools ? new Set(options.allowedTools) : undefined;
  const excludedTools = options.excludedTools ? new Set(options.excludedTools) : undefined;
  const noToolsAll = options.noTools === "all";

  const hostAllows = (name: string): boolean => {
    if (noToolsAll) return false;
    if (allowedTools && !allowedTools.has(name)) return false;
    if (excludedTools?.has(name)) return false;
    return true;
  };

  const handlers = new Map<EventName, Handler[]>();
  const tools = new Map<string, ToolDefinition>();
  const allowedToolNames = new Set<string>();
  const knownToolNames = new Set<string>(options.activeTools ?? ["read"]);
  const commands = new Map<string, RegisteredCommand>();
  const entries: PersistedEntry[] = [];
  const sentMessages: SentMessage[] = [];
  const notify = vi.fn();
  const setStatus = vi.fn();
  const activeToolNames = new Set(options.activeTools ?? ["read"]);
  let branch = options.branch ?? [];
  let model = options.model ?? { provider: "test", id: "test-model" };

  const ui = {
    notify,
    setStatus,
    select: vi.fn(),
    confirm: vi.fn(),
    input: vi.fn(),
    editor: vi.fn(),
    custom: vi.fn(),
    setWorkingMessage: vi.fn(),
    setWidget: vi.fn(),
    setFooter: vi.fn(),
    setHeader: vi.fn(),
    setTitle: vi.fn(),
    pasteToEditor: vi.fn(),
    setEditorText: vi.fn(),
    getEditorText: vi.fn(() => ""),
    addAutocompleteProvider: vi.fn(),
    setEditorComponent: vi.fn(),
    getEditorComponent: vi.fn(),
    getToolsExpanded: vi.fn(() => false),
    setToolsExpanded: vi.fn(),
    onTerminalInput: vi.fn(() => () => {}),
    setWorkingVisible: vi.fn(),
    setWorkingIndicator: vi.fn(),
    setHiddenThinkingLabel: vi.fn(),
    get theme(): never {
      throw new Error("theme is not available in the harness");
    },
    getAllThemes: vi.fn(() => []),
    getTheme: vi.fn(),
    setTheme: vi.fn(() => ({ success: false })),
  };

  const sessionManager = {
    getCwd: () => options.cwd ?? process.cwd(),
    getSessionDir: () => options.sessionDir ?? DEFAULT_SESSION_DIR,
    getSessionId: () => options.sessionId ?? "harness-session",
    getBranch: () => branch,
    getLeafId: () => null,
    getLeafEntry: () => undefined,
    getEntry: () => undefined,
    getLabel: () => undefined,
    getHeader: () => undefined,
    getEntries: () => branch,
    getTree: () => [],
    getSessionName: () => undefined,
    buildContextEntries: () => branch,
    buildSessionProjection: () => ({
      entries: [],
      messages: [],
      thinkingLevel: "medium",
      model: null,
    }),
  };

  const extensionContext = {
    ui,
    mode: "tui",
    hasUI: options.hasUI ?? false,
    cwd: options.cwd ?? process.cwd(),
    sessionManager,
    model: model as unknown as ExtensionContext["model"],
    modelRegistry: {},
    scopedModels: [],
    isIdle: () => true,
    isProjectTrusted: () => options.projectTrusted ?? false,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => options.contextUsage,
    compact: () => {},
    getSystemPrompt: () => "",
  };

  const commandContext = {
    ...extensionContext,
    get model() {
      return extensionContext.model;
    },
    getSystemPromptOptions: () => ({
      selectedTools: [...activeToolNames],
      toolSnippets: {},
      toolGuidelines: {},
      promptGuidelines: [],
      appendSystemPrompt: "",
      sections: {},
      contextFiles: [],
      skills: [],
      cwd: extensionContext.cwd,
    }),
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: true }),
    fork: async () => ({ cancelled: true }),
    navigateTree: async () => ({ cancelled: true }),
    switchSession: async () => ({ cancelled: true }),
    reload: async () => {},
  };

  const api = {
    on(event: EventName, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(definition: ToolDefinition) {
      const wasRegistered = tools.has(definition.name);
      tools.set(definition.name, definition);
      if (!hostAllows(definition.name)) return;
      allowedToolNames.add(definition.name);
      knownToolNames.add(definition.name);
      // Replacing an existing definition preserves its active state.
      if (wasRegistered) return;
      if (definition.defaultActive !== false) activeToolNames.add(definition.name);
    },
    getActiveTools() {
      return [...activeToolNames];
    },
    getAllTools() {
      return [...allowedToolNames].map((name) => ({
        name,
        description: tools.get(name)?.description ?? "",
        parameters: tools.get(name)?.parameters ?? {},
        promptGuidelines: tools.get(name)?.promptGuidelines,
        exposure: "direct" as const,
        sourceInfo: { path: "harness", source: "extension" as const },
      }));
    },
    setActiveTools(names: string[]) {
      const next = new Set<string>();
      for (const name of names) {
        if (knownToolNames.has(name)) next.add(name);
      }
      activeToolNames.clear();
      for (const name of next) activeToolNames.add(name);
    },
    registerCommand(name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      commands.set(name, {
        ...command,
        name,
        sourceInfo: createSyntheticSourceInfo(`<harness:${name}>`, { source: "inline" }),
      });
    },
    sendMessage(message: unknown, sendOptions?: unknown) {
      sentMessages.push({ message, options: sendOptions });
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
    getSettings: () => ({}),
    getCommands: () => [],
  };

  async function emit<K extends EventName>(
    name: K,
    event: Extract<ExtensionEvent, { type: K }>,
  ): Promise<unknown[]> {
    if (name === "model_select") {
      const selected = (event as { model?: unknown }).model;
      if (selected) setHarnessModel(selected as HarnessModel);
    }
    const list = handlers.get(name);
    if (!list || list.length === 0) {
      throw new Error(`No handler registered for "${name}"`);
    }
    const results: unknown[] = [];
    for (const handler of list) {
      results.push(await handler(event, extensionContext));
    }
    return results;
  }

  async function executeTool(name: string, args: unknown, ctx = extensionContext) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" is not registered`);
    const toolContext = {
      ...ctx,
      tools: [],
      executeTool: async () => {
        throw new Error("nested tool calls are not supported by the harness");
      },
    } as unknown as ExtensionToolContext;
    const signal = undefined;
    const onUpdate = undefined;
    return tool.execute("harness-call", args as never, signal, onUpdate, toolContext);
  }

  async function runCommand(name: string, args: string, ctx = buildCommandContext()) {
    const command = commands.get(name);
    if (!command) throw new Error(`Command "${name}" is not registered`);
    return command.handler(args, ctx as unknown as ExtensionCommandContext);
  }

  function buildCommandContext() {
    return {
      ...extensionContext,
      getSystemPromptOptions: () => ({
        selectedTools: [...activeToolNames],
        toolSnippets: {},
        toolGuidelines: {},
        promptGuidelines: [],
        appendSystemPrompt: "",
        sections: {},
        contextFiles: [],
        skills: [],
        cwd: extensionContext.cwd,
      }),
      waitForIdle: async () => {},
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {},
    };
  }

  function setHarnessModel(next: HarnessModel) {
    model = next;
    (extensionContext as { model: unknown }).model = next as unknown as ExtensionContext["model"];
  }

  function emitMessages(name: EventName, event: unknown): Promise<unknown[]> {
    return emit(name as EventName, event as never);
  }

  return {
    api: api as unknown as ExtensionAPI,
    tools,
    commands,
    entries,
    sentMessages,
    ui: { notify, setStatus },
    context: extensionContext as unknown as ExtensionContext,
    commandContext: commandContext as unknown as ExtensionCommandContext,
    get model() {
      return model;
    },
    setModel(next: HarnessModel) {
      setHarnessModel(next);
    },
    setBranch(next: unknown[]) {
      branch = next;
    },
    getBranch() {
      return branch;
    },
    activeTools: () => [...activeToolNames],
    setActiveTools: (names: string[]) => {
      api.setActiveTools(names);
    },
    emit,
    emitMessages,
    executeTool,
    runCommand,
    hasHandler: (name: EventName) => (handlers.get(name)?.length ?? 0) > 0,
  };
}

export type ExtensionHarness = ReturnType<typeof createExtensionHarness>;

/** Build a default structured system message fixture declaring a tool loadout. */
export function declaredLoadoutMessage(toolNames: string[] = []): AgentMessage {
  return {
    role: "system",
    content: "",
    sections: {},
    toolsAdded: toolNames.map((name) => ({ name, description: "", parameters: {} })),
    timestamp: 1,
  } as unknown as AgentMessage;
}
