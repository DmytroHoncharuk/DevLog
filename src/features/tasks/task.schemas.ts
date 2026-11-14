import { z } from "zod";

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
    parentTaskId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema
  .omit({ parentTaskId: true })
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one task field is required",
  });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z
  .object({
    status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    sortBy: z
      .enum(["createdAt", "updatedAt", "title", "status", "priority"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

export const taskIdSchema = z.string().trim().min(1);

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const taskResponseSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
    createdAt: z.string(),
    updatedAt: z.string(),
    parentTaskId: z.string().nullable(),
  })
  .strict();

export const taskWithSubtasksResponseSchema = taskResponseSchema.extend({
  subtasks: z.array(taskResponseSchema),
});

export const taskListResponseSchema = z
  .object({
    data: z.array(taskWithSubtasksResponseSchema),
    meta: z
      .object({
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type TaskWithSubtasksResponse = z.infer<
  typeof taskWithSubtasksResponseSchema
>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
