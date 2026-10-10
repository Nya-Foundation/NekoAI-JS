import { afterEach, describe, expect, it, vi } from "vitest";
import { NovelAI } from "./client";
import { Host } from "./constants";

describe("NovelAI.getSubscription", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the Opus usage battery from the subscription endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tier: 3,
          active: true,
          usage: {
            percent: 42,
            isNegative: false,
            timeUntilNextPercent: 7888,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new NovelAI({ token: "test", host: Host.WEB });
    const subscription = await client.getSubscription();

    expect(fetchMock).toHaveBeenCalledWith(
      `${Host.WEB}/user/subscription`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(subscription.usage).toEqual({
      percent: 42,
      isNegative: false,
      timeUntilNextPercent: 7888,
    });
  });
});
