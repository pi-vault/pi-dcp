# Pi Host-Provided TypeBox Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Pi's host-provided `typebox` warning without changing pi-dcp runtime behavior, and prevent the invalid package metadata from recurring.

**Architecture:** Treat `typebox` like the other modules supplied by Pi: the published extension declares an exact `"*"` peer so Pi's extension loader owns the runtime instance, while local development keeps a compatible pinned copy in `devDependencies`. A focused Vitest contract test protects this boundary, and package-artifact inspection verifies that the published manifest preserves it.

**Tech Stack:** Node.js >=24.15.0, TypeScript, pnpm 11.24.0, Vitest 4, Pi 1.0.1

**Spec:** Approved in-chat design from 2026-10-03 (bounded change; no separate design document)

## Global Constraints

- `typebox` must be absent from `dependencies`, present in `peerDependencies` with the exact range `"*"`, and available locally from `devDependencies` at `^1.3.19`.
- Existing peer contracts for `@earendil-works/pi-agent-core` and `@earendil-works/pi-coding-agent` remain exact `"*"` ranges with their current development versions unchanged.
- Do not change TypeScript imports, extension behavior, package version, changelog, or release workflow.
- Do not edit the installed v0.6.0 manifest under `~/.config/pi/npm`; it remains stale until a corrected package is installed or published.
- Keep the diff limited to package metadata, its lockfile representation, and one metadata regression test.

## Review Focus

- A host-provided package appearing in both `dependencies` and `peerDependencies` must fail the metadata test; being a peer does not excuse a bundled runtime copy.
- A host-provided peer using a semver range such as `^1.3.19` instead of exact `"*"` must fail the metadata test.
- Removing the local development copy of a host-provided package must fail the metadata test before typechecking or tests encounter an unresolved import.
- The packed tarball must retain the corrected dependency sections rather than only making the source manifest look correct.
- Pi loading the repository directly must still resolve `typebox` and register the extension; the metadata-only fix must not require source import changes.

---

### Task 1: Restore the host-provided package contract

**Files:**

- Create: `tests/package-metadata.test.ts`
- Modify: `package.json:53-68`
- Modify: `pnpm-lock.yaml:9-29`

**Interfaces:**

- Consumes: the top-level `dependencies`, `devDependencies`, and `peerDependencies` maps in `package.json`.
- Produces: the npm metadata contract that `typebox`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-coding-agent` are host-provided `"*"` peers, never runtime dependencies, and remain available for local development.

- [ ] **Step 1: Add the failing package-metadata contract test**

Create `tests/package-metadata.test.ts` using `node:fs`, `node:url`, and Vitest. Resolve `../package.json` from `import.meta.url`, parse it into an interface with optional `Record<string, string>` dependency maps, and exercise this exact package list:

```ts
const hostProvidedPackages = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "typebox",
] as const;
```

Use one parameterized test named `"declares %s as a host-provided development peer"`. For each package, assert:

```ts
expect(manifest.dependencies?.[packageName]).toBeUndefined();
expect(manifest.peerDependencies?.[packageName]).toBe("*");
expect(manifest.devDependencies?.[packageName]).toBeDefined();
```

- [ ] **Step 2: Run the focused test and verify the current manifest violates the contract**

Run: `pnpm vitest run tests/package-metadata.test.ts`

Expected: FAIL only for `typebox`, showing it is currently `^1.3.19` under `dependencies`, missing from `peerDependencies`, and missing from `devDependencies`.

- [ ] **Step 3: Correct `package.json` dependency ownership**

Remove the `dependencies` block containing `typebox`; add `"typebox": "^1.3.19"` to `devDependencies`; add `"typebox": "*"` to `peerDependencies`. Preserve the existing ordering convention and leave all other versions unchanged.

- [ ] **Step 4: Regenerate the lockfile with the repository's pnpm version**

Run: `pnpm install --lockfile-only`

Inspect: `git diff -- package.json pnpm-lock.yaml`

Expected: the root importer moves `typebox` from `dependencies` to `devDependencies` with specifier `^1.3.19` and resolved version `1.3.19`; no unrelated package resolutions change.

- [ ] **Step 5: Run the focused test and static checks**

Run: `pnpm vitest run tests/package-metadata.test.ts && pnpm typecheck`

Expected: the three parameterized metadata cases pass and TypeScript resolves all existing `typebox` imports without source changes.

- [ ] **Step 6: Run the complete repository checks**

Run: `pnpm check`

Expected: exit 0. The baseline before this change is 51 test files and 511 passing tests; existing non-failing Biome warnings are unrelated and must not be edited as part of this task.

- [ ] **Step 7: Verify the package artifact preserves the contract**

Pack to a `mktemp -d` directory with `pnpm pack --pack-destination <temp-dir>`. Extract `package/package.json` from the generated tarball and verify:

- `dependencies.typebox` is absent.
- `peerDependencies.typebox` is exactly `"*"`.
- `devDependencies.typebox` is present in the source manifest for local development but is not required in the installed production dependency graph.
- No nested `node_modules/typebox` is included in the tarball.

- [ ] **Step 8: Smoke-test the local extension with Pi**

Launch an isolated interactive Pi process from the repository:

```bash
SMOKE_ROOT=$(mktemp -d)
XDG_CONFIG_HOME="$SMOKE_ROOT/config" \
  PI_CODING_AGENT_DIR="$SMOKE_ROOT/agent" \
  PI_PACKAGE_DIR="$SMOKE_ROOT/packages" \
  pi --offline --no-session --no-extensions --no-skills \
    --no-prompt-templates --no-themes -e "$PWD"
```

At the prompt, enter `dcp:help`, confirm Pi displays the DCP command help, then exit. Startup must emit no extension load error. This validates that moving `typebox` out of runtime dependencies did not break local loading; the npm-install warning itself is conclusively covered by the manifest test and packed-manifest inspection until a corrected release is installed.

- [ ] **Step 9: Review the final diff and commit**

Run: `git diff --check && git status --short`

Expected: only `package.json`, `pnpm-lock.yaml`, and `tests/package-metadata.test.ts` are implementation changes; this plan document may also be present if it is committed with the work.

```bash
git add package.json pnpm-lock.yaml tests/package-metadata.test.ts
git commit -m "fix: declare typebox as a host-provided peer"
```
