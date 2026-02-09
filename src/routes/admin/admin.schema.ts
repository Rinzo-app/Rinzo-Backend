import { z } from "zod";

// ─────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/assign-pickup  —  request body
// ─────────────────────────────────────────────────────────

export const assignPickupSchema = z.object({
  riderId: z.string().uuid("riderId must be a valid UUID"),
});

export type AssignPickupInput = z.infer<typeof assignPickupSchema>;
