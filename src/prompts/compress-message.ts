/**
 * Message-mode compress tool description.
 * Used when config.compress.mode === "message".
 */
export const COMPRESS_MESSAGE_PROMPT = `Compress specific messages identified by their priority markers.

Messages are tagged with a compact marker of the form @mN:P@ where N is the message number and P is 1-5:
- Priority 1-2: Highest compression value (old, large, resolved content)
- Priority 3: Moderate compression value
- Priority 4-5: Low compression value (recent, small, active content)

Copy the marker exactly as shown into \`messageId\`. Padded forms such as m0012 are also accepted, but the markers you see are compact.

TARGET SELECTION
Focus on priority 1-2 messages first. These are the best candidates for compression.
Only compress priority 3+ messages when context pressure is severe.

SUMMARY REQUIREMENTS
Each summary must be self-contained and capture all essential information from the target message.
Preserve exact error messages, file paths, function names, and user instructions.
`;
