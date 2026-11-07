import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { overlaps } from "../shared/reprint/geometry.js";
import { reflowPatch } from "../shared/reprint/reflow.js";
import { getDb, schema } from "../server/db/index.js";
import {
  assertWeekdayMatches,
  fitContext,
  geometryOf,
  insertPatch,
  lockGeometry,
  pageChildren,
  patchOut,
  planPatch,
  recheckPage,
  requireDoc,
  requirePage,
  requireUser,
  suggestionOut,
} from "../server/lib/reprint.js";
import { patchSchema, suggestionSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Accept or dismiss a suggestion from check-document. Accept creates a label with the suggested text (or newText), or updates the label already on that spot, and auto-fixes it if it doesn't fit. Dismiss hides it for good.",
  schema: z.object({
    id: z.string().describe("Suggestion id"),
    decision: z.enum(["accept", "dismiss"]).describe('"accept" or "dismiss"'),
    newText: z.string().min(1).max(300).optional().describe("Text to use instead of the suggested text (required for suggestions without one, e.g. past dates)"),
  }),
  outputSchema: z.object({
    id: z.string(),
    suggestion: suggestionSchema,
    patch: patchSchema.nullable(),
    reflow: z.string().nullable(),
    nextRequiredAction: z.string().optional(),
  }),
  run: async (args, ctx) => {
    const who = requireUser(ctx);
    const db = getDb();
    const [s] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, args.id)).limit(1);
    if (!s) fail("Suggestion not found.", { errorCode: "not_found", statusCode: 404 });
    const doc = await requireDoc(s.documentId, "editor");
    if (s.status !== "open") fail(`This suggestion is already ${s.status}.`, { errorCode: "already_resolved", statusCode: 409 });
    if (args.decision === "dismiss") {
      await db.update(schema.suggestions).set({ status: "dismissed" }).where(eq(schema.suggestions.id, s.id));
      return { id: s.id, suggestion: suggestionOut({ ...s, status: "dismissed" }), patch: null, reflow: null };
    }
    const text = (args.newText ?? s.suggestedText).trim();
    if (!text) fail("This suggestion has no replacement text; pass newText.", { errorCode: "needs_text" });
    assertWeekdayMatches(doc, text);
    const source = ctx?.caller === "frontend" ? "user" : "agent";
    return db.transaction(async (tx) => {
      const { patchRows } = await pageChildren(tx, doc.id, s.page);
      const existing = patchRows.find((p) => overlaps(p.target, s.target, 0.5));
      let patchId: string;
      if (existing) {
        await tx.update(schema.patches).set({ newText: text, updatedAt: new Date().toISOString() }).where(eq(schema.patches.id, existing.id));
        patchId = existing.id;
        await recheckPage(tx, doc, s.page);
      } else {
        const plan = planPatch(doc, s.page, s.target, text, { oldText: s.oldText });
        patchId = (await insertPatch(tx, doc, plan, who, source)).id;
      }
      let reflow: string | null = null;
      let { patchRows: rows, lockRows } = await pageChildren(tx, doc.id, s.page);
      let row = rows.find((r) => r.id === patchId)!;
      if (row.status === "error") {
        const res = reflowPatch(geometryOf(row), fitContext(requirePage(doc, s.page), row, rows.map((r) => ({ id: r.id, rect: r.rect })), lockRows.map(lockGeometry)));
        reflow = res.explanation;
        if (res.changed) {
          await tx.update(schema.patches).set({ rect: res.rect, fontSize: res.fontSize }).where(eq(schema.patches.id, patchId));
          rows = await recheckPage(tx, doc, s.page);
          row = rows.find((r) => r.id === patchId)!;
        }
      }
      await tx.update(schema.suggestions).set({ status: "accepted" }).where(eq(schema.suggestions.id, s.id));
      return {
        id: s.id,
        suggestion: suggestionOut({ ...s, status: "accepted" }),
        patch: patchOut(row),
        reflow,
        nextRequiredAction: "check-document",
      };
    });
  },
});
