# Pi DCP Provenance Audit

Date: 2026-07-28

| Repository | Commit | Version | License | Use in this project |
| --- | --- | --- | --- | --- |
| `pi-vault/pi-dcp` | `e68c236` (`v0.4.1` baseline `bfeeff0`) | 0.4.1 | MIT | Current implementation |
| `earendil-works/pi` checkout | `8eef62ed` | coding-agent 0.82.0; installed API 0.80.3 | MIT | Pi lifecycle and extension API reference |
| `opencode-dynamic-context-pruning` | `85b6f5c` | 3.1.14 | AGPL-3.0-or-later | Behavioral comparison only |
| `Davidcreador/pi-dcp` | `7ae24be9` | 0.2.0 | AGPL-3.0-or-later | Behavioral comparison only |
| `complexthings/pi-dynamic-context-pruning` | `75e04cb` | 1.0.7 | No license file or package declaration | Behavioral comparison only |

## Rules

- Do not copy source from the AGPL or unlicensed repositories into the MIT package.
- Record behavior and public interfaces in original words.
- Treat Pi core as the authority for extension lifecycle, session, message, and tool APIs.
- Verify `appendEntry`, `getBranch`, `getSessionId`, `session_tree`, `sendMessage`, `ctx.cwd`, and project trust against the installed Pi 0.80.3 types before later phases use them.

## Verification Baseline

- Tests: 368 passing.
- Typecheck: passing.
- Lint: exits successfully with 88 warnings and 1 info.
- Package dry-run: passing.
- Local runtime: Node 23.11.0, below the package requirement of Node >=24.15.0; Node 24 CI is the merge gate.
- Comparison suites: not executed because their local runtime dependencies were absent.
