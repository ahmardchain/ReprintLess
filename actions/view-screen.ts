import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDoc } from "../server/lib/reprint.js";

export default defineAction({
  description:
    "Read the current navigation state and, on a ReprintLess document, a short summary of what is visible: page, labels with status, locks and open suggestions. Basic navigation is already included in <current-screen>; use this action only when you need a fresh read.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = (await readAppState("navigation")) as { documentId?: string; page?: number; patchId?: string } | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    if (navigation?.documentId) {
      try {
        const doc = await requireDoc(navigation.documentId, "viewer");
        const page = navigation.page ?? 0;
        const db = getDb();
        const [patches, locks, open] = await Promise.all([
          db.select({ id: schema.patches.id, page: schema.patches.page, oldText: schema.patches.oldText, newText: schema.patches.newText, status: schema.patches.status }).from(schema.patches).where(eq(schema.patches.documentId, doc.id)).limit(100),
          db.select({ id: schema.locks.id, page: schema.locks.page, label: schema.locks.label }).from(schema.locks).where(eq(schema.locks.documentId, doc.id)).limit(100),
          db.select({ id: schema.suggestions.id, kind: schema.suggestions.kind, message: schema.suggestions.message }).from(schema.suggestions).where(and(eq(schema.suggestions.documentId, doc.id), eq(schema.suggestions.status, "open"))).limit(50),
        ]);
        screen.document = {
          id: doc.id,
          name: doc.name,
          pageCount: doc.pages.length,
          page,
          selectedPatchId: navigation.patchId ?? null,
          patches,
          locks,
          openSuggestions: open,
        };
      } catch {
        screen.document = { id: navigation.documentId, error: "not available" };
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
