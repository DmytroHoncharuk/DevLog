import { taskDecompositionConfirmationService } from "@/features/task-decomposition/task-decomposition.service";
import { decompositionConfirmRequestSchema } from "@/features/task-decomposition/task-decomposition.schemas";
import { taskIdSchema } from "@/features/tasks/task.schemas";
import { ApiError, toErrorResponse } from "@/lib/api-error";

type DecompositionConfirmRouteContext = {
  params: Promise<{ taskId: string }>;
};

async function getTaskId(
  context: DecompositionConfirmRouteContext,
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
  context: DecompositionConfirmRouteContext,
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
        "Invalid decomposition confirmation payload",
        [{ path: "body", message: "Request body must contain valid JSON" }],
      );
    }

    const parsed = decompositionConfirmRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid decomposition confirmation payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const subtasks = await taskDecompositionConfirmationService.confirm(
      taskId,
      parsed.data,
    );

    return Response.json({ data: subtasks }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
