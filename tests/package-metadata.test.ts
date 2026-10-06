import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const manifest: PackageManifest = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);

const hostProvidedPackages = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "typebox",
] as const;

describe("package metadata", () => {
  it.each(hostProvidedPackages)(
    "declares %s as a host-provided development peer",
    (packageName) => {
      expect(manifest.dependencies?.[packageName]).toBeUndefined();
      expect(manifest.peerDependencies?.[packageName]).toBe("*");
      expect(manifest.devDependencies?.[packageName]).toBeDefined();
    },
  );

  it("declares @earendil-works/pi-tui as a host-provided peer pinned to ^1.0.1 for development", () => {
    expect(manifest.dependencies?.["@earendil-works/pi-tui"]).toBeUndefined();
    expect(manifest.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
    expect(manifest.devDependencies?.["@earendil-works/pi-tui"]).toBe("^1.0.1");
  });

  it("locks @earendil-works/pi-tui at v1.0.1", () => {
    const lockfile = fs.readFileSync(
      fileURLToPath(new URL("../pnpm-lock.yaml", import.meta.url)),
      "utf8",
    );
    expect(lockfile).toContain("'@earendil-works/pi-tui@1.0.1':");
  });
});
