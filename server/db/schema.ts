import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, real, text } from "drizzle-orm/pg-core";
import { createSharesTable, ownableColumns } from "@agent-native/core/db/schema";

import type {
  Align,
  FontFamily,
  Page,
  PatchLayout,
  PatchStatus,
  Rect,
  Warning,
} from "../../shared/reprint/types.js";

/** A printed document (flyer, menu) as structured text extracted in the browser. */
export const documents = pgTable("reprint_documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pageCount: integer("page_count").notNull().default(1),
  pages: jsonb("pages").$type<Page[]>().notNull(),
  createdAt: text("created_at").notNull().default(sql`now()`),
  ...ownableColumns(),
});
export const documentShares = createSharesTable("reprint_document_shares");

/** A cover-up label for one mistake. Child of a document. */
export const patches = pgTable("reprint_patches", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  page: integer("page").notNull(),
  rect: jsonb("rect").$type<Rect>().notNull(),
  target: jsonb("target").$type<Rect>().notNull(),
  oldText: text("old_text").notNull().default(""),
  newText: text("new_text").notNull(),
  fontFamily: text("font_family").$type<FontFamily>().notNull().default("sans"),
  bold: boolean("bold").notNull().default(false),
  fontSize: real("font_size").notNull(),
  originalFontSize: real("original_font_size").notNull(),
  align: text("align").$type<Align>().notNull().default("left"),
  textColor: text("text_color").notNull().default("#111111"),
  bgColor: text("bg_color").notNull().default("#ffffff"),
  border: boolean("border").notNull().default(false),
  layout: jsonb("layout").$type<PatchLayout>().notNull(),
  status: text("status").$type<PatchStatus>().notNull().default("ok"),
  warnings: jsonb("warnings").$type<Warning[]>().notNull(),
  source: text("source").$type<"user" | "agent">().notNull().default("user"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
});

/** An area labels must never cover (logo, venue, QR code). */
export const locks = pgTable("reprint_locks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  page: integer("page").notNull(),
  rect: jsonb("rect").$type<Rect>().notNull(),
  label: text("label").notNull().default(""),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

/** A mistake the checker found that the user did not mark. */
export const suggestions = pgTable("reprint_suggestions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  kind: text("kind").$type<"related" | "weekday" | "past_date" | "combo" | "currency">().notNull(),
  severity: text("severity").$type<"error" | "warn" | "info">().notNull(),
  page: integer("page").notNull(),
  target: jsonb("target").$type<Rect>().notNull(),
  oldText: text("old_text").notNull(),
  suggestedText: text("suggested_text").notNull().default(""),
  message: text("message").notNull(),
  status: text("status").$type<"open" | "accepted" | "dismissed">().notNull().default("open"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});
