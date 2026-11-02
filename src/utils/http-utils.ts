import { decode } from "@msgpack/msgpack";
import { NovelAIResponse } from "../types";
import { Image, MsgpackEvent, EventType } from "../image";
import { base64ToUint8Array } from "./image-utils";
import { timestampString } from "./fs-utils";

/**
 * Error thrown for non-2xx API responses. Carries the HTTP status and the
 * error message returned by the NovelAI API, when available.
 */
export class NovelAIApiError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string, apiMessage?: string) {
    super(
      apiMessage
        ? `NovelAI API error ${status}: ${apiMessage}`
        : `NovelAI API error ${status} ${statusText}`,
    );
    this.name = "NovelAIApiError";
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * A single parsed Server-Sent Event
 */
export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Minimal incremental Server-Sent Events parser.
 * Feed raw bytes, get complete events out.
 */
export class SSEStream {
  private buffer = "";
  private decoder = new TextDecoder();

  *feed(chunk: Uint8Array): Generator<SSEEvent, void, unknown> {
    this.buffer += this.decoder.decode(chunk, { stream: true });

    const rawEvents = this.buffer.split("\n\n");
    this.buffer = rawEvents.pop() || "";

    for (const raw of rawEvents) {
      const event = parseSSEEventText(raw);
      if (event) yield event;
    }
  }

  *flush(): Generator<SSEEvent, void, unknown> {
    const event = parseSSEEventText(this.buffer);
    this.buffer = "";
    if (event) yield event;
  }
}

function parseSSEEventText(raw: string): SSEEvent | null {
  if (!raw.trim()) return null;

  let eventName: string | undefined;
  let data = "";

  for (const line of raw.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    const field = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    if (field === "data") {
      data += value;
    } else if (field === "event") {
      eventName = value;
    }
  }

  if (!data) return null;
  return { event: eventName, data };
}

/**
 * Real-time msgpack parser that processes streaming data chunk by chunk.
 * Handles the length-prefixed msgpack format used by NovelAI's V4 API.
 */
export class StreamingMsgpackParser {
  private buffer: Uint8Array = new Uint8Array(0);
  private expectedMessageLength: number | null = null;

  /**
   * Feed a chunk of data to the parser and yield any complete events
   */
  *feedChunk(chunk: Uint8Array): Generator<MsgpackEvent, void, unknown> {
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    while (true) {
      if (this.expectedMessageLength === null) {
        if (this.buffer.length < 4) break;

        // Length prefix is a big-endian 32-bit integer
        this.expectedMessageLength = new DataView(
          this.buffer.buffer,
          this.buffer.byteOffset,
          4,
        ).getUint32(0, false);
        this.buffer = this.buffer.slice(4);
      }

      if (this.buffer.length < this.expectedMessageLength) break;

      const messageData = this.buffer.slice(0, this.expectedMessageLength);
      this.buffer = this.buffer.slice(this.expectedMessageLength);
      this.expectedMessageLength = null;

      const event = parseMsgpackMessage(messageData);
      if (event) yield event;
    }
  }
}

/**
 * Real-time parser for the SSE flavor of NovelAI's event stream
 * (used by V4 inpainting). Yields MsgpackEvent objects.
 */
export class StreamingSSEParser {
  private sse = new SSEStream();

  *feedChunk(chunk: Uint8Array): Generator<MsgpackEvent, void, unknown> {
    for (const event of this.sse.feed(chunk)) {
      const parsed = parseEventJson(event.data);
      if (parsed) yield parsed;
    }
  }

