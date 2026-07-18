import { describe, expect, it, vi } from "vitest";
import { HermesClient, HermesError } from "../src/hermes/client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HermesClient", () => {
  it("startRun posts to /v1/runs with auth and session key headers", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { run_id: "run_1", status: "started" }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "secret", fetchFn });

    const result = await client.startRun({
      input: "天気を教えて",
      instructions: "簡潔に",
      sessionKey: "agent:echo:alexa:hash",
    });

    expect(result.runId).toBe("run_1");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/v1/runs");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret");
    expect(headers["X-Hermes-Session-Key"]).toBe("agent:echo:alexa:hash");
    const body = JSON.parse(init.body as string);
    expect(body.input).toBe("天気を教えて");
    expect(body.instructions).toBe("簡潔に");
  });

  it("getRun polls /v1/runs/:id and returns status and output", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        object: "hermes.run",
        run_id: "run_1",
        status: "completed",
        output: "回答です",
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }),
    );
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "secret", fetchFn });

    const run = await client.getRun("run_1");
    expect(run.status).toBe("completed");
    expect(run.output).toBe("回答です");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/v1/runs/run_1");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret");
  });

  it("throws HermesError on non-2xx response from startRun", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "bad", fetchFn });
    await expect(client.startRun({ input: "x", instructions: "", sessionKey: "k" })).rejects.toThrow(HermesError);
  });

  it("throws HermesError on non-2xx response from getRun", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(404, { error: "not found" }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "secret", fetchFn });
    await expect(client.getRun("run_x")).rejects.toThrow(HermesError);
  });

  it("health returns true when /health responds ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok" }));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "secret", fetchFn });
    await expect(client.health()).resolves.toBe(true);
  });

  it("health returns false on failure", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:8642", apiKey: "secret", fetchFn });
    await expect(client.health()).resolves.toBe(false);
  });
});
