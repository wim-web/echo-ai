import fs from "node:fs";
import { parse } from "yaml";

interface DevicesFile {
  devices?: Record<string, { entity_id?: string }>;
}

/**
 * config/devices.yaml に定義した Alexa deviceId → HA entity_id の対応表。
 * ファイルが無くても空の対応表として動作する（未登録はundefined）。
 */
export class DeviceRepository {
  private readonly mappings: Map<string, string>;

  constructor(yamlPath: string) {
    this.mappings = new Map();
    let content: string;
    try {
      content = fs.readFileSync(yamlPath, "utf8");
    } catch {
      return;
    }
    const parsed = parse(content) as DevicesFile | null;
    for (const [deviceId, entry] of Object.entries(parsed?.devices ?? {})) {
      if (entry?.entity_id) {
        this.mappings.set(deviceId, entry.entity_id);
      }
    }
  }

  resolve(alexaDeviceId: string): string | undefined {
    return this.mappings.get(alexaDeviceId);
  }

  deviceIds(): string[] {
    return [...this.mappings.keys()];
  }
}
