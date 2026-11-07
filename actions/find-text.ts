import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { findText } from "../shared/reprint/find.js";
import { measureText } from "../server/lib/fonts.js";
import { requireDoc } from "../server/lib/reprint.js";
import { rectSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Find printed text in a document (case-insensitive). Each match has a tight bounding box (pt, top-left origin) computed from the text runs and font measurement, so it can be passed to create-patch as target.",
  schema: z.object({
    documentId: z.string().describe("Document id"),
    query: z.string().min(1).describe('Exact text to find, e.g. "Saturday, 5 December 2026"'),
    page: z.coerce.number().int().min(0).optional().describe("0-based page index; omit to search all pages"),
  }),
  outputSchema: z.object({
    matches: z.array(z.object({ page: z.number().int(), lineId: z.string(), lineText: z.string(), text: z.string(), bbox: rectSchema })),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ documentId, query, page }) => {
    const doc = await requireDoc(documentId, "viewer");
    const matches = findText(doc.pages, query, measureText, page).slice(0, 50);
    return { matches: matches.map(({ page, lineId, lineText, text, bbox }) => ({ page, lineId, lineText, text, bbox })) };
  },
});
