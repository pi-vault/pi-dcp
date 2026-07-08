import { Type, type Static } from "typebox";

export const DeduplicationConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable deduplication strategy",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool names excluded from deduplication (glob patterns)",
  }),
  turnProtection: Type.Number({
    default: 0,
    minimum: 0,
    description:
      "Protect duplicate tool outputs from pruning for N turns after invocation. 0 disables.",
  }),
});

export const PurgeErrorsConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable error purging strategy",
  }),
  turns: Type.Number({
    default: 4,
    minimum: 1,
    description: "Prune failed tool results after this many turns",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool names excluded from error purging (glob patterns)",
  }),
});

export const CompressConfigSchema = Type.Object({
  mode: Type.Union([Type.Literal("range"), Type.Literal("message")], {
    default: "range",
    description:
      "Compression mode: range (compress spans) or message (compress individual messages)",
  }),
  permission: Type.Union([Type.Literal("allow"), Type.Literal("deny")], {
    default: "allow",
    description: "Whether the compress tool is allowed to run",
  }),
  showCompression: Type.Boolean({
    default: false,
    description:
      "Include compression summary text in user notifications (does not affect model context)",
  }),
  maxContextPercent: Type.Number({
    default: 80,
    description: "Legacy: max context percentage threshold",
  }),
  minContextPercent: Type.Number({
    default: 50,
    description: "Legacy: min context percentage threshold",
  }),
  maxContextLimit: Type.Optional(
    Type.Union([Type.Number(), Type.String()], {
      description:
        "Max context limit (absolute token count or percentage string like '80%'). Default: 200000",
    }),
  ),
  minContextLimit: Type.Optional(
    Type.Union([Type.Number(), Type.String()], {
      description:
        "Min context limit (absolute token count or percentage string like '50%'). Default: 100000",
    }),
  ),
  modelMaxLimits: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.Number(), Type.String()]), {
      description: "Per-model max context limits keyed by 'provider/modelId'",
    }),
  ),
  modelMinLimits: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.Number(), Type.String()]), {
      description: "Per-model min context limits keyed by 'provider/modelId'",
    }),
  ),
  nudgeFrequency: Type.Number({
    default: 5,
    minimum: 1,
    description: "Minimum turns between non-urgent nudges",
  }),
  iterationNudgeThreshold: Type.Number({
    default: 15,
    minimum: 1,
    description:
      "Number of assistant iterations without user input before nudging",
  }),
  nudgeForce: Type.Union([Type.Literal("strong"), Type.Literal("soft")], {
    default: "soft",
    description: "Nudge urgency: strong (imperative) or soft (suggestion)",
  }),
  protectedTools: Type.Array(Type.String(), {
    default: [],
    description: "Tool outputs to preserve during compression (glob patterns)",
  }),
  protectUserMessages: Type.Boolean({
    default: false,
    description: "Append user message text to compression summaries",
  }),
  protectTags: Type.Boolean({
    default: false,
    description:
      "Preserve <protect>...</protect> tag content in summaries",
  }),
  summaryBuffer: Type.Boolean({
    default: true,
    description:
      "Exclude active summary tokens from threshold comparison to prevent cascading",
  }),
});

export const ManualModeConfigSchema = Type.Object({
  default: Type.Union([Type.Literal(false), Type.Literal("active")], {
    default: false,
    description: "Initial manual mode state",
  }),
  automaticStrategies: Type.Boolean({
    default: true,
    description: "Run automatic strategies even in manual mode",
  }),
});

export const ExperimentalConfigSchema = Type.Object({
  allowSubAgents: Type.Boolean({
    default: false,
    description: "Enable DCP in sub-agent child sessions",
  }),
  customPrompts: Type.Boolean({
    default: false,
    description: "Enable filesystem-based prompt overrides",
  }),
});

export const StrategiesConfigSchema = Type.Object({
  deduplication: DeduplicationConfigSchema,
  purgeErrors: PurgeErrorsConfigSchema,
});

export const DcpConfigSchema = Type.Object({
  enabled: Type.Boolean({
    default: true,
    description: "Enable the DCP extension",
  }),
  debug: Type.Boolean({
    default: false,
    description: "Enable debug logging to session directory",
  }),
  nudgeNotification: Type.Union(
    [Type.Literal("off"), Type.Literal("minimal"), Type.Literal("detailed")],
    {
      default: "minimal",
      description: "Notification verbosity for pruning events",
    },
  ),
  nudgeNotificationType: Type.Union(
    [Type.Literal("toast"), Type.Literal("status")],
    {
      default: "status",
      description:
        "Notification delivery: toast (ephemeral) or status (persistent)",
    },
  ),
  protectedFilePatterns: Type.Array(Type.String(), {
    default: [],
    description: "Glob patterns for file paths to protect from pruning",
  }),
  compress: CompressConfigSchema,
  manualMode: ManualModeConfigSchema,
  strategies: StrategiesConfigSchema,
  experimental: ExperimentalConfigSchema,
});

export type DcpConfig = Static<typeof DcpConfigSchema>;
export type CompressConfig = Static<typeof CompressConfigSchema>;
export type DeduplicationConfig = Static<typeof DeduplicationConfigSchema>;
export type PurgeErrorsConfig = Static<typeof PurgeErrorsConfigSchema>;
export type ManualModeConfig = Static<typeof ManualModeConfigSchema>;
export type ExperimentalConfig = Static<typeof ExperimentalConfigSchema>;
export type StrategiesConfig = Static<typeof StrategiesConfigSchema>;
