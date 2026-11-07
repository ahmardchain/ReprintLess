import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { createError, defineEventHandler, getQuery, getRouterParam, setResponseHeader } from "h3";

import { getDb, schema } from "../../../db/index.js";
import { buildLabelSheet } from "../../../lib/label-sheet.js";
import { requireDoc } from "../../../lib/reprint.js";

/** Binary PDF download of the label sheet (the one non-JSON endpoint). */
export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing id" });
  const q = getQuery(event);
  const paper = q.paper === "Letter" ? "Letter" : "A4";
  const gapMm = Math.min(20, Math.max(0, Number(q.gapMm ?? 3) || 0));

  const result = await runWithRequestContext({ userEmail: session.email, ...(session.orgId ? { orgId: session.orgId } : {}) }, async () => {
    let doc;
    try {
      doc = await requireDoc(id, "viewer");
    } catch {
      return null;
    }
    const rows = await getDb().select().from(schema.patches).where(eq(schema.patches.documentId, doc.id)).limit(500);
    const bytes = await buildLabelSheet({
      documentName: doc.name,
      pages: doc.pages,
      patches: rows,
      paper,
      gapMm,
    });
    return { bytes, name: doc.name };
  });
  if (!result) throw createError({ statusCode: 404, statusMessage: "Document not found" });
  const file = `${result.name.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "-")}-labels.pdf`;
  setResponseHeader(event, "Content-Type", "application/pdf");
  setResponseHeader(event, "Content-Disposition", `attachment; filename="${file}"`);
  setResponseHeader(event, "Cache-Control", "no-store");
  return Buffer.from(result.bytes);
});
