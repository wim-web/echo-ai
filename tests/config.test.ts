import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  ALEXA_SKILL_ID: "amzn1.ask.skill.test",
  HERMES_API_URL: "http://127.0.0.1:8642",
  HERMES_API_KEY: "hermes-key",
  HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
  HOME_ASSISTANT_TOKEN: "ha-token",
  HA_DEFAULT_ENTITY_ID: "media_player.living_room_echo",
};

describe("loadConfig", () => {
  it("loads required values and applies defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.alexaSkillId).toBe("amzn1.ask.skill.test");
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe("./data/bridge.sqlite");
    expect(config.hermesInstructions).toContain("日本語");
  });

  it("throws when a required variable is missing", () => {
    expect(() => loadConfig({ ...validEnv, HERMES_API_KEY: "" })).toThrow(/HERMES_API_KEY/);
  });

  it("parses PORT as a number", () => {
    const config = loadConfig({ ...validEnv, PORT: "8080" });
    expect(config.port).toBe(8080);
  });
});
