import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDoc } from "../server/lib/reprint.js";

export default defineAction({
  description: "Delete a document with all its labels, locks and suggestions. Only ask to do this when the user explicitly wants it gone.",
  schema: z.object({ id: z.string().describe("Document id") }),
  outputSchema: z.object({ id: z.string(), deleted: z.boolean() }),
  agentTool: false,
  run: async ({ id }) => {
    await requireDoc(id, "owner");
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(schema.suggestions).where(eq(schema.suggestions.documentId, id));
      await tx.delete(schema.locks).where(eq(schema.locks.documentId, id));
      await tx.delete(schema.patches).where(eq(schema.patches.documentId, id));
      await tx.delete(schema.documentShares).where(eq(schema.documentShares.resourceId, id));
      await tx.delete(schema.documents).where(eq(schema.documents.id, id));
    });
    return { id, deleted: true };
  },
});
