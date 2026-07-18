export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HermesClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: FetchFn;
}

export interface StartRunInput {
  input: string;
  instructions: string;
  sessionKey: string;
}

export interface HermesRun {
  runId: string;
  status: string;
  output?: string;
  error?: string;
}

export class HermesError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HermesError";
  }
}

/** Hermes API Server (hermes-agent) の Runs API クライアント。 */
export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchFn;

  constructor(options: HermesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async startRun(input: StartRunInput): Promise<{ runId: string; status: string }> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/runs`, {
      method: "POST",
      headers: this.headers({ "X-Hermes-Session-Key": input.sessionKey }),
      body: JSON.stringify({ input: input.input, instructions: input.instructions }),
    });
    if (!res.ok) {
      throw new HermesError(`startRun failed: HTTP ${res.status}`, res.status);
    }
    const body = (await res.json()) as { run_id: string; status: string };
    return { runId: body.run_id, status: body.status };
  }

  async getRun(runId: string): Promise<HermesRun> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new HermesError(`getRun failed: HTTP ${res.status}`, res.status);
    }
    const body = (await res.json()) as {
      run_id: string;
      status: string;
      output?: string;
      error?: string;
    };
    return { runId: body.run_id, status: body.status, output: body.output, error: body.error };
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
