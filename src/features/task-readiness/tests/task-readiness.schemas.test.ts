import { describe, expect, it } from "vitest";

import {
  MAX_READINESS_CLARIFICATION_ROUNDS,
  MAX_READINESS_MODEL_TURNS,
  MAX_READINESS_QUESTIONS,
} from "../task-readiness.provider";
import {
  clarificationHistorySchema,
  findRelatedTasksArgumentsSchema,
  getTaskWithSubtasksArgumentsSchema,
  parseTaskReadinessResult,
  readinessAnalysisRequestSchema,
  readinessConfirmationRequestSchema,
  taskReadinessResultSchema,
} from "../task-readiness.schemas";

const assessment = {
  status: "pass" as const,
  explanation: "The task provides task-specific evidence.",
};

const criteria = {
  clarity: assessment,
  scope: assessment,
  acceptance_criteria: assessment,
  testability: assessment,
  dependencies: assessment,
};

const dependencyVerification = {
  status: "not_performed" as const,
  explanation: "Related-task search was not needed for this conclusion.",
};

function providerOutput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    outcome: "ready",
    criteria,
    explanation: "The task is sufficiently defined.",
    dependencyVerification,
    questions: [],
    proposedTitle: null,
    proposedDescription: null,
    ...overrides,
  };
}

describe("Task Readiness domain outcomes", () => {
  it("parses a ready outcome without actionable data", () => {
    expect(parseTaskReadinessResult(providerOutput())).toEqual({
      outcome: "ready",
      criteria,
      explanation: "The task is sufficiently defined.",
      dependencyVerification,
    });
  });

  it("parses a bounded clarification outcome with answer options", () => {
    const questions = [
      {
        question: "Which behavior is expected?",
        options: ["Prefix matching", "Whole-word matching"],
      },
    ];

    expect(
      parseTaskReadinessResult(
        providerOutput({ outcome: "needs_clarification", questions }),
      ),
    ).toEqual({
      outcome: "needs_clarification",
      criteria,
      explanation: "The task is sufficiently defined.",
      dependencyVerification,
      questions,
    });
  });

  it("normalizes the provider's required empty options array", () => {
    expect(
      parseTaskReadinessResult(
        providerOutput({
          outcome: "needs_clarification",
          questions: [{ question: "Which behavior is expected?", options: [] }],
        }),
      ),
    ).toMatchObject({
      questions: [{ question: "Which behavior is expected?" }],
    });
  });

  it("parses a rewrite with task-model title and description bounds", () => {
    expect(
      parseTaskReadinessResult(
        providerOutput({
          outcome: "rewrite_proposed",
          proposedTitle: "Define task search behavior",
          proposedDescription: "Return matching tasks by title and description.",
        }),
      ),
    ).toEqual({
      outcome: "rewrite_proposed",
      criteria,
      explanation: "The task is sufficiently defined.",
      dependencyVerification,
      proposedTitle: "Define task search behavior",
      proposedDescription: "Return matching tasks by title and description.",
    });
  });

  it("requires all five named criteria", () => {
    const incompleteCriteria = {
      clarity: criteria.clarity,
      scope: criteria.scope,
      acceptance_criteria: criteria.acceptance_criteria,
      testability: criteria.testability,
    };

    expect(
      taskReadinessResultSchema.safeParse({
        outcome: "ready",
        criteria: incompleteCriteria,
        explanation: "Incomplete assessment.",
        dependencyVerification,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown criterion names and invalid statuses", () => {
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          criteria: {
            ...criteria,
            clarity: { status: "failed", explanation: "Invalid status." },
          },
        }),
      ),
    ).toThrow();

    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          criteria: { ...criteria, formatting: assessment },
        }),
      ),
    ).toThrow();
  });

  it("allows optional bounded supporting evidence", () => {
    expect(
      parseTaskReadinessResult(
        providerOutput({
          criteria: {
            ...criteria,
            clarity: {
              ...assessment,
              evidence: ["The description names the expected result."],
            },
          },
        }),
      ).criteria.clarity.evidence,
    ).toEqual(["The description names the expected result."]);
  });

  it("rejects actionable clarification or rewrite data on ready", () => {
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({ questions: [{ question: "Unexpected question" }] }),
      ),
    ).toThrow();
    expect(() =>
      parseTaskReadinessResult(providerOutput({ proposedTitle: "Unexpected" })),
    ).toThrow();
  });

  it("requires one to three nonempty clarification questions", () => {
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({ outcome: "needs_clarification" }),
      ),
    ).toThrow();
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          outcome: "needs_clarification",
          questions: Array.from({ length: MAX_READINESS_QUESTIONS + 1 }, () => ({
            question: "Too many questions",
          })),
        }),
      ),
    ).toThrow();
  });

  it("rejects a clarification outcome containing a rewrite", () => {
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          outcome: "needs_clarification",
          questions: [{ question: "Which result is expected?" }],
          proposedTitle: "Unsupported rewrite",
          proposedDescription: "Unsupported rewrite",
        }),
      ),
    ).toThrow();
  });

  it("requires both valid rewrite fields and forbids unresolved questions", () => {
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          outcome: "rewrite_proposed",
          proposedTitle: "Only a title",
        }),
      ),
    ).toThrow();
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          outcome: "rewrite_proposed",
          proposedTitle: "Valid title",
          proposedDescription: "Valid description",
          questions: [{ question: "Unresolved requirement" }],
        }),
      ),
    ).toThrow();
  });

  it("rejects malformed or oversized rewrite text", () => {
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          outcome: "rewrite_proposed",
          proposedTitle: " ",
          proposedDescription: "Valid description",
        }),
      ),
    ).toThrow();
    expect(() =>
      parseTaskReadinessResult(
        providerOutput({
          outcome: "rewrite_proposed",
          proposedTitle: "Valid title",
          proposedDescription: "x".repeat(2001),
        }),
      ),
    ).toThrow();
  });

  it("does not treat technical failures as successful domain outcomes", () => {
    expect(
      taskReadinessResultSchema.safeParse({
        outcome: "provider_unavailable",
        criteria,
        explanation: "Technical failure",
        dependencyVerification,
      }).success,
    ).toBe(false);
  });
});

