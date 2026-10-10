import { describe, expect, it } from "vitest";
import { MetadataProcessor } from "../src/metadata";
import { Action, Model, Resolution, Sampler } from "../src/constants";
import { calculateCost, prepareMetadataForApi } from "../src/utils";
import type { Metadata } from "../src/types";

const processor = new MetadataProcessor();

describe("MetadataProcessor", () => {
  it("applies defaults", () => {
    const result = processor.processMetadata({});
    expect(result.model).toBe(Model.V4_5);
    expect(result.action).toBe(Action.GENERATE);
    expect(result.steps).toBe(28);
    expect(result.width).toBe(832);
    expect(result.height).toBe(1216);
    expect(result.seed).toBeGreaterThanOrEqual(0);
  });

  it("does not mutate the input object", () => {
    const input: Metadata = { prompt: "1girl" };
    processor.processMetadata(input);
    expect(input.width).toBeUndefined();
    expect(input.negative_prompt).toBeUndefined();
  });

  it("preserves a user-provided skip_cfg_above_sigma", () => {
    const result = processor.processMetadata({ skip_cfg_above_sigma: 19 });
    expect(result.skip_cfg_above_sigma).toBe(19);
  });

  it("defaults skip_cfg_above_sigma to null", () => {
    const result = processor.processMetadata({});
    expect(result.skip_cfg_above_sigma).toBeNull();
  });

  describe("use_coords", () => {
    it("is false without character prompts", () => {
      const result = processor.processMetadata({});
      expect(result.use_coords).toBe(false);
    });

    it("is false when character prompts have no explicit centers", () => {
      const result = processor.processMetadata({
        characterPrompts: [{ prompt: "1girl" }, { prompt: "1boy" }],
      });
      expect(result.use_coords).toBe(false);
    });

    it("is true when a character prompt has non-default center", () => {
      const result = processor.processMetadata({
        characterPrompts: [{ prompt: "1girl", center: { x: 0.2, y: 0.8 } }],
      });
      expect(result.use_coords).toBe(true);
    });
  });

  describe("resolution", () => {
    it("uses the resolution preset", () => {
      const result = processor.processMetadata({
        resPreset: Resolution.SMALL_LANDSCAPE,
      });
      expect(result.width).toBe(768);
      expect(result.height).toBe(512);
    });

    it("rounds explicit dimensions up to a multiple of 64", () => {
      const result = processor.processMetadata({ width: 800, height: 1000 });
      expect(result.width).toBe(832);
      expect(result.height).toBe(1024);
    });

    it("throws when the resolution is out of range", () => {
      expect(() =>
        processor.processMetadata({ width: 3000, height: 3000 }),
      ).toThrow(/resolution/i);
    });
  });

  describe("prompt handling", () => {
    it("appends quality tags when qualityToggle is on", () => {
      const result = processor.processMetadata({
        prompt: "1girl",
        model: Model.V4_5,
      });
      expect(result.prompt).toContain("very aesthetic");
      expect(result.prompt!.startsWith("1girl")).toBe(true);
    });

    it("does not append quality tags when qualityToggle is off", () => {
      const result = processor.processMetadata({
        prompt: "1girl",
        qualityToggle: false,
      });
      expect(result.prompt).toBe("1girl");
    });

    it("builds a clean negative prompt without leading separators", () => {
      const result = processor.processMetadata({
        model: Model.V4_5,
        ucPreset: 1,
        negative_prompt: "extra tag",
      });
      expect(result.negative_prompt!.startsWith("nsfw")).toBe(true);
      expect(result.negative_prompt).toContain("extra tag");
      expect(result.negative_prompt).not.toMatch(/^,|,\s*,/);
    });

    it("leaves the negative prompt intact for unknown preset indices", () => {
      const result = processor.processMetadata({
        model: Model.V4,
        ucPreset: 3, // V4 only defines presets 0-1
        negative_prompt: "extra tag",
      });
      expect(result.negative_prompt).toBe("extra tag");
    });

    it("inpainting models share presets with their base model", () => {
      const inp = processor.processMetadata({ model: Model.V4_5_INP });
      const base = processor.processMetadata({ model: Model.V4_5 });
      expect(inp.negative_prompt).toBe(base.negative_prompt);
    });
  });

  describe("v4 prompt structure", () => {
    it("builds v4_prompt and v4_negative_prompt for V4 models", () => {
      const result = processor.processMetadata({
        prompt: "scenery",
        model: Model.V4_5,
        characterPrompts: [
          { prompt: "1girl", center: { x: 0.3, y: 0.3 } },
          { prompt: "1boy", enabled: false },
        ],
      });
      expect(result.v4_prompt).toBeDefined();
      expect(result.v4_prompt!.caption.char_captions).toHaveLength(1);
      expect(result.v4_prompt!.caption.char_captions[0].char_caption).toBe(
        "1girl",
      );
      expect(result.v4_prompt!.use_coords).toBe(true);
      expect(result.v4_negative_prompt).toBeDefined();
    });

    it("does not build v4_prompt for V3 models", () => {
      const result = processor.processMetadata({ model: Model.V3 });
      expect(result.v4_prompt).toBeUndefined();
    });
  });

  it("drops sm/sm_dyn for V4 models", () => {
    const result = processor.processMetadata({
      model: Model.V4_5,
      sm: true,
      sm_dyn: true,
    });
    expect(result.sm).toBeUndefined();
    expect(result.sm_dyn).toBeUndefined();
  });

  it("sets streaming format for V4 generate", () => {
    const v4 = processor.processMetadata({ model: Model.V4_5 });
    expect(v4.stream).toBe("msgpack");
    const v3 = processor.processMetadata({ model: Model.V3 });
    expect(v3.stream).toBeUndefined();
  });
});

