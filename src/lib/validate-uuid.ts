import { z } from "zod";
import { BadRequestError } from "./errors.js";

const uuidSchema = z.string().uuid();

/**
 * Parse and validate a UUID path parameter.
 *
 * Returns the validated UUID string on success.
 * Throws a `BadRequestError` (400) with a clear message if it fails.
 */
export function parseUUID(raw: string, label = "ID"): string {
  const result = uuidSchema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestError(
      `Invalid ${label} format — expected a UUID`,
      "ERR_INVALID_ID",
    );
  }
  return result.data;
}
