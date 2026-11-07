import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List the printed documents (flyers, menus) the current user can open, newest first.",
  schema: z.object({}),
  outputSchema: z.object({
    documents: z.array(z.object({ id: z.string(), name: z.string(), pageCount: z.number().int(), createdAt: z.string() })),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({ url: buildDeepLink({ view: "reprint", to: "/reprint" }), label: "Open ReprintLess" }),
  run: async () => {
    const d = schema.documents;
    const rows = await getDb()
      .select({ id: d.id, name: d.name, pageCount: d.pageCount, createdAt: d.createdAt })
      .from(d)
      .where(accessFilter(d, schema.documentShares))
      .orderBy(desc(d.createdAt))
      .limit(100);
    return { documents: rows.map((r) => ({ ...r, createdAt: String(r.createdAt) })) };
  },
});
