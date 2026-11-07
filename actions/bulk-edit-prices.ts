import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { planPriceEdits } from "../shared/reprint/check.js";
import { overlaps } from "../shared/reprint/geometry.js";
import { getDb, schema } from "../server/db/index.js";
import { measureText } from "../server/lib/fonts.js";
import { boolParam } from "../server/lib/params.js";
import { insertPatch, planPatch, requireDoc, requireUser } from "../server/lib/reprint.js";
import { rectSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Change every price in a document by a percentage, rounded to the nearest roundTo (e.g. +10%, nearest ₦50). Parses ₦, N, $, £, € with commas and computes in exact integer minor units. dryRun (default true) previews; dryRun false creates all labels in one transaction (right-aligned for prices at the right edge). Prices already under a label are skipped. Run check-document afterwards to catch combos.",
  schema: z.object({
    documentId: z.string().describe("Document id"),
    percent: z.coerce.number().min(-90).max(500).describe("Change in percent, e.g. 10 for +10%, -5 for -5%"),
    roundTo: z.coerce.number().positive().max(100000).default(1).describe("Round to the nearest this many major units (50 = nearest ₦50, 0.05 = nearest 5 cents); defaults to 1"),
    dryRun: boolParam("true previews without writing; false creates the labels. Defaults to true").default(true),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    dryRun: z.boolean(),
    edits: z.array(z.object({ page: z.number().int(), target: rectSchema, oldText: z.string(), newText: z.string(), align: z.enum(["left", "right"]), skipped: z.string().optional(), patchId: z.string().optional(), status: z.string().optional() })),
    created: z.number().int(),
    nextRequiredAction: z.string().optional(),
  }),
  run: async (args, ctx) => {
    const who = requireUser(ctx);
    const doc = await requireDoc(args.documentId, "editor");
    const db = getDb();
    const existing = await db.select({ page: schema.patches.page, target: schema.patches.target }).from(schema.patches).where(eq(schema.patches.documentId, doc.id)).limit(500);
    const planned = planPriceEdits(doc, args.percent, args.roundTo, measureText).map((e) => ({
      ...e,
      skipped: existing.some((p) => p.page === e.page && overlaps(p.target, e.target, 0.5)) ? "already has a label" : undefined,
    }));
    if (planned.length === 0) fail("No prices found that this change would alter.", { errorCode: "no_prices", statusCode: 404 });
    const view = (e: (typeof planned)[number]) => ({ page: e.page, target: e.target, oldText: e.oldText, newText: e.newText, align: e.align, ...(e.skipped ? { skipped: e.skipped } : {}) });
    if (args.dryRun) return { documentId: doc.id, dryRun: true, edits: planned.map(view), created: 0 };
    const source = ctx?.caller === "frontend" ? "user" : "agent";
    const results = await db.transaction(async (tx) => {
      const out = [];
      for (const e of planned) {
        if (e.skipped) {
          out.push(view(e));
          continue;
        }
        const plan = planPatch(doc, e.page, e.target, e.newText, { oldText: e.oldText, align: e.align });
        const row = await insertPatch(tx, doc, plan, who, source);
        out.push({ ...view(e), patchId: row.id, status: row.status });
      }
      return out;
    });
    return {
      documentId: doc.id,
      dryRun: false,
      edits: results,
      created: results.filter((r) => "patchId" in r && r.patchId).length,
      nextRequiredAction: "check-document",
    };
  },
});
