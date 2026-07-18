import { describe, expect, it, vi } from "vitest";
import { JobRepository } from "../src/jobs/repository.js";
import { Worker, type WorkerDeps } from "../src/jobs/worker.js";
import type { HermesClient } from "../src/hermes/client.js";
import type { HomeAssistantClient } from "../src/home-assistant/client.js";

function makeDeps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    repo: new JobRepository(":memory:"),
    hermes: {
      startRun: vi.fn().mockResolvedValue({ runId: "run_1", status: "started" }),
      getRun: vi.fn().mockResolvedValue({ runId: "run_1", status: "completed", output: "今日は晴れです。" }),
      health: vi.fn().mockResolvedValue(true),
    } as unknown as HermesClient,
    ha: {
      announce: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue(true),
    } as unknown as HomeAssistantClient,
    defaultEntityId: "media_player.living_room_echo",
    instructions: "簡潔に回答してください",
    pollIntervalMs: 1,
    runTimeoutMs: 1000,
    ...overrides,
  };
}

describe("Worker", () => {
  it("processes a queued job to NOTIFIED via hermes and home assistant", async () => {
    const deps = makeDeps();
    const worker = new Worker(deps);
    const job = deps.repo.create({
      alexaRequestId: "req-1",
      alexaUserIdHash: "hash-1",
      alexaDeviceId: "device-1",
      query: "天気は？",
    });

    const processed = await worker.processNext();

    expect(processed).toBe(true);
    const updated = deps.repo.findById(job.id);
    expect(updated?.status).toBe("NOTIFIED");
    expect(updated?.answer).toBe("今日は晴れです。");
    expect(updated?.hermesRunId).toBe("run_1");
    expect(updated?.notifiedAt).toBeTruthy();

    expect(deps.hermes.startRun).toHaveBeenCalledWith({
      input: "天気は？",
      instructions: "簡潔に回答してください",
      sessionKey: "agent:echo:alexa:hash-1",
    });
    expect(deps.ha.announce).toHaveBeenCalledWith(
      "media_player.living_room_echo",
      "今日は晴れです。",
    );
  });

  it("returns false when there is no queued job", async () => {
    const deps = makeDeps();
    const worker = new Worker(deps);
    await expect(worker.processNext()).resolves.toBe(false);
  });

  it("marks the job FAILED when the hermes run fails", async () => {
    const deps = makeDeps();
    (deps.hermes.getRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      runId: "run_1",
      status: "failed",
      error: "model error",
    });
    const worker = new Worker(deps);
    const job = deps.repo.create({ alexaRequestId: "r", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });

    await worker.processNext();

    const updated = deps.repo.findById(job.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.error).toContain("model error");
    expect(deps.ha.announce).not.toHaveBeenCalled();
  });

  it("marks the job FAILED when polling times out", async () => {
    const deps = makeDeps({ runTimeoutMs: 5, pollIntervalMs: 1 });
    (deps.hermes.getRun as ReturnType<typeof vi.fn>).mockResolvedValue({ runId: "run_1", status: "running" });
    const worker = new Worker(deps);
    const job = deps.repo.create({ alexaRequestId: "r", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });

    await worker.processNext();

    const updated = deps.repo.findById(job.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.error).toMatch(/timeout/i);
  });

  it("marks the job FAILED when startRun throws", async () => {
    const deps = makeDeps();
    (deps.hermes.startRun as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));
    const worker = new Worker(deps);
    const job = deps.repo.create({ alexaRequestId: "r", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });

    await worker.processNext();

    expect(deps.repo.findById(job.id)?.status).toBe("FAILED");
  });

  it("keeps the job COMPLETED when home assistant announce fails", async () => {
    const deps = makeDeps();
    (deps.ha.announce as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("HA down"));
    const worker = new Worker(deps);
    const job = deps.repo.create({ alexaRequestId: "r", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });

    await worker.processNext();

    const updated = deps.repo.findById(job.id);
    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.answer).toBe("今日は晴れです。");
    expect(updated?.notifiedAt).toBeNull();
  });

  it("formats long answers for speech before announcing", async () => {
    const deps = makeDeps();
    (deps.hermes.getRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      runId: "run_1",
      status: "completed",
      output: "## 結論\n**太字**の回答。```code block```",
    });
    const worker = new Worker(deps);
    deps.repo.create({ alexaRequestId: "r", alexaUserIdHash: "h", alexaDeviceId: "d", query: "q" });

    await worker.processNext();

    expect(deps.ha.announce).toHaveBeenCalledWith(
      "media_player.living_room_echo",
      "結論 太字の回答。",
    );
  });
});