describe("director reference defaults", () => {
  it("normalizes per-image arrays to the image count", () => {
    const result = processor.processMetadata({
      model: Model.V4_5,
      director_reference_images: ["aaa", "bbb"],
      director_reference_strength_values: [0.5],
    });
    expect(result.director_reference_descriptions).toHaveLength(2);
    expect(
      result.director_reference_descriptions![0].caption.base_caption,
    ).toBe("character");
    expect(result.director_reference_information_extracted).toEqual([1, 1]);
    expect(result.director_reference_strength_values).toEqual([0.5, 1]);
    expect(result.director_reference_secondary_strength_values).toEqual([1, 1]);
  });

  it("removes vibe transfer parameters when director references are used", () => {
    const result = processor.processMetadata({
      model: Model.V4_5,
      director_reference_images: ["aaa"],
      reference_image_multiple: ["vibe"],
      reference_information_extracted_multiple: [0.7],
    });
    expect(result.reference_image_multiple).toBeUndefined();
    expect(result.reference_information_extracted_multiple).toBeUndefined();
    expect(result.normalize_reference_strength_multiple).toBeUndefined();
  });

  it("drops director parameters when no images are provided", () => {
    const result = processor.processMetadata({
      model: Model.V4_5,
      director_reference_strength_values: [1],
    });
    expect(result.director_reference_strength_values).toBeUndefined();
    expect(result.normalize_reference_strength_multiple).toBe(true);
  });

  it("adds +5 Anlas to the cost estimate", () => {
    const base = { model: Model.V4_5, n_samples: 2 };
    const withRef = calculateCost({
      ...base,
      director_reference_images: ["aaa"],
    });
    expect(withRef).toBe(calculateCost(base) + 5);
  });
});

describe("inpaint img2img strength (V4.5)", () => {
  it("adds an img2img object when strength is below 1", () => {
    const result = processor.processMetadata({
      model: Model.V4_5_INP,
      action: Action.INPAINT,
      inpaintImg2ImgStrength: 0.5,
    });
    expect(result.img2img).toEqual({ strength: 0.5, color_correct: true });
  });

  it("omits the img2img object at full strength", () => {
    const result = processor.processMetadata({
      model: Model.V4_5_INP,
      action: Action.INPAINT,
      inpaintImg2ImgStrength: 1,
    });
    expect(result.img2img).toBeUndefined();
  });

  it("falls back to metadata.strength", () => {
    const result = processor.processMetadata({
      model: Model.V4_5_INP,
      action: Action.INPAINT,
      strength: 0.4,
    });
    expect(result.inpaintImg2ImgStrength).toBe(0.4);
    expect(result.img2img?.strength).toBe(0.4);
  });
});

