import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { reflowPatch } from "../shared/reprint/reflow.js";
import { getDb, schema } from "../server/db/index.js";
import { fitContext, geometryOf, lockGeometry, pageChildren, patchOut, recheckPage, requireDoc, requirePage, summarize } from "../server/lib/reprint.js";
import { fitSummarySchema, patchSchema, rectSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Fix a label that doesn't fit (status error). Tries a slight shrink (up to 15%), growing into free space right/left/down, wrapping to 2 lines, and a bigger shrink down to 6pt; rejects anything that covers a lock, other printed text or another label; applies the lowest-penalty option. Returns changed and a one-sentence explanation.",
  schema: z.object({ id: z.string().describe("Patch id") }),
  outputSchema: z.object({
    id: z.string(),
    changed: z.boolean(),
    explanation: z.string(),
    before: z.object({ rect: rectSchema, fontSize: z.number() }),
    patch: patchSchema,
    fit: fitSummarySchema,
    nextRequiredAction: z.string(),
  }),
  run: async ({ id }) => {
    const db = getDb();
    const [row] = await db.select().from(schema.patches).where(eq(schema.patches.id, id)).limit(1);
    if (!row) fail("Label not found.", { errorCode: "not_found", statusCode: 404 });
    const doc = await requireDoc(row.documentId, "editor");
    const page = requirePage(doc, row.page);
    return db.transaction(async (tx) => {
      const { patchRows, lockRows } = await pageChildren(tx, doc.id, row.page);
      const others = patchRows.map((p) => ({ id: p.id, rect: p.rect }));
      const res = reflowPatch(geometryOf(row), fitContext(page, row, others, lockRows.map(lockGeometry)));
      if (res.changed) {
        await tx
          .update(schema.patches)
          .set({ rect: res.rect, fontSize: res.fontSize, updatedAt: new Date().toISOString() })
          .where(eq(schema.patches.id, id));
      }
      const rows = await recheckPage(tx, doc, row.page);
      const updated = rows.find((r) => r.id === id)!;
      return {
        id,
        changed: res.changed,
        explanation: res.explanation,
        before: { rect: row.rect, fontSize: row.fontSize },
        patch: patchOut(updated),
        fit: summarize(updated),
        nextRequiredAction: "check-document",
      };
    });
  },
});
