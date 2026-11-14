export const MAX_READINESS_MODEL_TURNS = 4;
export const MAX_READINESS_TOOL_CALLS = 4;
export const MAX_READINESS_CLARIFICATION_ROUNDS = 2;
export const MAX_READINESS_QUESTIONS = 3;
export const MAX_RELATED_TASK_RESULTS = 10;

export type TaskReadinessClarificationHistory = Array<{
  items: Array<{
    question: string;
    answer: string;
  }>;
}>;

export type TaskReadinessInput = {
  taskId: string;
  clarificationHistory: TaskReadinessClarificationHistory;
};

export type ReadinessTaskContext = {
  id: string;
  title: string;
  description: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH";
  parentTaskId: string | null;
};

export type TaskInspectionContext = {
  task: ReadinessTaskContext;
  subtasks: ReadinessTaskContext[];
  parentTask: ReadinessTaskContext | null;
};

export type RelatedTaskContext = ReadinessTaskContext;

export interface TaskReadinessTools {
  getTaskWithSubtasks(args: {
    taskId: string;
  }): Promise<TaskInspectionContext>;
  findRelatedTasks(args: {
    query: string;
    limit: number;
  }): Promise<RelatedTaskContext[]>;
}

export type TaskReadinessAgentTrace = {
  modelTurns: number;
  toolCalls: string[];
  inspectionPerformed: boolean;
  relatedSearchPerformed: boolean;
};

export type TaskReadinessProviderResult = {
  output: unknown;
  trace: TaskReadinessAgentTrace;
};

export interface TaskReadinessProvider {
  generate(
    input: TaskReadinessInput,
    tools: TaskReadinessTools,
  ): Promise<TaskReadinessProviderResult>;
}

export class TaskReadinessProviderError extends Error {
  constructor(
    readonly kind:
      | "unavailable"
      | "invalid_response"
      | "invalid_tool_call"
      | "limit_reached",
    readonly attempts = 1,
    readonly toolCalls: readonly string[] = [],
  ) {
    super("Task readiness provider failed");
    this.name = "TaskReadinessProviderError";
  }
}
