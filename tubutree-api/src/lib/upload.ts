/**
 * Upload Service — Lưu ảnh KYC vào local filesystem.
 *
 * Cấu trúc: /uploads/kyc/{user_id}/{prefix}-{uuid}.{ext}
 * - prefix: aff-cccd-front | agt-cccd-front | agt-cccd-back | agt-selfie | agt-license
 * - ext: chỉ chấp nhận jpg/jpeg/png/webp
 * - max size: process.env.MAX_UPLOAD_SIZE_MB (mặc định 5MB)
 *
 * Trả về relative URL `/api/uploads/kyc/{user_id}/{filename}` để FE dùng trực tiếp
 * (route serving sẽ check owner/admin).
 */
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
const MAX_SIZE = (Number(process.env.MAX_UPLOAD_SIZE_MB) || 5) * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function ensureUserDir(userId: number): string {
  const dir = path.join(UPLOAD_DIR, 'kyc', String(userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    const userId = req.user?.userId;
    if (!userId) return cb(new Error('Chưa đăng nhập'), '');
    cb(null, ensureUserDir(userId));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('File extension không hỗ trợ'), '');
    // prefix gắn theo field name: cccd_front, cccd_back, selfie, business_license
    const prefix = file.fieldname.replace(/_/g, '-');
    cb(null, `${prefix}-${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error(`Mime không hỗ trợ: ${file.mimetype}`));
  }
  cb(null, true);
};

export const uploadKYC = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 5 },
});

/** Convert path tuyệt đối multer trả về thành URL relative để lưu DB. */
export function toRelativeUrl(absolutePath: string): string {
  const rel = path.relative(UPLOAD_DIR, absolutePath).replace(/\\/g, '/');
  return `/api/uploads/${rel}`;
}

/** Resolve URL relative thành path tuyệt đối an toàn (chống path traversal). */
export function resolveUploadPath(userId: number, filename: string): string | null {
  // chỉ cho phép alphanumeric, dash, dot
  if (!/^[\w.\-]+$/.test(filename)) return null;
  const abs = path.join(UPLOAD_DIR, 'kyc', String(userId), filename);
  const expected = path.join(UPLOAD_DIR, 'kyc', String(userId));
  if (!abs.startsWith(expected)) return null; // belt-and-suspenders
  if (!fs.existsSync(abs)) return null;
  return abs;
}

/** Magic-byte signature của các file ảnh chấp nhận. */
const MAGIC_SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },              // JPEG
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // PNG
  // WebP: "RIFF....WEBP"
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },        // RIFF (đọc thêm 4 bytes + "WEBP" check)
];

function matchesSignature(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

function isValidImageMagicBytes(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    for (const sig of MAGIC_SIGNATURES) {
      if (sig.mime === 'image/webp') {
        // RIFF....WEBP — bytes 0-3 = RIFF, bytes 8-11 = WEBP
        if (matchesSignature(buf, sig.bytes) &&
            buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
          return true;
        }
      } else {
        if (matchesSignature(buf, sig.bytes)) return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
}

/**
 * Middleware chạy sau multer: verify magic bytes cho mỗi file vừa upload.
 * Nếu sai → xoá file + return 400.
 */
export const verifyImageMagicBytes = (req: Request, res: Response, next: NextFunction) => {
  const files = (req.files as { [field: string]: Express.Multer.File[] } | undefined) || {};
  const allFiles = Object.values(files).flat();
  for (const f of allFiles) {
    if (!isValidImageMagicBytes(f.path)) {
      // Cleanup all uploaded files trong request này
      for (const ff of allFiles) {
        try { fs.unlinkSync(ff.path); } catch {}
      }
      return res.status(400).json({
        error: 'INVALID_IMAGE_CONTENT',
        message: `File ${f.fieldname} không phải ảnh hợp lệ (magic bytes mismatch)`,
      });
    }
  }
  next();
};
