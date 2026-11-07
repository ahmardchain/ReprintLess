import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view or path. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z.string().optional().describe("View name to navigate to"),
    path: z.string().optional().describe("URL path to navigate to"),
    threadId: z.string().optional().describe("Chat thread ID to open"),
    documentId: z.string().optional().describe('ReprintLess document id to open (with view "reprint")'),
    page: z.coerce.number().int().min(0).optional().describe("0-based page of the document to show"),
    patchId: z.string().optional().describe("Label (patch) id to select"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path && !args.documentId) {
      throw new Error("At least --view, --path or --documentId is required.");
    }
    const nav: Record<string, string | number> = {};
    if (args.view) nav.view = args.view;
    if (args.path) nav.path = args.path;
    if (args.threadId) nav.threadId = args.threadId;
    if (args.documentId) {
      nav.view = args.view ?? "reprint";
      nav.documentId = args.documentId;
      if (args.page !== undefined) nav.page = args.page;
      if (args.patchId) nav.patchId = args.patchId;
    }
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}`;
  },
});
