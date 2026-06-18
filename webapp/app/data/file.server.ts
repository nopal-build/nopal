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
  const client = createS3Client();

  const putCommand = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: filename,
    ContentType: contentType,
    ACL: ObjectCannedACL.public_read,
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
  const client = createS3Client();
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(client as any, cmd, { expiresIn });
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
  const putCommand = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: filename,
    Body: nodeStream,
    ContentType: file.type || getFileContentType(filename),
    ContentLength: file.size,
    ACL: ObjectCannedACL.public_read,
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
  const cmd = new CreateMultipartUploadCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ACL: ObjectCannedACL.public_read,
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
