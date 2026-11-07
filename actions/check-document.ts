import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { checkDocument } from "../shared/reprint/check.js";
import { getDb, schema } from "../server/db/index.js";
import { measureText } from "../server/lib/fonts.js";
import { requireDoc, requireUser, suggestionOut } from "../server/lib/reprint.js";
import { suggestionSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Find mistakes the user did NOT mark and replace the open suggestions: other mentions of a corrected value (dates matched in any format and re-formatted in each mention's own format), weekday/date mismatches, past dates, combo prices that stop adding up, and mixed currency symbols. Run after every patch change. Dismissed suggestions stay dismissed.",
  schema: z.object({ documentId: z.string().describe("Document id") }),
  outputSchema: z.object({
    documentId: z.string(),
    suggestions: z.array(suggestionSchema),
    counts: z.record(z.string(), z.number()),
    summary: z.string(),
  }),
  run: async ({ documentId }, ctx) => {
    const who = requireUser(ctx);
    const doc = await requireDoc(documentId, "editor");
    const db = getDb();
    const now = new Date();
    const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    return db.transaction(async (tx) => {
      const patches = await tx.select().from(schema.patches).where(eq(schema.patches.documentId, documentId)).limit(500);
      const previous = await tx.select().from(schema.suggestions).where(eq(schema.suggestions.documentId, documentId)).limit(1000);
      const closed = new Set(previous.filter((s) => s.status === "dismissed").map((s) => `${s.kind}|${s.page}|${s.oldText}|${s.suggestedText}`));
      const drafts = checkDocument(doc, patches, measureText, today).filter(
        (d) => !closed.has(`${d.kind}|${d.page}|${d.oldText}|${d.suggestedText}`),
      );
      await tx.delete(schema.suggestions).where(and(eq(schema.suggestions.documentId, documentId), eq(schema.suggestions.status, "open")));
      const rows = drafts.slice(0, 200).map((d) => ({
        id: crypto.randomUUID(),
        documentId,
        ...d,
        status: "open" as const,
        ownerEmail: who.email,
        orgId: doc.orgId ?? who.orgId,
      }));
      if (rows.length) await tx.insert(schema.suggestions).values(rows);
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
      const summary = rows.length
        ? `${rows.length} thing${rows.length === 1 ? "" : "s"} to review: ${rows.slice(0, 4).map((r) => r.message).join(" ")}`
        : "Nothing else needs changing.";
      return {
        documentId,
        suggestions: rows.map((r) => suggestionOut({ ...r, createdAt: now.toISOString() })),
        counts,
        summary,
      };
    });
  },
});
