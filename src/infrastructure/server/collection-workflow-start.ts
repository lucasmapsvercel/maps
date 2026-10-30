import { start } from "workflow/api";
import { collectionWorkflow } from "./collection-workflow";

export async function enqueueCollectionWorkflow(jobId: string): Promise<string> {
  const run = await start(collectionWorkflow, [jobId]);
  return run.runId;
}