describe("prepareMetadataForApi", () => {
  const processed = processor.processMetadata({
    prompt: "1girl",
    model: Model.V4_5,
    action: Action.INPAINT,
    inpaintImg2ImgStrength: 0.7,
    characterPrompts: [{ prompt: "1girl" }],
  });
  const payload = prepareMetadataForApi(processed);

  it("puts prompt/model/action at the top level", () => {
    expect(payload.model).toBe(Model.V4_5);
    expect(payload.action).toBe(Action.INPAINT);
    expect(payload.input).toBe(processed.prompt);
    expect(payload.parameters.model).toBeUndefined();
    expect(payload.parameters.prompt).toBeUndefined();
    expect(payload.parameters.resPreset).toBeUndefined();
  });

  it("converts inpaintImg2ImgStrength to inpaint_img2img_strength", () => {
    expect(payload.parameters.inpaint_img2img_strength).toBe(0.7);
    expect(payload.parameters.inpaintImg2ImgStrength).toBeUndefined();
  });

  it("keeps characterPrompts alongside v4_prompt (webapp parity)", () => {
    expect(payload.parameters.characterPrompts).toHaveLength(1);
    expect(payload.parameters.characterPrompts[0].prompt).toBe("1girl");
    expect(payload.parameters.v4_prompt).toBeDefined();
  });

  it("keeps null values but drops undefined ones", () => {
    expect(payload.parameters.skip_cfg_above_sigma).toBeNull();
    expect("sm" in payload.parameters).toBe(false);
  });
});

describe("V5 medium effort", () => {
  it("locks steps, sampler, UC, and drops CFG rescale", () => {
    const result = processor.processMetadata({
      model: Model.V5_MED,
      prompt: "1girl",
      steps: 28,
      sampler: Sampler.EULER,
      cfg_rescale: 0.4,
      negative_prompt: "hat",
      ucPreset: 2,
      characterPrompts: [{ prompt: "blue hair", uc: "bad hands" }],
    });
    expect(result.steps).toBe(14);
    expect(result.sampler).toBe(Sampler.EULER_ANC);
    expect(result.cfg_rescale).toBeUndefined();
    expect(result.negative_prompt).toBe("");
    expect(result.ucPreset).toBeUndefined();
    expect(result.ucPresetId).toBe("heavy");
    expect(result.characterPrompts?.[0].uc).toBe("");
    expect(result.v4_negative_prompt?.caption.base_caption).toBe("");
    expect(result.v4_negative_prompt?.caption.char_captions).toEqual([]);
    const payload = prepareMetadataForApi(result);
    expect(payload.model).toBe("nai-diffusion-5-full-medium");
    expect(payload.parameters.ucPreset).toBeUndefined();
    expect(payload.parameters.ucPresetId).toBe("heavy");
    expect(payload.parameters.cfg_rescale).toBeUndefined();
    expect(payload.parameters.stream).toBe("msgpack");
  });
});

describe("calculateCost", () => {
  const base: Metadata = {
    model: Model.V4_5,
    width: 832,
    height: 1216,
    steps: 28,
    n_samples: 1,
  };

  it("is free for a single normal-size generation with Opus", () => {
    expect(calculateCost(base, true)).toBe(0);
  });

  it("charges without Opus", () => {
    expect(calculateCost(base, false)).toBeGreaterThan(0);
  });

  it("applies the autoSmea factor for all V4 models including V4.5 full", () => {
    const withSmea = calculateCost({ ...base, autoSmea: true, n_samples: 2 });
    const without = calculateCost({ ...base, n_samples: 2 });
    expect(withSmea).toBeGreaterThan(without);
  });

  it("ignores V3 sm flags for V4 models", () => {
    const withSm = calculateCost({ ...base, sm_dyn: true, n_samples: 2 });
    const without = calculateCost({ ...base, n_samples: 2 });
    expect(withSm).toBe(without);
  });
});
