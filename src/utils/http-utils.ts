import { decode } from "@msgpack/msgpack";
import { NovelAIResponse } from "../types";
import { Image, MsgpackEvent, EventType } from "../image";

/**
 * Real-time msgpack parser that processes streaming data chunk by chunk.
 * Handles the length-prefixed msgpack format used by NovelAI's V4 API.
 */
export class StreamingMsgpackParser {
  private buffer: Uint8Array = new Uint8Array(0);
  private expectedMessageLength: number | null = null;

  /**
   * Feed a chunk of data to the parser and yield any complete events
   *
   * @param chunk - Raw chunk of data from the stream
   * @returns AsyncGenerator yielding complete msgpack events
   */
  async *feedChunk(
    chunk: Uint8Array,
  ): AsyncGenerator<MsgpackEvent, void, unknown> {
    // Concatenate the new chunk to our buffer
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    while (true) {
      // If we don't have a message length yet, try to read it
      if (this.expectedMessageLength === null) {
        if (this.buffer.length < 4) {
          break; // Need more data for length prefix
        }

        // Read length prefix (big-endian 32-bit)
        const lengthBytes = this.buffer.slice(0, 4);
        this.expectedMessageLength = new DataView(
          lengthBytes.buffer,
          lengthBytes.byteOffset,
          4,
        ).getUint32(0, false);
        this.buffer = this.buffer.slice(4); // Remove length prefix
      }

      // Check if we have enough data for the complete message
      if (this.buffer.length < this.expectedMessageLength) {
        break; // Need more data
      }

      // Extract the complete message
      const messageData = this.buffer.slice(0, this.expectedMessageLength);
      this.buffer = this.buffer.slice(this.expectedMessageLength);

      // Reset for next message
      this.expectedMessageLength = null;

      // Parse the message
      const event = parseMsgpackMessage(messageData);
      if (event) {
        yield event;
      }
    }
  }
}

/**
 * Real-time SSE parser that processes streaming Server-Sent Events data chunk by chunk.
 * Handles the SSE format used by some NovelAI V4 endpoints.
 */
export class StreamingSSEParser {
  private buffer: string = '';

  /**
   * Feed a chunk of data to the parser and yield any complete events
   *
   * @param chunk - Raw chunk of data from the stream
   * @returns AsyncGenerator yielding complete SSE events
   */
  async *feedChunk(
    chunk: Uint8Array,
  ): AsyncGenerator<MsgpackEvent, void, unknown> {
    // Convert chunk to text and add to buffer
    const text = new TextDecoder().decode(chunk);
    this.buffer += text;

    // Split by double newline to find complete events
    const events = this.buffer.split('\n\n');
    
    // Keep the last (potentially incomplete) event in the buffer
    this.buffer = events.pop() || '';

    // Process complete events
    for (const eventText of events) {
      if (eventText.trim()) {
        const event = this.parseSSEEvent(eventText);
        if (event) {
          yield event;
        }
      }
    }
  }

  /**
   * Parse a single SSE event text into a MsgpackEvent
   *
   * @param eventText - Raw SSE event text
   * @returns MsgpackEvent object or null if parsing failed
   * @private
   */
  private parseSSEEvent(eventText: string): MsgpackEvent | null {
    const lines = eventText.split('\n');
    let currentEvent: any = {};

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.includes(':')) {
        const colonIndex = trimmedLine.indexOf(':');
        const field = trimmedLine.substring(0, colonIndex).trim();
        const value = trimmedLine.substring(colonIndex + 1).trim();
        
        if (field === 'data') {
          // Accumulate data fields (they can span multiple lines)
          currentEvent.data = (currentEvent.data || '') + value;
        } else {
          currentEvent[field] = value;
        }
      }
    }

    // Parse the data field as JSON
    if (currentEvent.data) {
      try {
        const eventData = JSON.parse(currentEvent.data);
        if (eventData.event_type) {
          return createMsgpackEvent(eventData);
        }
      } catch (error) {
        console.warn("Failed to parse SSE event data:", error);
      }
    }

    return null;
  }

  /**
   * Flush any remaining data in the buffer
   *
   * @returns AsyncGenerator yielding any final events
   */
  async *flush(): AsyncGenerator<MsgpackEvent, void, unknown> {
    if (this.buffer.trim()) {
      const event = this.parseSSEEvent(this.buffer);
      if (event) {
        yield event;
      }
      this.buffer = '';
    }
  }
}

