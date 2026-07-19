import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "ask-sdk-core";
import { JobRepository } from "../src/jobs/repository.js";
import { buildHandlers, type AlexaDeps } from "../src/alexa/handlers.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function intentEnvelope(intentName: string, slots: Record<string, string> = {}, requestId = "req-1") {
  return {
    version: "1.0",
    session: {
      sessionId: "session-1",
      application: { applicationId: "skill-1" },
      user: { userId: "user-1" },
      new: false,
    },
    context: {
      System: {
        application: { applicationId: "skill-1" },
        user: { userId: "user-1" },
        device: { deviceId: "device-1", supportedInterfaces: {} },
        apiEndpoint: "https://api.amazonalexa.com",
        apiAccessToken: "token",
      },
    },
    request: {
      type: "IntentRequest",
      requestId,
      timestamp: new Date().toISOString(),
      locale: "ja-JP",
      intent: {
        name: intentName,
        confirmationStatus: "NONE",
        slots: Object.fromEntries(
          Object.entries(slots).map(([name, value]) => [name, { name, value, confirmationStatus: "NONE" }]),
        ),
      },
    },
  };
}

function launchEnvelope() {
  const envelope = intentEnvelope("");
  return {
    ...envelope,
    request: {
      type: "LaunchRequest",
      requestId: "req-launch",
      timestamp: new Date().toISOString(),
      locale: "ja-JP",
    },
  };
}

function makeHandlerInput(envelope: unknown) {
  const speak = vi.fn().mockReturnThis();
  const withShouldEndSession = vi.fn().mockReturnThis();
  const reprompt = vi.fn().mockReturnThis();
  const addElicitSlotDirective = vi.fn().mockReturnThis();
  const getResponse = vi.fn().mockReturnValue({ mocked: true });
  const handlerInput = {
    requestEnvelope: envelope,
    responseBuilder: { speak, withShouldEndSession, reprompt, addElicitSlotDirective, getResponse },
  };
  return { handlerInput, speak, reprompt, withShouldEndSession, addElicitSlotDirective, getResponse };
}

function makeDeps(overrides: Partial<AlexaDeps> = {}): AlexaDeps {
  return {
    repo: new JobRepository(":memory:"),
    skillId: "skill-1",
    onJobAccepted: vi.fn(),
    ...overrides,
  };
}

function findHandler(handlers: RequestHandler[], handlerInput: unknown): RequestHandler {
  const handler = handlers.find((h) => h.canHandle(handlerInput as never));
  if (!handler) throw new Error("no handler matched");
  return handler;
}

