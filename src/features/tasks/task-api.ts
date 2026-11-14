import { z } from "zod";

import {
  taskWithSubtasksResponseSchema,
  taskListResponseSchema,
  type CreateTaskInput,
  type TaskListResponse,
  type TaskWithSubtasksResponse,
  type UpdateTaskInput,
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

const taskMutationResponseSchema = z
  .object({ data: taskWithSubtasksResponseSchema })
  .strict();

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TaskApiError("The server returned an unreadable response.");
  }
}

function throwApiError(body: unknown, fallbackMessage: string): never {
  const parsedError = apiErrorResponseSchema.safeParse(body);
  throw new TaskApiError(
    parsedError.success ? parsedError.data.error.message : fallbackMessage,
  );
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

  const body = await readJson(response);

  if (!response.ok) {
    throwApiError(body, "Tasks could not be loaded.");
  }

  const parsed = taskListResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskApiError("The server returned an unexpected task format.");
  }

  return parsed.data;
}

async function mutateTask(
  url: string,
  method: "POST" | "PATCH",
  input: CreateTaskInput | UpdateTaskInput,
): Promise<TaskWithSubtasksResponse> {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throwApiError(body, "The task could not be saved.");
  }

  const parsed = taskMutationResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskApiError("The server returned an unexpected task format.");
  }

  return parsed.data.data;
}

export function createTask(
  input: CreateTaskInput,
): Promise<TaskWithSubtasksResponse> {
  return mutateTask("/api/tasks", "POST", input);
}

export function updateTask(
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskWithSubtasksResponse> {
  return mutateTask(`/api/tasks/${encodeURIComponent(taskId)}`, "PATCH", input);
}

export async function deleteTask(taskId: string): Promise<void> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: { accept: "application/json" },
  });

  if (response.status === 204) return;

  const body = await readJson(response);

  if (!response.ok) {
    throwApiError(body, "The task could not be deleted.");
  }

  throw new TaskApiError("The server returned an unexpected response.");
}