/**
 * Parse SSE (Server-Sent Events) format data into individual events
 *
 * @param sseData - Raw SSE stream data
 * @returns Array of MsgpackEvent objects
 */
export function parseSSEEvents(sseData: Uint8Array): MsgpackEvent[] {
  const events: MsgpackEvent[] = [];
  const text = new TextDecoder().decode(sseData);
  const lines = text.split('\n');
  
  let currentEvent: any = {};
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine === '') {
      // Empty line indicates end of event
      if (currentEvent.data) {
        try {
          const eventData = JSON.parse(currentEvent.data);
          if (eventData.event_type) {
            const event = createMsgpackEvent(eventData);
            if (event) {
              events.push(event);
            }
          }
        } catch (error) {
          console.warn("Failed to parse SSE event data:", error);
        }
      }
      currentEvent = {};
    } else if (trimmedLine.includes(':')) {
      const colonIndex = trimmedLine.indexOf(':');
      const field = trimmedLine.substring(0, colonIndex).trim();
      const value = trimmedLine.substring(colonIndex + 1).trim();
      
      if (field === 'data') {
        // Accumulate data fields (they can span multiple lines)
        currentEvent.data = (currentEvent.data || '') + value;
      } else {
        currentEvent[field] = value;
      }
    }
  }
  
  // Handle last event if no trailing empty line
  if (currentEvent.data) {
    try {
      const eventData = JSON.parse(currentEvent.data);
      if (eventData.event_type) {
        const event = createMsgpackEvent(eventData);
        if (event) {
          events.push(event);
        }
      }
    } catch (error) {
      console.warn("Failed to parse final SSE event data:", error);
    }
  }
  
  return events;
}

/**
 * Auto-detect format and parse stream data into individual events
 *
 * @param streamData - Raw stream data (could be msgpack or SSE format)
 * @returns Array of MsgpackEvent objects
 */
export function parseStreamEvents(streamData: Uint8Array): MsgpackEvent[] {
  // Check if data starts with SSE format indicators
  const text = new TextDecoder().decode(streamData.slice(0, 100));
  if (text.includes('event:') || text.includes('data:')) {
    return parseSSEEvents(streamData);
  }
  
  // Otherwise, assume it's msgpack format
  return parseMsgpackEvents(streamData);
}

/**
 * Parse msgpack stream data into individual events
 *
 * @param msgpackData - Raw msgpack stream data
 * @returns Array of MsgpackEvent objects
 */
export function parseMsgpackEvents(msgpackData: Uint8Array): MsgpackEvent[] {
  const events: MsgpackEvent[] = [];
  let offset = 0;

  while (offset < msgpackData.length) {
    try {
      // Check if we have at least 4 bytes for length prefix
      if (offset + 4 > msgpackData.length) {
        break;
      }

      // Read length prefix (big-endian 32-bit)
      const lengthBytes = msgpackData.slice(offset, offset + 4);
      const messageLength = new DataView(
        lengthBytes.buffer,
        lengthBytes.byteOffset,
        4,
      ).getUint32(0, false);

      // Extract message data
      const msgStart = offset + 4;
      const msgEnd = Math.min(msgStart + messageLength, msgpackData.length);

      if (msgStart >= msgpackData.length) {
        break;
      }

      // Parse the message
      const messageData = msgpackData.slice(msgStart, msgEnd);
      const event = parseMsgpackMessage(messageData);

      if (event) {
        events.push(event);
      }

      // Move to next message
      offset = msgStart + messageLength;
    } catch (error) {
      // Skip corrupted data and try next byte
      offset += 1;
    }
  }

  return events;
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
    // Use proper msgpack library to decode the message
    const obj = decode(messageData) as any;

    if (typeof obj === "object" && obj !== null && "event_type" in obj) {
      return createMsgpackEvent(obj);
    }
  } catch (error) {
    // If msgpack parsing fails, try JSON fallback for compatibility
    try {
      const jsonString = new TextDecoder().decode(messageData);
      const obj = JSON.parse(jsonString);

      if (typeof obj === "object" && obj !== null && "event_type" in obj) {
        return createMsgpackEvent(obj);
      }
    } catch (jsonError) {
      // Both msgpack and JSON parsing failed
      console.warn("JSON parsing also failed:", jsonError);
    }
  }

  return null;
}

