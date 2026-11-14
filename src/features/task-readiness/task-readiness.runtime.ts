import OpenAI from "openai";

import { ApiError } from "@/lib/api-error";

import { OpenAITaskReadinessProvider } from "./openai-task-readiness.provider";
import { TaskReadinessService } from "./task-readiness.service";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "AI task readiness is not configured",
    );
  }

  return value;
}

export function createTaskReadinessServiceFromEnvironment(): TaskReadinessService {
  const providerName = requireEnvironmentValue("LLM_PROVIDER");

  if (providerName !== "openai") {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "AI task readiness is not configured",
    );
  }

  const apiKey = requireEnvironmentValue("OPENAI_API_KEY");
  const model = requireEnvironmentValue("OPENAI_MODEL");
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 30_000,
  });

  return new TaskReadinessService(
    new OpenAITaskReadinessProvider(client, model),
  );
}
