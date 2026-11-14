import { z } from "zod";

import {
  taskListResponseSchema,
  type TaskListResponse,
} from "./task.schemas";

const apiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.array(z.unknown()),
      })
      .strict(),
  })
  .strict();

export class TaskApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskApiError";
  }
}

export async function fetchTasks(
  queryString: string,
  signal: AbortSignal,
): Promise<TaskListResponse> {
  const response = await fetch(
    queryString.length > 0 ? `/api/tasks?${queryString}` : "/api/tasks",
    {
      headers: { accept: "application/json" },
      signal,
    },
  );

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new TaskApiError("The server returned an unreadable response.");
  }

  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(body);
    throw new TaskApiError(
      parsedError.success
        ? parsedError.data.error.message
        : "Tasks could not be loaded.",
    );
  }

  const parsed = taskListResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskApiError("The server returned an unexpected task format.");
  }

  return parsed.data;
}
