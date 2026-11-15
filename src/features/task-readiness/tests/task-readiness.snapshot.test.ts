import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { taskReadinessSnapshotManager } from "../task-readiness.snapshot";

const originalSecret = process.env.TASK_READINESS_SNAPSHOT_SECRET;

beforeAll(() => {
  process.env.TASK_READINESS_SNAPSHOT_SECRET = "test-snapshot-secret";
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.TASK_READINESS_SNAPSHOT_SECRET;
  } else {
    process.env.TASK_READINESS_SNAPSHOT_SECRET = originalSecret;
  }
});

describe("taskReadinessSnapshotManager", () => {
  const snapshot = {
    taskId: "task-1",
    title: "Original task",
    description: "Original description",
  };

  it("round-trips an authentic snapshot for the selected task", () => {
    const token = taskReadinessSnapshotManager.create(snapshot);

    expect(taskReadinessSnapshotManager.verify(token, snapshot.taskId)).toEqual(
      snapshot,
    );
  });

  it("rejects tampering and use against another task", () => {
    const token = taskReadinessSnapshotManager.create(snapshot);
    const [payload, signature] = token.split(".");

    expect(
      taskReadinessSnapshotManager.verify(`${payload}x.${signature}`, snapshot.taskId),
    ).toBeNull();
    expect(taskReadinessSnapshotManager.verify(token, "task-2")).toBeNull();
  });
});
