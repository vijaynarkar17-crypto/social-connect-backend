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
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('audio')) return '.m4a';
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

export async function streamGridFSFile(
  fileId: string,
  res: import('express').Response,
  rangeHeader?: string
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(fileId)) return false;

  const gfs = getBucket();
  const _id = new mongoose.Types.ObjectId(fileId);
  const files = await gfs.find({ _id }).limit(1).toArray();
  if (!files.length) return false;

  const file = files[0];
  const fileLength = Number(file.length);
  res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Accept-Ranges', 'bytes');

  let start = 0;
  let end = fileLength - 1;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileLength}`);
      res.end();
      return true;
    }

    const requestedStart = match[1] ? Number(match[1]) : undefined;
    const requestedEnd = match[2] ? Number(match[2]) : undefined;

    if (requestedStart === undefined && requestedEnd !== undefined) {
      start = Math.max(0, fileLength - requestedEnd);
    } else {
      start = requestedStart ?? 0;
      end = requestedEnd ?? end;
    }

    end = Math.min(end, fileLength - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= fileLength) {
      res.status(416).setHeader('Content-Range', `bytes */${fileLength}`);
      res.end();
      return true;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileLength}`);
  }

  res.setHeader('Content-Length', String(end - start + 1));

  await new Promise<void>((resolve, reject) => {
    const stream = gfs.openDownloadStream(_id, { start, end: end + 1 });
    stream.on('error', reject);
    stream.on('end', () => resolve());
    stream.pipe(res);
  });

  return true;
}
