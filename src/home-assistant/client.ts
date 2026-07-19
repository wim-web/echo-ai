import type { FetchFn } from "../hermes/client.js";

export interface HomeAssistantClientOptions {
  baseUrl: string;
  token: string;
  fetchFn?: FetchFn;
}

export class HomeAssistantError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HomeAssistantError";
  }
}

/** Home Assistant REST API クライアント (Alexa Media Player 経由の読み上げ用)。 */
export class HomeAssistantClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: FetchFn;

  constructor(options: HomeAssistantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** 指定したEcho entityへannounceを送る。 */
  async announce(entityId: string, message: string): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}/api/services/notify/alexa_media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: [entityId],
        message,
        data: { type: "announce" },
      }),
    });
    if (!res.ok) {
      throw new HomeAssistantError(`announce failed: HTTP ${res.status}`, res.status);
    }
  }

  async lastCalledMediaPlayer(): Promise<string | undefined> {
    const res = await this.fetchFn(`${this.baseUrl}/api/states`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      throw new HomeAssistantError(`states request failed: HTTP ${res.status}`, res.status);
    }

    const states = await res.json() as Array<{
      entity_id: string;
      state: string;
      last_updated: string;
      attributes?: { last_called?: boolean };
    }>;
    return states
      .filter((state) =>
        state.entity_id.startsWith("media_player.")
        && state.state !== "unavailable"
        && state.attributes?.last_called === true)
      .sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated))[0]
      ?.entity_id;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
