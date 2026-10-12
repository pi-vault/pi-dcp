# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `pi-vault/pi-dcp`.
Use the `gh` CLI from this clone; it infers the repository from
the Git remote.

## Conventions

- Create: `gh issue create --title "..." --body-file <path>`.
  For multiline content, write the body to a temporary file first.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,labels`.
  Add label and state filters as needed.
- Comment: `gh issue comment <number> --body-file <path>`.
- Label: `gh issue edit <number> --add-label "..."`.
- Remove label: `gh issue edit <number> --remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

When a skill says "publish to the issue tracker", create a GitHub
issue. When it says "fetch the relevant ticket", read that issue.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child ticket: link it as a GitHub sub-issue where available.
  Otherwise, add it to a task list in the map and put
  `Part of #<map>` at the top of its body.
- Ticket types: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- Blocking: use native issue dependencies where available.
  Otherwise, put `Blocked by: #<number>, #<number>` near the top
  of the ticket. All blockers must be closed before work begins.
- Frontier: select the first open, unblocked, unassigned child
  in map order.
- Claim: `gh issue edit <number> --add-assignee @me` before work.
- Resolve: comment with the answer, close the ticket, then append
  a concise answer and ticket link to the map's Decisions-so-far.
