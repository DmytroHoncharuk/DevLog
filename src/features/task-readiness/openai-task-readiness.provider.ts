import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type {
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses";

import {
  buildTaskReadinessInput,
  TASK_READINESS_INSTRUCTIONS,
} from "./task-readiness.prompt";
import {
  MAX_READINESS_MODEL_TURNS,
  MAX_READINESS_TOOL_CALLS,
  type TaskReadinessInput,
  type TaskReadinessProvider,
  TaskReadinessProviderError,
  type TaskReadinessProviderResult,
  type TaskReadinessTools,
} from "./task-readiness.provider";
import {
  findRelatedTasksArgumentsSchema,
  getTaskWithSubtasksArgumentsSchema,
  taskReadinessStructuredOutputSchema,
} from "./task-readiness.schemas";

const RETRY_DELAY_MS = 250;
const GET_TASK_TOOL = "get_task_with_subtasks";
const FIND_RELATED_TOOL = "find_related_tasks";

function getErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

function isRetryableProviderError(error: unknown): boolean {
  const status = getErrorStatus(error);

  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    (error instanceof Error && error.name === "APIConnectionTimeoutError")
  );
}

async function waitBeforeRetry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

export class OpenAITaskReadinessProvider implements TaskReadinessProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async generate(
    input: TaskReadinessInput,
    tools: TaskReadinessTools,
  ): Promise<TaskReadinessProviderResult> {
    const history: Array<ResponseInputItem | ResponseOutputItem> = [
      { role: "user", content: buildTaskReadinessInput(input) },
    ];
    const trace: TaskReadinessProviderResult["trace"] = {
      modelTurns: 0,
      toolCalls: [],
      inspectionPerformed: false,
      relatedSearchPerformed: false,
    };
    const completedSearches = new Set<string>();

    for (let turn = 1; turn <= MAX_READINESS_MODEL_TURNS; turn += 1) {
      const request = await this.requestModel(
        toResponseInputItems(history),
        trace.inspectionPerformed
          ? "auto"
          : { type: "function", name: GET_TASK_TOOL },
        trace,
      );
      const response = request.response;
      trace.modelTurns = turn;

      if (response.status !== "completed" || !Array.isArray(response.output)) {
        throw new TaskReadinessProviderError(
          "invalid_response",
          request.attempts,
          trace.toolCalls,
        );
      }

      const functionCalls = response.output.filter(
        (item) => item.type === "function_call",
      );

      if (functionCalls.length === 0) {
        if (!trace.inspectionPerformed || response.output_parsed === null) {
          throw new TaskReadinessProviderError(
            "invalid_response",
            request.attempts,
            trace.toolCalls,
          );
        }

        return { output: response.output_parsed, trace };
      }

      if (
        turn === MAX_READINESS_MODEL_TURNS ||
        trace.toolCalls.length + functionCalls.length > MAX_READINESS_TOOL_CALLS
      ) {
        throw new TaskReadinessProviderError(
          "limit_reached",
          request.attempts,
          trace.toolCalls,
        );
      }

      history.push(...response.output);

      for (const functionCall of functionCalls) {
        if (functionCall.name === GET_TASK_TOOL) {
          let args;

          try {
            args = getTaskWithSubtasksArgumentsSchema.parse(
              JSON.parse(functionCall.arguments),
            );
          } catch {
            throw new TaskReadinessProviderError(
              "invalid_tool_call",
              request.attempts,
              trace.toolCalls,
            );
          }

          if (trace.inspectionPerformed || args.taskId !== input.taskId) {
            throw new TaskReadinessProviderError(
              "invalid_tool_call",
              request.attempts,
              trace.toolCalls,
            );
          }

          const output = await tools.getTaskWithSubtasks(args);
          trace.inspectionPerformed = true;
          trace.toolCalls.push(GET_TASK_TOOL);
          history.push({
            type: "function_call_output",
            call_id: functionCall.call_id,
            output: JSON.stringify(output),
          });
          continue;
        }

        if (functionCall.name === FIND_RELATED_TOOL) {
          if (!trace.inspectionPerformed) {
            throw new TaskReadinessProviderError(
              "invalid_tool_call",
              request.attempts,
              trace.toolCalls,
            );
          }

          let args;

          try {
            args = findRelatedTasksArgumentsSchema.parse(
              JSON.parse(functionCall.arguments),
            );
          } catch {
            throw new TaskReadinessProviderError(
              "invalid_tool_call",
              request.attempts,
              trace.toolCalls,
            );
          }

          const searchKey = `${args.query.toLocaleLowerCase()}::${args.limit}`;

          if (completedSearches.has(searchKey)) {
            throw new TaskReadinessProviderError(
              "invalid_tool_call",
              request.attempts,
              trace.toolCalls,
            );
          }

          completedSearches.add(searchKey);
          trace.relatedSearchPerformed = true;
          trace.toolCalls.push(FIND_RELATED_TOOL);
          let output: unknown;

          try {
            output = await tools.findRelatedTasks(args);
          } catch {
            output = {
              error: "RELATED_TASK_SEARCH_FAILED",
              message: "Related-task verification could not be completed.",
            };
          }

          history.push({
            type: "function_call_output",
            call_id: functionCall.call_id,
            output: JSON.stringify(output),
          });
          continue;
        }

        throw new TaskReadinessProviderError(
          "invalid_tool_call",
          request.attempts,
          trace.toolCalls,
        );
      }
    }

    throw new TaskReadinessProviderError(
      "limit_reached",
      1,
      trace.toolCalls,
    );
  }

  private async requestModel(
    input: ResponseInputItem[],
    toolChoice:
      | "auto"
      | { type: "function"; name: typeof GET_TASK_TOOL },
    trace: TaskReadinessProviderResult["trace"],
  ): Promise<{
    response: Awaited<ReturnType<OpenAI["responses"]["parse"]>>;
    attempts: number;
  }> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await this.client.responses.parse({
          model: this.model,
          instructions: TASK_READINESS_INSTRUCTIONS,
          input,
          store: false,
          parallel_tool_calls: false,
          tool_choice: toolChoice,
          tools: [
            {
              type: "function",
              name: GET_TASK_TOOL,
              description:
                "Retrieve the selected task, its direct subtasks, and parent context. This read is mandatory before a final audit.",
              strict: true,
              parameters: {
                type: "object",
                properties: { taskId: { type: "string" } },
                required: ["taskId"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: FIND_RELATED_TOOL,
              description:
                "Search bounded board candidates when a possible dependency, duplicate, or conflict needs investigation.",
              strict: true,
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  limit: { type: "integer", minimum: 1, maximum: 10 },
                },
                required: ["query", "limit"],
                additionalProperties: false,
              },
            },
          ],
          text: {
            format: zodTextFormat(
              taskReadinessStructuredOutputSchema,
              "task_readiness",
            ),
          },
        });

        return { response, attempts: attempt };
      } catch (error) {
        if (attempt === 1 && isRetryableProviderError(error)) {
          await waitBeforeRetry();
          continue;
        }

        throw new TaskReadinessProviderError(
          "unavailable",
          attempt,
          trace.toolCalls,
        );
      }
    }

    throw new TaskReadinessProviderError(
      "unavailable",
      2,
      trace.toolCalls,
    );
  }
}
