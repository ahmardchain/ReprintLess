import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { planSheet } from "../shared/reprint/labels.js";
import { getDb, schema } from "../server/db/index.js";
import { requireDoc } from "../server/lib/reprint.js";

export default defineAction({
  description:
    "Lay out the printable label sheet: every label at exact size (pt), shelf-packed on A4 or Letter with crop marks, plus a placement map per page. Returns the layout and downloadUrl for the PDF.",
  schema: z.object({
    documentId: z.string().describe("Document id"),
    paper: z.enum(["A4", "Letter"]).default("A4").describe('Sticker paper size: "A4" or "Letter"; defaults to "A4"'),
    gapMm: z.coerce.number().min(0).max(20).default(3).describe("Gap between labels in millimetres; defaults to 3"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    paper: z.enum(["A4", "Letter"]),
    sheets: z.number().int(),
    labels: z.array(z.object({ id: z.string(), label: z.string(), page: z.number().int(), sheet: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), status: z.string(), text: z.string() })),
    downloadUrl: z.string(),
    warnings: z.array(z.string()),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ documentId, paper, gapMm }) => {
    const doc = await requireDoc(documentId, "viewer");
    const rows = await getDb().select().from(schema.patches).where(eq(schema.patches.documentId, doc.id)).limit(500);
    if (rows.length === 0) fail("There are no labels to print yet.", { errorCode: "no_labels", statusCode: 404 });
    const { ordered, pack } = planSheet(rows, paper, gapMm);
    const at = new Map(pack.placements.map((p) => [p.id, p]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const labels = ordered.map((o) => {
      const p = at.get(o.id)!;
      const r = byId.get(o.id)!;
      return { id: o.id, label: o.label, page: o.page, sheet: p.sheet, x: p.x, y: p.y, w: p.w, h: p.h, status: r.status, text: r.newText };
    });
    const warnings = labels.filter((l) => l.status === "error").map((l) => `${l.label} ("${l.text}") still has a fit error; fix it before printing.`);
    return {
      documentId: doc.id,
      paper,
      sheets: pack.sheets,
      labels,
      downloadUrl: `/api/label-sheet/${encodeURIComponent(doc.id)}?paper=${paper}&gapMm=${gapMm}`,
      warnings,
    };
  },
});
