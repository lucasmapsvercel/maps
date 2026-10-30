import { FatalError } from "workflow";
import { PortalError } from "../../application/portal-error";
import { mongoClient, mongoDatabase } from "./mongo";
import { secret } from "./config";
import { validateCollectionRequest } from "./runtime-config";
import {
  prepareCollectionJob, planCollectionJob, fetchCollectionPage, importCollectionPage, finishCollectionJob
} from "./collection-runner";

export async function collectionWorkflow(jobId: string) {
  "use workflow";
  try {
    await prepare(jobId);
    while (true) {
      const plan = await planNext(jobId);
      if (!plan) return;
      if (plan.done) {
        await finish(jobId);
        return;
      }
      const results = await Promise.allSettled([
        plan.importPage ? importPage(jobId, plan.importIndex) : Promise.resolve(),
        plan.fetchPage ? fetchPage(jobId, plan.requestIndex) : Promise.resolve()
      ]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    }
  } catch (error) {
    await finish(jobId, error instanceof FatalError ? error.message : "A execução da coleta foi interrompida por uma falha técnica. Consulte os logs de execução.");
    throw error;
  }
}

async function prepare(jobId: string) {
  "use step";
  await prepareCollectionJob(jobId, await mongoDatabase());
}

async function planNext(jobId: string) {
  "use step";
  try {
    return await planCollectionJob(jobId, await mongoDatabase());
  } catch (error) {
    if (error instanceof PortalError) throw new FatalError(error.message);
    throw error;
  }
}

async function fetchPage(jobId: string, requestIndex: number) {
  "use step";
  try {
    validateCollectionRequest(process.env);
    await fetchCollectionPage(jobId, requestIndex, secret("GOOGLE_PLACES_API_KEY"), await mongoClient(), await mongoDatabase());
  } catch (error) {
    if (error instanceof PortalError) throw new FatalError(error.message);
    throw error;
  }
}

async function importPage(jobId: string, importIndex: number) {
  "use step";
  try {
    await importCollectionPage(jobId, importIndex, await mongoClient(), await mongoDatabase());
  } catch (error) {
    if (error instanceof PortalError) throw new FatalError(error.message);
    throw error;
  }
}

async function finish(jobId: string, error?: string) {
  "use step";
  await finishCollectionJob(jobId, await mongoClient(), await mongoDatabase(), error);
}
