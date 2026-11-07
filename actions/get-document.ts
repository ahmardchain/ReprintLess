import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { boolParam, docLink } from "../server/lib/params.js";
import { lockOut, patchOut, requireDoc, suggestionOut } from "../server/lib/reprint.js";
import { lineSchema, lockSchema, patchSchema, suggestionSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Summarize a document: pages (size in pt), every patch (label) with its fit status, locks, and open suggestions. Pass includeLines to also get the text lines with their boxes (pt, top-left origin).",
  schema: z.object({
    id: z.string().describe("Document id from list-documents or <current-screen> documentId"),
    includeLines: boolParam("true to include every text line per page; defaults to false").optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    pages: z.array(z.object({ index: z.number().int(), width: z.number(), height: z.number(), lineCount: z.number().int(), lines: z.array(lineSchema).optional() })),
    patches: z.array(patchSchema),
    locks: z.array(lockSchema),
    suggestions: z.array(suggestionSchema),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ args }) => ({
    url: buildDeepLink({ view: "reprint", to: docLink(args.id), params: { documentId: args.id } }),
    label: "Open document",
  }),
  run: async ({ id, includeLines }) => {
    const doc = await requireDoc(id, "viewer");
    const db = getDb();
    const [patches, locks, suggestions] = await Promise.all([
      db.select().from(schema.patches).where(eq(schema.patches.documentId, id)).orderBy(schema.patches.page, schema.patches.createdAt).limit(500),
      db.select().from(schema.locks).where(eq(schema.locks.documentId, id)).limit(500),
      db
        .select()
        .from(schema.suggestions)
        .where(and(eq(schema.suggestions.documentId, id), eq(schema.suggestions.status, "open")))
        .limit(200),
    ]);
    return {
      id: doc.id,
      name: doc.name,
      pages: doc.pages.map((p, index) => ({
        index,
        width: p.width,
        height: p.height,
        lineCount: p.lines.length,
        ...(includeLines ? { lines: p.lines } : {}),
      })),
      patches: patches.map(patchOut),
      locks: locks.map(lockOut),
      suggestions: suggestions.map(suggestionOut),
    };
  },
});
