import type { PrismaClient, Task } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { CreateTaskInput } from "./task.schemas";
import { TaskService } from "./task.service";

const input: CreateTaskInput = {
  title: "Implement task creation",
  description: "Add the first backend endpoint.",
  status: "TODO",
  priority: "HIGH",
};

const taskRecord: Task = {
  id: "task-id",
  ...input,
  parentTaskId: null,
  createdAt: new Date("2026-11-14T00:00:00.000Z"),
  updatedAt: new Date("2026-11-14T00:00:00.000Z"),
};

const createdTask: Task & { subtasks: Task[] } = {
  ...taskRecord,
  subtasks: [],
};

function createDatabaseMock() {
  return {
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn().mockResolvedValue(createdTask),
    },
  } as unknown as PrismaClient;
}

describe("TaskService.create", () => {
  it("creates a root task without a parent lookup", async () => {
    const database = createDatabaseMock();
    const service = new TaskService(database);

    await expect(service.create(input)).resolves.toEqual(createdTask);
    expect(database.task.findUnique).not.toHaveBeenCalled();
    expect(database.task.create).toHaveBeenCalledWith({
      data: { ...input, parentTaskId: null },
      include: { subtasks: true },
    });
  });

  it("creates a subtask under a root task", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue({
      ...taskRecord,
      id: "parent-id",
      parentTaskId: null,
    });
    const service = new TaskService(database);

    await service.create({ ...input, parentTaskId: "parent-id" });

    expect(database.task.create).toHaveBeenCalledWith({
      data: { ...input, parentTaskId: "parent-id" },
      include: { subtasks: true },
    });
  });

  it("rejects a missing parent", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue(null);
    const service = new TaskService(database);

    await expect(
      service.create({ ...input, parentTaskId: "missing-id" }),
    ).rejects.toMatchObject({
      status: 404,
      code: "PARENT_TASK_NOT_FOUND",
    });
  });

  it("rejects nesting below a subtask", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue({
      ...taskRecord,
      id: "subtask-id",
      parentTaskId: "root-id",
    });
    const service = new TaskService(database);

    await expect(
      service.create({ ...input, parentTaskId: "subtask-id" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "INVALID_TASK_HIERARCHY",
    });
  });
});

describe("TaskService Agent B reads", () => {
  it("loads the source task with only a subtask count", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue({
      ...taskRecord,
      _count: { subtasks: 2 },
    } as never);
    const service = new TaskService(database);

    await expect(service.getDecompositionSource(taskRecord.id)).resolves.toEqual({
      ...taskRecord,
      existingSubtaskCount: 2,
    });
    expect(database.task.findUnique).toHaveBeenCalledWith({
      where: { id: taskRecord.id },
      include: { _count: { select: { subtasks: true } } },
    });
    expect(database.task.findMany).not.toHaveBeenCalled();
  });

  it("loads subtask details through the separate read-only query", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findMany).mockResolvedValue([taskRecord]);
    const service = new TaskService(database);

    await expect(service.listSubtasks("root-id")).resolves.toEqual([taskRecord]);
    expect(database.task.findMany).toHaveBeenCalledWith({
      where: { parentTaskId: "root-id" },
    });
  });
});

const subtaskRecord: Task = {
  ...taskRecord,
  id: "subtask-id",
  title: "Implement task search",
  description: "Search task titles and descriptions.",
  parentTaskId: taskRecord.id,
};

