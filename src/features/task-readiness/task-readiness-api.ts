import { z } from "zod";

import { taskWithSubtasksResponseSchema } from "@/features/tasks/task.schemas";

import {
  readinessAnalysisRequestSchema,
  readinessConfirmationRequestSchema,
  taskReadinessResultSchema,
  type ReadinessAnalysisRequest,
  type ReadinessConfirmationRequest,
  type TaskReadinessResult,
} from "./task-readiness.schemas";

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

const analysisResponseSchema = z
  .object({
    data: taskReadinessResultSchema,
    meta: z
      .object({
        clarificationRoundsUsed: z.number().int().min(0).max(2),
        clarificationRoundsRemaining: z.number().int().min(0).max(2),
        clarificationLimitReached: z.boolean(),
        execution: z
          .object({
            modelTurns: z.number().int().min(1).max(4),
            toolCalls: z.array(z.string()).max(4),
            inspectionPerformed: z.boolean(),
            relatedSearchPerformed: z.boolean(),
          })
          .strict(),
        snapshot: z
          .object({
            original: z
              .object({
                title: z.string().min(1).max(120),
                description: z.string().min(1).max(2000),
              })
              .strict(),
            token: z.string().min(1).max(4096),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedLimitReached =
      value.data.outcome === "needs_clarification" &&
      value.meta.clarificationRoundsUsed === 2;

    if (
      value.meta.clarificationRoundsRemaining !==
        2 - value.meta.clarificationRoundsUsed ||
      value.meta.clarificationLimitReached !== expectedLimitReached
    ) {
      context.addIssue({
        code: "custom",
        path: ["meta", "clarificationLimitReached"],
        message: "Clarification metadata is inconsistent",
      });
    }
  });

const confirmationResponseSchema = z
  .object({ data: taskWithSubtasksResponseSchema })
  .strict();

export type TaskReadinessAnalysisResponse = {
  data: TaskReadinessResult;
  meta: z.infer<typeof analysisResponseSchema>["meta"];
};

export class TaskReadinessApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly resultMayHaveChanged = false,
  ) {
    super(message);
    this.name = "TaskReadinessApiError";
  }
}

async function readJson(
  response: Response,
  resultMayHaveChanged: boolean,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TaskReadinessApiError(
      "The server returned an unreadable response.",
      "INVALID_RESPONSE",
      resultMayHaveChanged,
    );
  }
}

function throwApiError(body: unknown, fallback: string): never {
  const parsed = apiErrorResponseSchema.safeParse(body);

  throw new TaskReadinessApiError(
    parsed.success ? parsed.data.error.message : fallback,
    parsed.success ? parsed.data.error.code : "UNKNOWN_ERROR",
  );
}

export async function requestReadinessAnalysis(
  taskId: string,
  input: ReadinessAnalysisRequest,
  signal?: AbortSignal,
): Promise<TaskReadinessAnalysisResponse> {
  const parsedInput = readinessAnalysisRequestSchema.parse(input);
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/readiness-analysis`,
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
    throwApiError(body, "The task readiness analysis could not be completed.");
  }

  const parsed = analysisResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskReadinessApiError(
      "The server returned an unexpected readiness format.",
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}

export async function confirmReadinessRewrite(
  taskId: string,
  input: ReadinessConfirmationRequest,
  signal?: AbortSignal,
): Promise<z.infer<typeof taskWithSubtasksResponseSchema>> {
  const parsedInput = readinessConfirmationRequestSchema.parse(input);
  let response: Response;

  try {
    response = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}/readiness-confirm`,
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
    if (error instanceof DOMException && error.name === "AbortError") throw error;

    throw new TaskReadinessApiError(
      "The confirmation response was not received.",
      "NETWORK_ERROR",
      true,
    );
  }

  const body = await readJson(response, response.ok);

  if (!response.ok) {
    throwApiError(body, "The task rewrite could not be applied.");
  }

  const parsed = confirmationResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new TaskReadinessApiError(
      "The server returned an unexpected confirmation format.",
      "INVALID_RESPONSE",
      true,
    );
  }

  return parsed.data.data;
}
