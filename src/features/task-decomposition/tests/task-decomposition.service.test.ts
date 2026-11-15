import type { Task } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  type TaskDecompositionProvider,
  TaskDecompositionProviderError,
} from "../task-decomposition.provider";
import {
  TaskDecompositionConfirmationService,
  TaskDecompositionService,
  type TaskDecompositionTaskReader,
  type TaskDecompositionTaskWriter,
} from "../task-decomposition.service";

const rootTask: Task = {
  id: "root-id",
  title: "Build task decomposition",
  description: "Generate a preview of actionable subtasks.",
  status: "TODO",
  priority: "HIGH",
  parentTaskId: null,
  createdAt: new Date("2026-11-14T00:00:00.000Z"),
  updatedAt: new Date("2026-11-14T00:00:00.000Z"),
};

const existingSubtask: Task = {
  ...rootTask,
  id: "subtask-id",
  title: "Document the contract",
  description: "Record the confirmed behavior.",
  priority: "MEDIUM",
  parentTaskId: rootTask.id,
};

const validProviderOutput = {
  outcome: "decomposed",
  subtasks: [
    {
      title: "Define the schemas",
      description: "Create runtime schemas for both outcomes.",
      priority: "HIGH",
    },
    {
      title: "Implement the preview endpoint",
      description: "Return validated results without persistence.",
      priority: "MEDIUM",
    },
  ],
  reason: null,
  questions: [],
};

function createProvider(output: unknown): TaskDecompositionProvider {
  return {
    generate: vi.fn().mockResolvedValue({
      output,
      trace: { modelTurns: 1, toolCalls: [] },
    }),
  };
}

function createProviderWithExistingSubtasks(
  output: unknown,
): TaskDecompositionProvider {
  return {
    generate: vi.fn().mockImplementation(async (_input, tools) => {
      await tools.getExistingSubtasks();
      return {
        output,
        trace: {
          modelTurns: 2,
          toolCalls: ["get_existing_subtasks"],
        },
      };
    }),
  };
}

function createTaskReader(
  task = { ...rootTask, existingSubtaskCount: 1 },
  subtasks: Task[] = [existingSubtask],
): TaskDecompositionTaskReader {
  return {
    getDecompositionSource: vi.fn().mockResolvedValue(task),
    listSubtasks: vi.fn().mockResolvedValue(subtasks),
  };
}

