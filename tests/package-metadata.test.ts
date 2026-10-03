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
});
