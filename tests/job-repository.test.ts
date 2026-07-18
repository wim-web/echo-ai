import { describe, expect, it } from "vitest";
import { JobRepository } from "../src/jobs/repository.js";

function createRepo() {
  return new JobRepository(":memory:");
}

describe("JobRepository", () => {
  it("creates a job with QUEUED status and generated id", () => {
    const repo = createRepo();
    const job = repo.create({
      alexaRequestId: "req-1",
      alexaUserIdHash: "hash-1",
      alexaDeviceId: "device-1",
      query: "今日の天気は？",
    });
    expect(job.id).toBeTruthy();
    expect(job.status).toBe("QUEUED");
    expect(job.retryCount).toBe(0);
    expect(job.createdAt).toBeTruthy();
  });

  it("returns the existing job when alexaRequestId already exists (idempotent)", () => {
    const repo = createRepo();
    const first = repo.create({
      alexaRequestId: "req-dup",
      alexaUserIdHash: "hash-1",
      alexaDeviceId: "device-1",
      query: "質問1",
    });
    const second = repo.create({
      alexaRequestId: "req-dup",
      alexaUserIdHash: "hash-1",
      alexaDeviceId: "device-1",
      query: "質問1",
    });
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });

  it("claims the oldest QUEUED job as RUNNING", () => {
    const repo = createRepo();
    const j1 = repo.create({ alexaRequestId: "r1", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q1" });
    repo.create({ alexaRequestId: "r2", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q2" });

    const claimed = repo.claimNextQueued();
    expect(claimed?.id).toBe(j1.id);
    expect(claimed?.status).toBe("RUNNING");
    expect(repo.claimNextQueued()?.status).toBe("RUNNING");
    expect(repo.claimNextQueued()).toBeUndefined();
  });

  it("stores hermes run id", () => {
    const repo = createRepo();
    const job = repo.create({ alexaRequestId: "r1", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });
    repo.setHermesRunId(job.id, "run_abc");
    expect(repo.findById(job.id)?.hermesRunId).toBe("run_abc");
  });

  it("marks a job COMPLETED with the answer", () => {
    const repo = createRepo();
    const job = repo.create({ alexaRequestId: "r1", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });
    repo.complete(job.id, "回答テキスト");
    const updated = repo.findById(job.id);
    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.answer).toBe("回答テキスト");
  });

  it("marks a job FAILED with an error", () => {
    const repo = createRepo();
    const job = repo.create({ alexaRequestId: "r1", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });
    repo.fail(job.id, "hermes timeout");
    const updated = repo.findById(job.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.error).toBe("hermes timeout");
  });

  it("marks a COMPLETED job NOTIFIED with notifiedAt", () => {
    const repo = createRepo();
    const job = repo.create({ alexaRequestId: "r1", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });
    repo.complete(job.id, "回答");
    repo.markNotified(job.id);
    const updated = repo.findById(job.id);
    expect(updated?.status).toBe("NOTIFIED");
    expect(updated?.notifiedAt).toBeTruthy();
  });

  it("findById returns undefined for unknown id", () => {
    const repo = createRepo();
    expect(repo.findById("nope")).toBeUndefined();
  });

  it("ping returns true when the database is reachable", () => {
    const repo = createRepo();
    expect(repo.ping()).toBe(true);
  });
});
