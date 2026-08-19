import { storage } from "edgespark";
import { buckets, generationJobs } from "@defs";

type JsonRecord = Record<string, unknown>;
type CoverJobIdentity = Pick<typeof generationJobs.$inferSelect, "id" | "userId">;

const MAX_COVER_BYTES = 20 * 1024 * 1024;
const COVER_URL_TTL_SECONDS = 6 * 60 * 60;
const CONTENT_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function archivedCoverUris(result: JsonRecord): string[] {
  return stringArray(result.imageUris).filter((uri) => storage.isS3Uri(uri));
}

export function providerCoverUrls(result: JsonRecord): string[] {
  return stringArray(result.imageUrls).filter((url) => /^https:\/\//u.test(url));
}

export async function archiveCoverImages(
  job: CoverJobIdentity,
  imageUrls: string[],
  providerExpiresAt: number | null = null,
): Promise<JsonRecord> {
  const urls = imageUrls.filter((url) => /^https:\/\//u.test(url)).slice(0, 4);
  if (!urls.length) throw new Error("ImageGen did not return a downloadable image");

  const storedPaths: string[] = [];
  const imageUris: string[] = [];
  const imageContentTypes: string[] = [];
  const imageSizeBytes: number[] = [];

  try {
    for (const [index, url] of urls.entries()) {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:") throw new Error("ImageGen returned an unsafe image URL");

      const response = await fetch(parsedUrl, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`ImageGen image download failed (${response.status})`);

      const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const extension = CONTENT_TYPES.get(contentType);
      if (!extension) throw new Error("ImageGen returned an unsupported image format");

      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_COVER_BYTES) throw new Error("ImageGen image is larger than 20MB");
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_COVER_BYTES) throw new Error("ImageGen image file is invalid");

      const path = `users/${job.userId}/covers/${job.id}-${index + 1}.${extension}`;
      await storage.from(buckets.outputs).put(path, bytes, {
        contentType,
        contentDisposition: `attachment; filename="${job.id}-${index + 1}.${extension}"`,
      });
      storedPaths.push(path);
      imageUris.push(storage.createS3Uri(buckets.outputs, path));
      imageContentTypes.push(contentType);
      imageSizeBytes.push(bytes.byteLength);
    }
  } catch (error) {
    if (storedPaths.length) await storage.from(buckets.outputs).delete(storedPaths).catch(() => undefined);
    throw error;
  }

  return {
    imageUris,
    imageContentTypes,
    imageSizeBytes,
    archivedAt: Date.now(),
    providerExpiresAt,
    deliveryStatus: "archived",
  };
}

export async function signArchivedCoverImages(result: JsonRecord): Promise<{
  imageUrls: string[];
  imageUrlExpiresAt: number | null;
}> {
  const signed = await Promise.all(archivedCoverUris(result).map(async (uri) => {
    const parsed = storage.parseS3Uri(uri);
    return storage.from(parsed.bucket).createPresignedGetUrl(parsed.path, COVER_URL_TTL_SECONDS);
  }));
  return {
    imageUrls: signed.map((item) => item.downloadUrl),
    imageUrlExpiresAt: signed.length ? Math.min(...signed.map((item) => item.expiresAt.getTime())) : null,
  };
}
