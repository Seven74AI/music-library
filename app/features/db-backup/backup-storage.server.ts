/**
 * Tigris/S3 helpers that target BACKUP_BUCKET_NAME (not the media bucket).
 */
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
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
    await copyFile(localPath, dest);
    return key;
  }

  const bucket = getBackupBucketName();
  const { size } = await stat(localPath);
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentLength: size,
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
