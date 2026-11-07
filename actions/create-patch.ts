import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { docLink } from "../server/lib/params.js";
import {
  assertWeekdayMatches,
  insertPatch,
  patchOut,
  planPatch,
  requireDoc,
  requireUser,
  resolveTarget,
  summarize,
} from "../server/lib/reprint.js";
import { fitSummarySchema, patchSchema, rectSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Mark a printed mistake and propose its cover-up label in one call. Give the mistake as target (bbox in pt) or findText. The label is the target plus 2pt bleed, widened to fit newText at the original font size, with background and text colour matched from the page, then fit-checked (status ok/warn/error). Fails with weekday_mismatch when newText names a weekday that doesn't match its date; ask the user which option they mean.",
  schema: z.object({
    documentId: z.string().describe("Document id"),
    page: z.coerce.number().int().min(0).optional().describe("0-based page index; required with target, optional with findText"),
    target: rectSchema.optional().describe("Box around the wrong text, PDF points, top-left origin"),
    findText: z.string().min(1).optional().describe("The wrong printed text exactly as printed; used to locate the target"),
    occurrence: z.coerce.number().int().min(0).optional().describe("0-based match index when findText appears more than once"),
    newText: z.string().min(1).max(300).describe("The correct text exactly as the user wrote it; never reword or abbreviate"),
    align: z.enum(["left", "right", "center"]).optional().describe('Text alignment in the label; defaults to "right" for prices at the right edge, else "left"'),
  }),
  outputSchema: z.object({
    id: z.string(),
    patch: patchSchema,
    fit: fitSummarySchema,
    nextRequiredAction: z.string(),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({
      view: "reprint",
      to: docLink(result.patch.documentId, { page: result.patch.page, patch: result.id }),
      params: { documentId: result.patch.documentId, page: result.patch.page, patchId: result.id },
    }),
    label: "Open label",
  }),
  run: async (args, ctx) => {
    const who = requireUser(ctx);
    const doc = await requireDoc(args.documentId, "editor");
    const resolved = resolveTarget(doc, args.page, args);
    assertWeekdayMatches(doc, args.newText);
    const plan = planPatch(doc, resolved.page, resolved.target, args.newText, { oldText: resolved.oldText, align: args.align });
    const source = ctx?.caller === "frontend" ? "user" : "agent";
    const row = await getDb().transaction((tx) => insertPatch(tx, doc, plan, who, source));
    return {
      id: row.id,
      patch: patchOut(row),
      fit: summarize(row),
      nextRequiredAction: row.status === "error" ? "reflow-patch" : "check-document",
    };
  },
});
