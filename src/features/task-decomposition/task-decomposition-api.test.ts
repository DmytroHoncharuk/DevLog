import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmDecomposition,
  requestDecompositionPreview,
  TaskDecompositionApiError,
} from "./task-decomposition-api";

const generatedSubtask = {
  title: "Implement the dialog",
  description: "Render and edit the generated preview.",
  priority: "HIGH" as const,
};

const createdSubtask = {
  id: "created-id",
  ...generatedSubtask,
  status: "TODO" as const,
  parentTaskId: "root-id",
  createdAt: "2026-11-14T12:00:00.000Z",
  updatedAt: "2026-11-14T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agent B frontend API", () => {
  it("posts complete clarification history and validates a preview", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          outcome: "decomposed",
          subtasks: [
            generatedSubtask,
            { ...generatedSubtask, title: "Verify the dialog" },
          ],
        },
        meta: {
          clarificationRoundsUsed: 1,
          clarificationRoundsRemaining: 1,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const clarificationHistory = [
      {
        items: [
          { question: "What should be built?", answer: "An editable dialog." },
        ],
      },
    ];

    await expect(
      requestDecompositionPreview("root/id", { clarificationHistory }),
    ).resolves.toMatchObject({ data: { outcome: "decomposed" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/root%2Fid/decomposition-preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clarificationHistory }),
      }),
    );
  });

  it("preserves the public API error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "CLARIFICATION_LIMIT_REACHED",
              message: "More context is required",
              details: [],
            },
          },
          { status: 422 },
        ),
      ),
    );

    await expect(
      requestDecompositionPreview("root-id", { clarificationHistory: [] }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "CLARIFICATION_LIMIT_REACHED",
        message: "More context is required",
      }),
    );
  });

  it("validates a no-new-subtasks preview without confirmation data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: {
            outcome: "no_new_subtasks",
            reason: "Existing subtasks cover the stated scope.",
          },
          meta: {
            clarificationRoundsUsed: 0,
            clarificationRoundsRemaining: 2,
          },
        }),
      ),
    );

    await expect(
      requestDecompositionPreview("root-id", { clarificationHistory: [] }),
    ).resolves.toMatchObject({
      data: {
        outcome: "no_new_subtasks",
        reason: "Existing subtasks cover the stated scope.",
      },
    });
  });

  it("posts only confirmed subtasks and validates created records", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [createdSubtask] }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      confirmDecomposition("root-id", { subtasks: [generatedSubtask] }),
    ).resolves.toEqual([createdSubtask]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/root-id/decomposition-confirm",
      expect.objectContaining({
        body: JSON.stringify({ subtasks: [generatedSubtask] }),
      }),
    );
  });

  it("marks an interrupted confirmation result as uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(
      confirmDecomposition("root-id", { subtasks: [generatedSubtask] }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "NETWORK_ERROR",
        resultMayHaveChanged: true,
      }),
    );
  });

  it("rejects an invalid successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: { id: "broken" } })),
    );

    await expect(
      requestDecompositionPreview("root-id", { clarificationHistory: [] }),
    ).rejects.toBeInstanceOf(TaskDecompositionApiError);
  });
});
