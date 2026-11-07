import { z } from "zod";

export const rectSchema = z.object({
  x: z.number().describe("Left edge, PDF points from the page's left"),
  y: z.number().describe("Top edge, PDF points from the page's top"),
  w: z.number().positive().describe("Width, PDF points"),
  h: z.number().positive().describe("Height, PDF points"),
});

export const warningSchema = z.object({
  code: z.string(),
  level: z.enum(["warn", "error", "info"]),
  message: z.string(),
});

export const layoutSchema = z.object({
  fontSize: z.number(),
  scaleX: z.number().optional(),
  lines: z.array(z.object({ text: z.string(), x: z.number(), baseline: z.number(), w: z.number() })),
});

export const patchSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  page: z.number().int(),
  rect: rectSchema,
  target: rectSchema,
  oldText: z.string(),
  newText: z.string(),
  fontFamily: z.enum(["sans", "serif", "mono"]),
  bold: z.boolean(),
  fontSize: z.number(),
  originalFontSize: z.number(),
  align: z.enum(["left", "right", "center"]),
  textColor: z.string(),
  bgColor: z.string(),
  border: z.boolean(),
  layout: layoutSchema,
  status: z.enum(["ok", "warn", "error"]),
  warnings: z.array(warningSchema),
  source: z.enum(["user", "agent"]),
});

export const lockSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  page: z.number().int(),
  rect: rectSchema,
  label: z.string(),
});

export const suggestionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  kind: z.enum(["related", "weekday", "past_date", "combo", "currency"]),
  severity: z.enum(["error", "warn", "info"]),
  page: z.number().int(),
  target: rectSchema,
  oldText: z.string(),
  suggestedText: z.string(),
  message: z.string(),
  status: z.enum(["open", "accepted", "dismissed"]),
});

export const lineSchema = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  fontSize: z.number(),
  fontFamily: z.enum(["sans", "serif", "mono"]),
  bold: z.boolean(),
  color: z.string(),
  runs: z.array(z.object({ text: z.string(), x: z.number(), w: z.number() })),
  fontName: z.string().optional(),
});

export const gridSchema = z.object({
  cell: z.number(),
  cols: z.number().int(),
  rows: z.number().int(),
  colors: z.array(z.string()),
  ink: z.array(z.string()),
  uniformity: z.array(z.number()),
});

export const pageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  lines: z.array(lineSchema),
  grid: gridSchema.nullable().optional(),
});

export const fitSummarySchema = z.object({
  status: z.enum(["ok", "warn", "error"]),
  warnings: z.array(z.string()),
});
