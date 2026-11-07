import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { inflate, rectRound } from "../shared/reprint/geometry.js";
import { getDb, schema } from "../server/db/index.js";
import { lockOut, recheckPage, requireDoc, requireUser, resolveTarget } from "../server/lib/reprint.js";
import { lockSchema, rectSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Lock an area labels must never cover (a venue, logo, QR code). Give rect (pt) or findText. Every label on the page is re-checked; labels now covering the lock turn red.",
  schema: z.object({
    documentId: z.string().describe("Document id"),
    page: z.coerce.number().int().min(0).optional().describe("0-based page index; required with rect"),
    rect: rectSchema.optional().describe("Area to protect, PDF points, top-left origin"),
    findText: z.string().min(1).optional().describe("Printed text to protect; its box plus 1pt is locked"),
    occurrence: z.coerce.number().int().min(0).optional().describe("0-based match index when findText appears more than once"),
    label: z.string().max(80).optional().describe('Short name for the locked area, e.g. "Venue"'),
  }),
  outputSchema: z.object({
    id: z.string(),
    lock: lockSchema,
    affectedPatches: z.array(z.object({ id: z.string(), status: z.enum(["ok", "warn", "error"]) })),
  }),
  run: async (args, ctx) => {
    const who = requireUser(ctx);
    const doc = await requireDoc(args.documentId, "editor");
    const resolved = resolveTarget(doc, args.page, { target: args.rect, findText: args.findText, occurrence: args.occurrence });
    const rect = args.rect ? rectRound(args.rect) : rectRound(inflate(resolved.target, 1));
    const lock = {
      id: crypto.randomUUID(),
      documentId: doc.id,
      page: resolved.page,
      rect,
      label: args.label ?? resolved.oldText ?? "",
      ownerEmail: who.email,
      orgId: doc.orgId ?? who.orgId,
    };
    const rows = await getDb().transaction(async (tx) => {
      await tx.insert(schema.locks).values(lock);
      return recheckPage(tx, doc, lock.page);
    });
    return {
      id: lock.id,
      lock: lockOut({ ...lock, createdAt: new Date().toISOString() }),
      affectedPatches: rows.map((r) => ({ id: r.id, status: r.status })),
    };
  },
});
