import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { uploadToGridFS } from './gridfs.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function isCloudinaryConfigured() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

/** Hosted environments must not use ephemeral disk. */
function usePersistentStorage() {
  return (
    process.env.NODE_ENV === 'production' ||
    !!process.env.RENDER ||
    !!process.env.RENDER_EXTERNAL_URL ||
    process.env.USE_GRIDFS === 'true'
  );
}

export async function uploadBuffer(
  buffer: Buffer,
  folder: string,
  mimeType = 'image/jpeg'
): Promise<string> {
  if (isCloudinaryConfigured()) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `socialconnect/${folder}`,
          resource_type: mimeType.startsWith('video/') ? 'video' : 'auto',
        },
        (err, result) => {
          if (err || !result) reject(err || new Error('Upload failed'));
          else resolve(result.secure_url);
        }
      );
      Readable.from(buffer).pipe(stream);
    });
  }

  // Always persist on Render / production — local disk is wiped on redeploy
  if (usePersistentStorage()) {
    return uploadToGridFS(buffer, folder, mimeType);
  }

  const fs = await import('fs');
  const path = await import('path');
  const uploadsDir = path.join(process.cwd(), 'uploads', folder);
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const ext = mimeType.includes('png')
    ? '.png'
    : mimeType.includes('webp')
      ? '.webp'
      : mimeType.includes('gif')
        ? '.gif'
        : mimeType.includes('video')
          ? '.mp4'
          : mimeType.includes('audio')
            ? '.mp3'
            : '.jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const filepath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(filepath, buffer);
  return `/uploads/${folder}/${filename}`;
}
