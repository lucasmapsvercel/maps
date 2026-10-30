import { PortalError } from "../../../../../../application/portal-error";
import { authenticatedApi, json } from "../../../../../../infrastructure/server/api";
import { mongoDatabase } from "../../../../../../infrastructure/server/mongo";
import { getCollectionJob } from "../../../../../../infrastructure/server/collection-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return authenticatedApi(request, async (actor) => {
    const db = await mongoDatabase();
    const job = await getCollectionJob(jobId, actor.workspaceId, db);
    if (!job) throw new PortalError(404, "JOB_NOT_FOUND", "Job não encontrado.");
    return json({
      id: job._id, status: job.status, importedCount: job.importedCount, error: job.error, hasMore: job.hasMore,
      requestsMade: job.requestsMade, maxRequestsPerRun: job.maxRequestsPerRun,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      finishedAt: job.finishedAt?.toISOString()
    });
  });
}
