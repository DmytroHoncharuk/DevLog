import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { OpenAITaskReadinessProvider } from "./openai-task-readiness.provider";
import { TaskReadinessProviderError } from "./task-readiness.provider";

const input = { taskId: "task-1", clarificationHistory: [] };
const readyOutput = {
  outcome: "ready",
  criteria: Object.fromEntries(
    [
      "clarity",
      "scope",
      "acceptance_criteria",
      "testability",
      "dependencies",
    ].map((criterion) => [
      criterion,
      { status: "pass", explanation: `${criterion} is sufficient.` },
    ]),
  ),
  explanation: "The task is ready.",
  dependencyVerification: {
    status: "not_performed",
    explanation: "Related search was not needed.",
  },
  questions: [],
  proposedTitle: null,
  proposedDescription: null,
};

function createClient(parse: ReturnType<typeof vi.fn>): OpenAI {
  return { responses: { parse } } as unknown as OpenAI;
}

function createTools(options?: { searchFailure?: boolean }) {
  return {
    getTaskWithSubtasks: vi.fn().mockResolvedValue({
      task: {
        id: input.taskId,
        title: "Implement search",
        description: "Search titles using substring matching.",
        status: "TODO" as const,
        priority: "MEDIUM" as const,
        parentTaskId: null,
      },
      subtasks: [],
      parentTask: null,
    }),
    findRelatedTasks: options?.searchFailure
      ? vi.fn().mockRejectedValue(new Error("search failed"))
      : vi.fn().mockResolvedValue([
          {
            id: "related-1",
            title: "Existing search",
            description: "Search descriptions.",
            status: "TODO" as const,
            priority: "LOW" as const,
            parentTaskId: null,
          },
        ]),
  };
}

