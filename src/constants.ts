export const HEADERS = {
  "Content-Type": "application/json",
  Accept: "*/*",
  Origin: "https://novelai.net",
  Referer: "https://novelai.net",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0",
};

export enum Host {
  WEB = "https://image.novelai.net",
  API = "https://api.novelai.net",
  TEXT = "https://text.novelai.net",
}

export enum Endpoint {
  SUBSCRIPTION = "/user/subscription",
  IMAGE = "/ai/generate-image",
  IMAGE_STREAM = "/ai/generate-image-stream",
  DIRECTOR = "/ai/augment-image",
  ENCODE_VIBE = "/ai/encode-vibe",
  SUGGEST_TAGS = "/ai/generate-image/suggest-tags",
  UPSCALE = "/ai/upscale",
  CHAT_COMPLETIONS = "/oa/v1/chat/completions",
  COMPLETIONS = "/oa/v1/completions",
  TEXT_MODELS = "/oa/v1/models",
}

export enum Model {
  // NAI V3
  V3 = "nai-diffusion-3",
  V3_INP = "nai-diffusion-3-inpainting",
  // NAI V4 Full
  V4 = "nai-diffusion-4-full",
  V4_INP = "nai-diffusion-4-full-inpainting",
  // NAI V4 Curated
  V4_CUR = "nai-diffusion-4-curated-preview",
  V4_CUR_INP = "nai-diffusion-4-curated-inpainting",
  // NAI V4.5 Full
  V4_5 = "nai-diffusion-4-5-full",
  V4_5_INP = "nai-diffusion-4-5-full-inpainting",
  // NAI V4.5 Curated
  V4_5_CUR = "nai-diffusion-4-5-curated",
  V4_5_CUR_INP = "nai-diffusion-4-5-curated-inpainting",
  // NAI V5 Full
  V5 = "nai-diffusion-5-full",
  V5_INP = "nai-diffusion-5-full-inpainting",
  // NAI V5 Full medium effort (distilled, 14 steps)
  V5_MED = "nai-diffusion-5-full-medium",
  V5_MED_INP = "nai-diffusion-5-full-medium-inpainting",
  // NAI V5 Curated
  V5_CUR = "nai-diffusion-5-curated",
  V5_CUR_INP = "nai-diffusion-5-curated-inpainting",
  // Furry model beta v1.3
  FURRY = "nai-diffusion-furry-3",
  FURRY_INP = "nai-diffusion-furry-3-inpainting",
}

const V4_MODELS: ReadonlySet<Model> = new Set([
  Model.V4,
  Model.V4_INP,
  Model.V4_CUR,
  Model.V4_CUR_INP,
  Model.V4_5,
  Model.V4_5_INP,
  Model.V4_5_CUR,
  Model.V4_5_CUR_INP,
]);

const V5_MODELS: ReadonlySet<Model> = new Set([
  Model.V5,
  Model.V5_INP,
  Model.V5_MED,
  Model.V5_MED_INP,
  Model.V5_CUR,
  Model.V5_CUR_INP,
]);

export function isV4Model(model: Model): boolean {
  return V4_MODELS.has(model);
}

/** NovelAI Diffusion V5 Full / Curated (and inpaint variants). */
export function isV5Family(model: Model): boolean {
  return V5_MODELS.has(model);
}

/** Distilled V5 Full effort. Steps, sampler, UC, and CFG rescale are fixed. */
export function isV5MediumEffort(model: Model | string | undefined): boolean {
  return model === Model.V5_MED || model === Model.V5_MED_INP;
}

/**
 * Models that use the v4_prompt / msgpack stream generate path
 * (V4, V4.5, and V5).
 */
export function usesV4PromptEnvelope(model: Model): boolean {
  return isV4Model(model) || isV5Family(model);
}

/**
 * Text generation models available through the OpenAI-compatible endpoints
 * on https://text.novelai.net (use client.listTextModels() for the live list)
 */
