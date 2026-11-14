import { describe, expect, it, vi } from "vitest";

import type {
  TaskReadinessProvider,
  TaskReadinessTools,
} from "./task-readiness.provider";
import {
  TaskReadinessConfirmationService,
  TaskReadinessService,
  type TaskReadinessTaskAccess,
  type TaskReadinessTaskWriter,
} from "./task-readiness.service";
import type { TaskReadinessSnapshotManager } from "./task-readiness.snapshot";

const task = {
  id: "task-1",
  title: "Improve search",
  description: "Make task search convenient.",
  status: "TODO" as const,
  priority: "MEDIUM" as const,
  parentTaskId: null,
};

const context = { task, subtasks: [], parentTask: null };
const assessment = {
  status: "pass" as const,
  explanation: "The requirement is supported.",
};
const criteria = {
  clarity: assessment,
  scope: assessment,
  acceptance_criteria: assessment,
  testability: assessment,
  dependencies: assessment,
};

function output(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    outcome: "ready",
    criteria,
    explanation: "The task is ready.",
    dependencyVerification: {
      status: "not_performed",
      explanation: "Search was not needed.",
    },
    questions: [],
    proposedTitle: null,
    proposedDescription: null,
    ...overrides,
  };
}

function createAccess(options?: { searchFailure?: boolean }) {
  return {
    getReadinessContext: vi.fn().mockResolvedValue(context),
    findRelatedTasks: options?.searchFailure
      ? vi.fn().mockRejectedValue(new Error("search failed"))
      : vi.fn().mockResolvedValue([]),
  } satisfies TaskReadinessTaskAccess;
}

function createSnapshotManager(): TaskReadinessSnapshotManager {
  return {
    create: vi.fn().mockReturnValue("signed-token"),
    verify: vi.fn().mockReturnValue({
      taskId: task.id,
      title: task.title,
      description: task.description,
    }),
  };
}

function createProvider(
  providerOutput: unknown,
  options?: { search?: boolean; discloseFailedSearch?: boolean },
): TaskReadinessProvider {
  return {
    generate: vi.fn().mockImplementation(
      async (
        input: { taskId: string },
        tools: TaskReadinessTools,
      ) => {
        await tools.getTaskWithSubtasks({ taskId: input.taskId });
        let searchFailed = false;

        if (options?.search) {
          try {
            await tools.findRelatedTasks({ query: "search", limit: 5 });
          } catch {
            searchFailed = true;
          }
        }

        return {
          output:
            searchFailed && options?.discloseFailedSearch
              ? output({
                  dependencyVerification: {
                    status: "failed",
                    explanation: "Related search failed.",
                  },
                })
              : providerOutput,
          trace: {
            modelTurns: options?.search ? 3 : 2,
            toolCalls: options?.search
              ? ["get_task_with_subtasks", "find_related_tasks"]
              : ["get_task_with_subtasks"],
            inspectionPerformed: true,
            relatedSearchPerformed: options?.search ?? false,
          },
        };
      },
    ),
  };
}

