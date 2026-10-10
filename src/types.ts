import {
  Action,
  Controlnet,
  Host,
  Model,
  Noise,
  Resolution,
  Sampler,
} from "./constants";

/**
 * Opus image-generation usage battery from GET /user/subscription
 */
export interface OpusUsage {
  percent: number;
  isNegative: boolean;
  timeUntilNextPercent: number;
}

/**
 * Account subscription payload from GET /user/subscription
 */
export interface NovelAISubscription {
  tier: number;
  active: boolean;
  usage?: OpusUsage;
  [key: string]: unknown;
}

/**
 * Configuration for API request retries
 */
export interface RetryConfig {
  /**
   * Whether to enable retry for failed requests
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Base delay between retries in milliseconds
   * Will be used with exponential backoff
   * @default 1000 (1 second)
   */
  baseDelay?: number;

  /**
   * Maximum delay between retries in milliseconds
   * @default 30000 (30 seconds)
   */
  maxDelay?: number;

  /**
   * HTTP status codes that should trigger a retry
   * @default [429, 500, 502, 503, 504]
   */
  retryStatusCodes?: number[];
}

// Character prompts types
export interface PositionCoords {
  x: number;
  y: number;
}

/**
 * Flexible image input types
 * This allows images to be passed in various formats for cross-platform compatibility
 */
export type ImageInput =
  | string // Path (Node.js), Data URL, remote URL, or raw base64
  | Blob // Browser native Blob
  | File // Browser File API
  | ArrayBuffer // Raw binary data
  | Uint8Array // Raw binary data
  | { data: Uint8Array } // Internal format (e.g. a generated Image)
  | { url: string } // Remote URL
  | HTMLImageElement // Browser DOM Image element
  | HTMLCanvasElement; // Browser Canvas element

/**
 * Result from parsing an image
 */
export interface ParsedImage {
  width: number;
  height: number;
  base64: string;
}

/**
 * Character caption for V4 prompts
 */
export interface CharacterCaption {
  char_caption: string;
  centers: PositionCoords[];
}

/**
 * Character prompt for V4/V4.5 multi-character generation
 */
export interface CharacterPrompt {
  prompt: string;
  uc?: string;
  center?: PositionCoords;
  enabled?: boolean;
}

/**
 * V4 caption format for prompts
 */
export interface V4CaptionFormat {
  base_caption: string;
  char_captions: CharacterCaption[];
}

/**
 * V4 prompt format with multi-character support
 */
export interface V4PromptFormat {
  caption: V4CaptionFormat;
  use_coords: boolean;
  use_order: boolean;
}

/**
 * V4 format for negative prompts
 */
export interface V4NegativePromptFormat {
  caption: V4CaptionFormat;
  legacy_uc: boolean;
}

/**
 * Condition input used by director reference (character reference) parameters
 */
export interface V4ConditionInput {
  caption: V4CaptionFormat;
  legacy_uc?: boolean;
  use_coords?: boolean;
  use_order?: boolean;
}

/**
 * img2img sub-object sent alongside V4.5 inpainting when the
 * inpaint img2img strength is below 1
 */
export interface V4Img2Img {
  strength: number;
  color_correct: boolean;
}

// Core metadata
export interface Metadata {
  // General parameters
  prompt?: string;
  model?: Model;
  action?: Action;
  resPreset?: Resolution;

  // Prompt settings
  negative_prompt?: string;
  qualityToggle?: boolean;
  ucPreset?: 0 | 1 | 2 | 3;
  /**
   * Client-side control: when false, skip comma-separated tag deduplication.
   * Stripped before the API request.
   */
  deduplicate_tags?: boolean;

  // Image settings
  width?: number;
  height?: number;
  n_samples?: number;

  // AI settings
  steps?: number;
  scale?: number;
  dynamic_thresholding?: boolean;
  seed?: number;
  extra_noise_seed?: number;
  sampler?: Sampler;
  sm?: boolean;
  sm_dyn?: boolean;
  cfg_rescale?: number;
  noise_schedule?: Noise;

  // img2img settings
  /** Source image. Accepts any ImageInput (path, Blob, URL, raw base64, ...) */
  image?: ImageInput;
  strength?: number;
  img2img?: V4Img2Img;
  noise?: number;
  controlnet_strength?: number;
  controlnet_condition?: string;
  controlnet_model?: Controlnet;

  // Inpaint settings
  add_original_image?: boolean;
  /** Inpainting mask (white = repaint). Accepts any ImageInput */
  mask?: ImageInput;

  // Vibe Transfer settings
  /** Reference images for vibe transfer. Accept any ImageInput; V4 models encode them into vibe tokens automatically */
  reference_image_multiple?: ImageInput[];
  reference_information_extracted_multiple?: number[];
  reference_strength_multiple?: number[];

