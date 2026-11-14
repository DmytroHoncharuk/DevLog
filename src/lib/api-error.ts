export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "TASK_NOT_FOUND"
  | "PARENT_TASK_NOT_FOUND"
  | "INVALID_TASK_HIERARCHY"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: readonly unknown[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        details: [],
      },
    },
    { status: 500 },
  );
}
