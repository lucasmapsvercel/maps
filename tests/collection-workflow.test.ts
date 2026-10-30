// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { FatalError } from "workflow";
import { collectionWorkflow } from "../src/infrastructure/server/collection-workflow";
import {
  prepareCollectionJob, planCollectionJob, fetchCollectionPage, importCollectionPage, finishCollectionJob
} from "../src/infrastructure/server/collection-runner";
import { PortalError } from "../src/application/portal-error";

vi.mock("../src/infrastructure/server/mongo", () => ({
  mongoClient: vi.fn(async () => ({})), mongoDatabase: vi.fn(async () => ({}))
}));
vi.mock("../src/infrastructure/server/config", () => ({ secret: () => "fixture" }));
vi.mock("../src/infrastructure/server/runtime-config", () => ({ validateCollectionRequest: vi.fn() }));
vi.mock("../src/infrastructure/server/collection-runner", () => ({
  prepareCollectionJob: vi.fn(), planCollectionJob: vi.fn(), fetchCollectionPage: vi.fn(),
  importCollectionPage: vi.fn(), finishCollectionJob: vi.fn()
}));

beforeEach(() => vi.clearAllMocks());

test("workflow advances through persisted plans and finishes without returning provider data", async () => {
  vi.mocked(planCollectionJob)
    .mockResolvedValueOnce({ done: false, importPage: false, fetchPage: true, requestIndex: 0, importIndex: 0 })
    .mockResolvedValueOnce({ done: false, importPage: true, fetchPage: true, requestIndex: 1, importIndex: 0 })
    .mockResolvedValueOnce({ done: true, importPage: false, fetchPage: false, requestIndex: 2, importIndex: 1 });
  expect(await collectionWorkflow("job")).toBeUndefined();
  expect(prepareCollectionJob).toHaveBeenCalledWith("job", {});
  expect(fetchCollectionPage).toHaveBeenCalledTimes(2);
  expect(importCollectionPage).toHaveBeenCalledWith("job", 0, {}, {});
  expect(finishCollectionJob).toHaveBeenCalledWith("job", {}, {}, undefined);
});

test("workflow waits for an in-flight fetch before recording an import failure and fails the run explicitly", async () => {
  vi.mocked(planCollectionJob).mockResolvedValueOnce({
    done: false, importPage: true, fetchPage: true, requestIndex: 1, importIndex: 0
  });
  vi.mocked(importCollectionPage).mockRejectedValueOnce(new PortalError(409, "TEST", "Importação recusada"));
  let release!: () => void;
  vi.mocked(fetchCollectionPage).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const task = collectionWorkflow("job");
  const failed = expect(task).rejects.toBeInstanceOf(FatalError);
  await vi.waitFor(() => expect(fetchCollectionPage).toHaveBeenCalled());
  expect(finishCollectionJob).not.toHaveBeenCalled();
  release();
  await failed;
  expect(finishCollectionJob).toHaveBeenCalledWith("job", {}, {}, "Importação recusada");
});

test("a missing or already finished job does not dispatch new Google steps", async () => {
  vi.mocked(planCollectionJob).mockResolvedValueOnce(null);
  await collectionWorkflow("finished");
  expect(fetchCollectionPage).not.toHaveBeenCalled();
  expect(importCollectionPage).not.toHaveBeenCalled();
  expect(finishCollectionJob).not.toHaveBeenCalled();
});

test("unexpected errors fail the run without exposing internal details in the job", async () => {
  const error = new Error("Internal connection details");
  vi.mocked(planCollectionJob).mockRejectedValueOnce(error);
  await expect(collectionWorkflow("job")).rejects.toBe(error);
  expect(finishCollectionJob).toHaveBeenCalledWith(
    "job", {}, {}, "A execução da coleta foi interrompida por uma falha técnica. Consulte os logs de execução."
  );
});
