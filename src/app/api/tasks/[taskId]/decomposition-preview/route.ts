import { createTaskDecompositionServiceFromEnvironment } from "@/features/task-decomposition/task-decomposition.runtime";
import { decompositionPreviewRequestSchema } from "@/features/task-decomposition/task-decomposition.schemas";
import { taskIdSchema } from "@/features/tasks/task.schemas";
import { ApiError, toErrorResponse } from "@/lib/api-error";

type DecompositionPreviewRouteContext = {
  params: Promise<{ taskId: string }>;
};

async function getTaskId(
  context: DecompositionPreviewRouteContext,
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
  context: DecompositionPreviewRouteContext,
): Promise<Response> {
  try {
    const taskId = await getTaskId(context);
    let body: unknown = {};

    try {
      const rawBody = await request.text();
      body = rawBody.trim() === "" ? {} : JSON.parse(rawBody);
    } catch {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid decomposition preview payload",
        [{ path: "body", message: "Request body must contain valid JSON" }],
      );
    }

    const parsed = decompositionPreviewRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid decomposition preview payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const service = createTaskDecompositionServiceFromEnvironment();
    const preview = await service.preview(
      taskId,
      parsed.data.clarificationHistory,
    );

    if (process.env.NODE_ENV === "development") {
      console.info("Agent B execution", preview.trace);
    }

    return Response.json({
      data: preview.result,
      meta: {
        clarificationRoundsUsed: preview.clarificationRoundsUsed,
        clarificationRoundsRemaining: preview.clarificationRoundsRemaining,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
