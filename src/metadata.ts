import {
  Action,
  Model,
  Sampler,
  Noise,
  isV5Family,
  isV5MediumEffort,
  usesV4PromptEnvelope,
  Resolution,
  RESOLUTION_DIMENSIONS,
} from "./constants";
import { Metadata, CharacterCaption } from "./types";
import { deduplicateTags } from "./utils";

/**
 * Inpainting variants share prompt presets with their base model
 */
const BASE_MODEL: Partial<Record<Model, Model>> = {
  [Model.V3_INP]: Model.V3,
  [Model.V4_INP]: Model.V4,
  [Model.V4_CUR_INP]: Model.V4_CUR,
  [Model.V4_5_INP]: Model.V4_5,
  [Model.V4_5_CUR_INP]: Model.V4_5_CUR,
  [Model.V5_INP]: Model.V5,
  [Model.V5_MED_INP]: Model.V5_MED,
  [Model.V5_CUR_INP]: Model.V5_CUR,
  [Model.FURRY_INP]: Model.FURRY,
};

function baseModel(model: Model): Model {
  return BASE_MODEL[model] ?? model;
}

/**
 * Quality tags appended to the prompt when qualityToggle is enabled
 */
const QUALITY_TAGS: Partial<Record<Model, string>> = {
  [Model.V4_5]: "very aesthetic, masterpiece, no text",
  [Model.V4_5_CUR]:
    "location, masterpiece, no text, -0.8::feet::, rating:general",
  // V5 Full/Curated quality tags match V4.5 in the launch capture
  [Model.V5]: "very aesthetic, masterpiece, no text",
  [Model.V5_MED]: "very aesthetic, masterpiece, no text",
  [Model.V5_CUR]:
    "location, masterpiece, no text, -0.8::feet::, rating:general",
  [Model.V4]: "no text, best quality, very aesthetic, absurdres",
  [Model.V4_CUR]: "rating:general, amazing quality, very aesthetic, absurdres",
  [Model.V3]: "best quality, amazing quality, very aesthetic, absurdres",
  [Model.FURRY]: "{best quality}, {amazing quality}",
};

/**
 * Negative prompt presets per model, indexed by ucPreset value
 */
const UC_PRESETS: Partial<Record<Model, string[]>> = {
  [Model.V4_5]: [
    "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    "nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
    "nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
    "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
  ],
  [Model.V4_5_CUR]: [
    "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
    "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page",
    "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
  ],
  [Model.V4]: [
    "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks",
    "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing",
  ],
  [Model.V4_CUR]: [
    "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts",
    "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature",
  ],
  [Model.V3]: [
    "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
    "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
    "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes",
  ],
  [Model.FURRY]: [
    "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast",
    "{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text",
  ],
};

// V5 reuses V4.5 UC presets (same launch capture)
UC_PRESETS[Model.V5] = UC_PRESETS[Model.V4_5];
UC_PRESETS[Model.V5_MED] = UC_PRESETS[Model.V5];
UC_PRESETS[Model.V5_CUR] = UC_PRESETS[Model.V4_5_CUR];

/**
 * Class responsible for processing and validating metadata before sending to API
 */
export class MetadataProcessor {
  /**
   * Process and validate metadata before sending to API
   *
   * @param metadata - User-provided metadata
   * @returns Processed metadata object
   */
  processMetadata(metadata: Metadata): Metadata {
    // Deep copy to avoid modifying the caller's object
    const result: Metadata =
      typeof structuredClone === "function"
        ? structuredClone(metadata)
        : JSON.parse(JSON.stringify(metadata));

    this.applyDefaultValues(result);
    this.applyMediumEffort(result);
    this.handleResolution(result);

    this.handleUcPreset(result);
    this.handleQualityTags(result);

    // Deduplicate tags (skipped when deduplicate_tags is explicitly false)
    const shouldDeduplicate = result.deduplicate_tags !== false;
    result.prompt = result.prompt
      ? shouldDeduplicate
        ? deduplicateTags(result.prompt)
        : result.prompt
      : "";
    result.negative_prompt = result.negative_prompt
      ? shouldDeduplicate
        ? deduplicateTags(result.negative_prompt)
        : result.negative_prompt
      : "";

    this.handleActionSpecificParameters(result);

    // Character prompt defaults must be set before use_coords is derived
    this.handleCharacterPrompts(result);
    this.handleUseCoords(result);
    this.handleStream(result);

    this.handleV4Prompt(result);
    this.handleV4NegativePrompt(result);

    this.handleModelSpecificSettings(result);
    this.handleSamplerSpecificSettings(result);
    this.handleInpaintImg2ImgStrength(result);

    return result;
  }