  *flush(): Generator<MsgpackEvent, void, unknown> {
    for (const event of this.sse.flush()) {
      const parsed = parseEventJson(event.data);
      if (parsed) yield parsed;
    }
  }
}

function parseEventJson(data: string): MsgpackEvent | null {
  try {
    const obj = JSON.parse(data);
    if (obj && typeof obj === "object" && "event_type" in obj) {
      return createMsgpackEvent(obj);
    }
  } catch (error) {
    console.warn("Failed to parse SSE event data:", error);
  }
  return null;
}

/**
 * Parse a complete SSE buffer into individual events
 */
export function parseSSEEvents(sseData: Uint8Array): MsgpackEvent[] {
  const parser = new StreamingSSEParser();
  return [...parser.feedChunk(sseData), ...parser.flush()];
}

/**
 * Parse a complete length-prefixed msgpack buffer into individual events
 */
export function parseMsgpackEvents(msgpackData: Uint8Array): MsgpackEvent[] {
  const parser = new StreamingMsgpackParser();
  return [...parser.feedChunk(msgpackData)];
}

/**
 * Auto-detect format and parse stream data into individual events
 *
 * @param streamData - Raw stream data (msgpack or SSE format)
 * @returns Array of MsgpackEvent objects
 */
export function parseStreamEvents(streamData: Uint8Array): MsgpackEvent[] {
  const head = new TextDecoder().decode(streamData.slice(0, 100));
  if (head.includes("event:") || head.includes("data:")) {
    return parseSSEEvents(streamData);
  }
  return parseMsgpackEvents(streamData);
}

/**
 * Parse a single msgpack message and return the event
 *
 * @param messageData - Raw msgpack message data
 * @returns MsgpackEvent object or null if parsing failed
 */
export function parseMsgpackMessage(
  messageData: Uint8Array,
): MsgpackEvent | null {
  try {
    const obj = decode(messageData) as any;
    if (typeof obj === "object" && obj !== null && "event_type" in obj) {
      return createMsgpackEvent(obj);
    }
  } catch {
    // Fall back to JSON for compatibility
    try {
      const obj = JSON.parse(new TextDecoder().decode(messageData));
      if (typeof obj === "object" && obj !== null && "event_type" in obj) {
        return createMsgpackEvent(obj);
      }
    } catch (jsonError) {
      console.warn("Failed to parse stream message:", jsonError);
    }
  }
  return null;
}

/**
 * Create a MsgpackEvent from a parsed stream event object
 */
export function createMsgpackEvent(obj: any): MsgpackEvent {
  // Image data may arrive as binary, base64 or a plain number array
  let imageData: Uint8Array;

  if (obj.image instanceof Uint8Array) {
    imageData = obj.image;
  } else if (typeof obj.image === "string") {
    try {
      imageData = base64ToUint8Array(obj.image);
    } catch (error) {
      console.warn("Failed to decode base64 image data:", error);
      imageData = new Uint8Array(0);
    }
  } else if (Array.isArray(obj.image)) {
    imageData = new Uint8Array(obj.image);
  } else {
    console.warn("Unknown image data format in stream event");
    imageData = new Uint8Array(0);
  }

  // Detect the image format from the response bytes.
  const extension =
    imageData.length >= 2 && imageData[0] === 0xff && imageData[1] === 0xd8
      ? "jpg"
      : imageData.length >= 12 &&
          new TextDecoder().decode(imageData.slice(0, 4)) === "RIFF" &&
          new TextDecoder().decode(imageData.slice(8, 12)) === "WEBP"
        ? "webp"
        : "png";

  const eventType = obj.event_type;
  const timestamp = timestampString();
  const filename =
    eventType === "final"
      ? `${timestamp}_final.${extension}`
      : `${timestamp}_step_${String(obj.step_ix || 0).padStart(2, "0")}.${extension}`;

  return new MsgpackEvent({
    event_type:
      eventType === "final" ? EventType.FINAL : EventType.INTERMEDIATE,
    samp_ix: obj.samp_ix || 0,
    step_ix: obj.step_ix || 0,
    gen_id: String(obj.gen_id || ""),
    sigma: obj.sigma || 0.0,
    image: new Image({ filename, data: imageData }),
  });
}

/**
 * Generates a random correlation ID
 * @returns 6-character string with letters and digits
 */
export function generateXCorrelationId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Prepares headers by adding correlation ID and timestamp
 */
export function prepHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return {
    ...headers,
    "x-correlation-id": generateXCorrelationId(),
    "x-initiated-at": new Date().toISOString(),
  };
}

/**
 * Handles API response and checks status codes
 * @param response - Fetch API response
 * @returns NovelAIResponse object
 * @throws NovelAIApiError if response is not OK
 */
export async function handleResponse(
  response: Response,
): Promise<NovelAIResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  const contentType = response.headers.get("Content-Type") || "";
  const isBinary = [
    "application/zip",
    "application/octet-stream",
    "application/msgpack",
    "application/x-zip-compressed",
    "application/binary",
  ].some((type) => contentType.includes(type));

  return {
    statusCode: response.status,
    statusText: response.statusText,
    headers,
    data: isBinary ? await response.arrayBuffer() : response.body,
  };
}

/**
 * Build a NovelAIApiError from a failed response, extracting the API's
 * error message from the body when possible.
 */
export async function apiErrorFromResponse(
  response: Response,
): Promise<NovelAIApiError> {
  let apiMessage: string | undefined;
  try {
    const text = await response.text();
    if (text) {
      try {
        const body = JSON.parse(text);
        apiMessage = body.message || body.error || text.slice(0, 300);
      } catch {
        apiMessage = text.slice(0, 300);
      }
    }
  } catch {
    // Body unavailable; status alone will have to do
  }
  return new NovelAIApiError(response.status, response.statusText, apiMessage);
}
