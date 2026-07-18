export interface Config {
  port: number;
  alexaSkillId: string;
  hermesApiUrl: string;
  hermesApiKey: string;
  homeAssistantUrl: string;
  homeAssistantToken: string;
  haDefaultEntityId: string;
  databasePath: string;
  devicesConfigPath: string;
  hermesInstructions: string;
}

const DEFAULT_HERMES_INSTRUCTIONS = [
  "Amazon Echoでの音声読み上げ用です。",
  "日本語で結論から簡潔に回答してください。",
  "表、Markdown、URL、コードブロックは使用しないでください。",
  "読み上げは原則60秒以内にしてください。",
  "長い調査結果は要点だけ回答してください。",
].join("\n");

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number.parseInt(env.PORT ?? "3000", 10),
    alexaSkillId: required(env, "ALEXA_SKILL_ID"),
    hermesApiUrl: required(env, "HERMES_API_URL"),
    hermesApiKey: required(env, "HERMES_API_KEY"),
    homeAssistantUrl: required(env, "HOME_ASSISTANT_URL"),
    homeAssistantToken: required(env, "HOME_ASSISTANT_TOKEN"),
    haDefaultEntityId: env.HA_DEFAULT_ENTITY_ID ?? "", // 端末対応表に無い場合のフォールバック先。空なら通知しない
    databasePath: env.DATABASE_PATH ?? "./data/bridge.sqlite",
    devicesConfigPath: env.DEVICES_CONFIG_PATH ?? "./config/devices.yaml",
    hermesInstructions: env.HERMES_INSTRUCTIONS ?? DEFAULT_HERMES_INSTRUCTIONS,
  };
}
