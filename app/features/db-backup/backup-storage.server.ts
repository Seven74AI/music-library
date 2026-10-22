/**
 * Tigris/S3 helpers that target BACKUP_BUCKET_NAME (not the media bucket).
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getS3Client } from "#app/utils/storage.server.ts";

export function isBackupBucketConfigured(): boolean {
  return Boolean(process.env.BACKUP_BUCKET_NAME?.trim());
}

export function getBackupBucketName(): string {
  const name = process.env.BACKUP_BUCKET_NAME?.trim();
  if (!name) {
    throw new Error("BACKUP_BUCKET_NAME is not configured");
  }
  return name;
}

function localBackupDir(): string {
  return join(process.cwd(), "tests", "fixtures", "backups");
}

/**
 * Upload a local file to the backup bucket.
 * In MOCKS mode, copies to tests/fixtures/backups and returns the key.
 */
export async function uploadBackupObject(params: {
  localPath: string;
  key: string;
  contentType?: string;
}): Promise<string> {
  const { localPath, key, contentType = "application/x-sqlite3" } = params;
  if (!key) throw new Error("key is required");

  if (process.env.MOCKS === "true") {
    const dest = join(localBackupDir(), key);
    await mkdir(dirname(dest), { recursive: true });
    const body = await readFile(localPath);
    await writeFile(dest, body);
    return key;
  }

  const bucket = getBackupBucketName();
  const body = await readFile(localPath);
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

/** List object keys under a prefix in the backup bucket (paginated). */
export async function listBackupObjectKeys(prefix: string): Promise<string[]> {
  if (process.env.MOCKS === "true") {
    // Local fixture listing is best-effort; tests inject list via mocks.
    return [];
  }

  const bucket = getBackupBucketName();
  const client = getS3Client();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of result.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export async function deleteBackupObject(key: string): Promise<void> {
  if (process.env.MOCKS === "true") {
    try {
      await unlink(join(localBackupDir(), key));
    } catch {
      // ignore missing
    }
    return;
  }

  const bucket = getBackupBucketName();
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Download a backup object to a local path. */
export async function downloadBackupObject(key: string, localPath: string): Promise<void> {
  await mkdir(dirname(localPath), { recursive: true });

  if (process.env.MOCKS === "true") {
    const src = join(localBackupDir(), key);
    const body = await readFile(src);
    await writeFile(localPath, body);
    return;
  }

  const bucket = getBackupBucketName();
  const client = getS3Client();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) {
    throw new Error(`Empty body for backup object: ${key}`);
  }

  const body = result.Body;
  if (body instanceof Readable) {
    await pipeline(body, createWriteStream(localPath));
    return;
  }

  // SDK may return a web ReadableStream in some environments
  const bytes = await result.Body.transformToByteArray();
  await writeFile(localPath, Buffer.from(bytes));
}
