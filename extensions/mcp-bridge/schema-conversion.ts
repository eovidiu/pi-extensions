import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";

interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: unknown;
}

export function convertMcpInputSchema(schema: unknown): TSchema {
  if (!isObject(schema)) throw new Error("inputSchema must be an object");
  const typed = schema as JsonSchema;
  if (schemaType(typed) !== "object") throw new Error("Only object top-level input schemas are supported");
  return convertObjectSchema(typed, "root");
}

function convertSchema(schema: JsonSchema, path: string): TSchema {
  if (Array.isArray(schema.type)) throw new Error(`Unsupported union type at ${path}`);

  if (schema.enum) {
    if (schema.enum.length === 0) throw new Error(`Unsupported empty enum at ${path}`);
    if (schema.enum.every((value): value is string => typeof value === "string")) {
      return withDescription(StringEnum(schema.enum as [string, ...string[]]), schema.description);
    }
    throw new Error(`Unsupported non-string enum at ${path}`);
  }

  switch (schemaType(schema)) {
    case "string":
      return withDescription(Type.String(), schema.description);
    case "number":
      return withDescription(Type.Number(), schema.description);
    case "integer":
      return withDescription(Type.Integer(), schema.description);
    case "boolean":
      return withDescription(Type.Boolean(), schema.description);
    case "array": {
      const items = schema.items ? convertSchema(schema.items, `${path}[]`) : Type.Any();
      return withDescription(Type.Array(items), schema.description);
    }
    case "object":
      return convertObjectSchema(schema, path);
    default:
      throw new Error(`Unsupported or missing type at ${path}`);
  }
}

function convertObjectSchema(schema: JsonSchema, path: string): TSchema {
  if (hasComplexCombinators(schema)) throw new Error(`Unsupported schema combinator at ${path}`);
  const required = new Set(schema.required ?? []);
  const props: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    if (hasComplexCombinators(value)) throw new Error(`Unsupported schema combinator at ${path}.${key}`);
    const converted = convertSchema(value, `${path}.${key}`);
    props[key] = required.has(key) ? converted : Type.Optional(converted);
  }
  return withDescription(Type.Object(props), schema.description);
}

function schemaType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return undefined;
  if (schema.type) return schema.type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return undefined;
}

function hasComplexCombinators(schema: unknown): boolean {
  if (!isObject(schema)) return false;
  return "oneOf" in schema || "anyOf" in schema || "allOf" in schema || "$ref" in schema;
}

function withDescription<T extends TSchema>(schema: T, description: string | undefined): T {
  if (description) (schema as unknown as { description?: string }).description = description;
  return schema;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
