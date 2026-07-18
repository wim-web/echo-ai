import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeviceRepository } from "../src/devices/repository.js";

function writeYaml(content: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devices-")), "devices.yaml");
  fs.writeFileSync(file, content);
  return file;
}

describe("DeviceRepository", () => {
  it("resolves an entity id for a known alexa device id", () => {
    const file = writeYaml(`devices:
  amzn1.ask.device.ABC123:
    entity_id: media_player.living_room_echo
  amzn1.ask.device.XYZ789:
    entity_id: media_player.bedroom_echo
`);
    const repo = new DeviceRepository(file);
    expect(repo.resolve("amzn1.ask.device.ABC123")).toBe("media_player.living_room_echo");
    expect(repo.resolve("amzn1.ask.device.XYZ789")).toBe("media_player.bedroom_echo");
  });

  it("returns undefined for an unknown device id", () => {
    const file = writeYaml(`devices:
  amzn1.ask.device.ABC123:
    entity_id: media_player.living_room_echo
`);
    const repo = new DeviceRepository(file);
    expect(repo.resolve("amzn1.ask.device.UNKNOWN")).toBeUndefined();
  });

  it("resolves nothing when the file does not exist", () => {
    const repo = new DeviceRepository("/nonexistent/devices.yaml");
    expect(repo.resolve("amzn1.ask.device.ABC123")).toBeUndefined();
  });

  it("lists registered device ids", () => {
    const file = writeYaml(`devices:
  amzn1.ask.device.ABC123:
    entity_id: media_player.living_room_echo
`);
    const repo = new DeviceRepository(file);
    expect(repo.deviceIds()).toEqual(["amzn1.ask.device.ABC123"]);
  });
});
