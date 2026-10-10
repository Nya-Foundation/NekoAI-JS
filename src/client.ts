import JSZip from "jszip";
import {
  HEADERS,
  Host,
  Endpoint,
  Action,
  DirectorTools,
  EmotionOptions,
  EmotionLevel,
  Model,
  TextModel,
  isV4Model,
  usesV4PromptEnvelope,
} from "./constants";
import { Image, MsgpackEvent, EventType } from "./image";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatMessage,
  Completion,
  DirectorRequest,
  EnhanceOptions,
  ImageInput,
  Metadata,
  NovelAIOptions,
  NovelAIResponse,
  NovelAISubscription,
  RetryConfig,
  TagSuggestion,
  TextGenerationOptions,
} from "./types";
import {
  apiErrorFromResponse,
  calculateCost,
  createFilename,
  getNodeFs,
  handleResponse,
  isNodeEnvironment,
  parseImage,
  prepareMetadataForApi,
  prepHeaders,
  SSEStream,
  StreamingMsgpackParser,
  StreamingSSEParser,
  parseStreamEvents,
  scaleDimensions,
  timestampString,
  uint8ArrayToBase64,
  withRetry,
} from "./utils";
import { metadataProcessor } from "./metadata";

/** Maximum number of vibe tokens kept in the in-memory cache */
const VIBE_CACHE_LIMIT = 100;

/**
 * Detect whether a base64 string is an actual image (needing vibe encoding)
 * rather than a pre-encoded vibe token
 */
function isEncodableImage(base64: string): boolean {
  // Base64 prefixes of PNG, JPEG, WebP/RIFF and GIF magic bytes
  return ["iVBOR", "/9j/", "UklGR", "R0lGO"].some((magic) =>
    base64.startsWith(magic),
  );
}

/**
 * Copy of a request payload with bulky base64 fields replaced by size
 * annotations, for verbose logging
 */
function redactPayload(payload: any): any {
  const params = payload?.parameters;
  if (!params) return payload;

  const redact = (value: unknown) =>
    typeof value === "string" ? `<base64: ${value.length} chars>` : value;

  const redacted: any = { ...params };
  for (const key of ["image", "mask"]) {
    if (redacted[key] !== undefined) redacted[key] = redact(redacted[key]);
  }
  for (const key of ["reference_image_multiple", "director_reference_images"]) {
    if (Array.isArray(redacted[key])) {
      redacted[key] = redacted[key].map(redact);
    }
  }
  return { ...payload, parameters: redacted };
}

/**
 * NovelAI client for image generation, director tools and text generation
 */
export class NovelAI {
  private token: string;
  private host: string;
  private textHost: string;
  private timeout: number;
  private retryConfig?: RetryConfig;

  private verbose: boolean = false;
  private headers: Record<string, string>;

  /**
   * Cache of vibe tokens to avoid re-encoding the same images
   */
  private vibeCache: Map<string, string> = new Map();

