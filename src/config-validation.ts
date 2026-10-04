import { Value } from "typebox/value";
import { DcpConfigSchema } from "./config-schema.ts";

/**
 * Schema-guided sanitization for one parsed configuration layer.
 *
 * Invalid or unknown fields are omitted (never aborting startup) so a higher
 * precedence layer cannot erase a valid value from a lower one merely by being
 * malformed. Valid siblings are always retained.
 */
export function sanitizeConfigLayer(
  value: Record<string, unknown>,
  sourcePath: string,
): { value: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const sanitized = sanitizeNode(
    DcpConfigSchema as unknown as Schema,
    value,
    "",
    sourcePath,
    warnings,
  );
  return {
    value: (isPlainObject(sanitized) ? sanitized : {}) as Record<string, unknown>,
    warnings,
  };
}

type Schema = Record<string, unknown>;

function sanitizeNode(
  schema: Schema,
  value: unknown,
  pointer: string,
  sourcePath: string,
  warnings: string[],
): unknown {
  if (isDeclaredObjectSchema(schema)) {
    if (!isPlainObject(value))
      return warnAndOmit(pointer, sourcePath, warnings, "Expected an object");
    const result: Record<string, unknown> = {};
    const properties = schema.properties as Record<string, Schema>;
    for (const [key, childValue] of Object.entries(value)) {
      const childPointer = joinPointer(pointer, key);
      if (isUnsafeKey(key)) {
        warnAndOmit(childPointer, sourcePath, warnings, "Unsafe configuration key");
        continue;
      }
      const propertySchema = properties[key];
      if (propertySchema === undefined) {
        warnAndOmit(childPointer, sourcePath, warnings, "Unknown configuration key");
        continue;
      }
      const sanitized = sanitizeNode(
        propertySchema,
        childValue,
        childPointer,
        sourcePath,
        warnings,
      );
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }

  if (isRecordSchema(schema)) {
    if (!isPlainObject(value))
      return warnAndOmit(pointer, sourcePath, warnings, "Expected an object");
    const valueSchema = Object.values(schema.patternProperties as Record<string, Schema>)[0];
    if (valueSchema === undefined) return value;
    const result: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
      if (isUnsafeKey(key)) {
        warnAndOmit(joinPointer(pointer, key), sourcePath, warnings, "Unsafe configuration key");
        continue;
      }
      const sanitized = sanitizeNode(
        valueSchema,
        childValue,
        joinPointer(pointer, key),
        sourcePath,
        warnings,
      );
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }

  if (!Value.Check(schema, value)) {
    for (const invalidPointer of invalidPointers(schema, value, pointer)) {
      warnAndOmit(invalidPointer, sourcePath, warnings, "Invalid value");
    }
    return undefined;
  }

  if (isContextLimitSchema(schema)) {
    const problem = contextLimitProblem(value);
    if (problem !== undefined) return warnAndOmit(pointer, sourcePath, warnings, problem);
  }

  return value;
}

function warnAndOmit(
  pointer: string,
  sourcePath: string,
  warnings: string[],
  message: string,
): undefined {
  warnings.push(`${sourcePath}#${pointer}: ${message}`);
  return undefined;
}

function invalidPointers(schema: Schema, value: unknown, basePointer: string): string[] {
  const pointers = new Set<string>();
  for (const error of Value.Errors(schema, value)) {
    const relative = error.instancePath ?? "";
    pointers.add(relative ? `${basePointer}${relative}` : basePointer);
  }
  if (pointers.size === 0) pointers.add(basePointer);
  return [...pointers];
}

function contextLimitProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (!match) return "Invalid context limit";
  const percent = Number.parseFloat(match[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return "Context limit percentage must be greater than 0 and no greater than 100";
  }
  return undefined;
}

function isDeclaredObjectSchema(schema: Schema): boolean {
  return schema.type === "object" && isPlainObject(schema.properties);
}

function isRecordSchema(schema: Schema): boolean {
  return schema.type === "object" && isPlainObject(schema.patternProperties);
}

function isContextLimitSchema(schema: Schema): boolean {
  const branches = schema.anyOf;
  if (!Array.isArray(branches) || branches.length !== 2) return false;
  return (
    branches.some(
      (branch) => isPlainObject(branch) && branch.type === "integer" && branch.minimum === 1,
    ) &&
    branches.some(
      (branch) =>
        isPlainObject(branch) &&
        branch.type === "string" &&
        branch.pattern === "^\\d+(?:\\.\\d+)?%$",
    )
  );
}

function joinPointer(pointer: string, key: string): string {
  return `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}
