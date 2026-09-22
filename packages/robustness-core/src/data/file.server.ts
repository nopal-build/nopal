import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ObjectCannedACL,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import sharp from "sharp";

// S3_ENDPOINT        – full endpoint URL for the S3 client
//                      local:  http://minio:9000  (internal Docker service name)
//                      prod:   https://fly.storage.tigris.dev
//
// S3_PUBLIC_HOSTNAME – hostname (+ optional port) used to build public file URLs
//                      local:  localhost:9000      (reachable from the browser)
//                      prod:   fly.storage.tigris.dev
//
// S3_FORCE_PATH_STYLE – set to "true" for MinIO; omit or set "false" for Tigris
//                       controls both the S3 client addressing style and the
//                       shape of the returned public URL

const AWS_REGION = "auto";

function getPublicFileUrl(filename: string): string {
  const hostname = process.env.S3_PUBLIC_HOSTNAME!;
  const bucket = process.env.BUCKET_NAME!;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

  if (forcePathStyle) {
    // Path-style: http(s)://hostname/bucket/filename
    const protocol =
      hostname.startsWith("localhost") || hostname.startsWith("127.")
        ? "http"
        : "https";
    return `${protocol}://${hostname}/${bucket}/${filename}`;
  }

  // Virtual-hosted style: https://bucket.hostname/filename  (Tigris default)
  return `https://${bucket}.${hostname}/${filename}`;
}

function createS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: AWS_REGION,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    // AWS SDK v3 >=3.721 adds CRC32 checksums to every PutObject by default.
    // For presigned URLs the checksum value gets baked into the signed query
    // string, but the browser fetch() won't send the matching header — causing
    // a SignatureDoesNotMatch error whose error response lacks CORS headers,
    // which the browser then (misleadingly) surfaces as a CORS error.
    // Setting both options to "when_required" restores the pre-3.721 behaviour.
    requestChecksumCalculation: "when_required",
    responseChecksumValidation: "when_required",
  } as unknown as S3ClientConfig);
}

/**
 * S3 client for generating *presigned URLs the browser will fetch*.
 *
 * The Host header is part of the SigV4 signature, so presigned URLs must be
 * signed against the endpoint the BROWSER reaches — not the server-side
 * endpoint. Locally these differ: the app talks to MinIO at
 * `http://minio:9000` (Docker service name) while the browser can only reach
 * `localhost:9000`. Rewriting the hostname after signing would invalidate
 * the signature, so we sign with the public endpoint from the start.
 *
 * In production (Tigris) `S3_PUBLIC_HOSTNAME` matches the endpoint host, so
 * this is equivalent to `createS3Client`. Falls back to the server endpoint
 * when `S3_PUBLIC_HOSTNAME` is unset.
 *
 * Only use this for presigning; actual server-side operations
 * (`client.send(...)`) must keep using `createS3Client`.
 */
function createPresignS3Client(): S3Client {
  const hostname = process.env.S3_PUBLIC_HOSTNAME;
  if (!hostname) return createS3Client();

  const protocol =
    hostname.startsWith("localhost") || hostname.startsWith("127.")
      ? "http"
      : "https";

  return new S3Client({
    endpoint: `${protocol}://${hostname}`,
    region: AWS_REGION,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    // Same checksum reasoning as createS3Client above.
    requestChecksumCalculation: "when_required",
    responseChecksumValidation: "when_required",
  } as unknown as S3ClientConfig);
}

/**
 * Generate a short-lived presigned PUT URL so the browser can upload a file
 * directly to S3 without routing the bytes through the server.
 *
 * @param filename  The S3 key (e.g. "daily-log/user123/1234567890-video.mp4")
 * @param contentType  MIME type of the file being uploaded
 * @param expiresIn  Seconds until the URL expires (default: 300 = 5 minutes)
 * @returns { presignedUrl, publicUrl }
 */
export async function getPresignedUploadUrl(
  filename: string,
  contentType: string,
  expiresIn = 300,
): Promise<{ presignedUrl: string; publicUrl: string }> {
  const client = createPresignS3Client();

  // No ACL — private by default. This URL is only ever meant to be used
  // as-is by the uploading user; everyone else (including the uploader,
  // later) must go through a presigned GET (see getPresignedViewUrl /
  // getPresignedDownloadUrl), which enforces ownership server-side. See
  // `uploadFileToS3` below for the same rule on server-side uploads.
  const putCommand = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: filename,
    ContentType: contentType,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const presignedUrl = await getSignedUrl(client as any, putCommand, {
    expiresIn,
  });
  const publicUrl = getPublicFileUrl(filename);

  return { presignedUrl, publicUrl };
}

