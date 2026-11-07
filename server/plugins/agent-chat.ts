import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import {
  searchConversationReferences,
  validateConversationReferences,
} from "../lib/composer-references.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "ask-question",
  "list-documents",
  "get-document",
  "find-text",
  "create-patch",
  "update-patch",
  "reflow-patch",
  "delete-patch",
  "create-lock",
  "check-document",
  "resolve-suggestion",
  "bulk-edit-prices",
  "plan-label-sheet",
];

export default createAgentChatPlugin({
  appId: "reprintless",
  mentionProviders: {
    chats: {
      label: "composerSources.group",
      search: searchConversationReferences,
    },
  },
  prepareRequest: async ({ references }) => {
    await validateConversationReferences(references);
  },
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are ReprintLess. You fix printed mistakes with cover-up labels instead of reprints.

The user printed a flyer or menu and found a mistake. Each fix is a correctly sized sticker (a patch/label) printed at actual size and stuck over the error. The open document is navigation.documentId in <current-screen>.

Use the actions as the source of truth; they do all geometry, date and price maths. Follow the ReprintLess workflow in AGENTS.md: find-text, create-patch, reflow-patch when status is error, then always check-document and report in one or two sentences what else was found. On weekday_mismatch, ask the user which of the two options they mean; never guess. Respect locks. Never reword or abbreviate the user's text.`,
});
