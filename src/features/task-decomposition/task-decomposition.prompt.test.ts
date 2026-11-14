import { describe, expect, it } from "vitest";

import { TASK_DECOMPOSITION_INSTRUCTIONS } from "./task-decomposition.prompt";

describe("TASK_DECOMPOSITION_INSTRUCTIONS", () => {
  it("defines remaining-work and no-new-subtasks behavior without a target count", () => {
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "remains after subtracting the semantic coverage",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "application policy requires you to call get_existing_subtasks",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "regardless of status",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "Never recreate an existing subtask merely because it is incomplete",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      'outcome "no_new_subtasks"',
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "Do not target a preferred number or add filler",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "does not mean the parent task or existing subtasks are completed",
    );
  });

  it("forbids unsupported conventional feature expansion", () => {
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "Do not treat a broad category",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "Password reset, logout, session lifecycle",
    );
    expect(TASK_DECOMPOSITION_INSTRUCTIONS).toContain(
      "instead of proposing plausible industry-standard work",
    );
  });
});
