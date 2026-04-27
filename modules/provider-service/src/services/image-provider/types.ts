export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageBackground = 'auto' | 'opaque';

export type ImageDataInput = string | {
  data?: string;
  data_url?: string;
  b64_json?: string;
  mime_type?: string;
  filename?: string;
};

export type ImageProviderOptions = {
  model?: string;
  prompt: string;
  size?: string;
  quality?: ImageQuality;
  format?: ImageOutputFormat;
  output_compression?: number;
  background?: ImageBackground | 'transparent';
  n?: number;
};

export type ImageGenerateRequest = ImageProviderOptions;

export type ImageEditRequest = ImageProviderOptions & {
  image?: ImageDataInput | ImageDataInput[];
  images?: ImageDataInput[];
  mask?: ImageDataInput;
};

export type NormalizedImageFile = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  bytes: number;
};

export type NormalizedImageOptions = {
  model: 'gpt-image-2';
  prompt: string;
  size: string;
  quality: ImageQuality;
  format: ImageOutputFormat;
  background?: ImageBackground;
  output_compression?: number;
  n?: number;
};

export type NormalizedImageResult = {
  data_url?: string;
  url?: string;
  mime_type: string;
  format: ImageOutputFormat;
  revised_prompt?: string;
  bytes_estimate?: number;
};

export type ImageProviderResult = {
  model: 'gpt-image-2';
  images: NormalizedImageResult[];
  usage?: unknown;
};