  /**
   * Apply default values to metadata
   */
  private applyDefaultValues(metadata: Metadata): void {
    metadata.model = metadata.model ?? Model.V4_5;
    metadata.action = metadata.action ?? Action.GENERATE;
    metadata.resPreset = metadata.resPreset ?? Resolution.NORMAL_PORTRAIT;
    metadata.ucPreset = metadata.ucPreset ?? 0;
    metadata.qualityToggle = metadata.qualityToggle ?? true;
    metadata.n_samples = metadata.n_samples ?? 1;
    metadata.steps = metadata.steps ?? 28;
    metadata.scale = metadata.scale ?? 6.0;
    metadata.dynamic_thresholding = metadata.dynamic_thresholding ?? false;
    metadata.seed = metadata.seed ?? Math.floor(Math.random() * 4294967288);
    metadata.sampler = metadata.sampler ?? Sampler.EULER_ANC;
    metadata.cfg_rescale = metadata.cfg_rescale ?? 0;
    metadata.noise_schedule = metadata.noise_schedule ?? Noise.KARRAS;
    metadata.controlnet_strength = metadata.controlnet_strength ?? 1;
    metadata.add_original_image = metadata.add_original_image ?? true;
    metadata.autoSmea = metadata.autoSmea ?? false;
    // V5 live capture uses params_version 4; older families keep 3 unless the caller sets it.
    if (metadata.params_version == null) {
      metadata.params_version = isV5Family(metadata.model!) ? 4 : 3;
    }
    metadata.prompt = metadata.prompt ?? "1girl, cute";
    metadata.negative_prompt = metadata.negative_prompt ?? "";
    metadata.characterPrompts = metadata.characterPrompts ?? [];
    metadata.skip_cfg_above_sigma = metadata.skip_cfg_above_sigma ?? null;
    metadata.legacy_uc = metadata.legacy_uc ?? false;
    metadata.legacy = metadata.legacy ?? false;
    metadata.legacy_v3_extend = metadata.legacy_v3_extend ?? false;

    this.applyDirectorReferenceDefaults(metadata);
    this.applyVibeTransferDefaults(metadata);

    metadata.stream = undefined;
  }

  /**
   * Apply defaults for director reference (character reference) fields.
   * When director reference images are present, the per-image arrays are
   * normalized to matching lengths and vibe transfer parameters are removed
   * (the two features are mutually exclusive). Without images, all director
   * reference parameters are dropped.
   */
  private applyDirectorReferenceDefaults(metadata: Metadata): void {
    if (!metadata.director_reference_images?.length) {
      delete metadata.director_reference_descriptions;
      delete metadata.director_reference_images;
      delete metadata.director_reference_information_extracted;
      delete metadata.director_reference_strength_values;
      delete metadata.director_reference_secondary_strength_values;
      return;
    }

    // Director references replace vibe transfer
    delete metadata.reference_image_multiple;
    delete metadata.reference_information_extracted_multiple;
    delete metadata.reference_strength_multiple;
    delete metadata.normalize_reference_strength_multiple;

    const count = metadata.director_reference_images.length;
    const fit = <T>(values: T[] | undefined, fill: () => T): T[] => {
      const result = (values ?? []).slice(0, count);
      while (result.length < count) result.push(fill());
      return result;
    };

    metadata.director_reference_descriptions = fit(
      metadata.director_reference_descriptions,
      () => ({
        caption: { base_caption: "character", char_captions: [] },
        legacy_uc: false,
      }),
    );
    metadata.director_reference_information_extracted = fit(
      metadata.director_reference_information_extracted,
      () => 1,
    );
    metadata.director_reference_strength_values = fit(
      metadata.director_reference_strength_values,
      () => 1,
    );
    metadata.director_reference_secondary_strength_values = fit(
      metadata.director_reference_secondary_strength_values,
      () => 1,
    );
  }

