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