describe("TaskReadinessService.analyze", () => {
  it("performs required inspection and returns ready without a search", async () => {
    const access = createAccess();
    const service = new TaskReadinessService(
      createProvider(output()),
      access,
      createSnapshotManager(),
    );

    await expect(service.analyze(task.id)).resolves.toMatchObject({
      result: { outcome: "ready" },
      trace: {
        inspectionPerformed: true,
        relatedSearchPerformed: false,
      },
      clarificationRoundsUsed: 0,
      clarificationRoundsRemaining: 2,
      snapshot: null,
    });
    expect(access.getReadinessContext).toHaveBeenCalledWith(task.id);
    expect(access.findRelatedTasks).not.toHaveBeenCalled();
  });

  it("rejects a provider that claims inspection without calling the tool", async () => {
    const provider: TaskReadinessProvider = {
      generate: vi.fn().mockResolvedValue({
        output: output(),
        trace: {
          modelTurns: 1,
          toolCalls: [],
          inspectionPerformed: true,
          relatedSearchPerformed: false,
        },
      }),
    };
    const service = new TaskReadinessService(provider, createAccess());

    await expect(service.analyze(task.id)).rejects.toMatchObject({
      status: 502,
      code: "AI_PROVIDER_INVALID_RESPONSE",
    });
  });

  it("creates a signed original-text snapshot only for a rewrite", async () => {
    const snapshots = createSnapshotManager();
    const service = new TaskReadinessService(
      createProvider(
        output({
          outcome: "rewrite_proposed",
          proposedTitle: "Define task search",
          proposedDescription: "Search titles using substring matching.",
        }),
      ),
      createAccess(),
      snapshots,
    );

    await expect(service.analyze(task.id)).resolves.toMatchObject({
      result: { outcome: "rewrite_proposed" },
      snapshot: {
        original: { title: task.title, description: task.description },
        token: "signed-token",
      },
    });
    expect(snapshots.create).toHaveBeenCalledWith({
      taskId: task.id,
      title: task.title,
      description: task.description,
    });
  });

  it("permits an honestly disclosed optional search failure", async () => {
    const service = new TaskReadinessService(
      createProvider(output(), { search: true, discloseFailedSearch: true }),
      createAccess({ searchFailure: true }),
    );

    await expect(service.analyze(task.id)).resolves.toMatchObject({
      result: {
        dependencyVerification: { status: "failed" },
      },
      trace: { relatedSearchPerformed: true },
    });
  });

  it("rejects a failed or skipped search represented as completed", async () => {
    const failedSearch = new TaskReadinessService(
      createProvider(
        output({
          dependencyVerification: {
            status: "completed",
            explanation: "Incorrect claim.",
          },
        }),
        { search: true },
      ),
      createAccess({ searchFailure: true }),
    );
    await expect(failedSearch.analyze(task.id)).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
    });

    const skippedSearch = new TaskReadinessService(
      createProvider(
        output({
          dependencyVerification: {
            status: "completed",
            explanation: "Incorrect claim.",
          },
        }),
      ),
      createAccess(),
    );
    await expect(skippedSearch.analyze(task.id)).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
    });
  });

  it("passes validated clarification history and enforces two rounds", async () => {
    const history = [
      { items: [{ question: "Behavior?", answer: "Substring search." }] },
      { items: [{ question: "Fields?", answer: "Titles only." }] },
    ];
    const clarificationOutput = output({
      outcome: "needs_clarification",
      questions: [{ question: "Case sensitivity?" }],
    });
    const provider = createProvider(clarificationOutput);
    const service = new TaskReadinessService(provider, createAccess());

    await expect(service.analyze(task.id, history)).rejects.toMatchObject({
      status: 422,
      code: "CLARIFICATION_LIMIT_REACHED",
    });
    expect(provider.generate).toHaveBeenCalledWith(
      { taskId: task.id, clarificationHistory: history },
      expect.anything(),
    );
  });

  it("propagates fatal primary inspection failure", async () => {
    const access = createAccess();
    vi.mocked(access.getReadinessContext).mockRejectedValue(
      Object.assign(new Error("not found"), { code: "TASK_NOT_FOUND" }),
    );
    const service = new TaskReadinessService(createProvider(output()), access);

    await expect(service.analyze(task.id)).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
  });
});

describe("TaskReadinessConfirmationService.confirm", () => {
  const confirmation = {
    original: { title: task.title, description: task.description },
    rewrite: {
      title: "Define task search",
      description: "Search titles using substring matching.",
    },
    snapshotToken: "signed-token",
  };

  it("verifies the signed task snapshot before forwarding the rewrite", async () => {
    const writer: TaskReadinessTaskWriter = {
      confirmReadinessRewrite: vi.fn().mockResolvedValue({
        ...task,
        ...confirmation.rewrite,
        createdAt: new Date(),
        updatedAt: new Date(),
        subtasks: [],
      }),
    };
    const snapshots = createSnapshotManager();
    const service = new TaskReadinessConfirmationService(writer, snapshots);

    await service.confirm(task.id, confirmation);

    expect(snapshots.verify).toHaveBeenCalledWith("signed-token", task.id);
    expect(writer.confirmReadinessRewrite).toHaveBeenCalledWith(
      task.id,
      confirmation,
    );
  });

  it("rejects a tampered or cross-task snapshot before persistence", async () => {
    const writer: TaskReadinessTaskWriter = {
      confirmReadinessRewrite: vi.fn(),
    };
    const snapshots = createSnapshotManager();
    vi.mocked(snapshots.verify).mockReturnValue(null);
    const service = new TaskReadinessConfirmationService(writer, snapshots);

    await expect(service.confirm("other-task", confirmation)).rejects.toMatchObject(
      { status: 400, code: "VALIDATION_ERROR" },
    );
    expect(writer.confirmReadinessRewrite).not.toHaveBeenCalled();
  });
});
