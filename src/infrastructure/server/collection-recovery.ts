import { getRun } from "workflow/api";
import type { Db, MongoClient } from "mongodb";
import type { CollectionJob } from "./collection-runner";

export async function recoverInterruptedCollection(job: CollectionJob, client: MongoClient, db: Db, now = new Date()): Promise<CollectionJob> {
  if (!["pending", "running"].includes(job.status) ||
      now.getTime() - (job.updatedAt ?? job.startedAt ?? job.createdAt).getTime() < 15 * 60_000) return job;
  if (job.workflowRunId) {
    const status = await getRun(job.workflowRunId).status;
    if (status !== "failed" && status !== "cancelled" && status !== "completed") return job;
  }
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const jobs = db.collection<CollectionJob>("collectionJobs");
      const current = await jobs.findOne({ _id: job._id, workspaceId: job.workspaceId, status: job.status }, { session });
      if (!current || (current.updatedAt ?? current.startedAt ?? current.createdAt).getTime() !==
          (job.updatedAt ?? job.startedAt ?? job.createdAt).getTime()) return;
      const error = "A execução anterior foi interrompida. Os resultados salvos e o consumo foram preservados. Chamadas sem resposta salva não serão repetidas; se necessário, crie uma nova busca.";
      await jobs.updateOne({ _id: job._id }, { $set: { status: "failed", error, finishedAt: now } }, { session });
      // Sem checkpoint confiável da última chamada, não é seguro reutilizar o token anterior.
      await db.collection("collectionCursors").updateOne({ activeJobId: job._id, workspaceId: job.workspaceId },
        { $set: { blocked: true }, $unset: { activeJobId: "" } }, { session });
    });
  } finally { await session.endSession(); }
  const recovered = await db.collection<CollectionJob>("collectionJobs").findOne({ _id: job._id, workspaceId: job.workspaceId });
  if (!recovered) throw new Error("Job não encontrado após recuperação.");
  if (recovered.status === "failed") {
    console.warn(JSON.stringify({ event: "collection_interrupted_recovered", jobId: job._id, durable: Boolean(job.workflowRunId) }));
  }
  return recovered;
}