  /**
   * Apply defaults for vibe transfer fields (only when director references
   * are not in use)
   */
  private applyVibeTransferDefaults(metadata: Metadata): void {
    if (metadata.director_reference_images?.length) return;

    metadata.normalize_reference_strength_multiple =
      metadata.normalize_reference_strength_multiple ?? true;
    if (metadata.reference_image_multiple?.length) {
      metadata.reference_strength_multiple =
        metadata.reference_strength_multiple ??
        metadata.reference_image_multiple.map(() => 0.6);
    }
  }

  /**
   * V4 / V4.5 / V5 generate requests go through the streaming endpoint in msgpack format
   */
  private handleStream(metadata: Metadata): void {
    if (
      usesV4PromptEnvelope(metadata.model!) &&
      metadata.action === Action.GENERATE
    ) {
      metadata.stream = "msgpack";
    }
  }

  /**
   * Handle action-specific parameters (img2img and inpaint)
   */
  private handleActionSpecificParameters(metadata: Metadata): void {
    if (
      metadata.action === Action.IMG2IMG ||
      metadata.action === Action.INPAINT
    ) {
      metadata.sm = false;
      metadata.sm_dyn = false;
      metadata.strength = metadata.strength || 0.3;
      metadata.noise = metadata.noise || 0;
      metadata.extra_noise_seed =
        metadata.extra_noise_seed || Math.floor(Math.random() * 4294967288);
    }
  }

  /**
   * Drop V3-only settings for V4+ / V5 models (v4_prompt envelope family)
   */
  private handleModelSpecificSettings(metadata: Metadata): void {
    if (usesV4PromptEnvelope(metadata.model!)) {
      metadata.sm = undefined;
      metadata.sm_dyn = undefined;
    }
  }

  /**
   * Handle sampler-specific settings
   */
  private handleSamplerSpecificSettings(metadata: Metadata): void {
    if (metadata.sampler === Sampler.EULER_ANC) {
      metadata.deliberate_euler_ancestral_bug = false;
      metadata.prefer_brownian = true;
    }
  }

  /**
   * Append model-specific quality tags to the prompt when qualityToggle is on
   */
  handleQualityTags(metadata: Metadata): void {
    if (!metadata.qualityToggle) return;

    const tags = QUALITY_TAGS[baseModel(metadata.model!)];
    if (tags) {
      metadata.prompt = metadata.prompt ? `${metadata.prompt}, ${tags}` : tags;
    }
  }

  /**
   * Medium effort sends ucPresetId and must not also prepend a numeric preset.
   */
  private applyMediumEffort(metadata: Metadata): void {
    if (!isV5MediumEffort(metadata.model)) return;
    metadata.steps = 14;
    metadata.sampler = Sampler.EULER_ANC;
    delete metadata.cfg_rescale;
    metadata.negative_prompt = "";
    metadata.ucPresetId = "heavy";
    delete metadata.ucPreset;
    metadata.characterPrompts?.forEach((cp) => {
      cp.uc = "";
    });
  }

  /**
   * Prepend the model-specific negative prompt preset selected by ucPreset
   */
  handleUcPreset(metadata: Metadata): void {
    if (metadata.ucPresetId) {
      delete metadata.ucPreset;
      return;
    }
    const presets = UC_PRESETS[baseModel(metadata.model!)];
    const uc = presets?.[metadata.ucPreset ?? 0];
    if (!uc) return;

    metadata.negative_prompt = metadata.negative_prompt
      ? `${uc}, ${metadata.negative_prompt}`
      : uc;
  }

  /**
   * Default inpaint img2img strength for V4.5 models. When below 1, the API
   * additionally expects an img2img sub-object with color correction.
   */
  handleInpaintImg2ImgStrength(metadata: Metadata): void {
    if (metadata.model === Model.V4_5 || metadata.model === Model.V4_5_INP) {
      metadata.inpaintImg2ImgStrength =
        metadata.inpaintImg2ImgStrength ?? metadata.strength ?? 1;

      if (metadata.inpaintImg2ImgStrength < 1) {
        metadata.img2img = {
          strength: metadata.inpaintImg2ImgStrength,
          color_correct: true,
        };
      } else {
        delete metadata.img2img;
      }
    }
  }

