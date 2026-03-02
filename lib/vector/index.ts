import { createChromaProvider } from "./providers/chroma";
import { createCloudProvider } from "./providers/cloud";
import type { VectorAdapter, VectorProvider, VectorRuntimeConfig } from "./types";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  return value;
};

const getProviderFromEnv = (): VectorProvider => {
  const value = process.env.VECTOR_PROVIDER ?? "chroma";
  if (value !== "cloud" && value !== "chroma") {
    throw new Error("VECTOR_PROVIDER must be either 'cloud' or 'chroma'");
  }
  return value;
};

export const getVectorRuntimeConfig = (): VectorRuntimeConfig => {
  const provider = getProviderFromEnv();
  return {
    provider,
    embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    topK: Number(process.env.VECTOR_TOP_K ?? 8),
    namespacePrefix: process.env.VECTOR_NAMESPACE_PREFIX ?? "research-job",
  };
};

export const validateVectorConfig = (): VectorRuntimeConfig => {
  const config = getVectorRuntimeConfig();
  if (!Number.isFinite(config.topK) || config.topK <= 0) {
    throw new Error("VECTOR_TOP_K must be a positive number");
  }

  if (config.provider === "chroma") {
    requireEnv("CHROMA_COLLECTION");
    const chromaUrl = optionalEnv("CHROMA_URL");
    if (!chromaUrl) {
      requireEnv("CHROMA_API_KEY");
      requireEnv("CHROMA_TENANT");
      requireEnv("CHROMA_DATABASE");
    }
  } else {
    requireEnv("CLOUD_VECTOR_URL");
    requireEnv("CLOUD_VECTOR_INDEX");
    requireEnv("CLOUD_VECTOR_API_KEY");
  }

  return config;
};

export const namespaceForJob = (jobId: string): string => {
  const config = getVectorRuntimeConfig();
  return `${config.namespacePrefix}:${jobId}`;
};

let providerInstance: VectorAdapter | null = null;

export const getVectorProvider = (): VectorAdapter => {
  const config = validateVectorConfig();

  if (providerInstance && providerInstance.provider === config.provider) {
    return providerInstance;
  }

  if (config.provider === "chroma") {
    providerInstance = createChromaProvider({
      url: optionalEnv("CHROMA_URL"),
      apiKey: optionalEnv("CHROMA_API_KEY"),
      tenant: optionalEnv("CHROMA_TENANT"),
      database: optionalEnv("CHROMA_DATABASE"),
      collection: requireEnv("CHROMA_COLLECTION"),
    });
    return providerInstance;
  }

  providerInstance = createCloudProvider({
    baseUrl: requireEnv("CLOUD_VECTOR_URL"),
    index: requireEnv("CLOUD_VECTOR_INDEX"),
    apiKey: requireEnv("CLOUD_VECTOR_API_KEY"),
  });
  return providerInstance;
};
