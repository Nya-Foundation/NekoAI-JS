import { describe, expect, it } from "vitest";
import { Action, Model } from "./constants";
import { metadataProcessor } from "./metadata";
import { prepareMetadataForApi } from "./utils/metadata-utils";
import { Metadata } from "./types";

describe("deduplicate_tags control flag", () => {
  it("deduplicates by default and strips the flag from the API payload", () => {
    const processed = metadataProcessor.processMetadata({
      prompt: "1girl, 1girl, cute",
      model: Model.V4_5,
      action: Action.GENERATE,
      characterPrompts: [{ prompt: "char, char", uc: "lowres, lowres" }],
    } as Metadata);

    expect(processed.prompt.startsWith("1girl, cute")).toBe(true);
    expect(processed.characterPrompts?.[0].prompt).toBe("char");
    expect(processed.characterPrompts?.[0].uc).toBe("lowres");

    const payload = prepareMetadataForApi(processed);
    expect(payload.parameters).not.toHaveProperty("deduplicate_tags");
  });

  it("keeps duplicate tags when deduplicate_tags is false", () => {
    const processed = metadataProcessor.processMetadata({
      prompt: "1girl, 1girl, cute",
      negative_prompt: "lowres, lowres",
      model: Model.V4_5,
      action: Action.GENERATE,
      deduplicate_tags: false,
      // Skip UC preset prepend so we can assert the raw negative string
      ucPreset: 99 as Metadata["ucPreset"],
      characterPrompts: [{ prompt: "char, char", uc: "lowres, lowres" }],
      qualityToggle: false,
    } as Metadata);

    expect(processed.prompt).toBe("1girl, 1girl, cute");
    expect(processed.negative_prompt).toBe("lowres, lowres");
    expect(processed.characterPrompts?.[0].prompt).toBe("char, char");
    expect(processed.characterPrompts?.[0].uc).toBe("lowres, lowres");

    const payload = prepareMetadataForApi(processed);
    expect(payload.parameters).not.toHaveProperty("deduplicate_tags");
  });

  it("keeps a line-ending comma-space in front of baked newlines", () => {
    const processed = metadataProcessor.processMetadata({
      prompt: "1girl, solo, \n1girl, standing, smile\nlooking at viewer",
      model: Model.V4_5,
      action: Action.GENERATE,
      deduplicate_tags: true,
      ucPreset: 99 as Metadata["ucPreset"],
      qualityToggle: false,
    } as Metadata);

    expect(processed.prompt).toBe(
      "1girl, solo, \nstanding, smile\nlooking at viewer"
    );

    const kept = metadataProcessor.processMetadata({
      prompt: "1girl, solo, \nstanding, smile, \n",
      model: Model.V4_5,
      action: Action.GENERATE,
      deduplicate_tags: true,
      ucPreset: 99 as Metadata["ucPreset"],
      qualityToggle: false,
    } as Metadata);

    expect(kept.prompt).toBe("1girl, solo, \nstanding, smile, \n");
  });
});