  // Director reference (character reference / precise reference, V4.5)
  /** Reference images. For character reference: 1024x1536, 1536x1024 or 1472x1472 with black padding */
  director_reference_images?: ImageInput[];
  /** For character reference: set caption.base_caption to "character" or "character&style" */
  director_reference_descriptions?: V4ConditionInput[];
  /** 0-1 per reference image */
  director_reference_information_extracted?: number[];
  /** 0-1 per reference image */
  director_reference_strength_values?: number[];
  /** Fidelity slider (0-1) per reference image */
  director_reference_secondary_strength_values?: number[];

  // V4/V4.5/V5 specific settings
  params_version?: 1 | 2 | 3 | 4;
  autoSmea?: boolean;
  characterPrompts?: CharacterPrompt[];
  v4_prompt?: V4PromptFormat;
  v4_negative_prompt?: V4NegativePromptFormat;
  skip_cfg_above_sigma?: number | null;
  use_coords?: boolean;
  legacy_uc?: boolean;
  normalize_reference_strength_multiple?: boolean;
  deliberate_euler_ancestral_bug?: boolean;
  prefer_brownian?: boolean;

  // V4.5 specific settings
  /** Sent to the API as inpaint_img2img_strength (default 1) */
  inpaintImg2ImgStrength?: number;

  // V5 optional request fields (pass-through; omit when undefined)
  /** Max Enhance: keep source WxH and set true instead of numeric scale-up. */
  upscaled_enhance?: boolean;
  /** Straight alpha channel for transparent V5 outputs. */
  straight_alpha?: boolean | null;
  /** String quality preset id when the client sends preset hints (e.g. "standard"). */
  qualityPresetId?: string;
  /** String UC preset id when the client sends preset hints (e.g. "heavy"). */
  ucPresetId?: string;
  /** Numeric encoding of qualityPresetId (0=none …). */
  tag_hint_qt?: number;
  /** Numeric encoding of ucPresetId. */
  tag_hint_uc_preset?: number;
  /** True when transparent-background mode is requested on V5. */
  tag_hint_transparent_background?: boolean;

  // Misc settings
  color_correct?: boolean;
  image_format?: string;
  legacy?: boolean;
  legacy_v3_extend?: boolean;

  stream?: string | null;
}

// Image related types
export interface ImageOptions {
  filename: string;
  data: Uint8Array;
}

// Director Tools options

export interface DirectorRequestBase {
  req_type: string;
  width: number;
  height: number;
  image: string;
}

export interface LineArtRequest extends DirectorRequestBase {
  req_type: "lineart";
}

export interface SketchRequest extends DirectorRequestBase {
  req_type: "sketch";
}

export interface BackgroundRemovalRequest extends DirectorRequestBase {
  req_type: "bg-removal";
}

export interface DeclutterRequest extends DirectorRequestBase {
  req_type: "declutter";
}

export interface ColorizeRequest extends DirectorRequestBase {
  req_type: "colorize";
  prompt: string;
  defry: number;
}

export interface EmotionRequest extends DirectorRequestBase {
  req_type: "emotion";
  prompt: string;
  defry: number;
}

export type DirectorRequest =
  | LineArtRequest
  | SketchRequest
  | BackgroundRemovalRequest
  | DeclutterRequest
  | ColorizeRequest
  | EmotionRequest;

export interface NovelAIOptions {
  token: string;
  host?: Host | string;
  /** Host used for text generation endpoints (default: Host.TEXT) */
  textHost?: Host | string;
  /**
   * Request timeout in milliseconds. Covers the time until the API responds
   * (for image generation that includes the generation itself).
   * @default 120000
   */
  timeout?: number;
  retry?: RetryConfig;
  verbose?: boolean;
}

// API response types
export interface NovelAIResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  data: ArrayBuffer | ReadableStream<Uint8Array> | null;
}

/**
 * Options for the enhance() convenience method — img2img re-generation at a
 * scaled-up resolution, mirroring the web UI's Enhance feature.
 */
export type EnhanceOptions = Omit<
  Metadata,
  "image" | "action" | "width" | "height"
> & {
  /** Target resolution multiplier relative to the source image (default: 1.5) */
  upscaleFactor?: number;
};

// Tag suggestion types
export interface TagSuggestion {
  tag: string;
  confidence?: number;
  count?: number;
}

// ---- Text generation (OpenAI-compatible endpoints) ----

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * Options for text generation via the OpenAI-compatible endpoints.
 * Unknown keys are passed through to the API untouched.
 */
export interface TextGenerationOptions {
  /** Model id (default: TextModel.ERATO) */
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  logit_bias?: Record<string, number>;
  n?: number;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface Completion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: { index: number; text: string; finish_reason: string | null }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