/**
 * Generate a short-lived presigned GET URL that forces a file download.
 * The URL includes `Content-Disposition: attachment` so the browser saves
 * the file rather than opening it inline, even for cross-origin requests.
 *
 * @param s3Key     The S3 key of the object to download
 * @param filename  The suggested save-as filename
 * @param expiresIn Seconds until the URL expires (default: 300 = 5 minutes)
 */
export async function getPresignedDownloadUrl(
  s3Key: string,
  filename: string,
  expiresIn = 300,
): Promise<string> {
  const client = createPresignS3Client();
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(client as any, cmd, { expiresIn });
}

/**
 * Generate a short-lived presigned GET URL for *inline* viewing (no
 * `Content-Disposition: attachment`) — suitable for `<img src>` or opening
 * a file in a new tab. Used by `/api/vault/view/:fileId`, which wraps this
 * in an ownership check and a redirect so the rest of the app can just link
 * to a stable, same-origin URL instead of handling S3 URLs directly.
 *
 * `contentType`, when given, is what the browser is told the bytes are
 * (`ResponseContentType`, a GetObject response override S3 signs into the
 * URL). The object's own stored Content-Type is whatever the upload path
 * guessed at the time, and `getFileContentType` below did not know `.mov`
 * until 2026-09-22, so a video could sit in the bucket as
 * `application/octet-stream`: a `<video>` given that plus `nosniff` shows
 * 0:00 and never plays. The `file_refs` row knows the real type, so the
 * caller passes it and the bytes in the bucket are left alone.
 *
 * @param s3Key       The S3 key of the object to view
 * @param expiresIn   Seconds until the URL expires (default: 900 = 15 minutes)
 * @param contentType The Content-Type the response should carry, if known
 */
export async function getPresignedViewUrl(
  s3Key: string,
  expiresIn = 900,
  contentType?: string,
): Promise<string> {
  const client = createPresignS3Client();
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
    ...(contentType ? { ResponseContentType: contentType } : {}),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(client as any, cmd, { expiresIn });
}

/**
 * Reads an object's raw bytes directly through the S3 SDK, in-process —
 * unlike every other read path here (`getPresignedViewUrl`/
 * `getPresignedDownloadUrl`), which hand the browser a presigned URL to
 * fetch itself. Used by `syncKnowledge.server.ts` to feed an image's
 * actual bytes to a vision-capable LLM call happening server-side, where
 * a redirect makes no sense.
 */
/** Whether an object is in the bucket. A 404 is `false`; anything else
 * (no credentials, a network fault) is thrown, so a caller never mistakes
 * an outage for "not made yet" and regenerates on every request. */
export async function objectExists(s3Key: string): Promise<boolean> {
  const client = createS3Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: s3Key }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw err;
  }
}

export async function downloadFileBytes(s3Key: string): Promise<Buffer> {
  const client = createS3Client();
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
  });
  const response = await client.send(cmd);
  const bytes = await response.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

const RANGE_CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Reads an S3 object via small, fixed-size HTTP Range requests (8MB each)
 * rather than one open-ended GetObjectCommand covering the whole object.
 *
 * This exists because the plain "whole-object" streaming response Body
 * from the AWS SDK was measured, while diagnosing a real production OOM,
 * to NOT reliably bound memory the way a genuine incremental stream
 * should -- a synthetic, well-behaved pull-based Readable kept archiver's
 * own memory flat regardless of total size, but the SDK's own open-ended
 * GetObjectCommand response stream did not behave the same way. Explicitly
 * bounding every individual REQUEST's own response size via Range sidesteps
 * that uncertainty entirely, regardless of the SDK/runtime/network's
 * internal streaming behavior for an open-ended request -- each chunk is
 * a brand new, small, self-contained HTTP response.
 */
class S3RangeReadStream extends Readable {
  private position = 0;
  private totalSize: number | null = null;
  private reading = false;

  constructor(
    private client: S3Client,
    private bucket: string | undefined,
    private key: string,
  ) {
    super();
  }

