import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmReadinessRewrite,
  requestReadinessAnalysis,
  TaskReadinessApiError,
} from "./task-readiness-api";

const assessment = {
  status: "pass",
  explanation: "The requirement is supported.",
};
const readyResponse = {
  data: {
    outcome: "ready",
    criteria: {
      clarity: assessment,
      scope: assessment,
      acceptance_criteria: assessment,
      testability: assessment,
      dependencies: assessment,
    },
    explanation: "The task is ready.",
    dependencyVerification: {
      status: "not_performed",
      explanation: "Related search was not needed.",
    },
  },
  meta: {
    clarificationRoundsUsed: 0,
    clarificationRoundsRemaining: 2,
    execution: {
      modelTurns: 2,
      toolCalls: ["get_task_with_subtasks"],
      inspectionPerformed: true,
      relatedSearchPerformed: false,
    },
    snapshot: null,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestReadinessAnalysis", () => {
  it("posts clarification history and validates diagnostics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(readyResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestReadinessAnalysis("task/1", { clarificationHistory: [] }),
    ).resolves.toEqual(readyResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task%2F1/readiness-analysis",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clarificationHistory: [] }),
      }),
    );
  });

  it("preserves safe server error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "CLARIFICATION_LIMIT_REACHED",
              message: "More context is required.",
              details: [],
            },
          }),
          { status: 422 },
        ),
      ),
    );

    await expect(
      requestReadinessAnalysis("task-1", { clarificationHistory: [] }),
    ).rejects.toMatchObject({
      code: "CLARIFICATION_LIMIT_REACHED",
      message: "More context is required.",
    });
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { outcome: "ready" } }), {
          status: 200,
        }),
      ),
    );

    await expect(
      requestReadinessAnalysis("task-1", { clarificationHistory: [] }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("confirmReadinessRewrite", () => {
  const confirmation = {
    original: { title: "Original", description: "Original description" },
    rewrite: { title: "Updated", description: "Updated description" },
    snapshotToken: "signed-token",
  };

  it("posts only the signed rewrite confirmation and parses the task", async () => {
    const task = {
      id: "task-1",
      title: "Updated",
      description: "Updated description",
      status: "TODO",
      priority: "MEDIUM",
      createdAt: "2026-11-14T00:00:00.000Z",
      updatedAt: "2026-11-14T01:00:00.000Z",
      parentTaskId: null,
      subtasks: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: task }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      confirmReadinessRewrite("task-1", confirmation),
    ).resolves.toEqual(task);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/readiness-confirm",
      expect.objectContaining({ body: JSON.stringify(confirmation) }),
    );
  });

  it("marks an uncertain network confirmation result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      confirmReadinessRewrite("task-1", confirmation),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TaskReadinessApiError &&
        error.code === "NETWORK_ERROR" &&
        error.resultMayHaveChanged,
    );
  });
});
