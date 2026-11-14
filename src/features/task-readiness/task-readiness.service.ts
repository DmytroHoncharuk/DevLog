import { ApiError } from "@/lib/api-error";
import {
  taskService,
  type TaskWithSubtasks,
} from "@/features/tasks/task.service";

import {
  MAX_READINESS_CLARIFICATION_ROUNDS,
  type RelatedTaskContext,
  type TaskInspectionContext,
  type TaskReadinessAgentTrace,
  type TaskReadinessProvider,
  TaskReadinessProviderError,
} from "./task-readiness.provider";
import {
  clarificationHistorySchema,
  parseTaskReadinessResult,
  readinessConfirmationRequestSchema,
  type ReadinessConfirmationRequest,
  type TaskReadinessResult,
} from "./task-readiness.schemas";
import {
  taskReadinessSnapshotManager,
  type TaskReadinessSnapshotManager,
} from "./task-readiness.snapshot";

export interface TaskReadinessTaskAccess {
  getReadinessContext(taskId: string): Promise<TaskInspectionContext>;
  findRelatedTasks(
    selectedTaskId: string,
    query: string,
    limit: number,
  ): Promise<RelatedTaskContext[]>;
}

export interface TaskReadinessTaskWriter {
  confirmReadinessRewrite(
    taskId: string,
    input: ReadinessConfirmationRequest,
  ): Promise<TaskWithSubtasks>;
}

export type TaskReadinessAnalysis = {
  result: TaskReadinessResult;
  trace: TaskReadinessAgentTrace;
  clarificationRoundsUsed: number;
  clarificationRoundsRemaining: number;
  snapshot: {
    original: { title: string; description: string };
    token: string;
  } | null;
};

function providerErrorToApiError(error: TaskReadinessProviderError): ApiError {
  if (process.env.NODE_ENV === "development") {
    console.error("Agent D provider failure", {
      code: error.kind,
      stage: "provider",
      attempts: error.attempts,
      toolCalls: error.toolCalls,
    });
  }

  if (error.kind === "limit_reached") {
    return new ApiError(
      502,
      "AI_AGENT_LIMIT_REACHED",
      "AI task readiness analysis reached its execution limit",
    );
  }

  if (error.kind === "invalid_tool_call") {
    return new ApiError(
      502,
      "AI_TOOL_CALL_INVALID",
      "AI provider requested an invalid readiness tool call",
    );
  }

  if (error.kind === "invalid_response") {
    return new ApiError(
      502,
      "AI_PROVIDER_INVALID_RESPONSE",
      "AI provider returned an invalid readiness analysis",
    );
  }

  return new ApiError(
    503,
    "AI_PROVIDER_UNAVAILABLE",
    "Task readiness analysis is temporarily unavailable",
  );
}

function invalidProviderResult(): ApiError {
  return new ApiError(
    502,
    "AI_PROVIDER_INVALID_RESPONSE",
    "AI provider returned an invalid readiness analysis",
  );
}

export class TaskReadinessService {
  constructor(
    private readonly provider: TaskReadinessProvider,
    private readonly tasks: TaskReadinessTaskAccess = taskService,
    private readonly snapshots: TaskReadinessSnapshotManager =
      taskReadinessSnapshotManager,
  ) {}

  async analyze(
    taskId: string,
    clarificationHistory: unknown = [],
  ): Promise<TaskReadinessAnalysis> {
    const clarification = clarificationHistorySchema.safeParse(
      clarificationHistory,
    );

    if (!clarification.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid readiness clarification history",
        clarification.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    let inspectedContext: TaskInspectionContext | null = null;
    let relatedSearchCalled = false;
    let relatedSearchFailed = false;
    let providerResult;

    try {
      providerResult = await this.provider.generate(
        {
          taskId,
          clarificationHistory: clarification.data,
        },
        {
          getTaskWithSubtasks: async ({ taskId: requestedTaskId }) => {
            if (requestedTaskId !== taskId) {
              throw new TaskReadinessProviderError("invalid_tool_call");
            }

            inspectedContext = await this.tasks.getReadinessContext(taskId);
            return inspectedContext;
          },
          findRelatedTasks: async ({ query, limit }) => {
            relatedSearchCalled = true;

            try {
              return await this.tasks.findRelatedTasks(taskId, query, limit);
            } catch (error) {
              relatedSearchFailed = true;
              throw error;
            }
          },
        },
      );
    } catch (error) {
      if (error instanceof TaskReadinessProviderError) {
        throw providerErrorToApiError(error);
      }

      throw error;
    }

    if (
      inspectedContext === null ||
      !providerResult.trace.inspectionPerformed ||
      providerResult.trace.relatedSearchPerformed !== relatedSearchCalled
    ) {
      throw invalidProviderResult();
    }

    const verifiedContext = inspectedContext as TaskInspectionContext;

    let result: TaskReadinessResult;

    try {
      result = parseTaskReadinessResult(providerResult.output);
    } catch {
      throw invalidProviderResult();
    }

    const verificationStatus = result.dependencyVerification.status;

    if (
      (relatedSearchFailed && verificationStatus !== "failed") ||
      (!relatedSearchFailed &&
        relatedSearchCalled &&
        verificationStatus !== "completed") ||
      (!relatedSearchCalled && verificationStatus !== "not_performed")
    ) {
      throw invalidProviderResult();
    }

    if (
      result.outcome === "needs_clarification" &&
      clarification.data.length >= MAX_READINESS_CLARIFICATION_ROUNDS
    ) {
      throw new ApiError(
        422,
        "CLARIFICATION_LIMIT_REACHED",
        "Task readiness still has unresolved requirements after two clarification rounds",
      );
    }

    const snapshot =
      result.outcome === "rewrite_proposed"
        ? {
            original: {
              title: verifiedContext.task.title,
              description: verifiedContext.task.description,
            },
            token: this.snapshots.create({
              taskId,
              title: verifiedContext.task.title,
              description: verifiedContext.task.description,
            }),
          }
        : null;

    return {
      result,
      trace: providerResult.trace,
      clarificationRoundsUsed: clarification.data.length,
      clarificationRoundsRemaining:
        MAX_READINESS_CLARIFICATION_ROUNDS - clarification.data.length,
      snapshot,
    };
  }
}

export class TaskReadinessConfirmationService {
  constructor(
    private readonly tasks: TaskReadinessTaskWriter = taskService,
    private readonly snapshots: TaskReadinessSnapshotManager =
      taskReadinessSnapshotManager,
  ) {}

  async confirm(
    taskId: string,
    input: unknown,
  ): Promise<TaskWithSubtasks> {
    const parsed = readinessConfirmationRequestSchema.safeParse(input);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid readiness confirmation payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const verified = this.snapshots.verify(parsed.data.snapshotToken, taskId);

    if (
      verified === null ||
      verified.title !== parsed.data.original.title ||
      verified.description !== parsed.data.original.description
    ) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid readiness snapshot",
      );
    }

    return this.tasks.confirmReadinessRewrite(taskId, parsed.data);
  }
}

export const taskReadinessConfirmationService =
  new TaskReadinessConfirmationService();
