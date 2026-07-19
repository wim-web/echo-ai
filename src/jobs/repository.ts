import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "NOTIFIED" | "FAILED";

export interface Job {
  id: string;
  alexaRequestId: string;
  alexaUserIdHash: string;
  alexaDeviceId: string;
  targetEntityId: string | null;
  query: string;
  status: JobStatus;
  hermesRunId: string | null;
  answer: string | null;
  error: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  notifiedAt: string | null;
}

export interface CreateJobInput {
  alexaRequestId: string;
  alexaUserIdHash: string;
  alexaDeviceId: string;
  targetEntityId?: string;
  query: string;
}

export type CreatedJob = Job & { created: boolean };

interface JobRow {
  id: string;
  alexa_request_id: string;
  alexa_user_id_hash: string;
  alexa_device_id: string;
  target_entity_id: string | null;
  query: string;
  status: JobStatus;
  hermes_run_id: string | null;
  answer: string | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  notified_at: string | null;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  alexa_request_id TEXT NOT NULL UNIQUE,
  alexa_user_id_hash TEXT NOT NULL,
  alexa_device_id TEXT NOT NULL,
  target_entity_id TEXT,
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
`;

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    alexaRequestId: row.alexa_request_id,
    alexaUserIdHash: row.alexa_user_id_hash,
    alexaDeviceId: row.alexa_device_id,
    targetEntityId: row.target_entity_id,
    query: row.query,
    status: row.status,
    hermesRunId: row.hermes_run_id,
    answer: row.answer,
    error: row.error,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notifiedAt: row.notified_at,
  };
}

function now(): string {
  return new Date().toISOString();
}

export class JobRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_TABLE);
    const columns = this.db.pragma("table_info(jobs)") as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "target_entity_id")) {
      this.db.exec("ALTER TABLE jobs ADD COLUMN target_entity_id TEXT");
    }
  }

  create(input: CreateJobInput): CreatedJob {
    const id = randomUUID();
    const ts = now();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO jobs
         (id, alexa_request_id, alexa_user_id_hash, alexa_device_id, target_entity_id, query, status, retry_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?)`,
      )
      .run(
        id,
        input.alexaRequestId,
        input.alexaUserIdHash,
        input.alexaDeviceId,
        input.targetEntityId ?? null,
        input.query,
        ts,
        ts,
      );

    const row = this.db
      .prepare("SELECT * FROM jobs WHERE alexa_request_id = ?")
      .get(input.alexaRequestId) as JobRow;
    return { ...toJob(row), created: result.changes > 0 };
  }

  findById(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? toJob(row) : undefined;
  }

  /** 最も古いQUEUEDジョブをRUNNINGへ更新して返す。無ければundefined。 */
  claimNextQueued(): Job | undefined {
    const tx = this.db.transaction((): Job | undefined => {
      const row = this.db
        .prepare("SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1")
        .get() as JobRow | undefined;
      if (!row) return undefined;
      this.db
        .prepare("UPDATE jobs SET status = 'RUNNING', updated_at = ? WHERE id = ?")
        .run(now(), row.id);
      return { ...toJob(row), status: "RUNNING" };
    });
    return tx();
  }

  setHermesRunId(id: string, runId: string): void {
    this.db
      .prepare("UPDATE jobs SET hermes_run_id = ?, updated_at = ? WHERE id = ?")
      .run(runId, now(), id);
  }

  complete(id: string, answer: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'COMPLETED', answer = ?, updated_at = ? WHERE id = ?")
      .run(answer, now(), id);
  }

  fail(id: string, error: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?")
      .run(error, now(), id);
  }

  markNotified(id: string): void {
    const ts = now();
    this.db
      .prepare("UPDATE jobs SET status = 'NOTIFIED', notified_at = ?, updated_at = ? WHERE id = ?")
      .run(ts, ts, id);
  }

  ping(): boolean {
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}
