import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Email schemas
export const emailSchema = z.object({
  id: z.string(),
  from: z.string(),
  fromName: z.string().optional(),
  to: z.string(),
  subject: z.string(),
  date: z.string(),
  textContent: z.string().optional(),
  htmlContent: z.string().optional(),
  isRead: z.boolean().default(false),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
  })).optional(),
});

export type Email = z.infer<typeof emailSchema>;

export const tempEmailSchema = z.object({
  address: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
});

export type TempEmail = z.infer<typeof tempEmailSchema>;

export const inboxResponseSchema = z.object({
  emails: z.array(emailSchema),
  tempEmail: tempEmailSchema,
});

export type InboxResponse = z.infer<typeof inboxResponseSchema>;

// Custom email schema for MongoDB storage (for logged-in users)
export const customEmailSchema = z.object({
  userId: z.string(),
  address: z.string(),
  domain: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
});

export type CustomEmail = z.infer<typeof customEmailSchema>;

export const insertCustomEmailSchema = customEmailSchema.omit({});
export type InsertCustomEmail = z.infer<typeof insertCustomEmailSchema>;

export type EmailProvider = "gmail" | "outlook" | "domain";

export const providerEmailSchema = emailSchema.extend({
  provider: z.enum(["gmail", "outlook", "domain"]).optional(),
  accountEmail: z.string().optional(),
  isAlias: z.boolean().optional(),
});

export type ProviderEmail = z.infer<typeof providerEmailSchema>;

export const providerAccountSchema = z.object({
  email: z.string(),
  provider: z.enum(["gmail", "outlook"]),
  canGenerateAlias: z.boolean(),
  isDirectInbox: z.boolean(),
});

export type ProviderAccount = z.infer<typeof providerAccountSchema>;

export const providerAliasSchema = z.object({
  aliasAddress: z.string(),
  baseEmail: z.string(),
  provider: z.enum(["gmail", "outlook"]),
  displayName: z.string(),
});

export type ProviderAlias = z.infer<typeof providerAliasSchema>;
