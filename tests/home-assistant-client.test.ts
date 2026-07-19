import { describe, expect, it, vi } from "vitest";
import { HomeAssistantClient, HomeAssistantError } from "../src/home-assistant/client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HomeAssistantClient", () => {
  it("announce calls notify.alexa_media with announce type", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, []));
    const client = new HomeAssistantClient({
      baseUrl: "http://127.0.0.1:8123",
      token: "ha-token",
      fetchFn,
    });

    await client.announce("media_player.living_room_echo", "Hermesの回答");

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8123/api/services/notify/alexa_media");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer ha-token");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      target: ["media_player.living_room_echo"],
      message: "Hermesの回答",
      data: { type: "announce" },
    });
  });

  it("throws HomeAssistantError on non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { message: "unauthorized" }));
    const client = new HomeAssistantClient({ baseUrl: "http://127.0.0.1:8123", token: "bad", fetchFn });
    await expect(client.announce("media_player.x", "msg")).rejects.toThrow(HomeAssistantError);
  });

  it("returns the most recently updated available media player marked as last called", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, [
      {
        entity_id: "media_player.old_echo",
        state: "idle",
        last_updated: "2026-07-19T00:00:00Z",
        attributes: { last_called: true },
      },
      {
        entity_id: "media_player.unavailable_echo",
        state: "unavailable",
        last_updated: "2026-07-19T00:02:00Z",
        attributes: { last_called: true },
      },
      {
        entity_id: "media_player.requesting_echo",
        state: "idle",
        last_updated: "2026-07-19T00:01:00Z",
        attributes: { last_called: true },
      },
      {
        entity_id: "switch.requesting_echo_do_not_disturb",
        state: "off",
        last_updated: "2026-07-19T00:03:00Z",
        attributes: { last_called: true },
      },
    ]));
    const client = new HomeAssistantClient({
      baseUrl: "http://127.0.0.1:8123",
      token: "ha-token",
      fetchFn,
    });

    await expect(client.lastCalledMediaPlayer()).resolves.toBe("media_player.requesting_echo");
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8123/api/states",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ha-token" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("health returns true when /api/ responds", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { message: "API running." }));
    const client = new HomeAssistantClient({ baseUrl: "http://127.0.0.1:8123", token: "t", fetchFn });
    await expect(client.health()).resolves.toBe(true);
  });

  it("health returns false on connection error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new HomeAssistantClient({ baseUrl: "http://127.0.0.1:8123", token: "t", fetchFn });
    await expect(client.health()).resolves.toBe(false);
  });
});
