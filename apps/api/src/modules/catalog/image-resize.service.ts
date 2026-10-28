import { HttpException, BadRequestException, BadGatewayException, Injectable, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicImageService } from './public-image.service';
import {
  FETCH_TIMEOUT_MS,
  FETCH_TOTAL_MS,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_PIXELS,
  cacheKey,
  isAllowedWidth,
  isPrivateAddress,
  parseOwnImagePath,
  parseRemoteSource,
  type ResizeFormat,
} from './image-resize';

export interface ResizedImage {
  data: Buffer;
  mime: string;
  etag: string;
}

/**
 * Phân giải DNS rồi mới kết nối, và từ chối địa chỉ nội bộ ngay ở đây: địa chỉ được kiểm là đúng địa chỉ sẽ được nối tới.
 * Node 20+ gọi lookup với all: true (thử nhiều địa chỉ), nên giữ riêng các địa chỉ công cộng.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, '', 4);
    if (Array.isArray(address)) {
      const safe = address.filter((a) => !isPrivateAddress(a.address));
      return safe.length > 0 ? callback(null, safe) : callback(new Error('blocked address') as NodeJS.ErrnoException, '', 4);
    }
    return isPrivateAddress(address) ? callback(new Error('blocked address') as NodeJS.ErrnoException, '', 4) : callback(null, address, family);
  });
};

const MAX_CONCURRENT_JOBS = 4;
/** Hàng đợi chờ xử lý tối đa: đầy thì 503 để RAM (mỗi việc giữ tới 8 MB nguồn) không phình theo số URL khác nhau. */
const MAX_QUEUED_JOBS = 32;
const REGISTRY_TTL_MS = 5 * 60 * 1000;
const REGISTRY_MISS_TTL_MS = 60 * 1000;
const REGISTRY_MAX_ENTRIES = 2_000;
/** Số lần tra DB cho nguồn lạ mỗi phút: URL không có trong DB bị từ chối nhưng mỗi lần vẫn tốn một lần quét. */
const REGISTRY_MISS_LOOKUPS_PER_MIN = 30;
const PRUNE_MIN_GAP_WHEN_FULL_MS = 10 * 1000;
const DEFAULT_CACHE_MAX_MB = 512;
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const PRUNE_EVERY_MS = 10 * 60 * 1000;

/**
 * Đổi cỡ ảnh sản phẩm lúc có người xem lần đầu, lưu bản nhỏ trên đĩa. Thư mục cache: IMAGE_CACHE_DIR (mặc định thư mục tạm của
 * container, mất khi dựng lại container và tự tạo lại dần); dung lượng: IMAGE_CACHE_MAX_MB (mặc định 512), file quá 14 ngày bị xoá.
 */
@Injectable()
export class ImageResizeService {
  private readonly log = new Logger(ImageResizeService.name);
  private readonly dir = process.env.IMAGE_CACHE_DIR || join(tmpdir(), 'tubu-img-cache');
  private readonly maxBytes = (Number(process.env.IMAGE_CACHE_MAX_MB) || DEFAULT_CACHE_MAX_MB) * 1024 * 1024;
  private readonly inFlight = new Map<string, Promise<ResizedImage>>();
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private lastPrune = 0;
  private cacheBytes: number | null = null;
  private readonly registry = new Map<string, { ok: boolean; until: number }>();
  private missWindowStart = 0;
  private missCount = 0;

  constructor(
    private readonly own: PublicImageService,
    private readonly prisma: PrismaService,
  ) {}

  /** Khoá cache (cũng là ETag) cho cặp nguồn + bề rộng + định dạng; null khi tham số không hợp lệ. Không chạm mạng hay đĩa. */
  keyFor(source: unknown, width: number, format: ResizeFormat): string | null {
    if (!isAllowedWidth(width)) return null;
    const own = parseOwnImagePath(source);
    if (own) return cacheKey(`own:${own.kind}/${own.id}/${own.slot}?v=${own.version ?? ''}`, width, format);
    const remote = parseRemoteSource(source);
    return remote ? cacheKey(remote.toString(), width, format) : null;
  }

