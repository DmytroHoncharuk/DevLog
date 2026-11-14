import OpenAI from "openai";

import { ApiError } from "@/lib/api-error";

import { OpenAITaskDecompositionProvider } from "./openai-task-decomposition.provider";
import { TaskDecompositionService } from "./task-decomposition.service";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "AI task decomposition is not configured",
    );
  }

  return value;
}

export function createTaskDecompositionServiceFromEnvironment(): TaskDecompositionService {
  const providerName = requireEnvironmentValue("LLM_PROVIDER");

  if (providerName !== "openai") {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "AI task decomposition is not configured",
    );
  }

  const apiKey = requireEnvironmentValue("OPENAI_API_KEY");
  const model = requireEnvironmentValue("OPENAI_MODEL");
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 30_000,
  });

  return new TaskDecompositionService(
    new OpenAITaskDecompositionProvider(client, model),
  );
}
