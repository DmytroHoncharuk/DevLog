import { taskReadinessConfirmationService } from "@/features/task-readiness/task-readiness.service";
import { readinessConfirmationRequestSchema } from "@/features/task-readiness/task-readiness.schemas";
import { taskIdSchema } from "@/features/tasks/task.schemas";
import { ApiError, toErrorResponse } from "@/lib/api-error";

type ReadinessConfirmRouteContext = {
  params: Promise<{ taskId: string }>;
};

async function getTaskId(
  context: ReadinessConfirmRouteContext,
): Promise<string> {
  const { taskId } = await context.params;
  const parsed = taskIdSchema.safeParse(taskId);

  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid task id", [
      { path: "taskId", message: "Task id is required" },
    ]);
  }

  return parsed.data;
}

export async function POST(
  request: Request,
  context: ReadinessConfirmRouteContext,
): Promise<Response> {
  try {
    const taskId = await getTaskId(context);
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid readiness confirmation payload",
        [{ path: "body", message: "Request body must contain valid JSON" }],
      );
    }

    const parsed = readinessConfirmationRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid readiness confirmation payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const task = await taskReadinessConfirmationService.confirm(
      taskId,
      parsed.data,
    );

    return Response.json({ data: task });
  } catch (error) {
    if (process.env.NODE_ENV === "development" && error instanceof ApiError) {
      console.error("Agent D confirmation failure", {
        code: error.code,
        stage: "confirmation",
      });
    }

    return toErrorResponse(error);
  }
}
