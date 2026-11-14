import type { Task } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api-error";
import {
  taskService,
  type TaskDecompositionSource,
} from "@/features/tasks/task.service";

import {
  MAX_CLARIFICATION_ROUNDS,
  type TaskDecompositionProvider,
  TaskDecompositionProviderError,
} from "./task-decomposition.provider";
import {
  clarificationHistorySchema,
  decompositionConfirmRequestSchema,
  parseTaskDecompositionResult,
  type DecompositionConfirmRequest,
  type TaskDecompositionResult,
} from "./task-decomposition.schemas";

export interface TaskDecompositionTaskReader {
  getDecompositionSource(taskId: string): Promise<TaskDecompositionSource>;
  listSubtasks(parentTaskId: string): Promise<Task[]>;
}

export interface TaskDecompositionTaskWriter {
  confirmDecomposition(
    taskId: string,
    subtasks: DecompositionConfirmRequest["subtasks"],
  ): Promise<Task[]>;
}

export type TaskDecompositionPreview = {
  result: TaskDecompositionResult;
  trace: {
    modelTurns: number;
    toolCalls: string[];
  };
  clarificationRoundsUsed: number;
  clarificationRoundsRemaining: number;
};

function normalizeTitle(title: string): string {
  return title.trim().toLocaleLowerCase();
}

function hasDuplicateTitles(
  generatedTitles: readonly string[],
  existingSubtasks: readonly Task[],
): boolean {
  const seen = new Set(existingSubtasks.map((task) => normalizeTitle(task.title)));

  for (const title of generatedTitles) {
    const normalized = normalizeTitle(title);

    if (seen.has(normalized)) {
      return true;
    }

    seen.add(normalized);
  }

  return false;
}

export class TaskDecompositionService {
  constructor(
    private readonly provider: TaskDecompositionProvider,
    private readonly tasks: TaskDecompositionTaskReader = taskService,
  ) {}

  async preview(
    taskId: string,
    clarificationHistory: unknown = [],
  ): Promise<TaskDecompositionPreview> {
    const clarification = clarificationHistorySchema.safeParse(
      clarificationHistory,
    );

    if (!clarification.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid clarification history",
        clarification.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const parsedClarificationHistory = clarification.data;
    const task = await this.tasks.getDecompositionSource(taskId);

    if (task.parentTaskId !== null) {
      throw new ApiError(
        409,
        "TASK_DECOMPOSITION_NOT_ALLOWED",
        "A subtask cannot be decomposed",
      );
    }

    let providerResult;
    let existingSubtasksInspected = false;

    try {
      providerResult = await this.provider.generate(
        {
          sourceTask: {
            title: task.title,
            description: task.description,
            priority: task.priority,
          },
          existingSubtaskCount: task.existingSubtaskCount,
          clarificationHistory: parsedClarificationHistory,
        },
        {
          getExistingSubtasks: async () => {
            existingSubtasksInspected = true;
            return (await this.tasks.listSubtasks(task.id)).map((subtask) => ({
              title: subtask.title,
              description: subtask.description,
              priority: subtask.priority,
            }));
          },
        },
      );
    } catch (error) {
      if (error instanceof TaskDecompositionProviderError) {
        if (error.kind === "limit_reached") {
          throw new ApiError(
            502,
            "AI_AGENT_LIMIT_REACHED",
            "AI task decomposition reached its execution limit",
          );
        }

        if (error.kind === "invalid_tool_call") {
          throw new ApiError(
            502,
            "AI_TOOL_CALL_INVALID",
            "AI provider requested an invalid tool call",
          );
        }

        const invalidResponse = error.kind === "invalid_response";

        throw new ApiError(
          invalidResponse ? 502 : 503,
          invalidResponse
            ? "AI_PROVIDER_INVALID_RESPONSE"
            : "AI_PROVIDER_UNAVAILABLE",
          invalidResponse
            ? "AI provider returned an invalid decomposition"
            : "Task decomposition is temporarily unavailable",
        );
      }

      throw error;
    }

    if (task.existingSubtaskCount > 0 && !existingSubtasksInspected) {
      throw new ApiError(
        502,
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI provider returned an invalid decomposition",
      );
    }

    let result: TaskDecompositionResult;

    try {
      result = parseTaskDecompositionResult(providerResult.output);
    } catch {
      throw new ApiError(
        502,
        "AI_PROVIDER_INVALID_RESPONSE",
        "AI provider returned an invalid decomposition",
      );
    }

    if (
      result.outcome === "needs_clarification" &&
      parsedClarificationHistory.length >= MAX_CLARIFICATION_ROUNDS
    ) {
      throw new ApiError(
        422,
        "CLARIFICATION_LIMIT_REACHED",
        "Task decomposition needs more context than the allowed clarification rounds",
      );
    }

    if (result.outcome === "decomposed") {
      const currentSubtasks = await this.tasks.listSubtasks(task.id);

      if (
        hasDuplicateTitles(
          result.subtasks.map((subtask) => subtask.title),
          currentSubtasks,
        )
      ) {
        throw new ApiError(
          502,
          "AI_PROVIDER_INVALID_RESPONSE",
          "AI provider returned an invalid decomposition",
        );
      }
    }

    return {
      result,
      trace: providerResult.trace,
      clarificationRoundsUsed: parsedClarificationHistory.length,
      clarificationRoundsRemaining:
        MAX_CLARIFICATION_ROUNDS - parsedClarificationHistory.length,
    };
  }
}

export class TaskDecompositionConfirmationService {
  constructor(
    private readonly tasks: TaskDecompositionTaskWriter = taskService,
  ) {}

  async confirm(
    taskId: string,
    input: unknown,
  ): Promise<Task[]> {
    const parsed = decompositionConfirmRequestSchema.safeParse(input);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid decomposition confirmation payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    return this.tasks.confirmDecomposition(taskId, parsed.data.subtasks);
  }
}

export const taskDecompositionConfirmationService =
  new TaskDecompositionConfirmationService();
