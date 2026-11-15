import { describe, expect, it } from "vitest";

import { createTaskSchema } from "../task.schemas";

const validTask = {
  title: "Implement task creation",
  description: "Add the first backend endpoint.",
  status: "TODO",
  priority: "HIGH",
} as const;

describe("createTaskSchema", () => {
  it("trims task text", () => {
    const result = createTaskSchema.parse({
      ...validTask,
      title: "  Implement task creation  ",
      description: "  Add the first backend endpoint.  ",
    });

    expect(result.title).toBe("Implement task creation");
    expect(result.description).toBe("Add the first backend endpoint.");
  });

  it.each([
    ["empty title", { ...validTask, title: "   " }],
    ["long title", { ...validTask, title: "a".repeat(121) }],
    ["empty description", { ...validTask, description: "   " }],
    ["long description", { ...validTask, description: "a".repeat(2001) }],
    ["invalid status", { ...validTask, status: "BLOCKED" }],
    ["invalid priority", { ...validTask, priority: "URGENT" }],
  ])("rejects %s", (_name, input) => {
    expect(createTaskSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      createTaskSchema.safeParse({ ...validTask, unexpected: true }).success,
    ).toBe(false);
  });
});
