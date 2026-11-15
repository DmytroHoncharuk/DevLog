import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTask,
  deleteTask,
  updateTask,
} from "../task-api";

const task = {
  id: "task/id",
  title: "Frontend CRUD",
  description: "Complete task mutations.",
  status: "IN_PROGRESS",
  priority: "HIGH",
  parentTaskId: null,
  createdAt: "2026-11-14T12:00:00.000Z",
  updatedAt: "2026-11-14T12:00:00.000Z",
  subtasks: [],
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("task mutation API helpers", () => {
  it("posts a task and validates the response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: task }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createTask({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        parentTaskId: null,
      }),
    ).resolves.toEqual(task);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("patches the encoded task URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: task }));
    vi.stubGlobal("fetch", fetchMock);

    await updateTask(task.id, { title: "Updated title" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task%2Fid",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("rejects an invalid mutation response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: { id: "broken" } })),
    );

    await expect(
      updateTask("task-id", { title: "Updated" }),
    ).rejects.toThrow(
      "The server returned an unexpected task format.",
    );
  });

  it("surfaces the safe API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "TASK_NOT_FOUND",
              message: "Task not found",
              details: [],
            },
          },
          { status: 404 },
        ),
      ),
    );

    await expect(updateTask("missing", { title: "Updated" })).rejects.toEqual(
      expect.objectContaining({ message: "Task not found" }),
    );
  });

  it("accepts a 204 delete response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteTask(task.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task%2Fid",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
