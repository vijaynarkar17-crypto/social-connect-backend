import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { resolvePublicUrl } from '../utils/publicUrl.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function isCloudinaryConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY);
}

export async function uploadBuffer(buffer: Buffer, folder: string): Promise<string> {
  if (!isCloudinaryConfigured()) {
    const fs = await import('fs');
    const path = await import('path');
    const uploadsDir = path.join(process.cwd(), 'uploads', folder);
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const filepath = path.join(uploadsDir, filename);
    await fs.promises.writeFile(filepath, buffer);
    return resolvePublicUrl(`/uploads/${folder}/${filename}`)!;
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `socialconnect/${folder}` },
      (err, result) => {
        if (err || !result) reject(err || new Error('Upload failed'));
        else resolve(result.secure_url);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}