  async get(source: unknown, width: number, format: ResizeFormat): Promise<ResizedImage> {
    if (!isAllowedWidth(width)) throw new BadRequestException('Bề rộng ảnh không được hỗ trợ.');
    const key = this.keyFor(source, width, format);
    if (!key) throw new BadRequestException('Nguồn ảnh không được hỗ trợ.');
    const mime = format === 'webp' ? 'image/webp' : 'image/jpeg';
    const etag = `"${key}"`;
    const hit = await this.readCache(key);
    if (hit) return { data: hit, mime, etag };
    if (!parseOwnImagePath(source) && !(await this.isRegistered(source as string))) throw new NotFoundException('Không tìm thấy ảnh.');
    let job = this.inFlight.get(key);
    if (!job) {
      job = this.produce(source as string, key, width, format).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, job);
    }
    return job;
  }

  /**
   * Chỉ đổi cỡ ảnh đang nằm trong sản phẩm hoặc nhãn: host Pancake/Cloudinary chung của mọi cửa hàng, kiểm host thôi sẽ biến
   * endpoint thành proxy ảnh cho bất kỳ ai. Khớp nguyên văn chuỗi `u` với dữ liệu, nhớ kết quả ít phút.
   */
  private async isRegistered(raw: string): Promise<boolean> {
    const now = Date.now();
    const known = this.registry.get(raw);
    if (known && known.until > now) return known.ok;
    if (now - this.missWindowStart > 60_000) {
      this.missWindowStart = now;
      this.missCount = 0;
    }
    if (this.missCount >= REGISTRY_MISS_LOOKUPS_PER_MIN) throw new ServiceUnavailableException('Máy chủ đang bận, thử lại sau.');
    const ok = await this.lookupRegistered(raw);
    if (!ok) this.missCount += 1;
    if (this.registry.size >= REGISTRY_MAX_ENTRIES) this.registry.clear();
    this.registry.set(raw, { ok, until: now + (ok ? REGISTRY_TTL_MS : REGISTRY_MISS_TTL_MS) });
    return ok;
  }

  private async lookupRegistered(raw: string): Promise<boolean> {
    const product = await this.prisma.product.findFirst({ where: { OR: [{ images: { has: raw } }, { thumbnail: raw }] }, select: { id: true } });
    if (product) return true;
    const brand = await this.prisma.brand.findFirst({ where: { OR: [{ logoUrl: raw }, { coverUrl: raw }, { storyImages: { has: raw } }] }, select: { id: true } });
    return brand !== null;
  }

  private async produce(source: string, key: string, width: number, format: ResizeFormat): Promise<ResizedImage> {
    const release = await this.acquire();
    let data: Buffer;
    try {
      const input = await this.loadSource(source);
      const pipeline = sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'error' }).rotate().resize({ width, withoutEnlargement: true });
      data = await (format === 'webp' ? pipeline.webp({ quality: 78 }) : pipeline.jpeg({ quality: 80, mozjpeg: true })).toBuffer();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadGatewayException('Không xử lý được ảnh nguồn.');
    } finally {
      release();
    }
    await this.writeCache(key, data);
    return { data, mime: format === 'webp' ? 'image/webp' : 'image/jpeg', etag: `"${key}"` };
  }

  private async loadSource(source: string): Promise<Buffer> {
    const own = parseOwnImagePath(source);
    if (own) {
      const found = await this.own.get(own.kind, own.id, own.slot, own.version).catch(() => null);
      if (!found || !found.versionOk) throw new NotFoundException('Không tìm thấy ảnh.');
      return found.data;
    }
    const url = parseRemoteSource(source);
    if (!url) throw new BadRequestException('Nguồn ảnh không được hỗ trợ.');
    return this.download(url);
  }

  /** Không theo chuyển hướng, chặn IP nội bộ ở bước phân giải DNS (đúng địa chỉ sẽ được kết nối), giới hạn dung lượng và thời gian. */
  private download(url: URL): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: 'GET',
          headers: { Accept: 'image/*', 'User-Agent': 'TubuTree-ImageResize/1' },
          timeout: FETCH_TIMEOUT_MS,
          signal: AbortSignal.timeout(FETCH_TOTAL_MS),
          lookup: safeLookup,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const type = String(res.headers['content-type'] ?? '');
          if (status !== 200 || !/^image\/(jpeg|png|webp|gif|avif)/i.test(type)) {
            res.resume();
            reject(new BadGatewayException('Ảnh nguồn không tải được.'));
            return;
          }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
            res.resume();
            reject(new PayloadTooLargeException('Ảnh nguồn quá lớn.'));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total > MAX_SOURCE_BYTES) {
              req.destroy();
              reject(new PayloadTooLargeException('Ảnh nguồn quá lớn.'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', () => reject(new BadGatewayException('Ảnh nguồn không tải được.')));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => reject(new BadGatewayException('Ảnh nguồn không tải được.')));
      req.end();
    });
  }

  private acquire(): Promise<() => void> {
    const take = () => {
      this.active += 1;
      return () => {
        this.active -= 1;
        this.waiters.shift()?.();
      };
    };
    if (this.active < MAX_CONCURRENT_JOBS) return Promise.resolve(take());
    if (this.waiters.length >= MAX_QUEUED_JOBS) return Promise.reject(new ServiceUnavailableException('Máy chủ đang bận, thử lại sau.'));
    return new Promise((resolve) => this.waiters.push(() => resolve(take())));
  }

  private pathFor(key: string): string {
    return join(this.dir, key.slice(0, 2), key);
  }

  private async readCache(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, data: Buffer): Promise<void> {
    const file = this.pathFor(key);
    if (this.cacheBytes === null) await this.prune();
    if ((this.cacheBytes ?? 0) + data.length > this.maxBytes) {
      if (Date.now() - this.lastPrune > PRUNE_MIN_GAP_WHEN_FULL_MS) {
        this.lastPrune = Date.now();
        await this.prune().catch(() => undefined);
      }
      if ((this.cacheBytes ?? 0) + data.length > this.maxBytes) return;
    }
    try {
      await fs.mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
      const tmp = `${file}.${createHash('md5').update(String(Math.random())).digest('hex').slice(0, 8)}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, file);
      this.cacheBytes = (this.cacheBytes ?? 0) + data.length;
    } catch (e) {
      this.log.warn(`Không ghi được cache ảnh: ${(e as Error).message}`);
      return;
    }
    if (Date.now() - this.lastPrune > PRUNE_EVERY_MS) {
      this.lastPrune = Date.now();
      void this.prune().catch((e: Error) => this.log.warn(`Dọn cache ảnh lỗi: ${e.message}`));
    }
  }

  /** Xoá file quá tuổi, rồi xoá file cũ nhất cho tới khi dưới trần dung lượng. */
  async prune(): Promise<{ removed: number; bytes: number }> {
    const files: { path: string; size: number; mtime: number }[] = [];
    let shards: string[] = [];
    try {
      shards = await fs.readdir(this.dir);
    } catch {
      this.cacheBytes = 0;
      return { removed: 0, bytes: 0 };
    }
    for (const shard of shards) {
      const sub = join(this.dir, shard);
      let names: string[];
      try {
        names = await fs.readdir(sub);
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(sub, name);
        try {
          const st = await fs.stat(path);
          files.push({ path, size: st.size, mtime: st.mtimeMs });
        } catch {
          /* file vừa bị xoá */
        }
      }
    }
    const now = Date.now();
    let removed = 0;
    let total = files.reduce((s, f) => s + f.size, 0);
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (now - f.mtime <= CACHE_MAX_AGE_MS && total <= this.maxBytes) break;
      await fs.rm(f.path, { force: true });
      total -= f.size;
      removed += 1;
    }
    this.cacheBytes = total;
    return { removed, bytes: total };
  }
}
