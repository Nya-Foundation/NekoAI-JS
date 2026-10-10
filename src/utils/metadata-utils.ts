import { Metadata } from "../types";
import { Action, usesV4PromptEnvelope } from "../constants";

/** Maximum total pixel count accepted by the generation API */
export const MAX_PIXELS = 3047424;

/**
 * Scale image dimensions by a factor, clamped to the API's pixel budget and
 * floored to multiples of 64 (the generation API's dimension granularity).
 *
 * @param width - Source width
 * @param height - Source height
 * @param factor - Desired scale factor
 * @param maxPixels - Maximum total pixel count (default: MAX_PIXELS)
 * @returns Scaled [width, height] tuple
 */
export function scaleDimensions(
  width: number,
  height: number,
  factor: number,
  maxPixels: number = MAX_PIXELS,
): [number, number] {
  const clamped = Math.min(factor, Math.sqrt(maxPixels / (width * height)));
  return [
    Math.max(64, Math.floor((width * clamped) / 64) * 64),
    Math.max(64, Math.floor((height * clamped) / 64) * 64),
  ];
}

/**
 * Prepares metadata for API request
 * @param metadata - Processed metadata object
 * @returns Formatted API request payload
 */
export function prepareMetadataForApi(metadata: Metadata): any {
  // JSON round-trip drops undefined values (null is kept)
  const params = JSON.parse(JSON.stringify(metadata));

  // These go in the top level of the payload, not in parameters
  delete params.model;
  delete params.action;
  delete params.prompt;
  delete params.resPreset;
  // Keep characterPrompts: webapp 787d312 sends it alongside v4_prompt
  // (carries per-character `name` labels that v4_prompt has no slot for).
  // Client-side control flag; never send to the API
  delete params.deduplicate_tags;

  // Client-side name -> API name
  if (params.inpaintImg2ImgStrength !== undefined) {
    params.inpaint_img2img_strength = params.inpaintImg2ImgStrength;
    delete params.inpaintImg2ImgStrength;
  }

  return {
    input: metadata.prompt,
    model: metadata.model,
    action: metadata.action,
    parameters: params,
  };
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

  // SMEA factor: V4+ / V5 models use autoSmea, V3 uses sm/sm_dyn
  let smeaFactor = 1.0;
  if (metadata.model && usesV4PromptEnvelope(metadata.model)) {
    if (metadata.autoSmea) {
      smeaFactor = 1.2;
    }
  } else if (metadata.sm_dyn) {
    smeaFactor = 1.4;
  } else if (metadata.sm) {
    smeaFactor = 1.2;
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
