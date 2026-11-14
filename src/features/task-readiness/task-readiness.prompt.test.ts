import { describe, expect, it } from "vitest";

import {
  buildTaskReadinessInput,
  TASK_READINESS_INSTRUCTIONS,
} from "./task-readiness.prompt";

describe("Task Readiness prompt", () => {
  it("requires inspection, five criteria, honest optional search, and ready", () => {
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "First call get_task_with_subtasks",
    );
    expect(TASK_READINESS_INSTRUCTIONS).toContain("find_related_tasks");
    expect(TASK_READINESS_INSTRUCTIONS).toContain("clarity, scope");
    expect(TASK_READINESS_INSTRUCTIONS).toContain("Return ready");
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "Example where ready is correct",
    );
    expect(TASK_READINESS_INSTRUCTIONS).toContain("do not create subtasks");
  });

  it("keeps task id and clarification answers in untrusted user data", () => {
    const content = buildTaskReadinessInput({
      taskId: "task-1",
      clarificationHistory: [
        {
          items: [
            {
              question: "Which fields?",
              answer: "Titles only.",
            },
          ],
        },
      ],
    });

    expect(TASK_READINESS_INSTRUCTIONS).not.toContain("Titles only.");
    expect(JSON.parse(content)).toEqual({
      selectedTaskId: "task-1",
      clarificationHistory: [
        {
          items: [
            { question: "Which fields?", answer: "Titles only." },
          ],
        },
      ],
    });
  });

  it("does not turn deletion implementation choices into product questions", () => {
    expect(TASK_READINESS_INSTRUCTIONS).toContain("Fix task deletion");
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "Do not ask whether duplicate-request protection belongs on the client or server",
    );
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "do not ask for the exact confirmation-dialog layout",
    );
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "If the requested behavior and observable completion conditions are sufficient, return ready",
    );
  });

  it("treats narrowed parent scope and existing subtasks as a potential conflict", () => {
    expect(TASK_READINESS_INSTRUCTIONS).toContain("Build DevLog backend");
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "existing subtasks for API documentation and validation",
    );
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "remain part of the parent, were superseded, or should be tracked separately",
    );
    expect(TASK_READINESS_INSTRUCTIONS).toContain(
      "Never silently ignore conflicting existing coverage",
    );
  });
});
