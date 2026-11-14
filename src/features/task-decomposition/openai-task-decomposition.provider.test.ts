import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { OpenAITaskDecompositionProvider } from "./openai-task-decomposition.provider";
import { TaskDecompositionProviderError } from "./task-decomposition.provider";

const input = {
  sourceTask: {
    title: "Build preview",
    description: "Generate structured subtasks.",
    priority: "HIGH" as const,
  },
  existingSubtaskCount: 1,
  clarificationHistory: [],
};

const decomposedOutput = {
  outcome: "decomposed" as const,
  subtasks: [
    {
      title: "Define the contract",
      description: "Document the preview contract.",
      priority: "HIGH" as const,
    },
    {
      title: "Implement the preview",
      description: "Return validated generated subtasks.",
      priority: "MEDIUM" as const,
    },
  ],
  reason: null,
  questions: [],
};

const clarificationOutput = {
  outcome: "needs_clarification" as const,
  subtasks: [],
  reason: "The expected result is unclear.",
  questions: ["What should the task produce?"],
};

function createClient(parse: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { parse } } as unknown as OpenAI;
}

function createTools() {
  return {
    getExistingSubtasks: vi.fn().mockResolvedValue([
      {
        title: "Existing step",
        description: "Already completed scope.",
        priority: "MEDIUM" as const,
      },
    ]),
  };
}

function functionCall(
  argumentsValue = "{}",
  callId = "call-existing-subtasks",
) {
  return {
    type: "function_call" as const,
    id: `item-${callId}`,
    call_id: callId,
    name: "get_existing_subtasks",
    arguments: argumentsValue,
    status: "completed" as const,
  };
}

describe("OpenAITaskDecompositionProvider", () => {
  it("returns a clear-task decomposition without an unnecessary tool call", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [],
      output_parsed: decomposedOutput,
    });
    const tools = createTools();
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).resolves.toEqual({
      output: decomposedOutput,
      trace: { modelTurns: 1, toolCalls: [] },
    });
    expect(tools.getExistingSubtasks).not.toHaveBeenCalled();
  });

  it("executes a model-selected existing-subtasks tool and supplies its result before the final output", async () => {
    const call = functionCall();
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [call],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [],
        output_parsed: decomposedOutput,
      });
    const tools = createTools();
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).resolves.toMatchObject({
      output: decomposedOutput,
      trace: {
        modelTurns: 2,
        toolCalls: ["get_existing_subtasks"],
      },
    });
    expect(tools.getExistingSubtasks).toHaveBeenCalledTimes(1);

    const secondRequest = parse.mock.calls[1][0];
    expect(secondRequest.input).toHaveLength(3);
    expect(secondRequest.input.some(Array.isArray)).toBe(false);
    expect(secondRequest.input[1]).toMatchObject(call);
    expect(secondRequest.input[2]).toEqual({
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(await tools.getExistingSubtasks.mock.results[0].value),
    });
  });

  it("returns clarification questions for an ambiguous task", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [],
      output_parsed: clarificationOutput,
    });
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).resolves.toMatchObject({
      output: clarificationOutput,
    });
  });

  it("keeps clarification answers in untrusted user input and lets them affect the next result", async () => {
    const parse = vi.fn().mockImplementation((request) => {
      const content = request.input[0].content as string;
      const hasAnswer = content.includes("A validated JSON preview.");

      return Promise.resolve({
        status: "completed",
        output: [],
        output_parsed: hasAnswer ? decomposedOutput : clarificationOutput,
      });
    });
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );
    const clarifiedInput = {
      ...input,
      clarificationHistory: [
        {
          items: [
            {
              question: "What should the task produce?",
              answer: "A validated JSON preview.",
            },
          ],
        },
      ],
    };

    await expect(provider.generate(input, createTools())).resolves.toMatchObject({
      output: clarificationOutput,
    });
    await expect(
      provider.generate(clarifiedInput, createTools()),
    ).resolves.toMatchObject({ output: decomposedOutput });

    const request = parse.mock.calls[1][0];
    expect(request.instructions).not.toContain("A validated JSON preview.");
    expect(JSON.parse(request.input[0].content)).toMatchObject({
      sourceTask: input.sourceTask,
      clarificationHistory: clarifiedInput.clarificationHistory,
    });
  });

  it("rejects invalid tool arguments before execution", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [functionCall('{"taskId":"frontend-controlled"}')],
      output_parsed: null,
    });
    const tools = createTools();
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).rejects.toMatchObject({
      kind: "invalid_tool_call",
    });
    expect(tools.getExistingSubtasks).not.toHaveBeenCalled();
  });

  it("stops when a function call arrives on the final allowed model turn", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [functionCall()],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [functionCall("{}", "call-again")],
        output_parsed: null,
      });
    const tools = createTools();
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).rejects.toMatchObject({
      kind: "limit_reached",
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(tools.getExistingSubtasks).toHaveBeenCalledTimes(1);
  });

  it("stops before execution when a turn exceeds the tool-call limit", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [functionCall(), functionCall("{}", "call-second")],
      output_parsed: null,
    });
    const tools = createTools();
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).rejects.toMatchObject({
      kind: "limit_reached",
    });
    expect(tools.getExistingSubtasks).not.toHaveBeenCalled();
  });

  it("handles an unexpected completed response safely", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output_parsed: null,
    });
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("retries one transient failure and returns parsed output", async () => {
    const parse = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("rate limited"), { status: 429 }),
      )
      .mockResolvedValue({
        status: "completed",
        output: [],
        output_parsed: clarificationOutput,
      });
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).resolves.toMatchObject({
      output: clarificationOutput,
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient provider failure", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("unauthorized"), { status: 401 }),
      );
    const provider = new OpenAITaskDecompositionProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).rejects.toBeInstanceOf(
      TaskDecompositionProviderError,
    );
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