describe("Alexa handlers", () => {
  it("AskHermesIntent creates a job and replies with an acknowledgement", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const { handlerInput, speak, withShouldEndSession } = makeHandlerInput(
      intentEnvelope("AskHermesIntent", { query: "今日の天気は？" }),
    );

    findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(speak).toHaveBeenCalledWith("了解。終わったらこの端末で知らせます。");
    expect(withShouldEndSession).toHaveBeenCalledWith(true);
    expect(deps.onJobAccepted).toHaveBeenCalledTimes(1);

    const job = deps.repo.claimNextQueued();
    expect(job?.query).toBe("今日の天気は？");
    expect(job?.alexaUserIdHash).toBe(sha256("user-1"));
    expect(job?.alexaDeviceId).toBe("device-1");
    expect(job?.alexaRequestId).toBe("req-1");
  });

  it("captures the last-called Home Assistant entity when accepting a question", async () => {
    const resolveLastCalledEntity = vi.fn().mockResolvedValue("media_player.requesting_echo");
    const deps = makeDeps({ resolveLastCalledEntity });
    const handlers = buildHandlers(deps);
    const { handlerInput } = makeHandlerInput(
      intentEnvelope("AskHermesIntent", { query: "今日の天気は？" }),
    );

    await findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(resolveLastCalledEntity).toHaveBeenCalledTimes(1);
    expect(deps.repo.claimNextQueued()?.targetEntityId).toBe("media_player.requesting_echo");
  });

  it("accepts the question without a captured entity when Home Assistant lookup fails", async () => {
    const warn = vi.fn();
    const deps = makeDeps({
      resolveLastCalledEntity: vi.fn().mockRejectedValue(new Error("HA unavailable")),
      logger: { info: vi.fn(), warn },
    });
    const handlers = buildHandlers(deps);
    const { handlerInput, speak } = makeHandlerInput(
      intentEnvelope("AskHermesIntent", { query: "今日の天気は？" }),
    );

    await findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(speak).toHaveBeenCalledWith("了解。終わったらこの端末で知らせます。");
    expect(deps.repo.claimNextQueued()?.targetEntityId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: "HA unavailable" }),
      "failed to resolve last-called Home Assistant entity",
    );
  });

  it("does not create a duplicate job for a retried request id", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const envelope = intentEnvelope("AskHermesIntent", { query: "質問" }, "req-dup");

    const first = makeHandlerInput(envelope);
    findHandler(handlers, first.handlerInput).handle(first.handlerInput as never);
    const second = makeHandlerInput(envelope);
    findHandler(handlers, second.handlerInput).handle(second.handlerInput as never);

    expect(deps.onJobAccepted).toHaveBeenCalledTimes(1);
    expect(second.speak).toHaveBeenCalledWith("了解。終わったらこの端末で知らせます。");
  });

  it("asks again when the query slot is empty", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const { handlerInput, speak } = makeHandlerInput(intentEnvelope("AskHermesIntent", {}));

    findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(speak).toHaveBeenCalledWith("すみません、聞き取れませんでした。もう一度お願いします。");
    expect(deps.onJobAccepted).not.toHaveBeenCalled();
  });

  it("rejects requests from an unknown skill id", () => {
    const deps = makeDeps({ skillId: "expected-skill" });
    const handlers = buildHandlers(deps);
    const { handlerInput } = makeHandlerInput(intentEnvelope("AskHermesIntent", { query: "質問" }));

    expect(() => findHandler(handlers, handlerInput)).toThrow(/skill/i);
  });

  it("responds to LaunchRequest with usage guidance", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const {
      handlerInput,
      speak,
      reprompt,
      withShouldEndSession,
      addElicitSlotDirective,
    } = makeHandlerInput(launchEnvelope());

    findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(speak).toHaveBeenCalledWith(expect.stringContaining("ヘルメス"));
    expect(reprompt).toHaveBeenCalledWith(expect.stringContaining("ヘルメス"));
    expect(withShouldEndSession).toHaveBeenCalledWith(false);
    expect(addElicitSlotDirective).not.toHaveBeenCalled();
  });

  it("responds to HelpIntent", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const { handlerInput, speak } = makeHandlerInput(intentEnvelope("AMAZON.HelpIntent"));

    findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(speak).toHaveBeenCalledWith(expect.stringContaining("聞きたいこと"));
  });

  it("responds to StopIntent and CancelIntent by ending the session", () => {
    for (const intent of ["AMAZON.StopIntent", "AMAZON.CancelIntent"]) {
      const deps = makeDeps();
      const handlers = buildHandlers(deps);
      const { handlerInput, speak, withShouldEndSession } = makeHandlerInput(intentEnvelope(intent));

      findHandler(handlers, handlerInput).handle(handlerInput as never);

      expect(speak).toHaveBeenCalledWith("終了します。");
      expect(withShouldEndSession).toHaveBeenCalledWith(true);
    }
  });

  it("handles SessionEndedRequest without error", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const envelope = {
      ...intentEnvelope(""),
      request: {
        type: "SessionEndedRequest",
        requestId: "req-end",
        timestamp: new Date().toISOString(),
        locale: "ja-JP",
        reason: "EXCEEDED_MAX_REPROMPTS",
      },
    };
    const { handlerInput, getResponse } = makeHandlerInput(envelope);

    findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(getResponse).toHaveBeenCalled();
  });

  it("responds to FallbackIntent", () => {
    const deps = makeDeps();
    const handlers = buildHandlers(deps);
    const { handlerInput, speak } = makeHandlerInput(intentEnvelope("AMAZON.FallbackIntent"));

    findHandler(handlers, handlerInput).handle(handlerInput as never);

    expect(speak).toHaveBeenCalledWith("すみません、よく聞き取れませんでした。もう一度お願いします。");
  });
});
