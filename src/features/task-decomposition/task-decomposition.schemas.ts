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

export const decompositionConfirmRequestSchema = z
  .object({
    subtasks: z.array(generatedSubtaskSchema).min(1).max(7),
  })
  .strict()
  .superRefine((value, context) => {
    const seenTitles = new Set<string>();

    value.subtasks.forEach((subtask, index) => {
      const normalizedTitle = subtask.title.trim().toLocaleLowerCase();

      if (seenTitles.has(normalizedTitle)) {
        context.addIssue({
          code: "custom",
          path: ["subtasks", index, "title"],
          message: "Subtask titles must be unique",
        });
      }

      seenTitles.add(normalizedTitle);
    });
  });

// Structured Outputs requires a root object rather than a root-level anyOf.
// The service converts this provider shape into the stricter domain union below.
export const taskDecompositionProviderOutputSchema = z
  .object({
    outcome: z.enum([
      "decomposed",
      "needs_clarification",
      "no_new_subtasks",
    ]),
    subtasks: z.array(generatedSubtaskSchema).max(7),
    reason: z.string().trim().max(1000).nullable(),
    questions: z.array(z.string().trim().min(1).max(500)).max(3),
  })
  .strict();

export const decomposedResultSchema = z
  .object({
    outcome: z.literal("decomposed"),
    subtasks: z.array(generatedSubtaskSchema).min(1).max(7),
  })
  .strict();

export const needsClarificationResultSchema = z
  .object({
    outcome: z.literal("needs_clarification"),
    reason: z.string().trim().min(1).max(1000),
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(3),
  })
  .strict();

export const noNewSubtasksResultSchema = z
  .object({
    outcome: z.literal("no_new_subtasks"),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const taskDecompositionResultSchema = z.discriminatedUnion("outcome", [
  decomposedResultSchema,
  needsClarificationResultSchema,
  noNewSubtasksResultSchema,
]);

export type GeneratedSubtask = z.infer<typeof generatedSubtaskSchema>;
export type DecompositionPreviewRequest = z.infer<
  typeof decompositionPreviewRequestSchema
>;
export type DecompositionConfirmRequest = z.infer<
  typeof decompositionConfirmRequestSchema
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

  if (providerOutput.outcome === "needs_clarification") {
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

  if (
    providerOutput.subtasks.length > 0 ||
    providerOutput.reason === null ||
    providerOutput.questions.length > 0
  ) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["outcome"],
        message: "A no-new-subtasks result cannot contain generated work",
      },
    ]);
  }

  return noNewSubtasksResultSchema.parse({
    outcome: providerOutput.outcome,
    reason: providerOutput.reason,
  });
}
