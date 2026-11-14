import { z } from "zod";

import {
  decompositionConfirmRequestSchema,
  decompositionPreviewRequestSchema,
  taskDecompositionResultSchema,
  type DecompositionConfirmRequest,
  type DecompositionPreviewRequest,
  type TaskDecompositionResult,
} from "./task-decomposition.schemas";
import { taskResponseSchema, type TaskResponse } from "../tasks/task.schemas";

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

const previewResponseSchema = z
  .object({
    data: taskDecompositionResultSchema,
    meta: z
      .object({
        clarificationRoundsUsed: z.number().int().min(0).max(2),
        clarificationRoundsRemaining: z.number().int().min(0).max(2),
      })
      .strict(),
  })
  .strict();

const confirmationResponseSchema = z
  .object({ data: z.array(taskResponseSchema).min(1).max(7) })
  .strict();

export type DecompositionPreviewResponse = {
  data: TaskDecompositionResult;
  meta: {
    clarificationRoundsUsed: number;
    clarificationRoundsRemaining: number;
  };
};

export class TaskDecompositionApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly resultMayHaveChanged = false,
  ) {
    super(message);
    this.name = "TaskDecompositionApiError";
  }
}

async function readJson(
  response: Response,
  resultMayHaveChanged: boolean,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TaskDecompositionApiError(
      "The server returned an unreadable response.",
      "INVALID_RESPONSE",
      resultMayHaveChanged,
    );
  }
}

function throwApiError(body: unknown, fallback: string): never {
  const parsed = apiErrorResponseSchema.safeParse(body);

  throw new TaskDecompositionApiError(
    parsed.success ? parsed.data.error.message : fallback,
    parsed.success ? parsed.data.error.code : "UNKNOWN_ERROR",
  );
}

export async function requestDecompositionPreview(
  taskId: string,
  input: DecompositionPreviewRequest,
  signal?: AbortSignal,
): Promise<DecompositionPreviewResponse> {
  const parsedInput = decompositionPreviewRequestSchema.parse(input);
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/decomposition-preview`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(parsedInput),
      signal,
    },
  );
  const body = await readJson(response, false);

  if (!response.ok) {
    throwApiError(body, "The task could not be decomposed.");
  }

  const parsed = previewResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskDecompositionApiError(
      "The server returned an unexpected decomposition format.",
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}

export async function confirmDecomposition(
  taskId: string,
  input: DecompositionConfirmRequest,
  signal?: AbortSignal,
): Promise<TaskResponse[]> {
  const parsedInput = decompositionConfirmRequestSchema.parse(input);
  let response: Response;

  try {
    response = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}/decomposition-confirm`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(parsedInput),
        signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new TaskDecompositionApiError(
      "The confirmation response was not received.",
      "NETWORK_ERROR",
      true,
    );
  }

  const body = await readJson(response, response.ok);

  if (!response.ok) {
    throwApiError(body, "The subtasks could not be created.");
  }

  const parsed = confirmationResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskDecompositionApiError(
      "The server returned an unexpected confirmation format.",
      "INVALID_RESPONSE",
      true,
    );
  }

  return parsed.data.data;
}
