import { DcpConfigSchema } from "../src/config-schema.ts";

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DCP Configuration",
  description: "Configuration schema for the pi-dcp extension",
  ...DcpConfigSchema,
};

// Strip `required` arrays — all properties have defaults, so everything is optional in user configs
console.log(
  JSON.stringify(schema, (k, v) => (k === "required" ? undefined : v), 2),
);
