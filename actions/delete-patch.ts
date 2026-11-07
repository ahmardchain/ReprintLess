import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { recheckPage, requireDoc } from "../server/lib/reprint.js";

export default defineAction({
  description: "Delete a label. Other labels on the page are re-checked (an overlap may clear).",
  schema: z.object({ id: z.string().describe("Patch id") }),
  outputSchema: z.object({ id: z.string(), deleted: z.boolean() }),
  run: async ({ id }) => {
    const db = getDb();
    const [row] = await db.select().from(schema.patches).where(eq(schema.patches.id, id)).limit(1);
    if (!row) fail("Label not found.", { errorCode: "not_found", statusCode: 404 });
    const doc = await requireDoc(row.documentId, "editor");
    await db.transaction(async (tx) => {
      await tx.delete(schema.patches).where(eq(schema.patches.id, id));
      await recheckPage(tx, doc, row.page);
    });
    return { id, deleted: true };
  },
});
