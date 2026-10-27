import { Client } from 'minio';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from './logger';

export const minio = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export const BUCKET = env.MINIO_BUCKET;

/**
 * Signs links for the address users actually reach (MINIO_PUBLIC_URL). The
 * host is part of the signature, so it can't be swapped on the client. Signing
 * is offline; the fixed region skips MinIO's region lookup request.
 */
const signer = (() => {
  const pub = env.MINIO_PUBLIC_URL ? new URL(env.MINIO_PUBLIC_URL) : null;
  const useSSL = pub ? pub.protocol === 'https:' : env.MINIO_USE_SSL;
  return new Client({
    endPoint: pub?.hostname ?? env.MINIO_ENDPOINT,
    port: pub ? (pub.port ? Number(pub.port) : useSSL ? 443 : 80) : env.MINIO_PORT,
    useSSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
    region: 'us-east-1',
  });
})();

/** Create the bucket on boot if it does not exist yet. */
export async function ensureBucket(): Promise<void> {
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET);
    logger.info({ bucket: BUCKET }, 'created MinIO bucket');
  }
}

/** Keys are namespaced by tenant so one company can never address another's files. */
export function objectKey(companyId: string, folder: string, originalName: string): string {
  const safe = originalName.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return `${companyId}/${folder}/${randomUUID()}-${safe}`;
}

export async function putObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  await minio.putObject(BUCKET, key, buffer, buffer.length, { 'Content-Type': mimeType });
}

/** Short-lived download URL (FILE_LINK_TTL_SECONDS, 5 minutes). */
/**
 * Lifetime of every signed file link (payslips, documents, letters …). Lists only
 * carry file ids; "View" asks the API, which checks access and returns a fresh
 * signed link that stops working after this many seconds.
 */
export const FILE_LINK_TTL_SECONDS = 300;

export async function presignedGetUrl(
  key: string,
  fileName?: string,
  disposition: 'attachment' | 'inline' = 'attachment' // inline = render in the browser tab (view)
): Promise<string> {
  const headers: Record<string, string> = {};
  if (fileName) {
    headers['response-content-disposition'] = `${disposition}; filename="${fileName.replace(/"/g, '')}"`;
  }
  return signer.presignedGetObject(BUCKET, key, FILE_LINK_TTL_SECONDS, headers);
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const stream = await minio.getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function removeObject(key: string): Promise<void> {
  await minio.removeObject(BUCKET, key);
}