export enum TextModel {
  GLM_4_6 = "glm-4-6",
  XIALONG = "xialong-v1",
}

export enum Controlnet {
  PALETTESWAP = "hed",
  FORMLOCK = "midas",
  SCRIBBLER = "fake_scribble",
  BUILDINGCONTROL = "mlsd",
  LANDSCAPER = "uniformer",
}

export enum Action {
  GENERATE = "generate",
  INPAINT = "infill",
  IMG2IMG = "img2img",
}

export enum DirectorTools {
  LINEART = "lineart",
  SKETCH = "sketch",
  BACKGROUND_REMOVAL = "bg-removal",
  EMOTION = "emotion",
  DECLUTTER = "declutter",
  COLORIZE = "colorize",
}

export enum EmotionOptions {
  NEUTRAL = "neutral",
  HAPPY = "happy",
  SAD = "sad",
  ANGRY = "angry",
  SCARED = "scared",
  SURPRISED = "surprised",
  TIRED = "tired",
  EXCITED = "excited",
  NERVOUS = "nervous",
  THINKING = "thinking",
  CONFUSED = "confused",
  SHY = "shy",
  DISGUSTED = "disgusted",
  SMUG = "smug",
  BORED = "bored",
  LAUGHING = "laughing",
  IRRITATED = "irritated",
  AROUSED = "aroused",
  EMBARRASSED = "embarrassed",
  WORRIED = "worried",
  LOVE = "love",
  DETERMINED = "determined",
  HURT = "hurt",
  PLAYFUL = "playful",
}

export enum EmotionLevel {
  NORMAL = 0,
  SLIGHTLY_WEAK = 1,
  WEAK = 2,
  EVEN_WEAKER = 3,
  VERY_WEAK = 4,
  WEAKEST = 5,
}

export enum Resolution {
  SMALL_PORTRAIT = "small_portrait",
  SMALL_LANDSCAPE = "small_landscape",
  SMALL_SQUARE = "small_square",
  NORMAL_PORTRAIT = "normal_portrait",
  NORMAL_LANDSCAPE = "normal_landscape",
  NORMAL_SQUARE = "normal_square",
  LARGE_PORTRAIT = "large_portrait",
  LARGE_LANDSCAPE = "large_landscape",
  LARGE_SQUARE = "large_square",
  WALLPAPER_PORTRAIT = "wallpaper_portrait",
  WALLPAPER_LANDSCAPE = "wallpaper_landscape",
}

export const RESOLUTION_DIMENSIONS: Record<Resolution, [number, number]> = {
  [Resolution.SMALL_PORTRAIT]: [512, 768],
  [Resolution.SMALL_LANDSCAPE]: [768, 512],
  [Resolution.SMALL_SQUARE]: [640, 640],
  [Resolution.NORMAL_PORTRAIT]: [832, 1216],
  [Resolution.NORMAL_LANDSCAPE]: [1216, 832],
  [Resolution.NORMAL_SQUARE]: [1024, 1024],
  [Resolution.LARGE_PORTRAIT]: [1024, 1536],
  [Resolution.LARGE_LANDSCAPE]: [1536, 1024],
  [Resolution.LARGE_SQUARE]: [1472, 1472],
  [Resolution.WALLPAPER_PORTRAIT]: [1088, 1920],
  [Resolution.WALLPAPER_LANDSCAPE]: [1920, 1088],
};

export enum Sampler {
  EULER = "k_euler",
  EULER_ANC = "k_euler_ancestral",
  DPM2S_ANC = "k_dpmpp_2s_ancestral",
  DPM2M = "k_dpmpp_2m",
  DPMSDE = "k_dpmpp_sde",
  DPM2MSDE = "k_dpmpp_2m_sde",
  DDIM = "ddim_v3",
}

export enum Noise {
  NATIVE = "native",
  KARRAS = "karras",
  EXPONENTIAL = "exponential",
  POLYEXPONENTIAL = "polyexponential",
}
