// ── Application-level error with HTTP status ───────────

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? "ERR_UNKNOWN";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ── Convenience factories ──────────────────────────────

export class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "ERR_BAD_REQUEST") {
    super(400, message, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "ERR_UNAUTHORIZED") {
    super(401, message, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "ERR_FORBIDDEN") {
    super(403, message, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", code = "ERR_NOT_FOUND") {
    super(404, message, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "ERR_CONFLICT") {
    super(409, message, code);
  }
}
