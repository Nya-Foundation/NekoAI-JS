import { Metadata } from "../types";
import { Action, Model } from "../constants";

/**
 * Prepares metadata for API request
 * @param metadata - Metadata object with parameters
 * @returns Formatted API request payload
 */
export function prepareMetadataForApi(metadata: Metadata): any {
  // Create a copy of metadata and remove undefined values (keep null)
  const params = JSON.parse(
    JSON.stringify(metadata, (key, value) => {
      return value === undefined ? undefined : value;
    }),
  );

  // Remove model, action, and prompt from parameters since they go in the top level
  delete params.model;
  delete params.action;
  delete params.prompt;
  delete params.resPreset;

  // Create the payload
  const payload: any = {
    input: metadata.prompt,
    model: metadata.model,
    action: metadata.action,
    parameters: params,
  };

  return payload;
}

/**
 * Calculates the Anlas cost based on parameters
 * @param metadata - Metadata object with parameters
 * @param isOpus - Whether user has Opus subscription
 * @returns Estimated Anlas cost
 */
export function calculateCost(metadata: Metadata, isOpus = false): number {
  const steps = metadata.steps || 28;
  const n_samples = metadata.n_samples || 1;
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const strength =
    metadata.action === Action.IMG2IMG && metadata.strength
      ? metadata.strength
      : 1.0;

  // Handle SMEA factor for both V3 and V4+ models
  let smeaFactor = 1.0;
  if (
    metadata.model === Model.V4 ||
    metadata.model === Model.V4_CUR ||
    metadata.model === Model.V4_5_CUR
  ) {
    // V4/V4.5 uses autoSmea
    if (metadata.autoSmea) {
      smeaFactor = 1.2;
    }
  } else {
    // V3 uses sm/sm_dyn
    if (metadata.sm_dyn) {
      smeaFactor = 1.4;
    } else if (metadata.sm) {
      smeaFactor = 1.2;
    }
  }

  const resolution = Math.max(width * height, 65536);

  // For normal resolutions, square is adjusted to the same price as portrait/landscape
  let adjustedResolution = resolution;
  if (resolution > 832 * 1216 && resolution <= 1024 * 1024) {
    adjustedResolution = 832 * 1216;
  }

  let perSample =
    Math.ceil(
      2951823174884865e-21 * adjustedResolution +
        5.753298233447344e-7 * adjustedResolution * steps,
    ) * smeaFactor;

  perSample = Math.max(Math.ceil(perSample * strength), 2);

  const opusDiscount =
    isOpus && steps <= 28 && adjustedResolution <= 1024 * 1024;

  let totalCost = perSample * (n_samples - (opusDiscount ? 1 : 0));

  // Add +5 cost for director reference images
  if (metadata.director_reference_images?.length) {
    totalCost += 5;
  }

  return totalCost;
}
