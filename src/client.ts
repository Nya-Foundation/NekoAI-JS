import JSZip from "jszip";
import {
  HEADERS,
  Host,
  Endpoint,
  DirectorTools,
  EmotionOptions,
  EmotionLevel,
  isV4Model,
} from "./constants";
import { Image, MsgpackEvent, EventType } from "./image";
import {
  DirectorRequest,
  ImageInput,
  Metadata,
  NovelAIOptions,
  NovelAIResponse,
  RetryConfig,
} from "./types";
import {
  calculateCost,
  createFilename,
  handleResponse,
  parseImage,
  prepareMetadataForApi,
  withRetry,
  prepHeaders,
  StreamingMsgpackParser,
  StreamingSSEParser,
  parseStreamEvents,
} from "./utils";
import { metadataProcessor } from "./metadata";

/**
 * NovelAI client for interacting with the NovelAI image generation API
 */
export class NovelAI {
  private token: string;
  private host: Host;
  private timeout: number;
  private retryConfig?: RetryConfig;

  private verbose: boolean = false;
  private headers: Record<string, string>;

  /**
   * Cache of vibe tokens to avoid re-encoding the same images
   * @private
   */
  private vibeCache: Map<string, string> = new Map();

  /**
   * Create a new NovelAI client
   *
   * @param options - Client configuration options
   * @param options.token - NovelAI access token
   * @param options.host - API host to use (default: Host.WEB)
   * @param options.timeout - Request timeout in milliseconds (default: 30000)
   * @param options.retry - Configuration for request retries (default: enabled with 3 retries)
   * @param options.verbose - Whether to log additional information (default: false)
  
   */
  constructor(options: NovelAIOptions) {
    this.token = options.token;
    this.host = options.host || Host.WEB;
    this.timeout = options.timeout || 30000;
    this.retryConfig = options.retry;
    this.verbose = options.verbose || false;

    // Set up default headers
    this.headers = {
      ...HEADERS,
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * Generate images using NovelAI's API
   *
   * @param metadata - Generation parameters
   * @param stream - Whether to stream intermediate steps for V4 models (default: false)
   * @param isOpus - Whether the user has Opus subscription (for cost calculation, default: false)
   * @returns Promise resolving to an array of Image objects or AsyncGenerator of MsgpackEvent objects
   */
  async generateImage(
    metadata: Metadata,
    stream: boolean = false,
    isOpus: boolean = false,
    forceZip: boolean = false,
  ): Promise<Image[] | AsyncGenerator<MsgpackEvent, void, unknown>> {
    // Process and validate the metadata
    const processedMetadata = this.processMetadata(metadata);

    // Calculate and log cost if verbose
    if (this.verbose) {
      const cost = calculateCost(processedMetadata, isOpus);
      console.info(`Generating image... estimated Anlas cost: ${cost}`);
    }

    // Handle vibe transfer for V4 models
    if (processedMetadata.reference_information_extracted_multiple) {
      await this.encodeVibe(processedMetadata);
    }

    // Prepare the API request payload
    const payload = prepareMetadataForApi(processedMetadata);

    return withRetry(async () => {
      const isV4 =
        processedMetadata.model && isV4Model(processedMetadata.model);

      if (isV4 && !forceZip) {
        // V4 models use streaming msgpack endpoint
        return stream
          ? this.streamV4Events(payload)
          : this.processV4Response(payload);
      } else {
        // V3 models use regular ZIP endpoint
        return this.processV3Response(payload);
      }
    }, this.retryConfig);
  }

  /**
   * Makes a request to the NovelAI API with appropriate headers and timeout handling
   *
   * @param url - The endpoint URL to send the request to
   * @param payload - The request payload
   * @returns Promise resolving to the API response
   * @private
   */
  private async makeRequest(
    url: string,
    payload: any,
  ): Promise<NovelAIResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const jsonPayload = JSON.stringify(payload);
    const headers = prepHeaders(this.headers);


    if (this.verbose) {
      let cleanPlayload = { ...payload };
      cleanPlayload.parameters = {
        ...cleanPlayload.parameters,
        image: !!cleanPlayload?.parameters?.image ? ("included with " + cleanPlayload.parameters.image.length + " bytes") : undefined,
        mask: !!cleanPlayload?.parameters?.mask ? ("included with " + cleanPlayload.parameters.mask.length + " bytes") : undefined,
      }
      console.log(`[Headers] for image generation:`, headers);
      console.info(`[Payload] for image generation:`, JSON.stringify(cleanPlayload));
    }

    // process.exit(-1);

    try {
      // Make the API request
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: jsonPayload,
        signal: controller.signal,
      });

      // Handle the response
      const apiResponse = await handleResponse(response);

      return apiResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Process V3 model response (ZIP format)
   *
   * @param payload - The request payload
   * @returns Promise resolving to an array of Image objects
   * @private
   */
  private async processV3Response(payload: any): Promise<Image[]> {
    try {
      const response = await this.makeRequest(
        `${this.host}${Endpoint.IMAGE}`,
        payload,
      );
      return this.extractImagesFromZip(response);
    } catch (error) {
      throw this.handleRequestError(error);
    }
  }

  /**
   * Process V4 model response (msgpack format)
   *
   * @param payload - The request payload
   * @returns Promise resolving to an array of Image objects
   * @private
   */
  private async processV4Response(payload: any): Promise<Image[]> {
    try {
      const response = await this.makeRequest(
        `${this.host}${Endpoint.IMAGE_STREAM}`,
        payload,
      );
      return this.extractImagesFromMsgpack(response);
    } catch (error) {
      throw this.handleRequestError(error);
    }
  }

  /**
   * Extract images from ZIP response (V3 models)
   *
   * @param apiResponse - The API response containing ZIP data
   * @returns Promise resolving to an array of Image objects
   * @private
   */
  private async extractImagesFromZip(
    apiResponse: NovelAIResponse,
  ): Promise<Image[]> {
    const arrayBuffer = await this.getResponseBuffer(apiResponse);
    const zip = await JSZip.loadAsync(arrayBuffer);
    const images: Image[] = [];
    const hostName = this.host.toLowerCase();
    let index = 0;

    for (const filename of Object.keys(zip.files)) {
      const zipObj = zip.files[filename];
      if (!zipObj.dir) {
        const data = await zipObj.async("uint8array");
        const timestamp = this.generateTimestamp();

        images.push(
          new Image({
            filename: `${timestamp}_${hostName}_p${index}.png`,
            data: data,
          }),
        );
        index++;
      }
    }

    return images;
  }

  /**
   * Extract images from msgpack response (V4 models)
   *
   * @param apiResponse - The API response containing msgpack data
   * @returns Promise resolving to an array of Image objects
   * @private
   */
  private async extractImagesFromMsgpack(
    apiResponse: NovelAIResponse,
  ): Promise<Image[]> {
    const arrayBuffer = await this.getResponseBuffer(apiResponse);
    const msgpackData = new Uint8Array(arrayBuffer);

    const events = parseStreamEvents(msgpackData);

    return events
      .filter((event) => event.event_type === EventType.FINAL)
      .map((event) => event.image);
  }

  /**
   * Get response data as ArrayBuffer
   *
   * @param apiResponse - The API response
   * @returns Promise resolving to ArrayBuffer
   * @private
   */
  private async getResponseBuffer(
    apiResponse: NovelAIResponse,
  ): Promise<ArrayBuffer> {
    if (apiResponse.data instanceof ArrayBuffer) {
      return apiResponse.data;
    } else if (apiResponse.data) {
      return await new Response(apiResponse.data).arrayBuffer();
    } else {
      throw new Error("No data received from API");
    }
  }

  /**
   * Generate timestamp for filename
   *
   * @returns Formatted timestamp string
   * @private
   */
  private generateTimestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "_")
      .substring(0, 15);
  }

  /**
   * Handle request errors with proper timeout detection
   *
   * @param error - The error to handle
   * @returns Formatted error
   * @private
   */
  private handleRequestError(error: any): Error {
    if (error.name === "AbortError") {
      return new Error(
        "Request timed out, please try again. If the problem persists, consider setting a higher 'timeout' value when initiating the NovelAI client.",
      );
    }
    return error;
  }

  /**
   * Process and validate metadata before sending to API
   *
   * @param metadata - User-provided metadata
   * @returns Processed metadata object
   */
  private processMetadata(metadata: Metadata): Metadata {
    // Use the metadata processor to handle all processing logic
    return metadataProcessor.processMetadata(metadata);
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
        const response = await this.makeRequest(
          `${this.host}${Endpoint.DIRECTOR}`,
          request,
        );

        if (!response.data) {
          throw new Error("Received empty response from the server.");
        }

        // Try to extract as ZIP first, fallback to raw data
        const arrayBuffer = await this.getResponseBuffer(response);
        let data: Uint8Array;

        try {
          // Director tools return ZIP files, so we can reuse extractImagesFromZip
          const images = await this.extractImagesFromZip(response);
          // Director tools typically return a single image, so take the first one
          data = images[0]?.data || new Uint8Array(arrayBuffer);
        } catch (error) {
          // If ZIP extraction fails, treat as raw image data
          data = new Uint8Array(arrayBuffer);
        }

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
   * Create a director tool request with common parameters
   *
   * @param image - Image input
   * @param reqType - Director tool type
   * @param additionalParams - Additional parameters for the request
   * @returns Promise resolving to an Image object
   * @private
   */
  private async createDirectorRequest(
    image: ImageInput,
    reqType: DirectorTools,
    additionalParams: Record<string, any> = {},
  ): Promise<Image> {
    const parsedImage = await parseImage(image);

    const request: any = {
      req_type: reqType,
      width: parsedImage.width,
      height: parsedImage.height,
      image: parsedImage.base64,
      ...additionalParams,
    };

    return this.useDirectorTool(request);
  }

  /**
   * Convert an image to line art
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @returns Promise resolving to an Image object
   */
  async lineArt(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.LINEART);
  }

  /**
   * Convert an image to sketch
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @returns Promise resolving to an Image object
   */
  async sketch(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.SKETCH);
  }

  /**
   * Remove the background from an image
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @returns Promise resolving to an Image object
   */
  async backgroundRemoval(image: ImageInput): Promise<Image> {
    return this.createDirectorRequest(image, DirectorTools.BACKGROUND_REMOVAL);
  }

  /**
   * Declutter an image (remove noise, distractions, etc.)
   *
   * @param image - Image input (path, Blob, File, URL, etc.)
   * @returns Promise resolving to an Image object
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
   * @returns Promise resolving to an Image object
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
   * @param emotionLevel - Level of emotion change (0-5, optional)
   * @returns Promise resolving to an Image object
   */
  async changeEmotion(
    image: ImageInput,
    emotion: string = EmotionOptions.NEUTRAL,
    prompt: string = "",
    emotionLevel: EmotionLevel = EmotionLevel.NORMAL,
  ): Promise<Image> {
    const finalPrompt = `${emotion};;${prompt}`;
    return this.createDirectorRequest(image, DirectorTools.EMOTION, {
      prompt: finalPrompt,
      defry: emotionLevel ?? EmotionLevel.NORMAL,
    });
  }

  /**
   * Encode images to vibe tokens using the /encode-vibe endpoint
   * Uses caching to avoid unnecessary API calls for previously processed images
   *
   * @param metadata - Metadata object to update with vibe tokens
   * @returns Promise resolving when encoding is complete
   * @private
   */
  private async encodeVibe(metadata: Metadata): Promise<void> {
    // Skip if model is not V4 or no reference images
    if (
      !metadata.model ||
      !isV4Model(metadata.model) ||
      !metadata.reference_image_multiple?.length
    ) {
      return;
    }

    const referenceImageMultiple: string[] = [];

    // Process each reference image
    for (let i = 0; i < metadata.reference_image_multiple.length; i++) {
      const refImage = metadata.reference_image_multiple[i];
      const refInfoExtracted =
        metadata.reference_information_extracted_multiple?.[i] ?? 1.0;

      // Create cache key and check cache
      const imageHash = await this.getImageHash(refImage);
      const cacheKey = `${imageHash}:${refInfoExtracted}:${metadata.model}`;

      let vibeToken = this.vibeCache.get(cacheKey);

      if (!vibeToken) {
        vibeToken = await this.fetchVibeToken(
          refImage,
          refInfoExtracted,
          metadata.model,
        );
        this.vibeCache.set(cacheKey, vibeToken);
      }

      referenceImageMultiple.push(vibeToken);
    }

    // Update metadata
    metadata.reference_image_multiple = referenceImageMultiple;
    metadata.reference_information_extracted_multiple = undefined;
  }

  /**
   * Fetch vibe token from API
   *
   * @param image - Base64 image data
   * @param informationExtracted - Information extraction level
   * @param model - Model being used
   * @returns Promise resolving to vibe token
   * @private
   */
  private async fetchVibeToken(
    image: string,
    informationExtracted: number,
    model: string,
  ): Promise<string> {
    const payload = {
      image,
      information_extracted: informationExtracted,
      model,
    };

    try {
      const response = await this.makeRequest(
        `${this.host}${Endpoint.ENCODE_VIBE}`,
        payload,
      );
      const buffer = await this.getResponseBuffer(response);
      return new TextDecoder().decode(buffer);
    } catch (error) {
      throw this.handleRequestError(error);
    }
  }

  /**
   * Create a hash for an image to use as a cache key
   *
   * @param base64Image - Base64 encoded image data
   * @returns Promise resolving to a hash string
   * @private
   */
  private async getImageHash(base64Image: string): Promise<string> {
    // Handle Node.js environment
    if (typeof window === "undefined") {
      try {
        const crypto = require("crypto");
        const imageBytes = Buffer.from(base64Image, "base64");
        return crypto.createHash("sha256").update(imageBytes).digest("hex");
      } catch (e) {
        throw new Error("Failed to hash image: " + e);
      }
    }
    // Handle browser environment
    else {
      try {
        const imageBytes = atob(base64Image);
        const uint8Array = new Uint8Array(imageBytes.length);
        for (let i = 0; i < imageBytes.length; i++) {
          uint8Array[i] = imageBytes.charCodeAt(i);
        }

        const hashBuffer = await crypto.subtle.digest("SHA-256", uint8Array);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (e) {
        throw new Error("Failed to hash image: " + e);
      }
    }
  }

  /**
   * Stream V4 events in real-time as they arrive from the server
   *
   * @param payload - The request payload
   * @returns AsyncGenerator yielding MsgpackEvent objects in real-time
   * @private
   */
  private async *streamV4Events(
    payload: any,
  ): AsyncGenerator<MsgpackEvent, void, unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const jsonPayload = JSON.stringify(payload);
    const headers = prepHeaders(this.headers);


    if (this.verbose) {
      console.log(`[Headers] for image generation:`, headers);
      console.info(`[Payload] for image generation:`, jsonPayload);
    }

    try {
      // Make the API request with streaming
      const response = await fetch(`${this.host}${Endpoint.IMAGE_STREAM}`, {
        method: "POST",
        headers: headers,
        body: jsonPayload,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP Error: ${response.status} ${response.statusText}`,
        );
      }

      if (!response.body) {
        throw new Error("No response body available for streaming");
      }

      console.log(`[Streaming] Started processing V4 events for action: ${payload.action}`);
      // Create a streaming msgpack parser
      const parser = payload.action === "infill" ? new StreamingSSEParser() : new StreamingMsgpackParser();

      // Process chunks as they arrive
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Feed chunk to parser and yield any complete events
          for await (const event of parser.feedChunk(value)) {
            yield event;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

}
