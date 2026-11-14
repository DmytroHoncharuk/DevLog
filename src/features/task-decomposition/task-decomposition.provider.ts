export const MAX_MODEL_TURNS = 2;
export const MAX_TOOL_CALLS = 1;
export const MAX_CLARIFICATION_ROUNDS = 2;

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export type ExistingSubtaskContext = {
  title: string;
  description: string;
  priority: TaskPriority;
};

export type ClarificationHistory = Array<{
  items: Array<{
    question: string;
    answer: string;
  }>;
}>;

export type DecompositionInput = {
  sourceTask: {
    title: string;
    description: string;
    priority: TaskPriority;
  };
  existingSubtaskCount: number;
  clarificationHistory: ClarificationHistory;
};

export interface TaskDecompositionTools {
  getExistingSubtasks(): Promise<ExistingSubtaskContext[]>;
}

export type TaskDecompositionAgentTrace = {
  modelTurns: number;
  toolCalls: string[];
};

export type TaskDecompositionProviderResult = {
  output: unknown;
  trace: TaskDecompositionAgentTrace;
};

export interface TaskDecompositionProvider {
  generate(
    input: DecompositionInput,
    tools: TaskDecompositionTools,
  ): Promise<TaskDecompositionProviderResult>;
}

export class TaskDecompositionProviderError extends Error {
  constructor(
    readonly kind:
      | "unavailable"
      | "invalid_response"
      | "invalid_tool_call"
      | "limit_reached",
  ) {
    super("Task decomposition provider failed");
    this.name = "TaskDecompositionProviderError";
  }
}
