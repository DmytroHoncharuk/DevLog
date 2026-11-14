import {
  taskIdSchema,
  updateTaskSchema,
} from "@/features/tasks/task.schemas";
import { taskService } from "@/features/tasks/task.service";
import { ApiError, toErrorResponse } from "@/lib/api-error";

type TaskRouteContext = {
  params: Promise<{ taskId: string }>;
};

async function getTaskId(context: TaskRouteContext): Promise<string> {
  const { taskId } = await context.params;
  const parsed = taskIdSchema.safeParse(taskId);

  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid task id", [
      { path: "taskId", message: "Task id is required" },
    ]);
  }

  return parsed.data;
}

export async function GET(
  _request: Request,
  context: TaskRouteContext,
): Promise<Response> {
  try {
    const taskId = await getTaskId(context);
    const task = await taskService.getById(taskId);

    return Response.json({ data: task });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: TaskRouteContext,
): Promise<Response> {
  try {
    const taskId = await getTaskId(context);
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid task payload", [
        {
          path: "body",
          message: "Request body must contain valid JSON",
        },
      ]);
    }

    const parsed = updateTaskSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid task payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const task = await taskService.update(taskId, parsed.data);

    return Response.json({ data: task });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: TaskRouteContext,
): Promise<Response> {
  try {
    const taskId = await getTaskId(context);
    await taskService.delete(taskId);

    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
