/**
 * Webhook Auth — verify shared secret header.
 *
 * Pancake POS phải gửi `X-Webhook-Secret: <WEBHOOK_SECRET>` mỗi request.
 * Constant-time compare để tránh timing attack.
 */
import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

const SECRET = process.env.WEBHOOK_SECRET;
if (!SECRET || SECRET.length < 16) {
  // Soft warn at startup — không throw để không phá nếu user cố tình tắt
  console.warn('[webhook] WEBHOOK_SECRET chưa set hoặc quá ngắn — webhook sẽ luôn 401.');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const verifyWebhookSecret = (req: Request, res: Response, next: NextFunction) => {
  if (!SECRET) return res.status(401).json({ error: 'WEBHOOK_SECRET_NOT_CONFIGURED' });
  const provided = (req.headers['x-webhook-secret'] as string | undefined) || '';
  if (!provided || !safeEqual(provided, SECRET)) {
    return res.status(401).json({ error: 'INVALID_WEBHOOK_SECRET' });
  }
  next();
};
