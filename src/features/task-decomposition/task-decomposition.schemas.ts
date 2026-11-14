import { z } from "zod";

import { MAX_CLARIFICATION_ROUNDS } from "./task-decomposition.provider";

const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const clarificationHistorySchema = z
  .array(
    z
      .object({
        items: z
          .array(
            z
              .object({
                question: z.string().trim().min(1).max(500),
                answer: z.string().trim().min(1).max(2000),
              })
              .strict(),
          )
          .min(1)
          .max(3),
      })
      .strict(),
  )
  .max(MAX_CLARIFICATION_ROUNDS);

export const decompositionPreviewRequestSchema = z
  .object({
    clarificationHistory: clarificationHistorySchema.default([]),
  })
  .strict();

export const getExistingSubtasksArgumentsSchema = z.object({}).strict();

export const generatedSubtaskSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    priority: taskPrioritySchema,
  })
  .strict();

// Structured Outputs requires a root object rather than a root-level anyOf.
// The service converts this provider shape into the stricter domain union below.
export const taskDecompositionProviderOutputSchema = z
  .object({
    outcome: z.enum(["decomposed", "needs_clarification"]),
    subtasks: z.array(generatedSubtaskSchema).max(7),
    reason: z.string().trim().max(1000).nullable(),
    questions: z.array(z.string().trim().min(1).max(500)).max(3),
  })
  .strict();

export const decomposedResultSchema = z
  .object({
    outcome: z.literal("decomposed"),
    subtasks: z.array(generatedSubtaskSchema).min(2).max(7),
  })
  .strict();

export const needsClarificationResultSchema = z
  .object({
    outcome: z.literal("needs_clarification"),
    reason: z.string().trim().min(1).max(1000),
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(3),
  })
  .strict();

export const taskDecompositionResultSchema = z.discriminatedUnion("outcome", [
  decomposedResultSchema,
  needsClarificationResultSchema,
]);

export type GeneratedSubtask = z.infer<typeof generatedSubtaskSchema>;
export type DecompositionPreviewRequest = z.infer<
  typeof decompositionPreviewRequestSchema
>;
export type TaskDecompositionResult = z.infer<
  typeof taskDecompositionResultSchema
>;

export function parseTaskDecompositionResult(
  value: unknown,
): TaskDecompositionResult {
  const providerOutput = taskDecompositionProviderOutputSchema.parse(value);

  if (providerOutput.outcome === "decomposed") {
    if (providerOutput.reason !== null || providerOutput.questions.length > 0) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["outcome"],
          message: "A decomposed result cannot contain clarification data",
        },
      ]);
    }

    return decomposedResultSchema.parse({
      outcome: providerOutput.outcome,
      subtasks: providerOutput.subtasks,
    });
  }

  if (providerOutput.subtasks.length > 0 || providerOutput.reason === null) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["outcome"],
        message: "A clarification result cannot contain generated subtasks",
      },
    ]);
  }

  return needsClarificationResultSchema.parse({
    outcome: providerOutput.outcome,
    reason: providerOutput.reason,
    questions: providerOutput.questions,
  });
}
