/**
 * Uploads Controller — serve file KYC + mint signed URL.
 *
 * 2 cách auth:
 *   - Authorization header JWT (cho tool admin / curl)
 *   - Signed URL (?exp=&v=&sig=) — preferred cho <img src> trên FE
 */
import { Response, Request } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { resolveUploadPath } from '../lib/upload';
import { toInt, getUserId, handleError } from '../lib/helpers';
import { generateSignedUrl, verifySignedUrl } from '../lib/signed-url';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.webp': 'image/webp',
};

const JWT_SECRET = process.env.JWT_SECRET!;

/** Verify viewer được phép xem ảnh của owner — owner hoặc admin. */
async function isViewerAuthorized(viewerId: number, ownerId: number): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const prismaMod = await import('../lib/prisma');
  const u = await prismaMod.default.user.findUnique({
    where: { id: viewerId }, select: { is_admin: true },
  });
  return !!u?.is_admin;
}

export const serveKYCFile = async (req: Request, res: Response) => {
  const ownerId = toInt(req.params.userId);
  const filename = req.params.filename;

  // Mode 1: signed URL
  const exp = Number(req.query.exp);
  const viewerId = Number(req.query.v);
  const sig = String(req.query.sig || '');
  if (exp && viewerId && sig) {
    if (!verifySignedUrl(ownerId, filename, exp, viewerId, sig)) {
      return res.status(403).json({ error: 'INVALID_OR_EXPIRED_SIGNATURE' });
    }
    // Vẫn check viewer có quyền xem (đề phòng signed URL bị forward sang người không có quyền)
    const ok = await isViewerAuthorized(viewerId, ownerId);
    if (!ok) return res.status(403).json({ error: 'NOT_AUTHORIZED' });
  } else {
    // Mode 2: fallback JWT từ header (KHÔNG còn accept ?token= trong query)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'NEED_SIGNED_URL_OR_BEARER' });
    let decoded: any;
    try { decoded = jwt.verify(token, JWT_SECRET); }
    catch { return res.status(403).json({ error: 'INVALID_TOKEN' }); }
    const ok = await isViewerAuthorized(decoded.userId, ownerId);
    if (!ok) return res.status(403).json({ error: 'NOT_AUTHORIZED' });
  }

  const abs = resolveUploadPath(ownerId, filename);
  if (!abs) return res.status(404).json({ error: 'File không tồn tại' });

  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Referrer-Policy', 'no-referrer');
  fs.createReadStream(abs).pipe(res);
};

/**
 * Mint signed URL cho 1 file. User chỉ mint được cho file của mình; admin
 * mint được cho file của bất kỳ ai.
 */
export const mintSignedKycUrl = async (req: AuthRequest, res: Response) => {
  try {
    const viewerId = getUserId(req);
    const ownerId = toInt(req.params.userId);
    const filename = req.params.filename;

    const ok = await isViewerAuthorized(viewerId, ownerId);
    if (!ok) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

    const abs = resolveUploadPath(ownerId, filename);
    if (!abs) return res.status(404).json({ error: 'File không tồn tại' });

    const { url, exp } = generateSignedUrl(ownerId, filename, viewerId);
    res.json({ url, exp });
  } catch (err) { handleError(res, 'Lỗi mint signed URL', err); }
};
