import type { HermesClient } from "../hermes/client.js";
import type { HomeAssistantClient } from "../home-assistant/client.js";
import { formatForSpeech } from "../speech/formatter.js";
import type { Job, JobRepository } from "./repository.js";

export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: WorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface DeviceResolver {
  resolve(alexaDeviceId: string): string | undefined;
}

export interface WorkerDeps {
  repo: JobRepository;
  hermes: HermesClient;
  ha: HomeAssistantClient;
  defaultEntityId: string;
  instructions: string;
  deviceRepo?: DeviceResolver;
  pollIntervalMs?: number;
  runTimeoutMs?: number;
  logger?: WorkerLogger;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * QUEUEDジョブをHermesへ投げ、完了した回答をHome Assistant経由で読み上げる。
 * processNext() は1ジョブを同期処理する（テスト・ループ双方から利用）。
 */
export class Worker {
  private readonly repo: JobRepository;
  private readonly hermes: HermesClient;
  private readonly ha: HomeAssistantClient;
  private readonly defaultEntityId: string;
  private readonly deviceRepo?: DeviceResolver;
  private readonly instructions: string;
  private readonly pollIntervalMs: number;
  private readonly runTimeoutMs: number;
  private readonly logger: WorkerLogger;
  private running = 0;
  private stopped = false;

  constructor(deps: WorkerDeps) {
    this.repo = deps.repo;
    this.hermes = deps.hermes;
    this.ha = deps.ha;
    this.defaultEntityId = deps.defaultEntityId;
    this.deviceRepo = deps.deviceRepo;
    this.instructions = deps.instructions;
    this.pollIntervalMs = deps.pollIntervalMs ?? 2000;
    this.runTimeoutMs = deps.runTimeoutMs ?? 10 * 60 * 1000;
    this.logger = deps.logger ?? noopLogger;
  }

  /** 最古のQUEUEDジョブを1件処理する。処理対象が無ければfalse。 */
  async processNext(): Promise<boolean> {
    const job = this.repo.claimNextQueued();
    if (!job) return false;
    await this.processJob(job);
    return true;
  }

  /** 定期的にQUEUEDをポーリングするループを開始する。 */
  startLoop(intervalMs = 1000): void {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      if (this.running < 1) {
        this.running++;
        try {
          const processed = await this.processNext();
          if (!processed) await sleep(intervalMs);
        } catch (err) {
          this.logger.error({ err: String(err) }, "worker loop error");
          await sleep(intervalMs);
        } finally {
          this.running--;
        }
      }
      setImmediate(() => void tick());
    };
    setImmediate(() => void tick());
  }

  stopLoop(): void {
    this.stopped = true;
  }

  async processJob(job: Job): Promise<void> {
    const logCtx = { jobId: job.id, alexaRequestId: job.alexaRequestId };
    try {
      const { runId } = await this.hermes.startRun({
        input: job.query,
        instructions: this.instructions,
        sessionKey: `agent:echo:alexa:${job.alexaUserIdHash}`,
      });
      this.repo.setHermesRunId(job.id, runId);
      this.logger.info({ ...logCtx, hermesRunId: runId }, "hermes run started");

      const output = await this.waitForCompletion(runId);
      this.repo.complete(job.id, output);
      this.logger.info(logCtx, "hermes run completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repo.fail(job.id, message);
      this.logger.error({ ...logCtx, err: message }, "hermes run failed");
      return;
    }

    await this.notify(job);
  }

  private async waitForCompletion(runId: string): Promise<string> {
    const deadline = Date.now() + this.runTimeoutMs;
    for (;;) {
      const run = await this.hermes.getRun(runId);
      if (run.status === "completed") {
        return run.output ?? "";
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new Error(run.error ?? `hermes run ${run.status}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`hermes run timeout after ${this.runTimeoutMs}ms`);
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private resolveEntityId(job: Job): string | undefined {
    return job.targetEntityId
      ?? this.deviceRepo?.resolve(job.alexaDeviceId)
      ?? (this.defaultEntityId || undefined);
  }

  private async notify(job: Job): Promise<void> {
    const current = this.repo.findById(job.id);
    if (!current?.answer) return;
    const entityId = this.resolveEntityId(job);
    if (!entityId) {
      // 未登録端末: COMPLETEDのまま保持し、deviceId末尾をログへ（対応付けはconfig/devices.yaml）
      this.logger.warn(
        { jobId: job.id, deviceIdTail: job.alexaDeviceId.slice(-8) },
        "no entity mapping for device; staying COMPLETED",
      );
      return;
    }
    const speech = formatForSpeech(current.answer);
    try {
      await this.ha.announce(entityId, speech);
      this.repo.markNotified(job.id);
      this.logger.info({ jobId: job.id }, "notified via home assistant");
    } catch (err) {
      // Phase 3: 読み上げ失敗時はCOMPLETEDのまま保持しログのみ（再試行はPhase 4）
      this.logger.error(
        { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
        "home assistant announce failed",
      );
    }
  }
}