describe("TaskService Agent D reads", () => {
  it("loads a root task with its subtasks and no parent context", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue({
      ...taskRecord,
      subtasks: [subtaskRecord],
      parentTask: null,
    } as never);
    const service = new TaskService(database);

    await expect(service.getReadinessContext(taskRecord.id)).resolves.toEqual({
      task: {
        id: taskRecord.id,
        title: taskRecord.title,
        description: taskRecord.description,
        status: taskRecord.status,
        priority: taskRecord.priority,
        parentTaskId: null,
      },
      subtasks: [
        {
          id: subtaskRecord.id,
          title: subtaskRecord.title,
          description: subtaskRecord.description,
          status: subtaskRecord.status,
          priority: subtaskRecord.priority,
          parentTaskId: taskRecord.id,
        },
      ],
      parentTask: null,
    });
    expect(database.task.findUnique).toHaveBeenCalledWith({
      where: { id: taskRecord.id },
      include: { subtasks: true, parentTask: true },
    });
  });

  it("provides parent context when the selected task is a subtask", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue({
      ...subtaskRecord,
      subtasks: [],
      parentTask: taskRecord,
    } as never);
    const service = new TaskService(database);

    const context = await service.getReadinessContext(subtaskRecord.id);

    expect(context.task.id).toBe(subtaskRecord.id);
    expect(context.subtasks).toEqual([]);
    expect(context.parentTask).toMatchObject({
      id: taskRecord.id,
      title: taskRecord.title,
      parentTaskId: null,
    });
  });

  it("fails required inspection when the selected task is missing", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findUnique).mockResolvedValue(null);
    const service = new TaskService(database);

    await expect(service.getReadinessContext("missing-id")).rejects.toMatchObject({
      status: 404,
      code: "TASK_NOT_FOUND",
    });
  });

  it("searches titles and descriptions, excludes the selected task, and ranks candidates", async () => {
    const database = createDatabaseMock();
    const exactTitle: Task = {
      ...taskRecord,
      id: "exact-title",
      title: "OAuth password",
      description: "Replace password authentication.",
      updatedAt: new Date("2026-11-14T01:00:00.000Z"),
    };
    const descriptionMatch: Task = {
      ...taskRecord,
      id: "description-match",
      title: "Reset credentials",
      description: "Add password recovery while OAuth is evaluated.",
      updatedAt: new Date("2026-11-14T02:00:00.000Z"),
    };
    vi.mocked(database.task.findMany).mockResolvedValue([
      descriptionMatch,
      exactTitle,
    ]);
    const service = new TaskService(database);

    const results = await service.findRelatedTasks(
      taskRecord.id,
      "OAuth password",
      2,
    );

    expect(results.map((task) => task.id)).toEqual([
      exactTitle.id,
      descriptionMatch.id,
    ]);
    expect(results[0]).not.toHaveProperty("createdAt");
    expect(database.task.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: taskRecord.id },
        OR: [
          { title: { contains: "oauth password" } },
          { description: { contains: "oauth password" } },
          { title: { contains: "oauth" } },
          { description: { contains: "oauth" } },
          { title: { contains: "password" } },
          { description: { contains: "password" } },
        ],
      },
      take: 50,
    });
  });

  it("caps related results and does not execute an empty search", async () => {
    const database = createDatabaseMock();
    vi.mocked(database.task.findMany).mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        ...taskRecord,
        id: `candidate-${index}`,
        title: `Search candidate ${index}`,
      })),
    );
    const service = new TaskService(database);

    await expect(
      service.findRelatedTasks(taskRecord.id, "search", 100),
    ).resolves.toHaveLength(10);
    vi.mocked(database.task.findMany).mockClear();
    await expect(
      service.findRelatedTasks(taskRecord.id, "   ", 10),
    ).resolves.toEqual([]);
    expect(database.task.findMany).not.toHaveBeenCalled();
  });
});

const confirmedSubtasks = [
  {
    title: "Implement confirmation",
    description: "Create every accepted subtask in one transaction.",
    priority: "HIGH" as const,
  },
  {
    title: "Verify confirmation",
    description: "Cover conflicts and atomic failure behavior.",
    priority: "MEDIUM" as const,
  },
];

function createTransactionDatabaseMock(options?: {
  sourceTask?: { id: string; parentTaskId: string | null } | null;
  existingTitles?: string[];
  createFailureAt?: number;
}) {
  const sourceTask = options?.sourceTask === undefined
    ? { id: taskRecord.id, parentTaskId: null }
    : options.sourceTask;
  const transaction = {
    task: {
      findUnique: vi.fn().mockResolvedValue(sourceTask),
      findMany: vi.fn().mockResolvedValue(
        (options?.existingTitles ?? []).map((title) => ({ title })),
      ),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const callIndex = transaction.task.create.mock.calls.length;

        if (options?.createFailureAt === callIndex) {
          throw new Error("database write failed");
        }

        return {
          ...taskRecord,
          ...data,
          id: `created-${callIndex}`,
        };
      }),
    },
  };
  const transactionRunner = vi.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const database = {
    $transaction: transactionRunner,
  } as unknown as PrismaClient;

  return { database, transaction, transactionRunner };
}

describe("TaskService.confirmDecomposition", () => {
  it("creates every confirmed subtask inside one transaction", async () => {
    const { database, transaction, transactionRunner } =
      createTransactionDatabaseMock();
    const service = new TaskService(database);

    await expect(
      service.confirmDecomposition(taskRecord.id, confirmedSubtasks),
    ).resolves.toHaveLength(2);
    expect(transactionRunner).toHaveBeenCalledTimes(1);
    expect(transaction.task.findUnique).toHaveBeenCalledWith({
      where: { id: taskRecord.id },
      select: { id: true, parentTaskId: true },
    });
    expect(transaction.task.create).toHaveBeenNthCalledWith(1, {
      data: {
        ...confirmedSubtasks[0],
        status: "TODO",
        parentTaskId: taskRecord.id,
      },
    });
    expect(transaction.task.create).toHaveBeenNthCalledWith(2, {
      data: {
        ...confirmedSubtasks[1],
        status: "TODO",
        parentTaskId: taskRecord.id,
      },
    });
  });

  it("rejects a current-title conflict before writing anything", async () => {
    const { database, transaction } = createTransactionDatabaseMock({
      existingTitles: ["  IMPLEMENT CONFIRMATION  "],
    });
    const service = new TaskService(database);

    await expect(
      service.confirmDecomposition(taskRecord.id, confirmedSubtasks),
    ).rejects.toMatchObject({
      status: 409,
      code: "DECOMPOSITION_CONFLICT",
    });
    expect(transaction.task.create).not.toHaveBeenCalled();
  });

  it("rejects a subtask as the decomposition source", async () => {
    const { database, transaction } = createTransactionDatabaseMock({
      sourceTask: { id: "subtask-id", parentTaskId: taskRecord.id },
    });
    const service = new TaskService(database);

    await expect(
      service.confirmDecomposition("subtask-id", confirmedSubtasks),
    ).rejects.toMatchObject({
      status: 409,
      code: "TASK_DECOMPOSITION_NOT_ALLOWED",
    });
    expect(transaction.task.findMany).not.toHaveBeenCalled();
    expect(transaction.task.create).not.toHaveBeenCalled();
  });

  it("propagates a write failure from the single atomic transaction", async () => {
    const { database, transactionRunner } = createTransactionDatabaseMock({
      createFailureAt: 2,
    });
    const service = new TaskService(database);

    await expect(
      service.confirmDecomposition(taskRecord.id, confirmedSubtasks),
    ).rejects.toThrow("database write failed");
    expect(transactionRunner).toHaveBeenCalledTimes(1);
  });
});

