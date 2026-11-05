import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isIP } from 'net';
import { promises as dns } from 'dns';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { cutoutWhite } from './story-cutout';

export const STORY_ASSETS_MAX_IMAGES = 12;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const CUTOUT_MAX_EDGE = 1600;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const MSG = {
  badUrl: 'Địa chỉ không hợp lệ hoặc không được phép truy cập.',
  fetchFail: 'Không tải được địa chỉ này. Kiểm tra lại đường dẫn rồi thử lại.',
  notHtml: 'Địa chỉ này không phải trang web (HTML).',
  notImage: 'Tệp không phải ảnh PNG, JPEG, WebP hoặc GIF.',
  tooBig: 'Tệp quá lớn.',
  badImage: 'Không đọc được ảnh.',
  empty: 'Cần nhập địa chỉ trang sản phẩm hoặc danh sách địa chỉ ảnh.',
  noProduct: 'Không tìm thấy sản phẩm.',
};

function ipv4Private(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

/** Đúng cho IPv4 và IPv6 dạng thường lẫn dạng ánh xạ IPv4 (::ffff:a.b.c.d hoặc ::ffff:xxxx:xxxx). */
function isPrivateIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return ipv4Private(a, b);
  }
  if (kind !== 6) return true;
  const dotted = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted?.[1]) return isPrivateIp(dotted[1]);
  const hex = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex?.[1]) {
    const hi = parseInt(hex[1], 16);
    return ipv4Private(hi >> 8, hi & 0xff);
  }
  if (ip === '::' || ip === '::1') return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

/** Chỉ http/https, cổng mặc định, và host (kể cả sau DNS) không được trỏ vào mạng nội bộ. Lỗi không nêu IP để không lộ hạ tầng. */
export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BadRequestException(MSG.badUrl);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException(MSG.badUrl);
  if (url.username || url.password) throw new BadRequestException(MSG.badUrl);
  if (url.port && url.port !== '80' && url.port !== '443') throw new BadRequestException(MSG.badUrl);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new BadRequestException(MSG.badUrl);
  if (isIP(host.replace(/^\[|\]$/g, ''))) {
    if (isPrivateIp(host)) throw new BadRequestException(MSG.badUrl);
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new BadRequestException(MSG.fetchFail);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new BadRequestException(MSG.badUrl);
  return url;
}

interface Fetched {
  buf: Buffer;
  finalUrl: URL;
  contentType: string;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) throw new BadRequestException(MSG.tooBig);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BadRequestException(MSG.tooBig);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Mọi bước (kiểm host, chuyển hướng, đọc thân) dùng chung một đồng hồ 8 giây. Chuyển hướng tự theo để kiểm lại từng chặng. */
async function fetchPublic(startUrl: string, accept: (type: string) => boolean, rejectMsg: string, maxBytes: number): Promise<Fetched> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let url = await assertPublicHttpUrl(startUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetch(url.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'TubuTreeStoryBot/1.0', accept: '*/*' } });
      } catch {
        throw new BadRequestException(MSG.fetchFail);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc || hop === MAX_REDIRECTS) throw new BadRequestException(MSG.fetchFail);
        url = await assertPublicHttpUrl(new URL(loc, url).toString());
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new BadRequestException(MSG.fetchFail);
      }
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!accept(contentType)) {
        await res.body?.cancel().catch(() => undefined);
        throw new BadRequestException(rejectMsg);
      }
      try {
        return { buf: await readCapped(res, maxBytes), finalUrl: url, contentType };
      } catch (e) {
        throw e instanceof BadRequestException ? e : new BadRequestException(MSG.fetchFail);
      }
    }
    throw new BadRequestException(MSG.fetchFail);
  } finally {
    clearTimeout(timer);
  }
}

const decodeAttr = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function extractImageUrls(html: string, base: URL): string[] {
  const raw: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/(?:property|name)\s*=\s*["']og:image(?::url|:secure_url)?["']/i.test(tag)) continue;
    const m = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (m?.[1]) raw.push(m[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) if (m[1]) raw.push(m[1]);
  const out: string[] = [];
  for (const r of raw) {
    try {
      const u = new URL(decodeAttr(r.trim()), base);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      u.protocol = 'https:';
      u.hash = '';
      const s = u.toString();
      if (!out.includes(s)) out.push(s);
    } catch {
      // đường dẫn ảnh hỏng thì bỏ qua
    }
  }
  return out;
}

export interface StoryAssetsResult {
  images: { url: string; width: number; height: number }[];
  cutouts: { sourceUrl: string; dataUrl: string }[];
}

@Injectable()
export class StoryAssetsService {
  private readonly logger = new Logger(StoryAssetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Chỉ đọc và xử lý trong bộ nhớ; không ghi đĩa, không ghi DB. Admin tự đăng ký ảnh muốn dùng qua luồng ảnh sản phẩm. */
  async extract(productId: string, body: { pageUrl?: string; imageUrls?: string[] }): Promise<StoryAssetsResult> {
    const pageUrl = body.pageUrl?.trim();
    const explicit = (body.imageUrls ?? []).map((u) => u.trim()).filter(Boolean);
    if (!pageUrl && explicit.length === 0) throw new BadRequestException(MSG.empty);
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException(MSG.noProduct);

    const candidates: string[] = [];
    if (pageUrl) {
      const page = await fetchPublic(pageUrl, (t) => t === 'text/html' || t === 'application/xhtml+xml', MSG.notHtml, MAX_HTML_BYTES);
      candidates.push(...extractImageUrls(page.buf.toString('utf8'), page.finalUrl));
    }
    for (const u of explicit) if (!candidates.includes(u)) candidates.push(u);

    const result: StoryAssetsResult = { images: [], cutouts: [] };
    for (const url of candidates.slice(0, STORY_ASSETS_MAX_IMAGES)) {
      try {
        const img = await fetchPublic(url, (t) => IMAGE_TYPES.has(t), MSG.notImage, MAX_IMAGE_BYTES);
        const meta = await sharp(img.buf).metadata().catch(() => null);
        if (!meta?.width || !meta.height) throw new BadRequestException(MSG.badImage);
        const small = await sharp(img.buf).resize(CUTOUT_MAX_EDGE, CUTOUT_MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        const webp = await sharp(await cutoutWhite(small)).webp({ quality: 85 }).toBuffer();
        result.images.push({ url: img.finalUrl.toString(), width: meta.width, height: meta.height });
        result.cutouts.push({ sourceUrl: img.finalUrl.toString(), dataUrl: `data:image/webp;base64,${webp.toString('base64')}` });
      } catch (e) {
        this.logger.warn(`Bỏ qua ảnh câu chuyện lỗi (${e instanceof Error ? e.message : 'lỗi'}).`);
      }
    }
    return result;
  }
}
