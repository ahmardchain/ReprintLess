import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "reprint-document",
  resourceTable: schema.documents,
  sharesTable: schema.documentShares,
  displayName: "Document",
  titleColumn: "name",
  getResourcePath: (doc) => `/reprint/${doc.id}`,
  getDb,
});
