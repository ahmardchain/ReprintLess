import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { MAX_PAGES, type Page } from "../shared/reprint/types.js";
import { getDb, schema } from "../server/db/index.js";
import { docLink } from "../server/lib/params.js";
import { requireUser } from "../server/lib/reprint.js";
import { pageSchema } from "../server/lib/reprint-schemas.js";

export default defineAction({
  description:
    "Save a printed document's structured text extraction (made in the browser with PDF.js). UI only: the PDF bytes never leave the browser.",
  schema: z.object({
    name: z.string().min(1).max(200).describe('Document name, usually the PDF file name, e.g. "flyer.pdf"'),
    pages: z
      .array(pageSchema)
      .min(1)
      .max(MAX_PAGES)
      .describe("Pages in order: size in PDF points, text lines (top-left origin, pt) and the 12pt colour grid"),
  }),
  outputSchema: z.object({ id: z.string(), name: z.string(), pageCount: z.number().int() }),
  agentTool: false,
  link: ({ result }) => ({
    url: buildDeepLink({ view: "reprint", to: docLink(result.id), params: { documentId: result.id } }),
    label: `Open ${result.name}`,
  }),
  run: async (args, ctx) => {
    const who = requireUser(ctx);
    const chars = args.pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.text.trim().length, 0), 0);
    if (chars < 5) {
      fail("This PDF has no text layer (it looks scanned). ReprintLess works with text-based PDFs only.", {
        errorCode: "scanned_pdf",
        statusCode: 422,
      });
    }
    const id = crypto.randomUUID();
    await getDb()
      .insert(schema.documents)
      .values({
        id,
        name: args.name,
        pageCount: args.pages.length,
        pages: args.pages as Page[],
        ownerEmail: who.email,
        orgId: who.orgId,
        visibility: who.orgId ? "org" : "private",
      });
    return { id, name: args.name, pageCount: args.pages.length };
  },
});
