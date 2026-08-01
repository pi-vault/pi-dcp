import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});

if (result.error || result.status !== 0) {
  throw new Error(
    `npm pack failed (${result.status}): ${result.stderr || result.error?.message}`,
  );
}

const [report] = JSON.parse(result.stdout);
const files = report.files.map(({ path }) => path);
const required = [
  "src/index.ts",
  "dcp.schema.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
];
const allowed = new Set([...required, "package.json"]);
const unexpected = files.filter(
  (file) =>
    !allowed.has(file) &&
    !file.startsWith("src/") &&
    !file.startsWith("docs/assets/"),
);
const missing = required.filter((file) => !files.includes(file));

if (missing.length || unexpected.length) {
  throw new Error(
    [
      missing.length && `Missing: ${missing.join(", ")}`,
      unexpected.length && `Unexpected: ${unexpected.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

console.log(`Package contents verified (${files.length} files)`);
