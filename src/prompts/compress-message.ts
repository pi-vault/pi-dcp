/**
 * Message-mode compress tool description.
 * Used when config.compress.mode === "message".
 */
export const COMPRESS_MESSAGE_PROMPT = `Compress specific messages identified by their priority tags.

Messages are tagged with <dcp-message-id priority="N"> where N is 1-5:
- Priority 1-2: Highest compression value (old, large, resolved content)
- Priority 3: Moderate compression value
- Priority 4-5: Low compression value (recent, small, active content)

TARGET SELECTION
Focus on priority 1-2 messages first. These are the best candidates for compression.
Only compress priority 3+ messages when context pressure is severe.

SUMMARY REQUIREMENTS
Each summary must be self-contained and capture all essential information from the target message.
Preserve exact error messages, file paths, function names, and user instructions.
`;
