import { ApiError, toErrorResponse } from "@/lib/api-error";
import {
  createTaskSchema,
  listTasksQuerySchema,
} from "@/features/tasks/task.schemas";
import { taskService } from "@/features/tasks/task.service";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listTasksQuerySchema.safeParse(query);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid task query",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const tasks = await taskService.list(parsed.data);

    return Response.json({
      data: tasks,
      meta: { total: tasks.length },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
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

    const parsed = createTaskSchema.safeParse(body);

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

    const task = await taskService.create(parsed.data);

    return Response.json({ data: task }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
