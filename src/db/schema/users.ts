import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { userRoleEnum, userStatusEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  firebaseUid: varchar("firebase_uid", { length: 128 }).unique(),
  role: userRoleEnum("role").notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  status: userStatusEnum("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
