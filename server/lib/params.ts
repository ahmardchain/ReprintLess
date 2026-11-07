import { z } from "zod";

/** Explicit boolean parser for HTTP/CLI params ("false" stays false). */
export const boolParam = (describe: string) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .describe(describe);

export const docLink = (documentId: string, extra: Record<string, string | number> = {}) => {
  const qs = new URLSearchParams(Object.entries(extra).map(([k, v]) => [k, String(v)])).toString();
  return `/reprint/${encodeURIComponent(documentId)}${qs ? `?${qs}` : ""}`;
};
