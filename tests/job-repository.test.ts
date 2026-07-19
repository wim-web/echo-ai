import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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

  it("stores the Home Assistant target entity captured when the job is created", () => {
    const repo = createRepo();

    const job = repo.create({
      alexaRequestId: "req-target",
      alexaUserIdHash: "hash-1",
      alexaDeviceId: "device-1",
      targetEntityId: "media_player.requesting_echo",
      query: "質問",
    });

    expect(job.targetEntityId).toBe("media_player.requesting_echo");
    expect(repo.findById(job.id)?.targetEntityId).toBe("media_player.requesting_echo");
  });

  it("adds the target entity column when opening an existing database", () => {
    const directory = mkdtempSync(join(tmpdir(), "echo-ai-job-repo-"));
    const databasePath = join(directory, "jobs.sqlite");
    try {
      const oldDatabase = new Database(databasePath);
      oldDatabase.exec(`
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          alexa_request_id TEXT NOT NULL UNIQUE,
          alexa_user_id_hash TEXT NOT NULL,
          alexa_device_id TEXT NOT NULL,
          query TEXT NOT NULL,
          status TEXT NOT NULL,
          hermes_run_id TEXT,
          answer TEXT,
          error TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          notified_at TEXT
        );
      `);
      oldDatabase.close();

      const repo = new JobRepository(databasePath);
      const job = repo.create({
        alexaRequestId: "req-migrated",
        alexaUserIdHash: "hash-1",
        alexaDeviceId: "device-1",
        targetEntityId: "media_player.requesting_echo",
        query: "質問",
      });

      expect(job.targetEntityId).toBe("media_player.requesting_echo");
      repo.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
