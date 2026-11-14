import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const snapshotPayloadSchema = z
  .object({
    taskId: z.string().min(1),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
  })
  .strict();

export type ReadinessSnapshot = z.infer<typeof snapshotPayloadSchema>;

export interface TaskReadinessSnapshotManager {
  create(snapshot: ReadinessSnapshot): string;
  verify(token: string, taskId: string): ReadinessSnapshot | null;
}

function getSigningSecret(): string | null {
  return (
    process.env.TASK_READINESS_SNAPSHOT_SECRET?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null
  );
}

function signatureFor(encodedPayload: string): Buffer | null {
  const secret = getSigningSecret();

  if (secret === null) return null;

  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest();
}

export const taskReadinessSnapshotManager: TaskReadinessSnapshotManager = {
  create(snapshot) {
    const payload = snapshotPayloadSchema.parse(snapshot);
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const signatureBuffer = signatureFor(encodedPayload);

    if (signatureBuffer === null) {
      throw new Error("Task readiness snapshot signing is not configured");
    }

    const signature = signatureBuffer.toString("base64url");

    return `${encodedPayload}.${signature}`;
  },

  verify(token, taskId) {
    const [encodedPayload, encodedSignature, extra] = token.split(".");

    if (!encodedPayload || !encodedSignature || extra !== undefined) return null;

    try {
      const actualSignature = Buffer.from(encodedSignature, "base64url");
      const expectedSignature = signatureFor(encodedPayload);

      if (
        expectedSignature === null ||
        actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)
      ) {
        return null;
      }

      const parsed = snapshotPayloadSchema.safeParse(
        JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
      );

      return parsed.success && parsed.data.taskId === taskId
        ? parsed.data
        : null;
    } catch {
      return null;
    }
  },
};
