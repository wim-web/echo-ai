import { createHash } from "node:crypto";
import type { HandlerInput, RequestHandler } from "ask-sdk-core";
import { getIntentName, getRequestType, getSlotValue } from "ask-sdk-core";
import type { JobRepository } from "../jobs/repository.js";
import { INTENTS } from "./intents.js";
import { SPEECH } from "./response.js";

export interface AlexaDeps {
  repo: JobRepository;
  skillId: string;
  onJobAccepted?: (jobId: string) => void;
  logger?: {
    info(obj: Record<string, unknown>, msg: string): void;
  };
}

function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function verifySkillId(handlerInput: HandlerInput, skillId: string): void {
  const envelope = handlerInput.requestEnvelope;
  const appId =
    envelope.context?.System?.application?.applicationId ??
    envelope.session?.application?.applicationId;
  if (appId !== skillId) {
    throw new Error(`Unexpected skill id: ${appId ?? "(none)"}`);
  }
}

function isIntent(handlerInput: HandlerInput, intentName: string): boolean {
  return getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
    && getIntentName(handlerInput.requestEnvelope) === intentName;
}

export function buildHandlers(deps: AlexaDeps): RequestHandler[] {
  const launchHandler: RequestHandler = {
    canHandle: (handlerInput) =>
      verify(handlerInput) && getRequestType(handlerInput.requestEnvelope) === "LaunchRequest",
    handle: (handlerInput) =>
      handlerInput.responseBuilder
        .speak(SPEECH.launch)
        .reprompt(SPEECH.launch)
        .withShouldEndSession(false)
        .getResponse(),
  };

  const askHermesHandler: RequestHandler = {
    canHandle: (handlerInput) => verify(handlerInput) && isIntent(handlerInput, INTENTS.askHermes),
    handle: (handlerInput) => {
      verifySkillId(handlerInput, deps.skillId);
      deps.logger?.info(
        { requestId: handlerInput.requestEnvelope.request.requestId },
        "AskHermesIntent received",
      );
      const query = getSlotValue(handlerInput.requestEnvelope, "query")?.trim();
      if (!query) {
        return handlerInput.responseBuilder
          .speak(SPEECH.retry)
          .reprompt(SPEECH.retry)
          .withShouldEndSession(false)
          .getResponse();
      }

      const { context, request } = handlerInput.requestEnvelope;
      const userId = context.System.user.userId;
      const deviceId = context.System.device?.deviceId ?? "unknown";

      const job = deps.repo.create({
        alexaRequestId: request.requestId,
        alexaUserIdHash: hashUserId(userId),
        alexaDeviceId: deviceId,
        query,
      });
      if (job.created) {
        deps.onJobAccepted?.(job.id);
      }

      return handlerInput.responseBuilder
        .speak(SPEECH.accepted)
        .withShouldEndSession(true)
        .getResponse();
    },
  };

  const helpHandler: RequestHandler = {
    canHandle: (handlerInput) => verify(handlerInput) && isIntent(handlerInput, INTENTS.help),
    handle: (handlerInput) =>
      handlerInput.responseBuilder
        .speak(SPEECH.help)
        .reprompt(SPEECH.help)
        .withShouldEndSession(false)
        .getResponse(),
  };

  const stopCancelHandler: RequestHandler = {
    canHandle: (handlerInput) =>
      verify(handlerInput)
      && (isIntent(handlerInput, INTENTS.stop) || isIntent(handlerInput, INTENTS.cancel)),
    handle: (handlerInput) =>
      handlerInput.responseBuilder
        .speak(SPEECH.stop)
        .withShouldEndSession(true)
        .getResponse(),
  };

  const fallbackHandler: RequestHandler = {
    canHandle: (handlerInput) => verify(handlerInput) && isIntent(handlerInput, INTENTS.fallback),
    handle: (handlerInput) => {
      deps.logger?.info(
        { requestId: handlerInput.requestEnvelope.request.requestId },
        "FallbackIntent received",
      );
      return handlerInput.responseBuilder
        .speak(SPEECH.fallback)
        .reprompt(SPEECH.fallback)
        .withShouldEndSession(false)
        .getResponse();
    },
  };

  const sessionEndedHandler: RequestHandler = {
    canHandle: (handlerInput) =>
      verify(handlerInput) && getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest",
    handle: (handlerInput) => {
      deps.logger?.info(
        {
          requestId: handlerInput.requestEnvelope.request.requestId,
          reason:
            handlerInput.requestEnvelope.request.type === "SessionEndedRequest"
              ? handlerInput.requestEnvelope.request.reason
              : undefined,
        },
        "session ended",
      );
      // SessionEndedRequest には音声応答を返せないため空のレスポンスを返す
      return handlerInput.responseBuilder.getResponse();
    },
  };

  return [launchHandler, askHermesHandler, helpHandler, stopCancelHandler, fallbackHandler, sessionEndedHandler];

  function verify(handlerInput: HandlerInput): boolean {
    verifySkillId(handlerInput, deps.skillId);
    return true;
  }
}
