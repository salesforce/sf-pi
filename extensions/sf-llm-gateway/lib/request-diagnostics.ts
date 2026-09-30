/* SPDX-License-Identifier: Apache-2.0 */
/** Protocol-neutral, public-safe diagnostics for finalized Gateway request errors. */
import type { ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { getGatewayConfig, PROVIDER_NAME } from "./config.ts";
import { gatewayProviderRuntime } from "./provider.ts";

export const MODEL_ACCESS_DENIED_CODE = "team_model_access_denied";
const MODEL_ACCESS_DENIED_PREFIX = "SF LLM Gateway denied access to ";
const GENERIC_UNCONFIGURED_ERROR = `Provider is not configured: ${PROVIDER_NAME}`;

export interface GatewayRequestReadiness {
  enabled: boolean;
  baseUrlConfigured: boolean;
  credentialConfigured: boolean;
  modelId?: string;
}

export interface GatewayRequestDiagnosticsDependencies {
  getConfig?: (cwd: string) => { enabled: boolean; baseUrl?: string };
  hasConfiguredCredential?: () => Promise<boolean>;
}

export function isGatewayModelAccessDeniedError(errorMessage: string): boolean {
  return errorMessage.includes(MODEL_ACCESS_DENIED_CODE);
}

function isUnsupportedGatewayCacheKeyError(errorMessage: string): boolean {
  return (
    errorMessage.includes("UnsupportedParamsError") && errorMessage.includes("prompt_cache_key")
  );
}

function isUnsupportedGatewayImageError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("image") &&
    (lower.includes("doesn't support") ||
      lower.includes("does not support") ||
      lower.includes("unsupported"))
  );
}

function gatewayModelLabel(modelId: string | undefined): string {
  const trimmed = modelId?.trim();
  return trimmed && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(trimmed)
    ? `${PROVIDER_NAME}/${trimmed}`
    : "the selected Gateway model";
}

function isTransientGatewayStreamError(errorMessage: string): boolean {
  const lower = errorMessage.trim().toLowerCase();
  return (
    lower === "terminated" ||
    lower === "request timed out." ||
    lower === "request timed out" ||
    lower === "connection error." ||
    lower === "connection error" ||
    /api error \(5\d\d\)/u.test(lower) ||
    lower.includes("upstream connect error")
  );
}

export function normalizeGatewayRequestError(
  errorMessage: string,
  readiness: GatewayRequestReadiness,
): string | undefined {
  if (errorMessage.startsWith(MODEL_ACCESS_DENIED_PREFIX)) return undefined;

  if (isGatewayModelAccessDeniedError(errorMessage)) {
    const model = gatewayModelLabel(readiness.modelId);
    return [
      `${MODEL_ACCESS_DENIED_PREFIX}${model} (${MODEL_ACCESS_DENIED_CODE}).`,
      `Run /${PROVIDER_NAME} refresh, then choose an available model with /model.`,
      "If refresh returns no models, request model access from your Gateway administrator.",
    ].join("\n");
  }

  if (isUnsupportedGatewayCacheKeyError(errorMessage)) {
    return [
      "SF LLM Gateway rejected an unsupported prompt_cache_key parameter.",
      "SF Pi omits this field on Gateway requests; update SF Pi and retry.",
      "If it persists, ask your Gateway administrator to review the selected model's route.",
    ].join("\n");
  }

  if (isUnsupportedGatewayImageError(errorMessage)) {
    return [
      `SF LLM Gateway route ${gatewayModelLabel(readiness.modelId)} rejected image input.`,
      "The public model can support images, but this deployed route has not proved compatible vision support.",
      `Use a verified image-capable route or resend without the image, then run /${PROVIDER_NAME} doctor.`,
    ].join("\n");
  }

  if (isTransientGatewayStreamError(errorMessage)) {
    return [
      `SF LLM Gateway stream for ${gatewayModelLabel(readiness.modelId)} ended before local completion.`,
      "This is a retryable transport failure, not proof that the model rejected the request.",
      `Run /${PROVIDER_NAME} doctor; Pi agent retries apply when retry.enabled is true.`,
    ].join("\n");
  }

  if (!errorMessage.includes(GENERIC_UNCONFIGURED_ERROR)) return undefined;

  if (!readiness.enabled) {
    return [
      "SF LLM Gateway is disabled for requests.",
      `Run /${PROVIDER_NAME} on to enable it, then retry.`,
    ].join("\n");
  }
  if (!readiness.baseUrlConfigured && !readiness.credentialConfigured) {
    return [
      "SF LLM Gateway has no usable endpoint or credential.",
      `Run /${PROVIDER_NAME} setup, then /login ${PROVIDER_NAME} and /${PROVIDER_NAME} refresh.`,
    ].join("\n");
  }
  if (!readiness.baseUrlConfigured) {
    return [
      "SF LLM Gateway has no usable endpoint.",
      `Run /${PROVIDER_NAME} setup, then retry.`,
    ].join("\n");
  }
  if (!readiness.credentialConfigured) {
    return [
      "SF LLM Gateway has no usable credential.",
      `Run /login ${PROVIDER_NAME}, then /${PROVIDER_NAME} refresh.`,
    ].join("\n");
  }
  return [
    "SF LLM Gateway authentication could not be resolved for this request.",
    `Run /${PROVIDER_NAME} doctor. If the key is rejected, run /login ${PROVIDER_NAME}, then refresh.`,
  ].join("\n");
}

export async function handleGatewayRequestDiagnostics(
  event: MessageEndEvent,
  ctx: ExtensionContext,
  dependencies: GatewayRequestDiagnosticsDependencies = {},
): Promise<{ message: MessageEndEvent["message"] } | undefined> {
  const message = event.message;
  if (message.role !== "assistant" || message.stopReason !== "error") return undefined;
  if (message.provider !== PROVIDER_NAME || !message.errorMessage) return undefined;

  const rawError = message.errorMessage;
  const isModelAccessDenied = isGatewayModelAccessDeniedError(rawError);
  const isGenericUnconfigured = rawError.includes(GENERIC_UNCONFIGURED_ERROR);
  const isUnsupportedCacheKey = isUnsupportedGatewayCacheKeyError(rawError);
  const isUnsupportedImage = isUnsupportedGatewayImageError(rawError);
  const isTransientStream = isTransientGatewayStreamError(rawError);
  if (
    rawError.startsWith(MODEL_ACCESS_DENIED_PREFIX) ||
    (!isModelAccessDenied &&
      !isGenericUnconfigured &&
      !isUnsupportedCacheKey &&
      !isUnsupportedImage &&
      !isTransientStream)
  ) {
    return undefined;
  }

  let enabled = true;
  let baseUrlConfigured = true;
  let credentialConfigured = true;
  if (isGenericUnconfigured) {
    const config = (dependencies.getConfig ?? getGatewayConfig)(ctx.cwd);
    enabled = config.enabled;
    baseUrlConfigured = Boolean(config.baseUrl);
    try {
      credentialConfigured = await (
        dependencies.hasConfiguredCredential ??
        (() => gatewayProviderRuntime.authController.hasConfiguredCredential())
      )();
    } catch {
      // If readiness inspection itself fails, avoid falsely claiming the key is absent.
      // The generic doctor guidance remains accurate and public-safe.
      credentialConfigured = true;
    }
  }

  const normalized = normalizeGatewayRequestError(rawError, {
    enabled,
    baseUrlConfigured,
    credentialConfigured,
    modelId: message.model,
  });
  if (!normalized || normalized === rawError) return undefined;

  return {
    message: {
      ...message,
      errorMessage: normalized,
    },
  };
}