  async _read(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      if (this.totalSize !== null && this.position >= this.totalSize) {
        this.push(null);
        return;
      }
      const end = this.position + RANGE_CHUNK_SIZE - 1;
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key,
          Range: `bytes=${this.position}-${end}`,
        }),
      );
      if (this.totalSize === null) {
        const match = res.ContentRange?.match(/\/(\d+)$/);
        this.totalSize = match ? parseInt(match[1], 10) : null;
      }
      const bytes = await res.Body!.transformToByteArray();
      this.position += bytes.length;
      if (bytes.length === 0) {
        this.push(null);
        return;
      }
      this.push(Buffer.from(bytes));
    } catch (err) {
      this.destroy(err as Error);
    } finally {
      this.reading = false;
    }
  }
}

/**
 * Streaming counterpart to downloadFileBytes -- returns the object as a
 * Node.js Readable that internally fetches it in small Range-bounded
 * chunks (see S3RangeReadStream above), instead of buffering the whole
 * thing into memory first. Used by publicZip.server.ts and the public
 * single-file share route to feed a file's bytes onward (into a zip
 * archive, or straight through as an HTTP response body) without ever
 * holding a whole large file (some vault files are large photos) in
 * memory at once.
 */
export async function downloadFileStream(s3Key: string): Promise<Readable> {
  const client = createS3Client();
  return new S3RangeReadStream(client, process.env.BUCKET_NAME, s3Key);
}

/**
 * Resizes an image DOWN to fit within `maxDimension` on its longer side
 * (never upscales — `withoutEnlargement`) and re-encodes as WebP, for use
 * as a lightweight gallery thumbnail. The original bytes/format are always
 * left untouched in S3; this is generated on demand by the thumbnail route
 * and never persisted, so a caller must supply its own caching (the public
 * gallery does this with a long-lived, `updated_at`-fingerprinted URL — see
 * `api.vault.public-thumb.$fileId.tsx`).
 *
 * Cropping is deliberately NOT done here — the caller's CSS already
 * handles that (`object-fit: cover` on a fixed-aspect-ratio box), so this
 * only needs to shrink file size/dimensions, not decide what to cut off.
 *
 * Animated (multi-frame) GIF/WebP/PNG is passed through as raw bytes
 * unchanged — sharp's default single-frame read would silently flatten the
 * animation to its first frame, which is worse than serving the original
 * at full size.
 */
export async function getImageThumbnail(
  bytes: Buffer,
  maxDimension = 480,
): Promise<{ bytes: Buffer; contentType: string }> {
  const metadata = await sharp(bytes).metadata();

  // Animated (multi-frame) GIF/WebP/PNG passed through unchanged — sharp's
  // default single-frame read would flatten the animation to its first
  // frame, which is worse than just serving the original at full size.
  if ((metadata.pages ?? 1) > 1) {
    return {
      bytes,
      contentType: metadata.format
        ? `image/${metadata.format}`
        : "application/octet-stream",
    };
  }

  const resized = await sharp(bytes)
    .rotate() // apply EXIF orientation before resizing, then drop it
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 75 })
    .toBuffer();

  return { bytes: resized, contentType: "image/webp" };
}

export async function downloadAndUploadToS3(
  fileUrl: string,
  filename: string,
): Promise<string> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return await uploadPublicFileToS3(buffer, filename);
  } catch (err) {
    console.error("Error downloading and uploading file:", err);
    throw err;
  }
}

/**
 * Stream a Web API File directly to S3 without ever buffering it fully in Node
 * heap memory. Pass ContentLength so S3/the SDK knows when the stream ends.
 * Use this for large-file uploads where loading the whole file into a Buffer
 * would exhaust available memory.
 */
export async function uploadFileToS3(
  file: File,
  filename: string,
): Promise<string> {
  const client = createS3Client();
  // Convert the Web ReadableStream to a Node.js Readable so AWS SDK v3
  // can pipe it without needing to buffer the entire payload.
  const nodeStream = Readable.fromWeb(
    file.stream() as import("stream/web").ReadableStream<Uint8Array>,
  );
  // Private by default (no ACL) — this is used for vault/daily-log uploads,
  // which are per-user files. Access must always go through a presigned URL
  // (see getPresignedViewUrl / getPresignedDownloadUrl) so ownership gets
  // checked server-side, instead of anyone-with-the-link. The returned
  // "public" URL below is kept only as a stored, informational reference
  // (e.g. for admin/debug lookups) — it is not usable for direct access.
  const putCommand = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: filename,
    Body: nodeStream,
    ContentType: file.type || getFileContentType(filename),
    ContentLength: file.size,
  });
  try {
    await client.send(putCommand);
    return getPublicFileUrl(filename);
  } catch (err) {
    console.error("Error streaming file to S3:", err);
    throw err;
  }
}