describe("Task Readiness request and tool boundaries", () => {
  it("records the agreed model-turn and clarification bounds", () => {
    expect(MAX_READINESS_MODEL_TURNS).toBe(4);
    expect(MAX_READINESS_CLARIFICATION_ROUNDS).toBe(2);
    expect(MAX_READINESS_QUESTIONS).toBe(3);
  });

  it("defaults clarification history and accepts at most two rounds", () => {
    expect(readinessAnalysisRequestSchema.parse({})).toEqual({
      clarificationHistory: [],
    });

    const round = {
      items: [{ question: "What is expected?", answer: "A concrete result." }],
    };
    expect(
      clarificationHistorySchema.parse([round, round]),
    ).toHaveLength(MAX_READINESS_CLARIFICATION_ROUNDS);
    expect(
      clarificationHistorySchema.safeParse([round, round, round]).success,
    ).toBe(false);
  });

  it("bounds each clarification round to one through three answered questions", () => {
    expect(clarificationHistorySchema.safeParse([{ items: [] }]).success).toBe(
      false,
    );
    expect(
      clarificationHistorySchema.safeParse([
        {
          items: Array.from({ length: 4 }, () => ({
            question: "Question",
            answer: "Answer",
          })),
        },
      ]).success,
    ).toBe(false);
  });

  it("strictly validates required-inspection tool arguments", () => {
    expect(getTaskWithSubtasksArgumentsSchema.parse({ taskId: "task-1" })).toEqual(
      { taskId: "task-1" },
    );
    expect(
      getTaskWithSubtasksArgumentsSchema.safeParse({
        taskId: "task-1",
        includeSecrets: true,
      }).success,
    ).toBe(false);
  });

  it("bounds optional related-task searches", () => {
    expect(findRelatedTasksArgumentsSchema.parse({ query: "task search" })).toEqual(
      { query: "task search", limit: 10 },
    );
    expect(
      findRelatedTasksArgumentsSchema.safeParse({ query: "task", limit: 11 })
        .success,
    ).toBe(false);
    expect(
      findRelatedTasksArgumentsSchema.safeParse({ query: " ", limit: 5 }).success,
    ).toBe(false);
  });

  it("validates and trims stale-safe rewrite confirmation text", () => {
    expect(
      readinessConfirmationRequestSchema.parse({
        original: {
          title: " Original title ",
          description: " Original description ",
        },
        rewrite: {
          title: " Improved title ",
          description: " Improved description ",
        },
        snapshotToken: " signed-token ",
      }),
    ).toEqual({
      original: {
        title: "Original title",
        description: "Original description",
      },
      rewrite: {
        title: "Improved title",
        description: "Improved description",
      },
      snapshotToken: "signed-token",
    });
  });

  it("rejects malformed or expanded rewrite confirmation payloads", () => {
    expect(
      readinessConfirmationRequestSchema.safeParse({
        original: { title: "Task", description: "Description" },
        rewrite: { title: " ", description: "Description" },
        snapshotToken: "signed-token",
      }).success,
    ).toBe(false);
    expect(
      readinessConfirmationRequestSchema.safeParse({
        original: { title: "Task", description: "Description" },
        rewrite: { title: "Updated", description: "Description" },
        snapshotToken: "signed-token",
        status: "DONE",
      }).success,
    ).toBe(false);
  });
});
