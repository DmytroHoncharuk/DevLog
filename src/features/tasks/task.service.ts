import type { Prisma, PrismaClient, Task } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";

import type {
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
} from "./task.schemas";

export type TaskWithSubtasks = Task & {
  subtasks: Task[];
};

const priorityRank = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
} as const;

function compareTasks(
  left: Task,
  right: Task,
  query: ListTasksQuery,
): number {
  let comparison: number;

  switch (query.sortBy) {
    case "createdAt":
    case "updatedAt":
      comparison = left[query.sortBy].getTime() - right[query.sortBy].getTime();
      break;
    case "priority":
      comparison = priorityRank[left.priority] - priorityRank[right.priority];
      break;
    case "title":
    case "status":
      comparison = left[query.sortBy].localeCompare(right[query.sortBy]);
      break;
  }

  if (comparison === 0) {
    comparison = left.id.localeCompare(right.id);
  }

  return query.sortOrder === "asc" ? comparison : -comparison;
}

export class TaskService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(query: ListTasksQuery): Promise<TaskWithSubtasks[]> {
    const where: Prisma.TaskWhereInput = {
      parentTaskId: null,
      status: query.status,
      priority: query.priority,
    };

    const tasks = await this.db.task.findMany({
      where,
      include: { subtasks: true },
    });

    return tasks
      .map((task) => ({
        ...task,
        subtasks: [...task.subtasks].sort((left, right) =>
          compareTasks(left, right, query),
        ),
      }))
      .sort((left, right) => compareTasks(left, right, query));
  }

  async getById(taskId: string): Promise<TaskWithSubtasks> {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: { subtasks: true },
    });

    if (task === null) {
      throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
    }

    return task;
  }

  async create(input: CreateTaskInput): Promise<TaskWithSubtasks> {
    const parentTaskId = input.parentTaskId ?? null;

    if (parentTaskId !== null) {
      const parent = await this.db.task.findUnique({
        where: { id: parentTaskId },
        select: { id: true, parentTaskId: true },
      });

      if (parent === null) {
        throw new ApiError(
          404,
          "PARENT_TASK_NOT_FOUND",
          "Parent task not found",
        );
      }

      if (parent.parentTaskId !== null) {
        throw new ApiError(
          409,
          "INVALID_TASK_HIERARCHY",
          "A subtask cannot have its own subtasks",
        );
      }
    }

    return this.db.task.create({
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        parentTaskId,
      },
      include: { subtasks: true },
    });
  }

  async update(
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskWithSubtasks> {
    const result = await this.db.task.updateMany({
      where: { id: taskId },
      data: input,
    });

    if (result.count === 0) {
      throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
    }

    return this.getById(taskId);
  }

  async delete(taskId: string): Promise<void> {
    const result = await this.db.task.deleteMany({
      where: { id: taskId },
    });

    if (result.count === 0) {
      throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
    }
  }
}

export const taskService = new TaskService();