describe("TaskDecompositionService.preview", () => {
  it("passes only neutral root-task data to the provider", async () => {
    const provider = createProviderWithExistingSubtasks(validProviderOutput);
    const reader = createTaskReader();
    const service = new TaskDecompositionService(provider, reader);

    await expect(service.preview(rootTask.id)).resolves.toMatchObject({
      result: {
        outcome: "decomposed",
        subtasks: validProviderOutput.subtasks,
      },
      trace: { modelTurns: 2, toolCalls: ["get_existing_subtasks"] },
      clarificationRoundsUsed: 0,
      clarificationRoundsRemaining: 2,
    });
    expect(provider.generate).toHaveBeenCalledWith(
      {
        sourceTask: {
          title: rootTask.title,
          description: rootTask.description,
          priority: rootTask.priority,
        },
        existingSubtaskCount: 1,
        clarificationHistory: [],
      },
      expect.objectContaining({
        getExistingSubtasks: expect.any(Function),
      }),
    );

    expect(reader.listSubtasks).toHaveBeenCalledWith(rootTask.id);
  });

  it("rejects a provider that skips required existing-subtask inspection", async () => {
    const reader = createTaskReader();
    const service = new TaskDecompositionService(
      createProvider(validProviderOutput),
      reader,
    );

    await expect(service.preview(rootTask.id)).rejects.toMatchObject({
      status: 502,
      code: "AI_PROVIDER_INVALID_RESPONSE",
    });
    expect(reader.listSubtasks).not.toHaveBeenCalled();
  });

  it("rejects decomposition of a subtask before calling the provider", async () => {
    const provider = createProvider(validProviderOutput);
    const service = new TaskDecompositionService(
      provider,
      createTaskReader({
        ...existingSubtask,
        existingSubtaskCount: 0,
      }),
    );

    await expect(service.preview(existingSubtask.id)).rejects.toMatchObject({
      status: 409,
      code: "TASK_DECOMPOSITION_NOT_ALLOWED",
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("returns a clarification outcome without persistence", async () => {
    const provider = createProvider({
      outcome: "needs_clarification",
      subtasks: [],
      reason: "The expected result is unclear.",
      questions: ["What should the completed task produce?"],
    });
    const reader = createTaskReader({
      ...rootTask,
      existingSubtaskCount: 0,
    });
    const service = new TaskDecompositionService(provider, reader);

    await expect(service.preview(rootTask.id)).resolves.toMatchObject({
      result: {
        outcome: "needs_clarification",
        reason: "The expected result is unclear.",
        questions: ["What should the completed task produce?"],
      },
    });
    expect(reader.getDecompositionSource).toHaveBeenCalledTimes(1);
    expect(reader.listSubtasks).not.toHaveBeenCalled();
  });

  it("returns no new subtasks after inspecting existing scope without persistence", async () => {
    const reader = createTaskReader();
    const service = new TaskDecompositionService(
      createProviderWithExistingSubtasks({
        outcome: "no_new_subtasks",
        subtasks: [],
        reason: "Existing subtasks cover the explicitly stated scope.",
        questions: [],
      }),
      reader,
    );

    await expect(service.preview(rootTask.id)).resolves.toMatchObject({
      result: {
        outcome: "no_new_subtasks",
        reason: "Existing subtasks cover the explicitly stated scope.",
      },
      trace: {
        modelTurns: 2,
        toolCalls: ["get_existing_subtasks"],
      },
    });
    expect(reader.getDecompositionSource).toHaveBeenCalledTimes(1);
    expect(reader.listSubtasks).toHaveBeenCalledTimes(1);
  });

  it("treats existing subtasks as scope coverage regardless of status", async () => {
    const doneSubtask = { ...existingSubtask, status: "DONE" as const };
    const todoSubtask = {
      ...existingSubtask,
      id: "todo-subtask-id",
      title: "Implement the remaining route",
      status: "TODO" as const,
    };
    const reader = createTaskReader(
      { ...rootTask, existingSubtaskCount: 2 },
      [doneSubtask, todoSubtask],
    );
    const provider: TaskDecompositionProvider = {
      generate: vi.fn().mockImplementation(async (_input, tools) => {
        await expect(tools.getExistingSubtasks()).resolves.toEqual([
          {
            title: doneSubtask.title,
            description: doneSubtask.description,
            priority: doneSubtask.priority,
          },
          {
            title: todoSubtask.title,
            description: todoSubtask.description,
            priority: todoSubtask.priority,
          },
        ]);

        return {
          output: {
            outcome: "no_new_subtasks",
            subtasks: [],
            reason: "Existing subtasks cover the stated scope.",
            questions: [],
          },
          trace: {
            modelTurns: 2,
            toolCalls: ["get_existing_subtasks"],
          },
        };
      }),
    };
    const service = new TaskDecompositionService(provider, reader);

    await expect(service.preview(rootTask.id)).resolves.toMatchObject({
      result: { outcome: "no_new_subtasks" },
    });
  });

  it.each([
    {
      ...validProviderOutput,
      subtasks: [
        validProviderOutput.subtasks[0],
        { ...validProviderOutput.subtasks[0], title: " define the schemas " },
      ],
    },
    {
      ...validProviderOutput,
      subtasks: [
        validProviderOutput.subtasks[0],
        { ...validProviderOutput.subtasks[1], title: " document the contract " },
      ],
    },
  ])("rejects duplicate generated titles", async (output) => {
    const service = new TaskDecompositionService(
      createProvider(output),
      createTaskReader(
        { ...rootTask, existingSubtaskCount: 0 },
        [existingSubtask],
      ),
    );

    await expect(service.preview(rootTask.id)).rejects.toMatchObject({
      status: 502,
      code: "AI_PROVIDER_INVALID_RESPONSE",
    });
  });

  it("maps malformed provider output to a safe error", async () => {
    const service = new TaskDecompositionService(
      createProvider({ outcome: "decomposed" }),
      createTaskReader({ ...rootTask, existingSubtaskCount: 0 }),
    );

    await expect(service.preview(rootTask.id)).rejects.toMatchObject({
      status: 502,
      code: "AI_PROVIDER_INVALID_RESPONSE",
      details: [],
    });
  });

  it("maps provider failures without exposing their payload", async () => {
    const provider: TaskDecompositionProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(new TaskDecompositionProviderError("unavailable")),
    };
    const service = new TaskDecompositionService(
      provider,
      createTaskReader({ ...rootTask, existingSubtaskCount: 0 }),
    );

    await expect(service.preview(rootTask.id)).rejects.toMatchObject({
      status: 503,
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "Task decomposition is temporarily unavailable",
      details: [],
    });
  });

  it("passes validated clarification history without replacing the current database task", async () => {
    const provider = createProvider(validProviderOutput);
    const reader = createTaskReader({
      ...rootTask,
      existingSubtaskCount: 0,
    });
    const service = new TaskDecompositionService(provider, reader);
    const clarificationHistory = [
      {
        items: [
          {
            question: "What should be delivered?",
            answer: "A JSON preview.",
          },
        ],
      },
    ];

    await service.preview(rootTask.id, clarificationHistory);

    expect(reader.getDecompositionSource).toHaveBeenCalledWith(rootTask.id);
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTask: expect.objectContaining({ title: rootTask.title }),
        clarificationHistory,
      }),
      expect.anything(),
    );
  });

  it("returns a controlled error when clarification is still needed after two rounds", async () => {
    const provider = createProvider({
      outcome: "needs_clarification",
      subtasks: [],
      reason: "More context is still required.",
      questions: ["Which exact format is required?"],
    });
    const service = new TaskDecompositionService(
      provider,
      createTaskReader({ ...rootTask, existingSubtaskCount: 0 }),
    );
    const clarificationHistory = [
      {
        items: [{ question: "First question?", answer: "First answer." }],
      },
      {
        items: [{ question: "Second question?", answer: "Second answer." }],
      },
    ];

    await expect(
      service.preview(rootTask.id, clarificationHistory),
    ).rejects.toMatchObject({
      status: 422,
      code: "CLARIFICATION_LIMIT_REACHED",
    });
  });

  it("maps agent execution limits to a safe controlled error", async () => {
    const provider: TaskDecompositionProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(new TaskDecompositionProviderError("limit_reached")),
    };
    const service = new TaskDecompositionService(provider, createTaskReader());

    await expect(service.preview(rootTask.id)).rejects.toMatchObject({
      status: 502,
      code: "AI_AGENT_LIMIT_REACHED",
      details: [],
    });
  });
});

describe("TaskDecompositionConfirmationService.confirm", () => {
  it("revalidates and forwards the edited preview without calling a provider", async () => {
    const writer: TaskDecompositionTaskWriter = {
      confirmDecomposition: vi.fn().mockResolvedValue([existingSubtask]),
    };
    const service = new TaskDecompositionConfirmationService(writer);

    await expect(
      service.confirm(rootTask.id, {
        subtasks: [
          {
            title: "  Create the route  ",
            description: "  Persist every confirmed item atomically.  ",
            priority: "HIGH",
          },
        ],
      }),
    ).resolves.toEqual([existingSubtask]);
    expect(writer.confirmDecomposition).toHaveBeenCalledWith(rootTask.id, [
      {
        title: "Create the route",
        description: "Persist every confirmed item atomically.",
        priority: "HIGH",
      },
    ]);
  });

  it("rejects invalid edited previews before persistence", async () => {
    const writer: TaskDecompositionTaskWriter = {
      confirmDecomposition: vi.fn(),
    };
    const service = new TaskDecompositionConfirmationService(writer);

    await expect(
      service.confirm(rootTask.id, { subtasks: [] }),
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(writer.confirmDecomposition).not.toHaveBeenCalled();
  });
});
