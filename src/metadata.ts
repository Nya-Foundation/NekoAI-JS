import {
  Action,
  Model,
  Sampler,
  Noise,
  isV4Model,
  Resolution,
} from "./constants";
import { Metadata, CharacterCaption } from "./types";
import { deduplicateTags } from "./utils";

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
    // Create a deep copy to avoid modifying the original
    const result = JSON.parse(JSON.stringify(metadata)) as Metadata;

    this.applyDefaultValues(result);
    this.handleResolution(result);

    this.handleUcPreset(result);
    this.handleQualityTags(result);

    // Deduplicate tags
    result.prompt = result.prompt ? deduplicateTags(result.prompt) : "";
    result.negative_prompt = result.negative_prompt
      ? deduplicateTags(result.negative_prompt)
      : "";

    // Handle img2img and inpaint specific parameters
    this.handleActionSpecificParameters(result);

    // Handle character-related parameters
    this.handleUseCoords(result);
    this.handleCharacterPrompts(result);
    this.handleStream(result);

    this.handleV4Prompt(result);
    this.handleV4NegativePrompt(result);

    // Handle model-specific settings
    this.handleModelSpecificSettings(result);

    // Handle sampler-specific settings
    this.handleSamplerSpecificSettings(result);

    this.handleInpaintImg2ImgStrength(result);

    return result;
  }

  /**
   * Apply default values to metadata
   *
   * @param metadata - Metadata to update
   * @private
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
    metadata.params_version = metadata.params_version ?? 3;
    metadata.prompt = metadata.prompt ?? "1girl, cute";
    metadata.negative_prompt = metadata.negative_prompt ?? "";
    metadata.characterPrompts = metadata.characterPrompts ?? [];
    metadata.skip_cfg_above_sigma = metadata.skip_cfg_above_sigma ?? null;
    metadata.legacy_uc = metadata.legacy_uc ?? false;
    metadata.legacy = metadata.legacy ?? false;
    metadata.legacy_v3_extend = metadata.legacy_v3_extend ?? false;

    // Handle director reference defaults
    this.applyDirectorReferenceDefaults(metadata);

    // Handle vibe transfer defaults (only if director references are not used)
    this.applyVibeTransferDefaults(metadata);

    metadata.stream = undefined;
  }

  /**
   * Handle model-specific settings
   *
   * @param metadata - Metadata to update
   * @private
   */
  private handleStream(metadata: Metadata): void {
    // Ensure stream is always false for non-streaming actions
    if (isV4Model(metadata.model) && metadata.action == Action.GENERATE) {
      metadata.stream = "msgpack";
    }
  }

  /**
   * Handle action-specific parameters (img2img and inpaint)
   *
   * @param metadata - Metadata to update
   * @private
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
   * Handle model-specific settings
   *
   * @param metadata - Metadata to update
   * @private
   */
  private handleModelSpecificSettings(metadata: Metadata): void {
    const v4Models = [
      Model.V4,
      Model.V4_INP,
      Model.V4_CUR,
      Model.V4_CUR_INP,
      Model.V4_5_CUR,
      Model.V4_5_CUR_INP,
      Model.V4_5,
      Model.V4_5_INP,
    ];

    // Drop sm and sm_dyn for V4+ models
    if (metadata.model && v4Models.includes(metadata.model)) {
      metadata.sm = undefined;
      metadata.sm_dyn = undefined;
    }
  }

  /**
   * Handle sampler-specific settings
   *
   * @param metadata - Metadata to update
   * @private
   */
  private handleSamplerSpecificSettings(metadata: Metadata): void {
    if (metadata.sampler === Sampler.EULER_ANC) {
      metadata.deliberate_euler_ancestral_bug = false;
      metadata.prefer_brownian = true;
    }
  }

  /**
   * Handle quality tags based on the model
   * If qualityToggle is true, append quality tags to the prompt
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleQualityTags(metadata: Metadata): void {
    if (!metadata.qualityToggle) {
      return;
    }

    let qualityTags = "";

    if (metadata.model === Model.V4_5 || metadata.model === Model.V4_5_INP) {
      qualityTags = ", very aesthetic, masterpiece, no text";
    } else if (
      metadata.model === Model.V4_5_CUR ||
      metadata.model === Model.V4_5_CUR_INP
    ) {
      qualityTags =
        ", location, masterpiece, no text, -0.8::feet::, rating:general";
    } else if (metadata.model === Model.V4 || metadata.model === Model.V4_INP) {
      qualityTags = ", no text, best quality, very aesthetic, absurdres";
    } else if (
      metadata.model === Model.V4_CUR ||
      metadata.model === Model.V4_CUR_INP
    ) {
      qualityTags =
        ", rating:general, amazing quality, very aesthetic, absurdres";
    } else if (metadata.model === Model.V3 || metadata.model === Model.V3_INP) {
      qualityTags =
        ", best quality, amazing quality, very aesthetic, absurdres";
    } else if (
      metadata.model === Model.FURRY ||
      metadata.model === Model.FURRY_INP
    ) {
      qualityTags = ", {best quality}, {amazing quality}";
    }

    metadata.prompt += qualityTags;
  }

  /**
   * Handle UC preset based on model
   * Appends model-specific negative prompt tags based on the ucPreset value
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleUcPreset(metadata: Metadata): void {
    let uc = "";

    if (metadata.model === Model.V4_5 || metadata.model === Model.V4_5_INP) {
      if (metadata.ucPreset === 0) {
        uc =
          ", nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
      } else if (metadata.ucPreset === 1) {
        uc =
          ", nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page";
      } else if (metadata.ucPreset === 2) {
        uc =
          ", nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic";
      } else if (metadata.ucPreset === 3) {
        uc =
          ", nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy";
      }
    } else if (
      metadata.model === Model.V4_5_CUR ||
      metadata.model === Model.V4_5_CUR_INP
    ) {
      if (metadata.ucPreset === 0) {
        uc =
          ", blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page";
      } else if (metadata.ucPreset === 1) {
        uc =
          ", blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page";
      } else if (metadata.ucPreset === 2) {
        uc =
          ", blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page";
      }
    } else if (metadata.model === Model.V4 || metadata.model === Model.V4_INP) {
      if (metadata.ucPreset === 0) {
        uc =
          ", blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks";
      } else if (metadata.ucPreset === 1) {
        uc =
          ", blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing";
      }
    } else if (
      metadata.model === Model.V4_CUR ||
      metadata.model === Model.V4_CUR_INP
    ) {
      if (metadata.ucPreset === 0) {
        uc =
          ", blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts";
      } else if (metadata.ucPreset === 1) {
        uc =
          ", blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature";
      }
    } else if (metadata.model === Model.V3 || metadata.model === Model.V3_INP) {
      if (metadata.ucPreset === 0) {
        uc =
          ", lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract],";
      } else if (metadata.ucPreset === 1) {
        uc =
          ", lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing,";
      } else if (metadata.ucPreset === 2) {
        uc =
          ", lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes,";
      }
    } else if (
      metadata.model === Model.FURRY ||
      metadata.model === Model.FURRY_INP
    ) {
      if (metadata.ucPreset === 0) {
        uc =
          ", {{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast,";
      } else if (metadata.ucPreset === 1) {
        uc =
          ", {worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text,";
      }
    }

    metadata.negative_prompt = uc + ", " + metadata.negative_prompt;
  }

  /**
   * Handle img2img strength for V4.5 models
   * Sets default strength if not provided and adds img2img object when needed
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleInpaintImg2ImgStrength(metadata: Metadata): void {
    if (metadata.model === Model.V4_5 || metadata.model === Model.V4_5_INP) {
      // Use metadata.strength as fallback if inpaintImg2ImgStrength is not provided
      metadata.inpaintImg2ImgStrength = metadata.inpaintImg2ImgStrength ?? metadata.strength ?? 1;
      
      // Only add img2img object if inpaintImg2ImgStrength is less than 1
      if (metadata.inpaintImg2ImgStrength < 1) {
        metadata.img2img = {
          strength: metadata.inpaintImg2ImgStrength,
          color_correct: true
        };
      } else {
        // Remove img2img object if inpaintImg2ImgStrength is 1 or greater
        delete metadata.img2img;
      }
    }
  }

  /**
   * Determine if coordinates should be used based on character prompt positions
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleUseCoords(metadata: Metadata): void {
    if (!metadata.characterPrompts?.length) {
      metadata.use_coords = false;
      return;
    }

    // Set useCoords to true if any character prompt has non-default center coordinates
    metadata.use_coords = metadata.characterPrompts.some(
      (cp) => cp.center?.x !== 0.5 || cp.center?.y !== 0.5,
    );
  }

  /**
   * Set default values for character prompts and deduplicate tags
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleCharacterPrompts(metadata: Metadata): void {
    if (!metadata.characterPrompts?.length) {
      return;
    }

    // Set default values for each character prompt
    metadata.characterPrompts.forEach((cp) => {
      cp.enabled = cp.enabled ?? true;
      cp.prompt = cp.prompt ? deduplicateTags(cp.prompt) : "1girl, cute";
      cp.uc = cp.uc ? deduplicateTags(cp.uc) : "lowres, aliasing,";

      // Ensure center coordinates exist with defaults
      cp.center = cp.center || { x: 0.5, y: 0.5 };
      cp.center.x = cp.center.x ?? 0.5;
      cp.center.y = cp.center.y ?? 0.5;
    });
  }

  /**
   * Handle the V4 prompt format for V4/V4.5 models
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleV4Prompt(metadata: Metadata): void {
    // Skip if v4Prompt is already set
    if (metadata.v4_prompt) {
      return;
    }

    // Skip if model is not V4/V4.5
    const v4Models = [
      Model.V4,
      Model.V4_INP,
      Model.V4_CUR,
      Model.V4_CUR_INP,
      Model.V4_5_CUR,
      Model.V4_5_CUR_INP,
      Model.V4_5,
      Model.V4_5_INP,
    ];

    if (!metadata.model || !v4Models.includes(metadata.model)) {
      return;
    }

    const charCaptions: CharacterCaption[] = [];

    // Create character captions based on enabled character prompts
    metadata.characterPrompts?.forEach((cp) => {
      if (cp.enabled) {
        charCaptions.push({
          char_caption: cp.prompt,
          centers: [cp.center],
        });
      }
    });

    // Set up V4 prompt format
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
   * Handle the V4 negative prompt format for V4/V4.5 models
   *
   * @param metadata - Metadata to update
   * @private
   */
  handleV4NegativePrompt(metadata: Metadata): void {
    // Skip if v4NegativePrompt is already set
    if (metadata.v4_negative_prompt) {
      return;
    }

    // Skip if model is not V4/V4.5
    const v4Models = [
      Model.V4,
      Model.V4_INP,
      Model.V4_CUR,
      Model.V4_CUR_INP,
      Model.V4_5_CUR,
      Model.V4_5_CUR_INP,
      Model.V4_5,
      Model.V4_5_INP,
    ];

    if (!metadata.model || !v4Models.includes(metadata.model)) {
      return;
    }

    const charCaptions: CharacterCaption[] = [];

    // Create character captions based on enabled character prompts with UC
    metadata.characterPrompts?.forEach((cp) => {
      if (cp.enabled && cp.uc) {
        charCaptions.push({
          char_caption: cp.uc,
          centers: [cp.center],
        });
      }
    });

    // Set up V4 negative prompt format
    metadata.v4_negative_prompt = {
      caption: {
        base_caption: metadata.negative_prompt || "",
        char_captions: charCaptions,
      },
      legacy_uc: metadata.legacy_uc || false,
    };
  }

  /**
   * Apply default values for director reference fields
   * Ensures arrays have consistent lengths when director_reference_images is provided
   * Removes all director reference parameters if no images are provided
   * When director references are used, removes old vibe transfer parameters and bypasses vibe encoding
   *
   * @param metadata - Metadata to update
   * @private
   */
  private applyDirectorReferenceDefaults(metadata: Metadata): void {
    // If no director reference images provided, remove all director reference parameters
    if (!metadata.director_reference_images?.length) {
      delete metadata.director_reference_descriptions;
      delete metadata.director_reference_images;
      delete metadata.director_reference_information_extracted;
      delete metadata.director_reference_strength_values;
      return;
    }

    // Director reference images are provided - remove old vibe transfer parameters and bypass vibe encoding
    delete metadata.reference_image_multiple;
    delete metadata.reference_information_extracted_multiple;
    delete metadata.reference_strength_multiple;
    delete metadata.normalize_reference_strength_multiple;

    const imageCount = metadata.director_reference_images.length;

    // Initialize arrays if not provided
    metadata.director_reference_descriptions = metadata.director_reference_descriptions ?? [];
    metadata.director_reference_information_extracted = metadata.director_reference_information_extracted ?? [];
    metadata.director_reference_strength_values = metadata.director_reference_strength_values ?? [];

    // Ensure all arrays have the same length as director_reference_images
    while (metadata.director_reference_descriptions.length < imageCount) {
      metadata.director_reference_descriptions.push({
        caption: {
          base_caption: "character",
          char_captions: []
        },
        legacy_uc: false
      });
    }

    while (metadata.director_reference_information_extracted.length < imageCount) {
      metadata.director_reference_information_extracted.push(1);
    }

    while (metadata.director_reference_strength_values.length < imageCount) {
      metadata.director_reference_strength_values.push(1);
    }

    // Trim arrays if they're longer than the image count
    if (metadata.director_reference_descriptions.length > imageCount) {
      metadata.director_reference_descriptions = metadata.director_reference_descriptions.slice(0, imageCount);
    }
    if (metadata.director_reference_information_extracted.length > imageCount) {
      metadata.director_reference_information_extracted = metadata.director_reference_information_extracted.slice(0, imageCount);
    }
    if (metadata.director_reference_strength_values.length > imageCount) {
      metadata.director_reference_strength_values = metadata.director_reference_strength_values.slice(0, imageCount);
    }
  }

  /**
   * Apply default values for vibe transfer fields
   * Only applies when director references are not being used
   *
   * @param metadata - Metadata to update
   * @private
   */
  private applyVibeTransferDefaults(metadata: Metadata): void {
    // Only apply vibe transfer defaults if director references are not being used
    if (!metadata.director_reference_images?.length) {
      metadata.normalize_reference_strength_multiple =
        metadata.normalize_reference_strength_multiple ?? true;
      metadata.reference_image_multiple = metadata.reference_image_multiple ?? undefined;
      metadata.reference_strength_multiple = metadata.reference_strength_multiple ?? undefined;
    }
  }

  /**
   * Get width and height from a resolution preset
   *
   * @param preset - Resolution preset
   * @returns [width, height] tuple
   */
  private getResolutionDimensions(preset: string): [number, number] {
    const dimensionsMap: Record<string, [number, number]> = {
      small_portrait: [512, 768],
      small_landscape: [768, 512],
      small_square: [640, 640],
      normal_portrait: [832, 1216],
      normal_landscape: [1216, 832],
      normal_square: [1024, 1024],
      large_portrait: [1024, 1536],
      large_landscape: [1536, 1024],
      large_square: [1472, 1472],
      wallpaper_portrait: [1088, 1920],
      wallpaper_landscape: [1920, 1088],
    };

    return dimensionsMap[preset] || [832, 1216]; // Default to normal_portrait if preset not found
  }

  /**
   * Handle the resolution preset. If width and height are not set, use the resolution preset.
   * If width and height are set, override the resolution preset.
   * If width or height are not multiple of 64, round them to the nearest multiple of 64.
   * If the product of the width and height is not in the allowed range (64-3047424), raise ValueError.
   *
   * @param metadata - Metadata to update
   * @private
   */
  private handleResolution(metadata: Metadata): void {
    if (metadata.width == null || metadata.height == null) {
      // Use resolution preset if width/height not provided
      if (metadata.resPreset) {
        const dimensions = this.getResolutionDimensions(metadata.resPreset);
        metadata.width = dimensions[0];
        metadata.height = dimensions[1];
      } else {
        // Default to normal_square if no preset specified
        metadata.width = 832;
        metadata.height = 1216;
      }
    } else {
      // Round width and height to the nearest multiple of 64
      metadata.width = Math.floor((metadata.width + 63) / 64) * 64;
      metadata.height = Math.floor((metadata.height + 63) / 64) * 64;
    }

    // Validate the total resolution is within allowed range
    const totalPixels = metadata.width * metadata.height;
    const minPixels = 64 * 64; // 4096
    const maxPixels = 3047424;

    if (totalPixels < minPixels || totalPixels > maxPixels) {
      throw new Error(
        `The maximum allowed total resolution is ${maxPixels} px, got ${metadata.width}x${metadata.height}=${totalPixels}.`,
      );
    }
  }
}

// Singleton instance for easy access
export const metadataProcessor = new MetadataProcessor();
