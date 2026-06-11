import { z } from "zod";

// ── Shared fields ────────────────────────────────────────
const nameField = z.string().min(1).max(150);
// Indian mobile: optional +91 / 0 prefix, then 10 digits starting 6-9.
// Spaces and dashes are stripped before validation.
const phoneField = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^(\+91|0)?[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  );
const emailField = z.string().email().max(255).optional();

// ── POST /api/auth/register/customer ─────────────────────
export const registerCustomerSchema = z.object({
  name: nameField,
  phone: phoneField.optional(),
  email: emailField,
});
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

// ── POST /api/auth/register/shop ─────────────────────────
export const registerShopSchema = z.object({
  name: nameField,
  phone: phoneField,
  email: emailField,
});
export type RegisterShopInput = z.infer<typeof registerShopSchema>;

// ── POST /api/auth/register/rider ────────────────────────
export const registerRiderSchema = z.object({
  name: nameField,
  phone: phoneField,
  email: emailField,
  vehicleType: z.string().min(1).max(50),
  vehicleNumber: z.string().max(30).optional().default(""),
});
export type RegisterRiderInput = z.infer<typeof registerRiderSchema>;