function functionCall(
  name: "get_task_with_subtasks" | "find_related_tasks",
  args: object,
  callId: string,
) {
  return {
    type: "function_call" as const,
    id: `item-${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    status: "completed" as const,
  };
}

describe("OpenAITaskReadinessProvider", () => {
  it("forces task inspection, replays its result, and may finish without search", async () => {
    const inspection = functionCall(
      "get_task_with_subtasks",
      { taskId: input.taskId },
      "inspect",
    );
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [inspection],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [],
        output_parsed: readyOutput,
      });
    const tools = createTools();
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).resolves.toMatchObject({
      output: readyOutput,
      trace: {
        modelTurns: 2,
        toolCalls: ["get_task_with_subtasks"],
        inspectionPerformed: true,
        relatedSearchPerformed: false,
      },
    });
    expect(parse.mock.calls[0][0].tool_choice).toEqual({
      type: "function",
      name: "get_task_with_subtasks",
    });
    expect(parse.mock.calls[1][0].tool_choice).toBe("auto");
    expect(parse.mock.calls[1][0].input).toHaveLength(3);
    expect(parse.mock.calls[1][0].input.some(Array.isArray)).toBe(false);
  });

  it("executes model-selected related search and returns its evidence", async () => {
    const inspection = functionCall(
      "get_task_with_subtasks",
      { taskId: input.taskId },
      "inspect",
    );
    const search = functionCall(
      "find_related_tasks",
      { query: "task search", limit: 5 },
      "search",
    );
    const searchedOutput = {
      ...readyOutput,
      dependencyVerification: {
        status: "completed",
        explanation: "Related candidates were examined.",
      },
    };
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [inspection],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [search],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [],
        output_parsed: searchedOutput,
      });
    const tools = createTools();
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).resolves.toMatchObject({
      trace: {
        modelTurns: 3,
        toolCalls: ["get_task_with_subtasks", "find_related_tasks"],
        relatedSearchPerformed: true,
      },
    });
    expect(tools.findRelatedTasks).toHaveBeenCalledWith({
      query: "task search",
      limit: 5,
    });
    expect(parse.mock.calls[2][0].input.at(-1)).toEqual({
      type: "function_call_output",
      call_id: "search",
      output: JSON.stringify(await tools.findRelatedTasks.mock.results[0].value),
    });
  });

  it("returns a safe tool result when optional search fails", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "get_task_with_subtasks",
            { taskId: input.taskId },
            "inspect",
          ),
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "find_related_tasks",
            { query: "conflict", limit: 5 },
            "search",
          ),
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [],
        output_parsed: {
          ...readyOutput,
          dependencyVerification: {
            status: "failed",
            explanation: "Related verification failed.",
          },
        },
      });
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(
      provider.generate(input, createTools({ searchFailure: true })),
    ).resolves.toMatchObject({
      trace: { relatedSearchPerformed: true },
    });
    expect(JSON.parse(parse.mock.calls[2][0].input.at(-1).output)).toEqual({
      error: "RELATED_TASK_SEARCH_FAILED",
      message: "Related-task verification could not be completed.",
    });
  });

  it("rejects a final result before required inspection", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [],
      output_parsed: readyOutput,
    });
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("rejects inspection of a different task", async () => {
    const parse = vi.fn().mockResolvedValue({
      status: "completed",
      output: [
        functionCall(
          "get_task_with_subtasks",
          { taskId: "other-task" },
          "inspect",
        ),
      ],
      output_parsed: null,
    });
    const tools = createTools();
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).rejects.toMatchObject({
      kind: "invalid_tool_call",
    });
    expect(tools.getTaskWithSubtasks).not.toHaveBeenCalled();
  });

  it("rejects repeated identical related searches", async () => {
    const search = () =>
      functionCall(
        "find_related_tasks",
        { query: "duplicate", limit: 5 },
        `search-${Math.random()}`,
      );
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "get_task_with_subtasks",
            { taskId: input.taskId },
            "inspect",
          ),
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [search()],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [search()],
        output_parsed: null,
      });
    const tools = createTools();
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, tools)).rejects.toMatchObject({
      kind: "invalid_tool_call",
    });
    expect(tools.findRelatedTasks).toHaveBeenCalledTimes(1);
  });

  it("enforces the final model-turn limit", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "get_task_with_subtasks",
            { taskId: input.taskId },
            "inspect",
          ),
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "find_related_tasks",
            { query: "first", limit: 5 },
            "search-1",
          ),
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "find_related_tasks",
            { query: "second", limit: 5 },
            "search-2",
          ),
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        status: "completed",
        output: [
          functionCall(
            "find_related_tasks",
            { query: "third", limit: 5 },
            "search-3",
          ),
        ],
        output_parsed: null,
      });
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).rejects.toMatchObject({
      kind: "limit_reached",
    });
    expect(parse).toHaveBeenCalledTimes(4);
  });

  it("retries one transient failure but not an authentication failure", async () => {
    const inspectionResponse = {
      status: "completed",
      output: [
        functionCall(
          "get_task_with_subtasks",
          { taskId: input.taskId },
          "inspect",
        ),
      ],
      output_parsed: null,
    };
    const parse = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { status: 503 }))
      .mockResolvedValueOnce(inspectionResponse)
      .mockResolvedValueOnce({
        status: "completed",
        output: [],
        output_parsed: readyOutput,
      });
    const provider = new OpenAITaskReadinessProvider(
      createClient(parse),
      "configured-model",
    );

    await expect(provider.generate(input, createTools())).resolves.toMatchObject({
      output: readyOutput,
    });
    expect(parse).toHaveBeenCalledTimes(3);

    const denied = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("denied"), { status: 401 }));
    const deniedProvider = new OpenAITaskReadinessProvider(
      createClient(denied),
      "configured-model",
    );
    await expect(
      deniedProvider.generate(input, createTools()),
    ).rejects.toBeInstanceOf(TaskReadinessProviderError);
    expect(denied).toHaveBeenCalledTimes(1);
  });
});
