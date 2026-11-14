import type { Prisma, PrismaClient, Task } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import type {
  ReadinessTaskContext,
  RelatedTaskContext,
  TaskInspectionContext,
} from "@/features/task-readiness/task-readiness.provider";
import type { ReadinessConfirmationRequest } from "@/features/task-readiness/task-readiness.schemas";

import type {
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
} from "./task.schemas";

export type TaskWithSubtasks = Task & {
  subtasks: Task[];
};

export type TaskDecompositionSource = Task & {
  existingSubtaskCount: number;
};

export type ConfirmedSubtaskInput = Pick<
  Task,
  "title" | "description" | "priority"
>;

const priorityRank = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
} as const;

const MAX_RELATED_TASK_CANDIDATES = 50;
const MAX_RELATED_SEARCH_TERMS = 8;
const MAX_RELATED_TASK_RESULTS = 10;

function toReadinessTaskContext(task: Task): ReadinessTaskContext {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    parentTaskId: task.parentTaskId,
  };
}

function getRelatedSearchTerms(query: string): string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const tokens = normalizedQuery
    .split(/\s+/u)
    .filter((token) => token.length > 1);

  return [...new Set([normalizedQuery, ...tokens])].slice(
    0,
    MAX_RELATED_SEARCH_TERMS,
  );
}

function scoreRelatedTask(task: Task, query: string): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const title = task.title.toLocaleLowerCase();
  const description = task.description.toLocaleLowerCase();
  const tokens = normalizedQuery
    .split(/\s+/u)
    .filter((token) => token.length > 1);
  let score = 0;

  if (title === normalizedQuery) score += 100;
  if (title.includes(normalizedQuery)) score += 40;
  if (description.includes(normalizedQuery)) score += 20;

  for (const token of tokens) {
    if (title.includes(token)) score += 5;
    if (description.includes(token)) score += 2;
  }

  return score;
}

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

  async getDecompositionSource(
    taskId: string,
  ): Promise<TaskDecompositionSource> {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: { _count: { select: { subtasks: true } } },
    });

    if (task === null) {
      throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
    }

    const { _count, ...sourceTask } = task;

    return {
      ...sourceTask,
      existingSubtaskCount: _count.subtasks,
    };
  }

  async listSubtasks(parentTaskId: string): Promise<Task[]> {
    return this.db.task.findMany({
      where: { parentTaskId },
    });
  }

  async getReadinessContext(taskId: string): Promise<TaskInspectionContext> {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: { subtasks: true, parentTask: true },
    });

    if (task === null) {
      throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
    }

    return {
      task: toReadinessTaskContext(task),
      subtasks: task.subtasks.map(toReadinessTaskContext),
      parentTask:
        task.parentTask === null
          ? null
          : toReadinessTaskContext(task.parentTask),
    };
  }

  async findRelatedTasks(
    selectedTaskId: string,
    query: string,
    limit: number,
  ): Promise<RelatedTaskContext[]> {
    const searchTerms = getRelatedSearchTerms(query);

    if (searchTerms.length === 0 || searchTerms[0].length === 0) {
      return [];
    }

    const boundedLimit = Math.min(
      Math.max(Math.trunc(limit), 1),
      MAX_RELATED_TASK_RESULTS,
    );
    const candidates = await this.db.task.findMany({
      where: {
        id: { not: selectedTaskId },
        OR: searchTerms.flatMap((term) => [
          { title: { contains: term } },
          { description: { contains: term } },
        ]),
      },
      take: MAX_RELATED_TASK_CANDIDATES,
    });

    return candidates
      .map((task) => ({ task, score: scoreRelatedTask(task, query) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.task.updatedAt.getTime() - left.task.updatedAt.getTime() ||
          left.task.id.localeCompare(right.task.id),
      )
      .slice(0, boundedLimit)
      .map(({ task }) => toReadinessTaskContext(task));
  }

  async confirmReadinessRewrite(
    taskId: string,
    input: ReadinessConfirmationRequest,
  ): Promise<TaskWithSubtasks> {
    return this.db.$transaction(async (transaction) => {
      const result = await transaction.task.updateMany({
        where: {
          id: taskId,
          title: input.original.title,
          description: input.original.description,
        },
        data: {
          title: input.rewrite.title,
          description: input.rewrite.description,
        },
      });

      if (result.count === 0) {
        const currentTask = await transaction.task.findUnique({
          where: { id: taskId },
          select: { id: true },
        });

        if (currentTask === null) {
          throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
        }

        throw new ApiError(
          409,
          "TASK_READINESS_CONFLICT",
          "Task title or description changed after readiness analysis",
        );
      }

      const updatedTask = await transaction.task.findUnique({
        where: { id: taskId },
        include: { subtasks: true },
      });

      if (updatedTask === null) {
        throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
      }

      return updatedTask;
    });
  }

  async confirmDecomposition(
    taskId: string,
    subtasks: readonly ConfirmedSubtaskInput[],
  ): Promise<Task[]> {
    return this.db.$transaction(async (transaction) => {
      const sourceTask = await transaction.task.findUnique({
        where: { id: taskId },
        select: { id: true, parentTaskId: true },
      });

      if (sourceTask === null) {
        throw new ApiError(404, "TASK_NOT_FOUND", "Task not found");
      }

      if (sourceTask.parentTaskId !== null) {
        throw new ApiError(
          409,
          "TASK_DECOMPOSITION_NOT_ALLOWED",
          "A subtask cannot be decomposed",
        );
      }

      const existingSubtasks = await transaction.task.findMany({
        where: { parentTaskId: taskId },
        select: { title: true },
      });
      const seenTitles = new Set(
        existingSubtasks.map((subtask) =>
          subtask.title.trim().toLocaleLowerCase(),
        ),
      );

      for (const subtask of subtasks) {
        const normalizedTitle = subtask.title.trim().toLocaleLowerCase();

        if (seenTitles.has(normalizedTitle)) {
          throw new ApiError(
            409,
            "DECOMPOSITION_CONFLICT",
            "One or more subtasks conflict with current task data",
          );
        }

        seenTitles.add(normalizedTitle);
      }

      const createdSubtasks: Task[] = [];

      for (const subtask of subtasks) {
        createdSubtasks.push(
          await transaction.task.create({
            data: {
              ...subtask,
              status: "TODO",
              parentTaskId: taskId,
            },
          }),
        );
      }

      return createdSubtasks;
    });
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
