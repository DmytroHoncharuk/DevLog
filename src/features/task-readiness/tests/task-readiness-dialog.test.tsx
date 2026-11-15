// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskResponse } from "@/features/tasks/task.schemas";

import {
  confirmReadinessRewrite,
  requestReadinessAnalysis,
  TaskReadinessApiError,
  type TaskReadinessAnalysisResponse,
} from "../task-readiness-api";
import { TaskReadinessDialog } from "../task-readiness-dialog";

vi.mock("./task-readiness-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../task-readiness-api")>();

  return {
    ...actual,
    requestReadinessAnalysis: vi.fn(),
    confirmReadinessRewrite: vi.fn(),
  };
});

const task: TaskResponse = {
  id: "task-1",
  title: "Improve search",
  description: "Make search convenient.",
  status: "TODO",
  priority: "MEDIUM",
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  parentTaskId: null,
};

const assessment = {
  status: "pass" as const,
  explanation: "The requirement is supported.",
};
const criteria = {
  clarity: assessment,
  scope: assessment,
  acceptance_criteria: assessment,
  testability: assessment,
  dependencies: assessment,
};

function response(
  data: TaskReadinessAnalysisResponse["data"],
  overrides: Partial<TaskReadinessAnalysisResponse["meta"]> = {},
): TaskReadinessAnalysisResponse {
  return {
    data,
    meta: {
      clarificationRoundsUsed: 0,
      clarificationRoundsRemaining: 2,
      clarificationLimitReached: false,
      execution: {
        modelTurns: 2,
        toolCalls: ["get_task_with_subtasks"],
        inspectionPerformed: true,
        relatedSearchPerformed: false,
      },
      snapshot: null,
      ...overrides,
    },
  };
}

const ready = response({
  outcome: "ready",
  criteria,
  explanation: "The task is sufficiently defined.",
  dependencyVerification: {
    status: "not_performed",
    explanation: "Related tasks did not need examination.",
  },
});

function clarification(
  question: string,
  roundsRemaining: number,
  clarificationLimitReached = false,
  explanation = "Search behavior is unclear.",
) {
  return response(
    {
      outcome: "needs_clarification",
      criteria,
      explanation,
      dependencyVerification: {
        status: "not_performed",
        explanation: "Related tasks were not examined.",
      },
      questions: [{ question }],
    },
    {
      clarificationRoundsUsed: 2 - roundsRemaining,
      clarificationRoundsRemaining: roundsRemaining,
      clarificationLimitReached,
    },
  );
}

const rewrite = response(
  {
    outcome: "rewrite_proposed",
    criteria,
    explanation: "The rewrite makes completion testable.",
    dependencyVerification: {
      status: "not_performed",
      explanation: "Related tasks were not examined.",
    },
    proposedTitle: "Define task search",
    proposedDescription: "Search task titles using substring matching.",
  },
  {
    snapshot: {
      original: { title: task.title, description: task.description },
      token: "signed-token",
    },
  },
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskReadinessDialog", () => {
  it("shows loading, then a ready state with no apply action", async () => {
    let resolve!: (value: TaskReadinessAnalysisResponse) => void;
    vi.mocked(requestReadinessAnalysis).mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );
    render(
      <TaskReadinessDialog
        task={task}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Analyzing task readiness")).toBeTruthy();
    resolve(ready);
    expect(
      await screen.findByText("Ready for implementation"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
  });

  it("supports two clarification rounds and a terminal unresolved state", async () => {
    vi.mocked(requestReadinessAnalysis)
      .mockResolvedValueOnce(clarification("Which matching rule?", 2))
      .mockResolvedValueOnce(clarification("Should matching ignore case?", 1))
      .mockResolvedValueOnce(
        clarification(
          "Which roles may delete tasks?",
          0,
          true,
          "The deletion permission rule is still unresolved.",
        ),
      );
    const user = userEvent.setup();
    render(
      <TaskReadinessDialog
        task={task}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );

    const firstAnswer = await screen.findByRole("textbox");
    await user.type(firstAnswer, "Substring matching");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const secondAnswer = await screen.findByRole("textbox");
    await user.type(secondAnswer, "Yes");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Readiness remains unresolved"),
    ).toBeTruthy();
    expect(
      screen.getByText("The deletion permission rule is still unresolved."),
    ).toBeTruthy();
    expect(screen.getByText("Which roles may delete tasks?")).toBeTruthy();
    expect(
      screen.getByText(
        "Update the task with the missing decisions, then start a new readiness check.",
      ),
    ).toBeTruthy();
    const preservedAnswers = screen.getAllByRole("textbox").map(
      (input) => (input as HTMLTextAreaElement).value,
    );
    expect(preservedAnswers).toEqual(["Substring matching", "Yes"]);
    expect(
      screen.getByRole("textbox", {
        name: "Answer from round 1, question 1",
      }),
    ).toHaveProperty("readOnly", true);
    expect(requestReadinessAnalysis).toHaveBeenLastCalledWith(
      task.id,
      {
        clarificationHistory: [
          {
            items: [
              {
                question: "Which matching rule?",
                answer: "Substring matching",
              },
            ],
          },
          {
            items: [
              { question: "Should matching ignore case?", answer: "Yes" },
            ],
          },
        ],
      },
      expect.any(AbortSignal),
    );
  });

  it("preserves clarification input and offers Retry analysis after failure", async () => {
    vi.mocked(requestReadinessAnalysis)
      .mockResolvedValueOnce(clarification("Which matching rule?", 2))
      .mockRejectedValueOnce(
        new TaskReadinessApiError("Provider unavailable.", "AI_PROVIDER_UNAVAILABLE"),
      );
    const user = userEvent.setup();
    render(
      <TaskReadinessDialog
        task={task}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );

    const answer = await screen.findByRole("textbox");
    await user.type(answer, "Substring matching");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Provider unavailable.")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Substring matching",
    );
    expect(
      screen.getByRole("button", { name: "Retry analysis" }),
    ).toBeTruthy();
  });

  it("allows editing and explicitly applying a rewrite", async () => {
    vi.mocked(requestReadinessAnalysis).mockResolvedValue(rewrite);
    vi.mocked(confirmReadinessRewrite).mockResolvedValue({
      ...task,
      title: "Edited title",
      description: rewrite.data.outcome === "rewrite_proposed"
        ? rewrite.data.proposedDescription
        : task.description,
      subtasks: [],
    });
    const onApplied = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskReadinessDialog
        task={task}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    );

    const title = await screen.findByLabelText("Proposed title");
    await user.clear(title);
    await user.type(title, "Edited title");
    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(confirmReadinessRewrite).toHaveBeenCalledWith(
      task.id,
      {
        original: { title: task.title, description: task.description },
        rewrite: {
          title: "Edited title",
          description: "Search task titles using substring matching.",
        },
        snapshotToken: "signed-token",
      },
      expect.any(AbortSignal),
    );
  });

  it("shows stale-preview conflict and can cancel without persistence", async () => {
    vi.mocked(requestReadinessAnalysis).mockResolvedValue(rewrite);
    vi.mocked(confirmReadinessRewrite).mockRejectedValue(
      new TaskReadinessApiError("Conflict", "TASK_READINESS_CONFLICT"),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskReadinessDialog
        task={task}
        onClose={onClose}
        onApplied={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Apply changes" }),
    );
    expect(await screen.findByText("The task changed")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry analysis" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
