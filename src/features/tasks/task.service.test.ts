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