const readinessConfirmation = {
  original: {
    title: taskRecord.title,
    description: taskRecord.description,
  },
  rewrite: {
    title: "Implement validated task creation",
    description: "Add the validated backend task-creation endpoint.",
  },
  snapshotToken: "signed-snapshot",
};

function createReadinessTransactionMock(options?: {
  updateCount?: number;
  currentTask?: { id: string } | null;
  updatedTask?: (Task & { subtasks: Task[] }) | null;
  updateFailure?: Error;
}) {
  const updateMany = options?.updateFailure
    ? vi.fn().mockRejectedValue(options.updateFailure)
    : vi.fn().mockResolvedValue({ count: options?.updateCount ?? 1 });
  const updatedTask = options?.updatedTask === undefined
    ? {
        ...createdTask,
        title: readinessConfirmation.rewrite.title,
        description: readinessConfirmation.rewrite.description,
      }
    : options.updatedTask;
  const findUnique = vi.fn();

  if ((options?.updateCount ?? 1) === 0) {
    findUnique.mockResolvedValue(
      options?.currentTask === undefined
        ? { id: taskRecord.id }
        : options.currentTask,
    );
  } else {
    findUnique.mockResolvedValue(updatedTask);
  }

  const transaction = {
    task: { updateMany, findUnique },
  };
  const transactionRunner = vi.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const database = {
    $transaction: transactionRunner,
  } as unknown as PrismaClient;

  return { database, transaction, transactionRunner };
}

describe("TaskService.confirmReadinessRewrite", () => {
  it("atomically updates only title and description when the snapshot matches", async () => {
    const { database, transaction, transactionRunner } =
      createReadinessTransactionMock();
    const service = new TaskService(database);

    await expect(
      service.confirmReadinessRewrite(taskRecord.id, readinessConfirmation),
    ).resolves.toMatchObject(readinessConfirmation.rewrite);
    expect(transactionRunner).toHaveBeenCalledTimes(1);
    expect(transaction.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: taskRecord.id,
        title: readinessConfirmation.original.title,
        description: readinessConfirmation.original.description,
      },
      data: readinessConfirmation.rewrite,
    });
    expect(transaction.task.findUnique).toHaveBeenCalledWith({
      where: { id: taskRecord.id },
      include: { subtasks: true },
    });
  });

  it("rejects a stale preview without overwriting newer task text", async () => {
    const { database, transaction } = createReadinessTransactionMock({
      updateCount: 0,
      currentTask: { id: taskRecord.id },
    });
    const service = new TaskService(database);

    await expect(
      service.confirmReadinessRewrite(taskRecord.id, readinessConfirmation),
    ).rejects.toMatchObject({
      status: 409,
      code: "TASK_READINESS_CONFLICT",
    });
    expect(transaction.task.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.task.findUnique).toHaveBeenCalledWith({
      where: { id: taskRecord.id },
      select: { id: true },
    });
  });

  it("returns not found when the selected task was deleted", async () => {
    const { database } = createReadinessTransactionMock({
      updateCount: 0,
      currentTask: null,
    });
    const service = new TaskService(database);

    await expect(
      service.confirmReadinessRewrite(taskRecord.id, readinessConfirmation),
    ).rejects.toMatchObject({ status: 404, code: "TASK_NOT_FOUND" });
  });

  it("propagates a conditional update failure from the transaction", async () => {
    const { database, transactionRunner } = createReadinessTransactionMock({
      updateFailure: new Error("database update failed"),
    });
    const service = new TaskService(database);

    await expect(
      service.confirmReadinessRewrite(taskRecord.id, readinessConfirmation),
    ).rejects.toThrow("database update failed");
    expect(transactionRunner).toHaveBeenCalledTimes(1);
  });
});
