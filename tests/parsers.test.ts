import { describe, expect, it } from "vitest";
import { encode } from "@msgpack/msgpack";
import {
  SSEStream,
  StreamingMsgpackParser,
  StreamingSSEParser,
  parseStreamEvents,
  NovelAIApiError,
  apiErrorFromResponse,
  handleResponse,
} from "../src/utils";
import { EventType } from "../src/image";

function msgpackFrame(obj: unknown): Uint8Array {
  const body = encode(obj);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  return frame;
}

const finalEvent = {
  event_type: "final",
  samp_ix: 0,
  step_ix: 27,
  gen_id: "abc",
  sigma: 0.1,
  image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

const intermediateEvent = {
  ...finalEvent,
  event_type: "intermediate",
  step_ix: 3,
  image: new Uint8Array([0xff, 0xd8, 0x01]),
};

describe("StreamingMsgpackParser", () => {
  it("preserves WebP output filenames", () => {
    const webp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const events = [
      ...new StreamingMsgpackParser().feedChunk(
        msgpackFrame({ ...finalEvent, image: webp }),
      ),
    ];
    expect(events[0].image.filename).toMatch(/\.webp$/);
    expect(events[0].image.toDataURL()).toMatch(/^data:image\/webp;base64,/);
  });
  it("parses events split across chunk boundaries", () => {
    const data = new Uint8Array([
      ...msgpackFrame(intermediateEvent),
      ...msgpackFrame(finalEvent),
    ]);

    const parser = new StreamingMsgpackParser();
    const events = [];
    // Feed in tiny 7-byte chunks to force partial frames
    for (let i = 0; i < data.length; i += 7) {
      events.push(...parser.feedChunk(data.slice(i, i + 7)));
    }

    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe(EventType.INTERMEDIATE);
    expect(events[0].image.filename).toMatch(/\.jpg$/);
    expect(events[1].event_type).toBe(EventType.FINAL);
    expect(events[1].image.filename).toMatch(/\.png$/);
  });
});

describe("SSEStream", () => {
  const encoder = new TextEncoder();

  it("parses events split across chunks", () => {
    const sse = new SSEStream();
    const chunks = ['event: message\ndata: {"a"', ': 1}\n\ndata: {"b": 2}\n\n'];

    const events = chunks.flatMap((c) => [...sse.feed(encoder.encode(c))]);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe('{"a": 1}');
    expect(events[0].event).toBe("message");
    expect(events[1].data).toBe('{"b": 2}');
  });

  it("flushes a trailing event without final newline", () => {
    const sse = new SSEStream();
    [...sse.feed(encoder.encode("data: tail"))];
    const events = [...sse.flush()];
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("tail");
  });
});

describe("StreamingSSEParser", () => {
  it("parses NovelAI SSE events into MsgpackEvents", () => {
    const encoder = new TextEncoder();
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const payload = JSON.stringify({
      event_type: "final",
      samp_ix: 0,
      step_ix: 27,
      gen_id: "xyz",
      sigma: 0,
      image: b64,
    });

    const parser = new StreamingSSEParser();
    const events = [
      ...parser.feedChunk(encoder.encode(`data: ${payload}\n\n`)),
      ...parser.flush(),
    ];

    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(EventType.FINAL);
    expect(events[0].gen_id).toBe("xyz");
    expect([...events[0].image.data]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe("parseStreamEvents", () => {
  it("auto-detects msgpack format", () => {
    const events = parseStreamEvents(msgpackFrame(finalEvent));
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(EventType.FINAL);
  });

  it("auto-detects SSE format", () => {
    const payload = JSON.stringify({ ...finalEvent, image: "" });
    const events = parseStreamEvents(
      new TextEncoder().encode(`data: ${payload}\n\n`),
    );
    expect(events).toHaveLength(1);
  });
});

describe("error handling", () => {
  it("extracts the API message from a JSON error body", async () => {
    const response = new Response(
      JSON.stringify({ statusCode: 402, message: "Not enough Anlas" }),
      { status: 402, statusText: "Payment Required" },
    );
    const error = await apiErrorFromResponse(response);
    expect(error).toBeInstanceOf(NovelAIApiError);
    expect(error.status).toBe(402);
    expect(error.message).toContain("Not enough Anlas");
  });

  it("handleResponse throws NovelAIApiError on failure", async () => {
    const response = new Response("nope", { status: 500 });
    await expect(handleResponse(response)).rejects.toBeInstanceOf(
      NovelAIApiError,
    );
  });

  it("handleResponse buffers binary responses", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "application/zip" },
    });
    const result = await handleResponse(response);
    expect(result.data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result.data as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
