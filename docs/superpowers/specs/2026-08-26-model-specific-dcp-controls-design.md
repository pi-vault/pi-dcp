# Model-specific DCP controls

## Summary

`pi-dcp` already supports per-model compression thresholds through `compress.modelMaxLimits` and `compress.modelMinLimits`. Both maps use exact `provider/modelId` keys and accept absolute token counts or percentage strings. The new capability is a top-level `disabledModels` list that bypasses all DCP behavior for listed models.

## Configuration

- `disabledModels` is a top-level `string[]` with default `[]`.
- Keys match `${provider}/${modelId}` exactly and case-sensitively; no glob matching is added.
- Missing provider or model identity does not match a disabled entry.
- Global `enabled: false` disables DCP before model eligibility is considered.
- A matching `disabledModels` entry takes precedence over `modelMaxLimits` and `modelMinLimits`. Limits for a disabled model remain configured but are dormant until that model is enabled again.
- Existing global/project merge behavior is preserved: nested objects merge recursively and arrays replace earlier arrays.

## Runtime behavior

- A disabled model receives no DCP system prompt, context transformations, message IDs, nudges, pruning, compression execution, hallucinated-ID cleanup, compression timing, or DCP result caching.
- `session_start` may register the existing `compress` tool, then Pi's `getActiveTools()` and `setActiveTools()` APIs remove it from the active set when the initial model is disabled.
- `model_select` applies the same reconciliation during live switches. No Pi host change or unregister API is needed.
- Tool-state reconciliation records whether `compress` was active only on the first transition into a disabled state. Repeated disabled contexts and disabled-to-disabled switches preserve that value. Returning to an enabled model restores `compress` only when the recorded value is `true`, then clears the record.
- A stale `compress` call is blocked in the `tool_call` hook using the current event context model.
- Existing DCP state is retained while a model is disabled. Pi compaction, tree navigation, and session lifecycle handling remain authoritative for clearing or restoring state.

## Commands and status

- Mutating commands (`dcp:compress`, `dcp:sweep`, `dcp:manual`, `dcp:decompress`, `dcp:recompress`, and `dcp:permission`) return before sending messages or mutating state for a disabled model.
- Model-level rejection uses `DCP is disabled for the current model.`; global disablement keeps its existing message.
- `dcp:help`, `dcp:lifetime`, and `dcp:stats` remain queryable.
- `dcp:context` remains queryable and receives a `modelDisabled` boolean so it can report model-level disablement without confusing it with global disablement.

## Scope and compatibility

- Only `/Users/lanh/Developer/pi-vault/pi-dcp` is modified.
- `/Users/lanh/Developer/pi-packages/pi`, `/Users/lanh/Developer/pi-packages/opencode-dynamic-context-pruning`, and `/Users/lanh/Developer/pi-packages/Snowy117-pi-dcp-migrate` remain read-only references.
- Pi already exposes `ExtensionContext.model`, `model_select`, `getActiveTools()`, and `setActiveTools()`; no host API changes are required.
- OpenCode DCP and the migration repository confirm the existing exact per-model limit-map shape but do not provide model-specific full disablement.
- No dependency changes are required. Execution and verification use Node.js `>=24.15.0`.
