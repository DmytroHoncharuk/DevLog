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
