import { createTaskReadinessServiceFromEnvironment } from "@/features/task-readiness/task-readiness.runtime";
import { readinessAnalysisRequestSchema } from "@/features/task-readiness/task-readiness.schemas";
import { taskIdSchema } from "@/features/tasks/task.schemas";
import { ApiError, toErrorResponse } from "@/lib/api-error";

type ReadinessAnalysisRouteContext = {
  params: Promise<{ taskId: string }>;
};

async function getTaskId(
  context: ReadinessAnalysisRouteContext,
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
  context: ReadinessAnalysisRouteContext,
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
        "Invalid readiness analysis payload",
        [{ path: "body", message: "Request body must contain valid JSON" }],
      );
    }

    const parsed = readinessAnalysisRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Invalid readiness analysis payload",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }

    const analysis = await createTaskReadinessServiceFromEnvironment().analyze(
      taskId,
      parsed.data.clarificationHistory,
    );

    if (process.env.NODE_ENV === "development") {
      console.info("Agent D execution", analysis.trace);
    }

    return Response.json({
      data: analysis.result,
      meta: {
        clarificationRoundsUsed: analysis.clarificationRoundsUsed,
        clarificationRoundsRemaining: analysis.clarificationRoundsRemaining,
        execution: analysis.trace,
        snapshot: analysis.snapshot,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development" && error instanceof ApiError) {
      console.error("Agent D analysis failure", {
        code: error.code,
        stage: "analysis",
      });
    }

    return toErrorResponse(error);
  }
}