/**
 * Create a MsgpackEvent from a parsed msgpack object
 *
 * @param obj - Parsed msgpack object containing event data
 * @returns MsgpackEvent object
 */
export function createMsgpackEvent(obj: any): MsgpackEvent {
  // Handle image data - msgpack may encode it as binary or base64
  let imageData: Uint8Array;

  if (obj.image instanceof Uint8Array) {
    imageData = obj.image;
  } else if (typeof obj.image === "string") {
    // Handle base64 encoded image data
    try {
      imageData = new Uint8Array(
        atob(obj.image)
          .split("")
          .map((char) => char.charCodeAt(0)),
      );
    } catch (error) {
      console.warn("Failed to decode base64 image data:", error);
      imageData = new Uint8Array(0);
    }
  } else if (Array.isArray(obj.image)) {
    imageData = new Uint8Array(obj.image);
  } else {
    console.warn("Unknown image data format in msgpack event");
    imageData = new Uint8Array(0);
  }

  // Determine file extension based on image format
  let extension = "png";
  if (imageData.length >= 2) {
    if (imageData[0] === 0xff && imageData[1] === 0xd8) {
      extension = "jpg";
    } else if (
      imageData.length >= 4 &&
      imageData[0] === 0x89 &&
      imageData[1] === 0x50 &&
      imageData[2] === 0x4e &&
      imageData[3] === 0x47
    ) {
      extension = "png";
    }
  }

  // Generate filename
  const eventType = obj.event_type;
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .substring(0, 15);

  let filename: string;
  if (eventType === "final") {
    filename = `${timestamp}_final.${extension}`;
  } else {
    const stepIx = obj.step_ix || 0;
    filename = `${timestamp}_step_${stepIx.toString().padStart(2, "0")}.${extension}`;
  }

  const image = new Image({
    filename,
    data: imageData,
  });

  // Create MsgpackEvent
  return new MsgpackEvent({
    event_type:
      eventType === "final" ? EventType.FINAL : EventType.INTERMEDIATE,
    samp_ix: obj.samp_ix || 0,
    step_ix: obj.step_ix || 0,
    gen_id: String(obj.gen_id || ""),
    sigma: obj.sigma || 0.0,
    image,
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
 * Generates a timestamp in ISO format with milliseconds
 * @returns ISO timestamp string
 */
export function generateXInitiatedAt(): string {
  const now = new Date();
  const ms = String(now.getUTCMilliseconds()).padStart(3, "0");
  return now.toISOString().replace(/\.\d{3}Z$/, `.${ms}Z`);
}

/**
 * Prepares headers by adding correlation ID and timestamp
 * @param headers - Existing headers object
 * @returns Headers with added x-correlation-id and x-initiated-at
 */
export function prepHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const preparedHeaders = { ...headers };
  preparedHeaders["x-correlation-id"] = generateXCorrelationId();
  preparedHeaders["x-initiated-at"] = generateXInitiatedAt();
  return preparedHeaders;
}

/**
 * Handles API response and checks status codes
 * @param response - Fetch API response
 * @returns NovelAIResponse object
 * @throws Error if response is not OK
 */
export async function handleResponse(
  response: Response,
): Promise<NovelAIResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  if (!response.ok) {
    const error = new Error(
      `HTTP Error: ${response.status} ${response.statusText}`,
    );
    (error as any).status = response.status;
    (error as any).statusText = response.statusText;
    throw error;
  }

  // For binary responses, we need to clone the response and buffer all the data
  if (
    response.headers.get("Content-Type")?.includes("application/zip") ||
    response.headers.get("Content-Type")?.includes("application/octet-stream") ||
    response.headers.get("Content-Type")?.includes("application/msgpack")
  ) {
    // Clone response to avoid consuming it
    const clonedResponse = response.clone();
    // Get the array buffer directly
    const buffer = await clonedResponse.arrayBuffer();

    return {
      statusCode: response.status,
      statusText: response.statusText,
      headers,
      data: buffer, // Return buffer directly for binary data
    };
  }

  // For non-binary responses, return the body stream
  return {
    statusCode: response.status,
    statusText: response.statusText,
    headers,
    data: response.body,
  };
}
