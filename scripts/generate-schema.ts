import { DcpConfigSchema } from "../src/config-schema.ts";

/**
 * Strip `required` arrays from the schema recursively.
 * TypeBox marks all Object properties as required, but this schema is for
 * user-facing dcp.json files where every property has a default and is optional.
 */
function stripRequired(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(stripRequired);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "required") continue;
    result[k] = stripRequired(v);
  }
  return result;
}

const schema = stripRequired({
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DCP Configuration",
  description: "Configuration schema for the pi-dcp extension",
  ...DcpConfigSchema,
});

console.log(JSON.stringify(schema, null, 2));