export async function uploadPublicFileToS3(
  file: Buffer,
  filename: string,
): Promise<string> {
  const client = createS3Client();

  const putCommand = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: filename,
    Body: file,
    ACL: ObjectCannedACL.public_read,
    ContentType: getFileContentType(filename),
  });

  try {
    await client.send(putCommand);
    return getPublicFileUrl(filename);
  } catch (err) {
    console.error("Error uploading file:", err);
    throw err;
  }
}

/**
 * Buffer-accepting counterpart to uploadFileToS3 — same private-by-default
 * rule (no ACL), just for callers that already have an in-memory Buffer
 * (e.g. a generated PDF) rather than a Web API File. Used for signed legal
 * documents (WC waiver), which must only be reachable via a presigned URL
 * (see getPresignedViewUrl / api.legal-documents.view.$docId.tsx), never a
 * permanent public link.
 */
export async function uploadPrivateFileToS3(
  file: Buffer,
  filename: string,
): Promise<string> {
  const client = createS3Client();

  const putCommand = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: filename,
    Body: file,
    ContentType: getFileContentType(filename),
  });

  try {
    await client.send(putCommand);
    return getPublicFileUrl(filename);
  } catch (err) {
    console.error("Error uploading file:", err);
    throw err;
  }
}

/**
 * Streams an arbitrary Readable to S3 via a real multipart upload
 * (`@aws-sdk/lib-storage`'s `Upload`, which buffers only a handful of
 * in-flight PARTS — a few MB each — not the whole payload) rather than
 * requiring the caller to hand over one big Buffer up front. The
 * streaming counterpart to `uploadPrivateFileToS3`, for a caller (like
 * `publicZip.server.ts`) that doesn't know the final byte size ahead of
 * time — a zip's compressed size isn't known until it's fully built.
 * Private by default (no ACL), same rule every other upload here follows.
 */
export async function uploadPrivateStreamToS3(
  stream: Readable,
  filename: string,
): Promise<void> {
  const client = createS3Client();
  const upload = new Upload({
    client,
    params: {
      Bucket: process.env.BUCKET_NAME,
      Key: filename,
      Body: stream,
      ContentType: getFileContentType(filename),
    },
  });
  try {
    await upload.done();
  } catch (err) {
    console.error("Error streaming file to S3:", err);
    throw err;
  }
}

export async function deleteFromS3(key: string): Promise<void> {
  const client = createS3Client();
  const deleteCommand = new DeleteObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
  });
  try {
    await client.send(deleteCommand);
  } catch (err) {
    console.error("Error deleting file from S3:", err);
    throw err;
  }
}

export async function createMultipartUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const client = createS3Client();
  // Private by default — multipart uploads are only used for large vault
  // files today; same reasoning as uploadFileToS3 above.
  const cmd = new CreateMultipartUploadCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  const result = await client.send(cmd);
  if (!result.UploadId) throw new Error("S3 did not return an UploadId");
  return result.UploadId;
}

export async function uploadMultipartPart(
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer | Uint8Array,
): Promise<string> {
  const client = createS3Client();
  const cmd = new UploadPartCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: body,
  });
  const result = await client.send(cmd);
  if (!result.ETag) throw new Error(`No ETag returned for part ${partNumber}`);
  return result.ETag;
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>,
): Promise<string> {
  const client = createS3Client();
  const cmd = new CompleteMultipartUploadCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  });
  await client.send(cmd);
  return getPublicFileUrl(key);
}

export async function abortMultipartUpload(
  key: string,
  uploadId: string,
): Promise<void> {
  const client = createS3Client();
  const cmd = new AbortMultipartUploadCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
  });
  await client.send(cmd);
}

export function getFileContentType(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "tiff":
      return "image/tiff";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "pdf":
      return "application/pdf";
    case "h264":
      return "video/h264";
    // A phone's own video formats. Absent until 2026-09-22, so a `.mov`
    // that reached S3 through a path with no browser-supplied type was
    // stored as octet-stream and would not play.
    case "mov":
      return "video/quicktime";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}
