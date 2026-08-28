import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ObjectCannedACL,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
 * @param s3Key     The S3 key of the object to view
 * @param expiresIn Seconds until the URL expires (default: 900 = 15 minutes)
 */
export async function getPresignedViewUrl(
  s3Key: string,
  expiresIn = 900,
): Promise<string> {
  const client = createPresignS3Client();
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
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
    case "pdf":
      return "application/pdf";
    case "h264":
      return "video/h264";
    default:
      return "application/octet-stream";
  }
}
