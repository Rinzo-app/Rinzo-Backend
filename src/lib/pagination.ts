import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  // Clamp oversized limits instead of rejecting the request — a 400
  // here silently blanks entire list screens in the apps.
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(20)
    .transform((v) => Math.min(v, 100)),
});

export function paginate(page: number, limit: number) {
  return {
    offset: (page - 1) * limit,
    limit,
  };
}

export function paginatedResponse<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