  /**
   * Determine if coordinates should be used based on character prompt positions.
   * Must run after handleCharacterPrompts so center defaults are in place.
   * Nullish centers still count as auto-position (use_coords false).
   */
  handleUseCoords(metadata: Metadata): void {
    metadata.use_coords =
      metadata.characterPrompts?.some((cp) => {
        const x = cp.center?.x ?? 0.5;
        const y = cp.center?.y ?? 0.5;
        return x !== 0.5 || y !== 0.5;
      }) ?? false;
  }

  /**
   * Set default values for character prompts and deduplicate tags
   */
  handleCharacterPrompts(metadata: Metadata): void {
    const shouldDeduplicate = metadata.deduplicate_tags !== false;
    metadata.characterPrompts?.forEach((cp) => {
      cp.enabled = cp.enabled ?? true;
      cp.prompt = cp.prompt
        ? shouldDeduplicate
          ? deduplicateTags(cp.prompt)
          : cp.prompt
        : "1girl, cute";
      if (isV5MediumEffort(metadata.model)) {
        cp.uc = "";
      } else {
        cp.uc = cp.uc
          ? shouldDeduplicate
            ? deduplicateTags(cp.uc)
            : cp.uc
          : "lowres, aliasing";
      }
      cp.center = {
        x: cp.center?.x ?? 0.5,
        y: cp.center?.y ?? 0.5,
      };
    });
  }

  /**
   * Build the V4 prompt structure for V4 / V4.5 / V5 models
   */
  handleV4Prompt(metadata: Metadata): void {
    if (metadata.v4_prompt || !usesV4PromptEnvelope(metadata.model!)) return;

    const charCaptions: CharacterCaption[] = [];
    metadata.characterPrompts?.forEach((cp) => {
      if (cp.enabled) {
        charCaptions.push({
          char_caption: cp.prompt,
          centers: [cp.center!],
        });
      }
    });

    metadata.v4_prompt = {
      caption: {
        base_caption: metadata.prompt || "",
        char_captions: charCaptions,
      },
      use_coords: metadata.use_coords || false,
      use_order: true,
    };
  }

  /**
   * Build the V4 negative prompt structure for V4 / V4.5 / V5 models
   */
  handleV4NegativePrompt(metadata: Metadata): void {
    if (metadata.v4_negative_prompt || !usesV4PromptEnvelope(metadata.model!))
      return;

    const charCaptions: CharacterCaption[] = [];
    metadata.characterPrompts?.forEach((cp) => {
      if (cp.enabled && cp.uc) {
        charCaptions.push({
          char_caption: cp.uc,
          centers: [cp.center!],
        });
      }
    });

    metadata.v4_negative_prompt = {
      caption: {
        base_caption: metadata.negative_prompt || "",
        char_captions: charCaptions,
      },
      legacy_uc: metadata.legacy_uc || false,
    };
  }

  /**
   * Resolve width/height from the resolution preset when not explicitly set.
   * Explicit dimensions are rounded up to the nearest multiple of 64 and the
   * total pixel count is validated against the allowed range.
   */
  private handleResolution(metadata: Metadata): void {
    if (metadata.width == null || metadata.height == null) {
      const preset = metadata.resPreset ?? Resolution.NORMAL_PORTRAIT;
      const [width, height] = RESOLUTION_DIMENSIONS[preset];
      metadata.width = width;
      metadata.height = height;
    } else {
      metadata.width = Math.ceil(metadata.width / 64) * 64;
      metadata.height = Math.ceil(metadata.height / 64) * 64;
    }

    const totalPixels = metadata.width * metadata.height;
    const minPixels = 64 * 64;
    const maxPixels = 3047424;

    if (totalPixels < minPixels || totalPixels > maxPixels) {
      throw new Error(
        `Total resolution must be between ${minPixels} and ${maxPixels} px, got ${metadata.width}x${metadata.height}=${totalPixels}.`,
      );
    }
  }
}

// Singleton instance for easy access
export const metadataProcessor = new MetadataProcessor();
