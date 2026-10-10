import { describe, expect, it } from "vitest";
import { Action, Model } from "./constants";
import { metadataProcessor } from "./metadata";
import { Metadata } from "./types";

function processCharacter(center?: { x: number; y: number }) {
  return metadataProcessor.processMetadata({
    prompt: "1girl",
    model: Model.V5,
    action: Action.GENERATE,
    characterPrompts: [{ prompt: "character", uc: "", center }],
  } as Metadata);
}

describe("character coordinate mode", () => {
  it("keeps auto-position enabled when a center is omitted", () => {
    const processed = processCharacter();

    expect(processed.use_coords).toBe(false);
    expect(processed.characterPrompts?.[0].center).toEqual({ x: 0.5, y: 0.5 });
  });

  it("enables coordinates for a non-default center", () => {
    const processed = processCharacter({ x: 0.25, y: 0.75 });

    expect(processed.use_coords).toBe(true);
  });
});
