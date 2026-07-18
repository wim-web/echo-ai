import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { SkillBuilders } from "ask-sdk-core";
import { ExpressAdapter } from "ask-sdk-express-adapter";
import express from "express";
import { buildHandlers } from "./alexa/handlers.js";
import { loadConfig } from "./config.js";
import { DeviceRepository } from "./devices/repository.js";
import { HermesClient } from "./hermes/client.js";
import { HomeAssistantClient } from "./home-assistant/client.js";
import { JobRepository } from "./jobs/repository.js";
import { Worker } from "./jobs/worker.js";
import { logger } from "./logger.js";

function main(): void {
  const config = loadConfig();

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const repo = new JobRepository(config.databasePath);
  const deviceRepo = new DeviceRepository(config.devicesConfigPath);
  logger.info({ devices: deviceRepo.deviceIds().length }, "device mappings loaded");

  const hermes = new HermesClient({
    baseUrl: config.hermesApiUrl,
    apiKey: config.hermesApiKey,
  });
  const ha = new HomeAssistantClient({
    baseUrl: config.homeAssistantUrl,
    token: config.homeAssistantToken,
  });

  const worker = new Worker({
    repo,
    hermes,
    ha,
    defaultEntityId: config.haDefaultEntityId,
    instructions: config.hermesInstructions,
    deviceRepo,
    logger,
  });
  worker.startLoop();

  const skill = SkillBuilders.custom()
    .addRequestHandlers(
      ...buildHandlers({
        repo,
        skillId: config.alexaSkillId,
        logger,
        onJobAccepted: () => {
          void worker.processNext();
        },
      }),
    )
    .create();

  // 署名検証・タイムスタンプ検証を有効化
  const adapter = new ExpressAdapter(skill, true, true);

  const app = express();

  // /alexa は署名検証のため raw body が必要なので、json パーサーより先にマウントする
  app.post("/alexa", adapter.getRequestHandlers());

  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const [database, hermesOk, haOk] = await Promise.all([
      Promise.resolve(repo.ping()),
      hermes.health(),
      ha.health(),
    ]);
    const statusOf = (ok: boolean) => (ok ? "ok" : "error");
    const allOk = database && hermesOk && haOk;
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "error",
      database: statusOf(database),
      hermes: statusOf(hermesOk),
      homeAssistant: statusOf(haOk),
    });
  });

  app.get("/jobs/:id", (req, res) => {
    const job = repo.findById(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.warn({ err: err.message }, "request rejected");
      res.status(400).json({ error: err.message });
    },
  );

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "alexa-hermes-bridge listening");
  });

  const shutdown = () => {
    logger.info("shutting down");
    worker.stopLoop();
    server.close(() => {
      repo.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
