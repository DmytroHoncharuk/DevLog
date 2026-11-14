import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type {
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses";

import {
  buildTaskDecompositionInput,
  TASK_DECOMPOSITION_INSTRUCTIONS,
} from "./task-decomposition.prompt";
import {
  MAX_MODEL_TURNS,
  MAX_TOOL_CALLS,
  type DecompositionInput,
  type TaskDecompositionProvider,
  TaskDecompositionProviderError,
  type TaskDecompositionProviderResult,
  type TaskDecompositionTools,
} from "./task-decomposition.provider";
import {
  getExistingSubtasksArgumentsSchema,
  taskDecompositionProviderOutputSchema,
} from "./task-decomposition.schemas";

const RETRY_DELAY_MS = 250;
const GET_EXISTING_SUBTASKS_TOOL = "get_existing_subtasks";

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

  if (status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }

  return error instanceof Error && error.name === "APIConnectionTimeoutError";
}

async function waitBeforeRetry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

export class OpenAITaskDecompositionProvider
  implements TaskDecompositionProvider
{
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async generate(
    input: DecompositionInput,
    tools: TaskDecompositionTools,
  ): Promise<TaskDecompositionProviderResult> {
    const history: Array<ResponseInputItem | ResponseOutputItem> = [
      {
        role: "user",
        content: buildTaskDecompositionInput(input),
      },
    ];
    const trace: TaskDecompositionProviderResult["trace"] = {
      modelTurns: 0,
      toolCalls: [],
    };

    for (let turn = 1; turn <= MAX_MODEL_TURNS; turn += 1) {
      const response = await this.requestModel(toResponseInputItems(history));
      trace.modelTurns = turn;

      if (response.status !== "completed" || !Array.isArray(response.output)) {
        throw new TaskDecompositionProviderError("invalid_response");
      }

      const functionCalls = response.output.filter(
        (item) => item.type === "function_call",
      );

      if (functionCalls.length === 0) {
        if (response.output_parsed === null) {
          throw new TaskDecompositionProviderError("invalid_response");
        }

        return { output: response.output_parsed, trace };
      }

      if (
        turn === MAX_MODEL_TURNS ||
        trace.toolCalls.length + functionCalls.length > MAX_TOOL_CALLS
      ) {
        throw new TaskDecompositionProviderError("limit_reached");
      }

      // response.output is an array. Keep every replayable item flat and ordered.
      history.push(...response.output);

      for (const functionCall of functionCalls) {
        if (functionCall.name !== GET_EXISTING_SUBTASKS_TOOL) {
          throw new TaskDecompositionProviderError("invalid_tool_call");
        }

        try {
          getExistingSubtasksArgumentsSchema.parse(
            JSON.parse(functionCall.arguments),
          );
        } catch {
          throw new TaskDecompositionProviderError("invalid_tool_call");
        }

        const toolOutput = await tools.getExistingSubtasks();
        trace.toolCalls.push(GET_EXISTING_SUBTASKS_TOOL);
        history.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: JSON.stringify(toolOutput),
        });
      }
    }

    throw new TaskDecompositionProviderError("limit_reached");
  }

  private async requestModel(input: ResponseInputItem[]) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.client.responses.parse({
          model: this.model,
          instructions: TASK_DECOMPOSITION_INSTRUCTIONS,
          input,
          store: false,
          parallel_tool_calls: false,
          tool_choice: "auto",
          tools: [
            {
              type: "function",
              name: GET_EXISTING_SUBTASKS_TOOL,
              description:
                "Read the root task's current subtasks when their details are needed to avoid duplicates or understand completed scope.",
              strict: true,
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            },
          ],
          text: {
            format: zodTextFormat(
              taskDecompositionProviderOutputSchema,
              "task_decomposition",
            ),
          },
        });
      } catch (error) {
        if (error instanceof TaskDecompositionProviderError) {
          throw error;
        }

        if (attempt === 0 && isRetryableProviderError(error)) {
          await waitBeforeRetry();
          continue;
        }

        throw new TaskDecompositionProviderError("unavailable");
      }
    }

    throw new TaskDecompositionProviderError("unavailable");
  }
}