  /**
   * Create a new NovelAI client
   *
   * @param options - Client configuration options
   * @param options.token - NovelAI access token
   * @param options.host - API host for image endpoints (default: Host.WEB)
   * @param options.textHost - API host for text endpoints (default: Host.TEXT)
   * @param options.timeout - Request timeout in milliseconds (default: 120000)
   * @param options.retry - Configuration for request retries (default: enabled with 3 retries)
   * @param options.verbose - Whether to log additional information (default: false)
   */
  constructor(options: NovelAIOptions) {
    this.token = options.token;
    this.host = options.host || Host.WEB;
    this.textHost = options.textHost || Host.TEXT;
    this.timeout = options.timeout || 120000;
    this.retryConfig = options.retry;
    this.verbose = options.verbose || false;

    this.headers = {
      ...HEADERS,
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * Generate images using NovelAI's API
   *
   * @param metadata - Generation parameters
   * @param stream - Whether to stream intermediate steps (V4/V4.5 models only, default: false)
   * @param isOpus - Whether the user has Opus subscription (for cost estimation logging, default: false)
   * @param forceZip - Route V4 models through the ZIP endpoint instead of the event stream (default: false)
   * @returns Array of Image objects, or an AsyncGenerator of MsgpackEvent objects when streaming
   */
  generateImage(metadata: Metadata): Promise<Image[]>;
  generateImage(
    metadata: Metadata,
    stream: false,
    isOpus?: boolean,
    forceZip?: boolean,
  ): Promise<Image[]>;
  generateImage(
    metadata: Metadata,
    stream: true,
    isOpus?: boolean,
  ): Promise<AsyncGenerator<MsgpackEvent, void, unknown>>;
  generateImage(
    metadata: Metadata,
    stream: boolean,
    isOpus?: boolean,
    forceZip?: boolean,
  ): Promise<Image[] | AsyncGenerator<MsgpackEvent, void, unknown>>;
  async generateImage(
    metadata: Metadata,
    stream: boolean = false,
    isOpus: boolean = false,
    forceZip: boolean = false,
  ): Promise<Image[] | AsyncGenerator<MsgpackEvent, void, unknown>> {
    const resolved = await this.resolveImageInputs(metadata);
    const processedMetadata = metadataProcessor.processMetadata(resolved);

    if (this.verbose) {
      const cost = calculateCost(processedMetadata, isOpus);
      console.info(`Generating image... estimated Anlas cost: ${cost}`);
    }

    // Encode vibe transfer reference images for V4 models
    await this.encodeVibe(processedMetadata);

    const payload = prepareMetadataForApi(processedMetadata);
    const useEventStream =
      usesV4PromptEnvelope(processedMetadata.model!) && !forceZip;

    if (stream) {
      if (!useEventStream) {
        throw new Error(
          "Streaming is only supported for V4/V4.5/V5 models without forceZip; V3 models return the final image only.",
        );
      }
      // Open the connection (with retry) before returning the generator so
      // connection/HTTP errors are retried and surface here, not mid-iteration
      const response = await withRetry(
        () => this.openStream(`${this.host}${Endpoint.IMAGE_STREAM}`, payload),
        this.retryConfig,
      );
      return this.parseEventStream(response, payload.action);
    }

    if (!useEventStream) {
      // The ZIP endpoint does not understand the stream parameter
      delete payload.parameters.stream;
    }

    return withRetry(async () => {
      try {
        if (useEventStream) {
          const response = await this.request(
            `${this.host}${Endpoint.IMAGE_STREAM}`,
            payload,
          );
          return await this.extractImagesFromMsgpack(response);
        }
        const response = await this.request(
          `${this.host}${Endpoint.IMAGE}`,
          payload,
        );
        return await this.extractImagesFromZip(response);
      } catch (error) {
        throw this.handleRequestError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Resolve all image-bearing metadata fields to raw base64 strings,
   * accepting any supported ImageInput format.
   */
  private async resolveImageInputs(metadata: Metadata): Promise<Metadata> {
    const result: Metadata = { ...metadata };

    result.image = await this.resolveToBase64(result.image);
    result.mask = await this.resolveToBase64(result.mask);

    if (result.reference_image_multiple) {
      result.reference_image_multiple = await Promise.all(
        result.reference_image_multiple.map((img) =>
          this.resolveToBase64(img) as Promise<string>,
        ),
      );
    }

    if (result.director_reference_images) {
      result.director_reference_images = await Promise.all(
        result.director_reference_images.map((img) =>
          this.resolveToBase64(img) as Promise<string>,
        ),
      );
    }

    return result;
  }

  /**
   * Convert an ImageInput to a raw base64 string.
   * Strings are treated as data URLs, remote URLs, file paths (Node.js, when
   * the file exists), or raw base64 (fallback) — in that order.
   */
  private async resolveToBase64(
    input?: ImageInput,
  ): Promise<string | undefined> {
    if (input == null) return undefined;

    if (typeof input === "string") {
      if (input.startsWith("data:")) {
        const comma = input.indexOf(",");
        return comma >= 0 ? input.slice(comma + 1) : input;
      }
      if (/^(https?|blob):/.test(input)) {
        return (await parseImage(input)).base64;
      }
      if (isNodeEnvironment()) {
        const fs = await getNodeFs();
        if (fs?.existsSync(input)) {
          return (await parseImage(input)).base64;
        }
      }
      // Assume the string is already raw base64
      return input;
    }

    return (await parseImage(input)).base64;
  }

  /**
   * Make a buffered request to the NovelAI API.
   * The timeout covers the time until the response is fully received.
   */
  private async request(
    url: string,
    payload: unknown,
  ): Promise<NovelAIResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const jsonPayload = JSON.stringify(payload);
    const headers = prepHeaders(this.headers);

    if (this.verbose) {
      console.debug(`[Request] ${url}`, JSON.stringify(redactPayload(payload)));
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: jsonPayload,
        signal: controller.signal,
      });

      return await handleResponse(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Open a streaming request. The timeout covers time-to-headers only, so
   * long-running streams are not aborted mid-generation.
   */
  private async openStream(url: string, payload: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const jsonPayload = JSON.stringify(payload);
    const headers = prepHeaders(this.headers);

    if (this.verbose) {
      console.debug(`[Stream] ${url}`, JSON.stringify(redactPayload(payload)));
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: jsonPayload,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await apiErrorFromResponse(response);
      }
      if (!response.body) {
        throw new Error("No response body available for streaming");
      }

      return response;
    } catch (error) {
      throw this.handleRequestError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse a streaming response body into MsgpackEvent objects
   */
  private async *parseEventStream(
    response: Response,
    action: string,
  ): AsyncGenerator<MsgpackEvent, void, unknown> {
    // Inpainting streams SSE; everything else streams length-prefixed msgpack
    const parser =
      action === "infill"
        ? new StreamingSSEParser()
        : new StreamingMsgpackParser();

    const reader = response.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield* parser.feedChunk(value);
      }
      if (parser instanceof StreamingSSEParser) {
        yield* parser.flush();
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Extract images from ZIP response (V3 models)
   */
  private async extractImagesFromZip(
    apiResponse: NovelAIResponse,
  ): Promise<Image[]> {
    const arrayBuffer = await this.getResponseBuffer(apiResponse);
    const zip = await JSZip.loadAsync(arrayBuffer);
    const images: Image[] = [];
    let index = 0;

    for (const filename of Object.keys(zip.files)) {
      const zipObj = zip.files[filename];
      if (!zipObj.dir) {
        const data = await zipObj.async("uint8array");
        images.push(
          new Image({
            filename: `${timestampString()}_p${index}.png`,
            data,
          }),
        );
        index++;
      }
    }

    return images;
  }

  /**
   * Extract final images from a buffered event stream response (V4 models)
   */
  private async extractImagesFromMsgpack(
    apiResponse: NovelAIResponse,
  ): Promise<Image[]> {
    const arrayBuffer = await this.getResponseBuffer(apiResponse);
    const events = parseStreamEvents(new Uint8Array(arrayBuffer));

    return events
      .filter((event) => event.event_type === EventType.FINAL)
      .map((event) => event.image);
  }

  /**
   * Get response data as ArrayBuffer
   */
  private async getResponseBuffer(
    apiResponse: NovelAIResponse,
  ): Promise<ArrayBuffer> {
    if (apiResponse.data instanceof ArrayBuffer) {
      return apiResponse.data;
    } else if (apiResponse.data) {
      return await new Response(apiResponse.data).arrayBuffer();
    }
    throw new Error("No data received from API");
  }

  /**
   * Convert AbortError into a friendly timeout message
   */
  private handleRequestError(error: any): Error {
    if (error?.name === "AbortError") {
      return new Error(
        `Request timed out after ${this.timeout}ms. Consider setting a higher 'timeout' value when creating the NovelAI client.`,
      );
    }
    return error;
  }

  /**
   * Use a Director tool with the specified request
   *
   * @param request - Director tool request
   * @returns Promise resolving to an Image object
   */
  async useDirectorTool(request: DirectorRequest): Promise<Image> {
    return withRetry(async () => {
      try {
        const response = await this.request(
          `${this.host}${Endpoint.DIRECTOR}`,
          request,
        );

        if (!response.data) {
          throw new Error("Received empty response from the server.");
        }

        // Buffer once — the response stream can only be consumed a single time
        const arrayBuffer = await this.getResponseBuffer(response);
        const data = await this.unzipSingleImage(arrayBuffer);

        return new Image({
          filename: createFilename(request.req_type),
          data,
        });
      } catch (error) {
        throw this.handleRequestError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Extract the first image from a single-image ZIP response, falling back
   * to the raw bytes when the response is not a ZIP.
   */
  private async unzipSingleImage(arrayBuffer: ArrayBuffer): Promise<Uint8Array> {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const firstFile = Object.values(zip.files).find((f) => !f.dir);
      return firstFile
        ? await firstFile.async("uint8array")
        : new Uint8Array(arrayBuffer);
    } catch {
      return new Uint8Array(arrayBuffer);
    }
  }

  /**
   * Create a director tool request with common parameters
   */
  private async createDirectorRequest(
    image: ImageInput,
    reqType: DirectorTools,
    additionalParams: Record<string, any> = {},
  ): Promise<Image> {
    const parsedImage = await parseImage(image);

    return this.useDirectorTool({
      req_type: reqType,
      width: parsedImage.width,
      height: parsedImage.height,
      image: parsedImage.base64,
      ...additionalParams,
    } as DirectorRequest);
  }

  /**
   * Convert an image to line art
   */
  async lineArt(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.LINEART);
  }

  /**
   * Convert an image to sketch
   */
  async sketch(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.SKETCH);
  }

  /**
   * Remove the background from an image
   */
  async backgroundRemoval(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.BACKGROUND_REMOVAL);
  }

  /**
   * Declutter an image (remove noise, distractions, etc.)
   */
  async declutter(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.DECLUTTER);
  }

  /**
   * Colorize a sketch or line art
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @param prompt - Additional prompt to add to the request
   * @param defry - Defry value (0-5, default: 0)
   */
  async colorize(
    image: ImageInput,
    prompt: string = "",
    defry: number = 0,
  ): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.COLORIZE, {
      prompt,
      defry,
    });
  }

  /**
   * Change the emotion of a character in an image
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @param emotion - Target emotion to change to
   * @param prompt - Additional prompt to add to the request
   * @param emotionLevel - Strength of the emotion change (default: NORMAL)
   */
  async changeEmotion(
    image: ImageInput,
    emotion: string = EmotionOptions.NEUTRAL,
    prompt: string = "",
    emotionLevel: EmotionLevel = EmotionLevel.NORMAL,
  ): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.EMOTION, {
      prompt: `${emotion};;${prompt}`,
      defry: emotionLevel,
    });
  }

  /**
   * Upscale an image using NovelAI's dedicated upscaler
   *
   * Note: this endpoint lives on api.novelai.net and requires an active
   * subscription; the upscaled image is returned as-is (no re-generation).
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @param scale - Upscale factor, 2 or 4 (default: 4)
   * @returns Promise resolving to the upscaled Image
   */
  async upscale(image: ImageInput, scale: 2 | 4 = 4): Promise<Image> {
    const parsed = await parseImage(image);

    return withRetry(async () => {
      try {
        const response = await this.request(`${Host.API}${Endpoint.UPSCALE}`, {
          image: parsed.base64,
          width: parsed.width,
          height: parsed.height,
          scale,
        });

        if (!response.data) {
          throw new Error("Received empty response from the server.");
        }

        const arrayBuffer = await this.getResponseBuffer(response);
        return new Image({
          filename: createFilename("upscaled"),
          data: await this.unzipSingleImage(arrayBuffer),
        });
      } catch (error) {
        throw this.handleRequestError(error);
      }
    }, this.retryConfig);
  }

  /**
   * Enhance an image — img2img re-generation at a scaled-up resolution,
   * mirroring the web UI's Enhance feature. The target resolution is the
   * source size multiplied by upscaleFactor, clamped to the API's pixel budget.
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @param options - Enhance options plus any generation metadata
   *                  (upscaleFactor default 1.5, strength 0.5, noise 0)
   * @returns Promise resolving to an array of Image objects
   */
  async enhance(
    image: ImageInput,
    options: EnhanceOptions = {},
  ): Promise<Image[]> {
    const { upscaleFactor = 1.5, strength = 0.5, noise = 0, ...rest } = options;
    const parsed = await parseImage(image);
    const [width, height] = scaleDimensions(
      parsed.width,
      parsed.height,
      upscaleFactor,
    );

    return this.generateImage({
      ...rest,
      action: Action.IMG2IMG,
      image: parsed.base64,
      width,
      height,
      strength,
      noise,
    });
  }

  /**
   * Fetch the current account subscription, including Opus image usage when supplied.
   * Hits GET /user/subscription on the image host (same as the web client).
   */
  async getSubscription(): Promise<NovelAISubscription> {
    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await fetch(
          `${this.host}${Endpoint.SUBSCRIPTION}`,
          {
            method: "GET",
            headers: prepHeaders(this.headers),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw await apiErrorFromResponse(response);
        }
        return (await response.json()) as NovelAISubscription;
      } catch (error) {
        throw this.handleRequestError(error);
      } finally {
        clearTimeout(timeoutId);
      }
    }, this.retryConfig);
  }

  /**
   * Get tag suggestions for a partial tag query
   *
   * @param prompt - The incomplete tag query
   * @param model - The image model to get suggestions for (default: V4.5)
   * @param lang - Query language, "en" or "jp" (default: "en")
   * @returns Promise resolving to an array of tag suggestions
   */
  async suggestTags(
    prompt: string,
    model: Model = Model.V4_5,
    lang?: "en" | "jp",
  ): Promise<TagSuggestion[]> {
    const url = new URL(`${this.host}${Endpoint.SUGGEST_TAGS}`);
    url.searchParams.set("model", model);
    url.searchParams.set("prompt", prompt);
    if (lang) url.searchParams.set("lang", lang);

    const result = await withRetry(async () => {
      const response = await fetch(url, {
        method: "GET",
        headers: prepHeaders(this.headers),
      });
      if (!response.ok) {
        throw await apiErrorFromResponse(response);
      }
      return response.json();
    }, this.retryConfig);

    const tags = (result as any)?.tags;
    return Array.isArray(tags) ? tags : [];
  }

  /**
   * Encode images to vibe tokens using the /encode-vibe endpoint.
   * Uses caching to avoid unnecessary API calls for previously processed images.
   */
  private async encodeVibe(metadata: Metadata): Promise<void> {
    if (
      !metadata.model ||
      !isV4Model(metadata.model) ||
      !metadata.reference_image_multiple?.length
    ) {
      return;
    }

    const encoded: string[] = [];

    for (let i = 0; i < metadata.reference_image_multiple.length; i++) {
      const refImage = metadata.reference_image_multiple[i] as string;

      // Pre-encoded vibe tokens (e.g. from .naiv4vibe files) are passed
      // through untouched; only actual images are sent to /encode-vibe
      if (!isEncodableImage(refImage)) {
        encoded.push(refImage);
        continue;
      }

      const refInfoExtracted =
        metadata.reference_information_extracted_multiple?.[i] ?? 1.0;

      const imageHash = await this.getImageHash(refImage);
      const cacheKey = `${imageHash}:${refInfoExtracted}:${metadata.model}`;

      let vibeToken = this.vibeCache.get(cacheKey);
      if (!vibeToken) {
        vibeToken = await this.fetchVibeToken(
          refImage,
          refInfoExtracted,
          metadata.model,
        );
        if (this.vibeCache.size >= VIBE_CACHE_LIMIT) {
          this.vibeCache.delete(this.vibeCache.keys().next().value!);
        }
        this.vibeCache.set(cacheKey, vibeToken);
      }

      encoded.push(vibeToken);
    }

    metadata.reference_image_multiple = encoded;
    metadata.reference_information_extracted_multiple = undefined;
  }

  /**
   * Fetch vibe token from the API
   */
  private async fetchVibeToken(
    image: string,
    informationExtracted: number,
    model: string,
  ): Promise<string> {
    try {
      const response = await this.request(
        `${this.host}${Endpoint.ENCODE_VIBE}`,
        {
          image,
          information_extracted: informationExtracted,
          model,
        },
      );
      // The endpoint returns the vibe token as raw binary; the generation
      // payload expects it base64-encoded
      const buffer = await this.getResponseBuffer(response);
      return uint8ArrayToBase64(new Uint8Array(buffer));
    } catch (error) {
      throw this.handleRequestError(error);
    }
  }

  /**
   * SHA-256 hash of a base64 image, used as vibe cache key.
   * Uses Web Crypto, available in browsers and Node.js 18+.
   */
  private async getImageHash(base64Image: string): Promise<string> {
    const binaryString = atob(base64Image);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // ---- Text generation (OpenAI-compatible endpoints) ----

  /**
   * Generate a chat completion using NovelAI's text models
   *
   * @param messages - Chat messages, or a plain string treated as a single user message
   * @param options - Generation options (model, max_tokens, temperature, ...)
   * @returns Promise resolving to a ChatCompletion in OpenAI format
   */
  async chat(
    messages: string | ChatMessage[],
    options: TextGenerationOptions = {},
  ): Promise<ChatCompletion> {
    // The non-streaming chat endpoint currently returns raw token ids
    // without decoded text, so assemble the completion from the streaming
    // endpoint instead.
    const stream = await this.chatStream(messages, options);

    let id = "";
    let model = "";
    let created = 0;
    let role: ChatMessage["role"] = "assistant";
    let content = "";
    let finishReason: string | null = null;
    let usage: ChatCompletion["usage"];

    for await (const chunk of stream) {
      id = id || chunk.id;
      model = model || chunk.model;
      created = created || chunk.created;
      const choice = chunk.choices?.[0];
      if (choice?.delta?.role) role = choice.delta.role;
      if (choice?.delta?.content) content += choice.delta.content;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const chunkUsage = (chunk as any).usage;
      if (chunkUsage) usage = chunkUsage;
    }

    return {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        { index: 0, message: { role, content }, finish_reason: finishReason },
      ],
      usage,
    };
  }

  /**
   * Generate a chat completion, streaming the response chunk by chunk
   *
   * @param messages - Chat messages, or a plain string treated as a single user message
   * @param options - Generation options (model, max_tokens, temperature, ...)
   * @returns AsyncGenerator of ChatCompletionChunk objects in OpenAI format
   */
  async chatStream(
    messages: string | ChatMessage[],
    options: TextGenerationOptions = {},
  ): Promise<AsyncGenerator<ChatCompletionChunk, void, unknown>> {
    const body = {
      ...options,
      model: options.model ?? TextModel.GLM_4_6,
      messages: this.normalizeMessages(messages),
      stream: true,
    };

    const response = await withRetry(
      () =>
        this.openStream(`${this.textHost}${Endpoint.CHAT_COMPLETIONS}`, body),
      this.retryConfig,
    );

    return this.parseChatStream(response);
  }

  /**
   * Generate a raw text completion using NovelAI's text models
   *
   * @param prompt - The prompt to continue
   * @param options - Generation options (model, max_tokens, temperature, ...)
   * @returns Promise resolving to a Completion in OpenAI format
   */
  async completion(
    prompt: string,
    options: TextGenerationOptions = {},
  ): Promise<Completion> {
    const body = {
      ...options,
      model: options.model ?? TextModel.GLM_4_6,
      prompt,
      stream: false,
    };
    return this.requestJson(`${this.textHost}${Endpoint.COMPLETIONS}`, body);
  }

  /**
   * List available text generation models
   *
   * @returns Promise resolving to an array of model ids
   */
  async listTextModels(): Promise<string[]> {
    const result = await withRetry(async () => {
      const response = await fetch(
        `${this.textHost}${Endpoint.TEXT_MODELS}`,
        { method: "GET", headers: prepHeaders(this.headers) },
      );
      if (!response.ok) {
        throw await apiErrorFromResponse(response);
      }
      return response.json();
    }, this.retryConfig);

    const data = (result as any)?.data;
    return Array.isArray(data) ? data.map((m: any) => m.id) : [];
  }

  private normalizeMessages(
    messages: string | ChatMessage[],
  ): ChatMessage[] {
    return typeof messages === "string"
      ? [{ role: "user", content: messages }]
      : messages;
  }

  /**
   * Parse an OpenAI-style SSE stream into completion chunks
   */
  private async *parseChatStream(
    response: Response,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const sse = new SSEStream();
    const reader = response.body!.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const event of sse.feed(value)) {
          if (event.data === "[DONE]") return;
          try {
            yield JSON.parse(event.data);
          } catch (error) {
            console.warn("Failed to parse chat stream chunk:", error);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Make a JSON request with timeout, retry and error handling
   */
  private async requestJson<T>(url: string, payload: unknown): Promise<T> {
    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        if (this.verbose) {
          console.debug(`[Request] ${url}`, JSON.stringify(payload));
        }

        const response = await fetch(url, {
          method: "POST",
          headers: prepHeaders(this.headers),
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw await apiErrorFromResponse(response);
        }

        return (await response.json()) as T;
      } catch (error) {
        throw this.handleRequestError(error);
      } finally {
        clearTimeout(timeoutId);
      }
    }, this.retryConfig);
  }
}
