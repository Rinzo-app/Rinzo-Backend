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
// Phone is required: the shop and rider need a number to reach the
// customer for pickup/delivery.
export const registerCustomerSchema = z.object({
  name: nameField,
  phone: phoneField,
  email: emailField,
});
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

// ── PATCH /api/auth/me ───────────────────────────────────
// Self-service profile edit (name and/or contact number).
export const updateProfileSchema = z
  .object({
    name: nameField.optional(),
    phone: phoneField.optional(),
  })
  .refine((b) => b.name !== undefined || b.phone !== undefined, {
    message: "Provide a name or phone to update",
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

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
