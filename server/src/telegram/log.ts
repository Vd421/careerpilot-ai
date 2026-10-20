import type { AgentActionType } from "../contracts.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db.js";

// Every agent step writes one AgentAction row (hard rule). One helper so nobody forgets a field.
export async function logAction(
  type: AgentActionType,
  where: { jobId?: number | null; applicationId?: number | null; loopId?: number | null },
  detail: Record<string, unknown> = {},
): Promise<void> {
  await prisma.agentAction.create({
    data: {
      type,
      jobId: where.jobId ?? null,
      applicationId: where.applicationId ?? null,
      loopId: where.loopId ?? null,
      detail: detail as Prisma.InputJsonValue,
    },
  });
}
