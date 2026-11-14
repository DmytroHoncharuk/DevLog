import { z } from "zod";

import {
  MAX_READINESS_CLARIFICATION_ROUNDS,
  MAX_READINESS_QUESTIONS,
  MAX_RELATED_TASK_RESULTS,
} from "./task-readiness.provider";

export const readinessCriterionStatusSchema = z.enum([
  "pass",
  "needs_improvement",
  "unknown",
]);

export const readinessCriterionAssessmentSchema = z
  .object({
    status: readinessCriterionStatusSchema,
    explanation: z.string().trim().min(1).max(1000),
    evidence: z.array(z.string().trim().min(1).max(500)).max(5).optional(),
  })
  .strict();

export const readinessCriteriaSchema = z
  .object({
    clarity: readinessCriterionAssessmentSchema,
    scope: readinessCriterionAssessmentSchema,
    acceptance_criteria: readinessCriterionAssessmentSchema,
    testability: readinessCriterionAssessmentSchema,
    dependencies: readinessCriterionAssessmentSchema,
  })
  .strict();

export const dependencyVerificationSchema = z
  .object({
    status: z.enum(["not_performed", "completed", "failed"]),
    explanation: z.string().trim().min(1).max(1000),
  })
  .strict();

export const readinessQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    options: z
      .array(z.string().trim().min(1).max(500))
      .min(2)
      .max(5)
      .optional(),
  })
  .strict();

const sharedResultShape = {
  criteria: readinessCriteriaSchema,
  explanation: z.string().trim().min(1).max(1000),
  dependencyVerification: dependencyVerificationSchema,
} as const;

export const readyResultSchema = z
  .object({
    outcome: z.literal("ready"),
    ...sharedResultShape,
  })
  .strict();

export const needsClarificationResultSchema = z
  .object({
    outcome: z.literal("needs_clarification"),
    ...sharedResultShape,
    questions: z
      .array(readinessQuestionSchema)
      .min(1)
      .max(MAX_READINESS_QUESTIONS),
  })
  .strict();

export const rewriteProposedResultSchema = z
  .object({
    outcome: z.literal("rewrite_proposed"),
    ...sharedResultShape,
    proposedTitle: z.string().trim().min(1).max(120),
    proposedDescription: z.string().trim().min(1).max(2000),
  })
  .strict();

export const taskReadinessResultSchema = z.discriminatedUnion("outcome", [
  readyResultSchema,
  needsClarificationResultSchema,
  rewriteProposedResultSchema,
]);

const providerQuestionOutputSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(500)).max(5).optional(),
  })
  .strict();

// OpenAI Structured Outputs requires a root object rather than a root-level
// union. The application converts this flat provider shape into the stricter
// domain union above.
export const taskReadinessProviderOutputSchema = z
  .object({
    outcome: z.enum(["ready", "needs_clarification", "rewrite_proposed"]),
    criteria: readinessCriteriaSchema,
    explanation: z.string().trim().min(1).max(1000),
    dependencyVerification: dependencyVerificationSchema,
    questions: z
      .array(providerQuestionOutputSchema)
      .max(MAX_READINESS_QUESTIONS),
    proposedTitle: z.string().trim().min(1).max(120).nullable(),
    proposedDescription: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict();

const structuredCriterionAssessmentSchema = z
  .object({
    status: readinessCriterionStatusSchema,
    explanation: z.string().trim().min(1).max(1000),
    evidence: z.array(z.string().trim().min(1).max(500)).max(5),
  })
  .strict();

const structuredCriteriaSchema = z
  .object({
    clarity: structuredCriterionAssessmentSchema,
    scope: structuredCriterionAssessmentSchema,
    acceptance_criteria: structuredCriterionAssessmentSchema,
    testability: structuredCriterionAssessmentSchema,
    dependencies: structuredCriterionAssessmentSchema,
  })
  .strict();

const structuredQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(500)).max(5),
  })
  .strict();

// Every property is required because OpenAI Structured Outputs does not
// support optional object properties. Empty evidence/options arrays represent
// absent optional domain data and remain valid at the application boundary.
export const taskReadinessStructuredOutputSchema = z
  .object({
    outcome: z.enum(["ready", "needs_clarification", "rewrite_proposed"]),
    criteria: structuredCriteriaSchema,
    explanation: z.string().trim().min(1).max(1000),
    dependencyVerification: dependencyVerificationSchema,
    questions: z.array(structuredQuestionSchema).max(MAX_READINESS_QUESTIONS),
    proposedTitle: z.string().trim().min(1).max(120).nullable(),
    proposedDescription: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict();

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
          .max(MAX_READINESS_QUESTIONS),
      })
      .strict(),
  )
  .max(MAX_READINESS_CLARIFICATION_ROUNDS);

export const readinessAnalysisRequestSchema = z
  .object({
    clarificationHistory: clarificationHistorySchema.default([]),
  })
  .strict();

const readinessTaskTextSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
  })
  .strict();

export const readinessConfirmationRequestSchema = z
  .object({
    original: readinessTaskTextSchema,
    rewrite: readinessTaskTextSchema,
    snapshotToken: z.string().trim().min(1).max(4096),
  })
  .strict();

export const getTaskWithSubtasksArgumentsSchema = z
  .object({
    taskId: z.string().trim().min(1),
  })
  .strict();

export const findRelatedTasksArgumentsSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(MAX_RELATED_TASK_RESULTS).default(10),
  })
  .strict();

export type TaskReadinessResult = z.infer<typeof taskReadinessResultSchema>;
export type ReadinessCriteria = z.infer<typeof readinessCriteriaSchema>;
export type ReadinessQuestion = z.infer<typeof readinessQuestionSchema>;
export type ReadinessAnalysisRequest = z.infer<
  typeof readinessAnalysisRequestSchema
>;
export type ReadinessConfirmationRequest = z.infer<
  typeof readinessConfirmationRequestSchema
>;

function invalidOutcome(message: string): never {
  throw new z.ZodError([
    {
      code: "custom",
      path: ["outcome"],
      message,
    },
  ]);
}

export function parseTaskReadinessResult(value: unknown): TaskReadinessResult {
  const output = taskReadinessProviderOutputSchema.parse(value);
  const normalizedQuestions = output.questions.map((question) =>
    question.options && question.options.length > 0
      ? question
      : { question: question.question },
  );
  const shared = {
    criteria: output.criteria,
    explanation: output.explanation,
    dependencyVerification: output.dependencyVerification,
  };

  if (output.outcome === "ready") {
    if (
      output.questions.length > 0 ||
      output.proposedTitle !== null ||
      output.proposedDescription !== null
    ) {
      invalidOutcome("A ready result cannot contain clarification or rewrite data");
    }

    return readyResultSchema.parse({ outcome: output.outcome, ...shared });
  }

  if (output.outcome === "needs_clarification") {
    if (
      output.questions.length === 0 ||
      output.proposedTitle !== null ||
      output.proposedDescription !== null
    ) {
      invalidOutcome(
        "A clarification result requires questions and cannot contain a rewrite",
      );
    }

    return needsClarificationResultSchema.parse({
      outcome: output.outcome,
      ...shared,
      questions: normalizedQuestions,
    });
  }

  if (
    output.questions.length > 0 ||
    output.proposedTitle === null ||
    output.proposedDescription === null
  ) {
    invalidOutcome(
      "A rewrite result requires proposed text and cannot contain clarification questions",
    );
  }

  return rewriteProposedResultSchema.parse({
    outcome: output.outcome,
    ...shared,
    proposedTitle: output.proposedTitle,
    proposedDescription: output.proposedDescription,
  });
}
