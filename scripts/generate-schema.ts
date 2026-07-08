import { DcpConfigSchema } from "../src/config-schema.ts";

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "DCP Configuration",
  description: "Configuration schema for the pi-dcp extension",
  ...DcpConfigSchema,
};

console.log(JSON.stringify(schema, null, 2));
