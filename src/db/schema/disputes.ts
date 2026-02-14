import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { disputeRaisedByEnum, disputeStatusEnum } from "./enums.js";

export const disputes = pgTable("disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  raisedByType: disputeRaisedByEnum("raised_by_type").notNull(),
  raisedById: uuid("raised_by_id").notNull(),
  orderId: uuid("order_id"),
  category: varchar("category", { length: 100 }).notNull(),
  description: text("description").notNull(),
  status: disputeStatusEnum("status").notNull().default("OPEN"),
  adminNotes: text("admin_notes"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
