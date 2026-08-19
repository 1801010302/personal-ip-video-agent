const textEncoder = new TextEncoder();

export interface AliyunOssCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface AliyunOssConfig extends AliyunOssCredentials {
  bucket: string;
  region: string;
}

interface PresignOptions extends AliyunOssConfig {
  method: "GET" | "PUT" | "HEAD";
  objectKey: string;
  expiresInSeconds: number;
  contentType?: string;
}

const OSS_URI_PREFIX = "oss://";

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeObjectPath(objectKey: string) {
  return objectKey.split("/").map(encodeRfc3986).join("/");
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(value));
}

function formatSigningTime(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalQuery(parameters: Record<string, string>) {
  return Object.entries(parameters)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** Generate an OSS V4 URL without exposing the AccessKey pair to the browser. */
export async function createAliyunOssPresignedUrl(options: PresignOptions) {
  const expiresInSeconds = Math.min(7 * 24 * 60 * 60, Math.max(1, Math.round(options.expiresInSeconds)));
  const now = new Date();
  const dateTime = formatSigningTime(now);
  const date = dateTime.slice(0, 8);
  const host = `${options.bucket}.oss-${options.region}.aliyuncs.com`;
  const credentialScope = `${date}/${options.region}/oss/aliyun_v4_request`;
  const query: Record<string, string> = {
    "x-oss-additional-headers": "host",
    "x-oss-credential": `${options.accessKeyId}/${credentialScope}`,
    "x-oss-date": dateTime,
    "x-oss-expires": String(expiresInSeconds),
    "x-oss-signature-version": "OSS4-HMAC-SHA256",
  };
  const headers: Record<string, string> = { host };
  if (options.contentType) headers["content-type"] = options.contentType;
  const canonicalHeaders = Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join("");
  const canonicalRequest = [
    options.method,
    encodeRfc3986(`/${options.bucket}/${options.objectKey}`).replace(/%2F/g, "/"),
    canonicalQuery(query),
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "OSS4-HMAC-SHA256",
    dateTime,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(textEncoder.encode(`aliyun_v4${options.accessKeySecret}`), date);
  const regionKey = await hmac(dateKey, options.region);
  const serviceKey = await hmac(regionKey, "oss");
  const signingKey = await hmac(serviceKey, "aliyun_v4_request");
  query["x-oss-signature"] = bytesToHex(await hmac(signingKey, stringToSign));
  return `https://${host}/${encodeObjectPath(options.objectKey)}?${canonicalQuery(query)}`;
}

export function createAliyunOssUri(bucket: string, objectKey: string) {
  return `${OSS_URI_PREFIX}${bucket}/${objectKey}`;
}

export function parseAliyunOssUri(value: string) {
  if (!value.startsWith(OSS_URI_PREFIX)) return null;
  const remainder = value.slice(OSS_URI_PREFIX.length);
  const separator = remainder.indexOf("/");
  if (separator <= 0 || separator === remainder.length - 1) return null;
  return { bucket: remainder.slice(0, separator), objectKey: remainder.slice(separator + 1) };
}
