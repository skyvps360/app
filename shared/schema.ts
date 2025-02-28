import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  apiKey: text("api_key"),
  balance: integer("balance").notNull().default(0), // Balance in cents
  isAdmin: boolean("is_admin").notNull().default(false), // Admin flag
});

export const servers = pgTable("servers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  dropletId: text("droplet_id").notNull(),
  region: text("region").notNull(),
  size: text("size").notNull(),
  status: text("status").notNull(),
  ipAddress: text("ip_address"),
  ipv6Address: text("ipv6_address"),
  specs: jsonb("specs").$type<{
    memory: number;
    vcpus: number;
    disk: number;
  }>(),
  application: text("application"), // Added application field
  lastMonitored: timestamp("last_monitored"),
});

// Server metrics table for monitoring
export const serverMetrics = pgTable("server_metrics", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  cpuUsage: integer("cpu_usage").notNull(), // Percentage: 0-100
  memoryUsage: integer("memory_usage").notNull(), // Percentage: 0-100
  diskUsage: integer("disk_usage").notNull(), // Percentage: 0-100
  networkIn: integer("network_in").notNull(), // Bytes
  networkOut: integer("network_out").notNull(), // Bytes
  loadAverage: jsonb("load_average").$type<number[]>().notNull(),
  uptimeSeconds: integer("uptime_seconds").notNull(),
});

export const volumes = pgTable("volumes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  serverId: integer("server_id").notNull(),
  name: text("name").notNull(),
  volumeId: text("volume_id").notNull(),
  size: integer("size").notNull(),
  region: text("region").notNull(),
});

export const billingTransactions = pgTable("billing_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(), // in cents
  currency: text("currency").notNull(),
  status: text("status").notNull(), // completed, pending, failed
  type: text("type").notNull(), // deposit, server_charge, volume_charge
  paypalTransactionId: text("paypal_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Updated: Support Tickets with server relation
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  serverId: integer("server_id"), // Optional - allows tickets to persist after server deletion
  subject: text("subject").notNull(),
  status: text("status").notNull(), // open, closed, pending
  priority: text("priority").notNull().default('normal'), // low, normal, high
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  originalDropletId: text("original_droplet_id"), // Store the original droplet ID for reference
});

// Support Messages with real-time chat support
export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  userId: integer("user_id").notNull(), // sender (can be admin or user)
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isRead: boolean("is_read").notNull().default(false), // For real-time chat notifications
});

export const sshKeys = pgTable("ssh_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  isAdmin: true,
  balance: true,
  apiKey: true,
});

export const insertServerSchema = createInsertSchema(servers).pick({
  name: true,
  region: true,
  size: true,
}).extend({
  application: z.string().optional(),
});

export const insertVolumeSchema = createInsertSchema(volumes).pick({
  name: true,
  size: true,
});

// Updated: Support Ticket Schema with server relation
export const insertTicketSchema = createInsertSchema(supportTickets).pick({
  subject: true,
  priority: true,
  serverId: true,
}).extend({
  message: z.string().min(1, "Initial message is required"),
  priority: z.string().default("normal"),
  serverId: z.number().optional(),
});

export const insertMessageSchema = createInsertSchema(supportMessages).pick({
  message: true,
});

export const insertSSHKeySchema = createInsertSchema(sshKeys).pick({
  name: true,
  publicKey: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type Volume = typeof volumes.$inferSelect;
export type BillingTransaction = typeof billingTransactions.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type SupportMessage = typeof supportMessages.$inferSelect;
export type InsertSSHKey = z.infer<typeof insertSSHKeySchema>;
export type SSHKey = typeof sshKeys.$inferSelect;