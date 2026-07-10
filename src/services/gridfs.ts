import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

let bucket: GridFSBucket | null = null;

function getBucket(): GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  if (!bucket) bucket = new GridFSBucket(db, { bucketName: 'uploads' });
  return bucket;
}

function extFromMime(mime: string): string {
  if (mime.includes('png')) return '.png';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('quicktime')) return '.mov';
  return '.jpg';
}

/** Persist uploads in MongoDB so they survive Render redeploys. */
export async function uploadToGridFS(
  buffer: Buffer,
  folder: string,
  mimeType = 'image/jpeg'
): Promise<string> {
  const gfs = getBucket();
  const id = new mongoose.Types.ObjectId();
  const filename = `${folder}/${Date.now()}-${id.toString()}${extFromMime(mimeType)}`;

  await new Promise<void>((resolve, reject) => {
    const stream = gfs.openUploadStreamWithId(id, filename, {
      contentType: mimeType,
      metadata: { folder },
    });
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    stream.end(buffer);
  });

  return `/api/files/${id.toString()}`;
}

export async function streamGridFSFile(fileId: string, res: import('express').Response): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(fileId)) return false;

  const gfs = getBucket();
  const _id = new mongoose.Types.ObjectId(fileId);
  const files = await gfs.find({ _id }).limit(1).toArray();
  if (!files.length) return false;

  const file = files[0];
  res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  await new Promise<void>((resolve, reject) => {
    const stream = gfs.openDownloadStream(_id);
    stream.on('error', reject);
    stream.on('end', () => resolve());
    stream.pipe(res);
  });

  return true;
}
