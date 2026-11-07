import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { rectRound } from "../shared/reprint/geometry.js";
import { getDb, schema } from "../server/db/index.js";
import { assertWeekdayMatches, patchOut, recheckPage, requireDoc, summarize } from "../server/lib/reprint.js";
import { fitSummarySchema, patchSchema, rectSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Change a label: move/resize it (rect), change its text, font size or alignment. Re-runs the fit check for every label on the page and returns the new status.",
  schema: z.object({
    id: z.string().describe("Patch id"),
    rect: rectSchema.optional().describe("New label box, PDF points, top-left origin"),
    newText: z.string().min(1).max(300).optional().describe("New label text, exactly as the user wrote it"),
    fontSize: z.coerce.number().min(6).max(200).optional().describe("Font size in pt (minimum 6)"),
    align: z.enum(["left", "right", "center"]).optional().describe('Text alignment: "left", "right" or "center"'),
  }),
  outputSchema: z.object({ id: z.string(), patch: patchSchema, fit: fitSummarySchema }),
  run: async (args) => {
    const db = getDb();
    const [row] = await db.select().from(schema.patches).where(eq(schema.patches.id, args.id)).limit(1);
    if (!row) fail("Label not found.", { errorCode: "not_found", statusCode: 404 });
    const doc = await requireDoc(row.documentId, "editor");
    if (args.newText) assertWeekdayMatches(doc, args.newText);
    const updated = await db.transaction(async (tx) => {
      await tx
        .update(schema.patches)
        .set({
          ...(args.rect ? { rect: rectRound(args.rect) } : {}),
          ...(args.newText ? { newText: args.newText } : {}),
          ...(args.fontSize ? { fontSize: args.fontSize } : {}),
          ...(args.align ? { align: args.align } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.patches.id, args.id));
      const rows = await recheckPage(tx, doc, row.page);
      return rows.find((r) => r.id === args.id)!;
    });
    return { id: updated.id, patch: patchOut(updated), fit: summarize(updated) };
  },
});
