# Dynamic Context Pruning

DCP manages the conversation context presented to a Pi model during long sessions.
It reduces stale content and replaces selected conversation content with summaries while retaining the original history.

## Language

### Context reduction

**Pruning**:
Removal or replacement of selected conversation content to reduce the context presented to the model.
It includes automatic tool pruning and compression.
_Avoid_: History deletion

**Automatic tool pruning**:
Reduction of redundant tool output or stale failed-tool input without a model-supplied summary.
Failed-tool diagnostics remain available.
_Avoid_: Automatic compression

**Compression**:
Replacement of selected conversation content with a model-supplied summary while retaining the original history.
_Avoid_: Compaction, deletion

**Compression block**:
A named summary together with the conversation content it represents.
One compression call can produce multiple blocks.
_Avoid_: Compressed message, compression call

**Compression run**:
One model compression call and the compression blocks it produces.
_Avoid_: Compression block

### Block lifecycle

**Active block**:
A compression block whose summary currently represents its covered conversation content in the model's context.
_Avoid_: Existing block, eligible block

**Consumed block**:
An existing compression block incorporated into a later compression block, its parent.
Its summary is hidden while an eligible consuming parent is active, but it remains available for restoration.
_Avoid_: Deleted block, user-deactivated block

**User-deactivated block**:
A compression block explicitly excluded from representing context by the user.
It remains excluded when a consuming parent is deactivated.
_Avoid_: Consumed block, inactive block

**Decompression**:
User deactivation of an active compression block.
The exposed content may be original messages or summaries of eligible consumed blocks.
_Avoid_: History recovery, deletion

**Recompression**:
Restoration of a user-deactivated block's eligibility using its existing summary.
A consuming parent can still keep that block hidden.
_Avoid_: Generating a new summary

### Conversation selection

**Raw context**:
The conversation messages available on the current session branch before DCP transformations.
_Avoid_: Model-visible context, entire session history

**Model-visible context**:
The conversation presented to the model after DCP pruning, compression summaries, message markers, and nudges.
_Avoid_: Raw context

**Message reference**:
A stable DCP identity for a message, independent of its position in the model-visible context.
The message marker is the visible notation for that reference and may also show compression priority.
_Avoid_: Message position, message index

**Compression priority**:
A relative recommendation for which messages offer the most value to compress in message mode.
Priority 1 is highest and 5 is lowest; priority does not grant permission or override protection.
_Avoid_: Message importance, protection level

**Range mode**:
A compression mode in which each selection is described by inclusive start and end references and a proposed summary.
_Avoid_: Message mode

**Message mode**:
A compression mode in which each selection is described by a message reference and a proposed summary.
A selection can expand to preserve related tool calls and results or an existing compression block.
_Avoid_: Single-message-only compression, range mode

**User turn**:
A span beginning with a user message and extending to the next user message or the end of the raw context.
Assistant iterations and tool results within the span do not start new user turns.
_Avoid_: Assistant iteration, tool call

**Turn protection**:
Exclusion of the newest configured number of user turns from automatic tool pruning, sweep, and new compression selections.
_Avoid_: Nudge frequency, assistant iteration limit

### Compression guidance and control

**Compression nudge**:
A reminder in conversation context asking the model to consider compression because of context usage, a user turn, or prolonged assistant iteration.
_Avoid_: Notification, compression call

**Nudge anchor**:
A conversation location associated with a compression nudge across successive context passes.
_Avoid_: Compression block anchor

**Manual mode**:
A mode that pauses automatic compression nudges while leaving explicit compression available subject to permission and policy.
Automatic tool pruning can continue according to its separate configuration.
_Avoid_: Compression denied, DCP disabled

**Compression permission**:
Authorization for model compression calls: allow, ask for approval on every call, or deny.
Denial alone leaves automatic tool pruning and existing compression summaries available.
_Avoid_: Manual mode, tool selection

**Sweep**:
User-requested pruning of all eligible completed tool outputs without model-supplied summaries.
_Avoid_: Compression, failed-input purging

**Summary buffer**:
An allowance for active summary tokens when evaluating whether context usage warrants an urgent context-limit nudge.
_Avoid_: Extra context-window capacity, stored summary collection
