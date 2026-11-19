import { HttpException, BadRequestException, BadGatewayException, Injectable, Optional, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicImageService } from './public-image.service';
import { ImageRegistryStale } from './image-registry-stale';
import { registrySql } from './image-registry-query';
import { loadPublicVisibility } from '../storefront/public-visibility';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  FETCH_TIMEOUT_MS,
  FETCH_TOTAL_MS,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_PIXELS,
  FORMAT_MIME,
  cacheKey,
  isAllowedWidth,
  parseOwnImagePath,
  parseRemoteSource,
  safeLookup,
  type ResizeFormat,
} from './image-resize';

export interface ResizedImage {
  data: Buffer;
  mime: string;
  etag: string;
  /** Bản thay tạm lúc máy bận mã hoá AVIF (WebP cùng bề rộng): controller cho cache ngắn để lần sau trình duyệt xin lại AVIF. */
  degraded?: boolean;
}

/**
 * Không nhận thêm việc đổi cỡ (hàng đợi đầy, hoặc IP đã gửi quá nhiều ?v= sai): controller chuyển hướng 302 về ảnh gốc thay vì trả 503.
 * Ảnh gốc là ảnh Pancake/Cloudinary đã có trong danh sách, hoặc `/public-image/...` của chính API (có hạn mức và kiểm ?v= riêng), nên
 * chuyển hướng không tốn CPU, RAM hay lượt đọc DB của /img và không mở thêm đường nào kẻ xấu chưa gọi thẳng được.
 */
export class ImageFallbackRedirect extends Error {
  constructor(
    readonly location: string,
    readonly reason: 'queue-full' | 'miss-limit',
  ) {
    super(`image fallback: ${reason}`);
  }
}

const MAX_CONCURRENT_JOBS = 4;
/** Mã hoá AVIF (effort 2) tốn CPU gấp 2–3 lần WebP: trong 4 việc đổi cỡ cùng lúc, tối đa ngần này việc mã hoá AVIF, chỗ còn lại vẫn làm WebP/JPEG. */
const MAX_CONCURRENT_AVIF = 2;
/**
 * Việc AVIF đã nhận (đang mã hoá + đang chờ chỗ AVIF) tối đa ngần này. Lúc cache lạnh (sau deploy, ảnh mới) một trang xin hàng chục ảnh AVIF cùng lúc;
 * vượt mức thì lần xin AVIF kế được phát bản WebP cùng bề rộng (đã cache thì đọc đĩa, chưa thì mã hoá WebP rẻ hơn 2–3 lần), cache ngắn.
 * Ba việc AVIF giữ tối đa 3 trong 4 chỗ đổi cỡ, nên WebP/JPEG luôn còn ít nhất một chỗ.
 */
const MAX_AVIF_BACKLOG = 3;
/** Hàng đợi chờ xử lý tối đa: đầy thì chuyển hướng về ảnh gốc (ImageFallbackRedirect) để RAM (mỗi việc giữ tới 8 MB nguồn) không phình theo số URL khác nhau. */
const MAX_QUEUED_JOBS = 32;
const REGISTRY_TTL_MS = 5 * 60 * 1000;
const REGISTRY_MISS_RELOAD_MS = 30_000;
/** Ảnh của chính API sai ?v= hoặc không có: mỗi lần vẫn tốn một lần đọc DB và một chỗ trong hàng đợi, nên giới hạn theo phút. */
const OWN_MISSES_PER_MIN = 30;
const MAX_MISS_TRACKED = 5000;
/** Ảnh của API vừa được DB xác nhận (còn công khai, đúng ?v=) thì phát bản đã cache mà không đọc lại DB trong ngần này. */
const OWN_VERIFIED_TTL_MS = 60_000;
const MAX_OWN_VERIFIED = 5000;
const PRUNE_MIN_GAP_WHEN_FULL_MS = 10 * 1000;
/** Dọn tới 80% trần để còn chỗ ghi ảnh mới, không dừng ghi ngay sát trần. */
const PRUNE_LOW_WATER = 0.8;
const DEFAULT_CACHE_MAX_MB = 512;
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const PRUNE_EVERY_MS = 10 * 60 * 1000;

/**
 * Đổi cỡ ảnh sản phẩm lúc có người xem lần đầu, lưu bản nhỏ trên đĩa. Thư mục cache: IMAGE_CACHE_DIR (mặc định thư mục tạm của
 * container; compose PROD gắn volume bền vào đó nên cache còn qua deploy); dung lượng: IMAGE_CACHE_MAX_MB (mặc định 512), file quá 14 ngày bị xoá.
 * Lần ghi đầu của mỗi tiến trình quét thư mục để tính dung lượng sẵn có, nên cache cũ trong volume vẫn bị giữ dưới trần.
 */
@Injectable()
export class ImageResizeService {
  private readonly log = new Logger(ImageResizeService.name);
  private readonly dir = process.env.IMAGE_CACHE_DIR || join(tmpdir(), 'tubu-img-cache');
  private readonly maxBytes = (Number(process.env.IMAGE_CACHE_MAX_MB) || DEFAULT_CACHE_MAX_MB) * 1024 * 1024;
  private readonly inFlight = new Map<string, Promise<ResizedImage>>();
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private avifActive = 0;
  private readonly avifWaiters: (() => void)[] = [];
  /** Việc AVIF đã nhận, từ lúc vào hàng tới lúc xong (xem MAX_AVIF_BACKLOG). */
  private avifJobs = 0;
  /** Đếm lần phát bản thay/chuyển hướng để ghi cảnh báo tối đa mỗi phút một lần (theo dõi cache lạnh sau deploy). */
  private fallbackCount = 0;
  private fallbackLoggedAt = 0;
  private lastPrune = 0;
  private cacheBytes: number | null = null;
  /** Lần quét đầu của tiến trình (tính dung lượng cache đã có trong volume): các lần ghi đầu tiên chờ chung một lần quét. */
  private firstScan: Promise<unknown> | null = null;
  /** Tổng byte đã ghi từ lúc chạy: lần dọn cộng phần ghi trong lúc nó đang quét, không đè mất. */
  private writtenBytes = 0;
  private registry = new Set<string>();
  private registryUntil = 0;
  private registryLoadedAt = 0;
  private registryLoad: Promise<void> | null = null;
  private retryAfter = 0;
  private readonly ownMisses = new Map<string, { start: number; count: number }>();
  /** Ảnh của API (khoá `ownRef`) đã được DB xác nhận, tới thời điểm hết hạn. */
  private readonly ownVerified = new Map<string, number>();

  constructor(
    private readonly own: PublicImageService,
    private readonly prisma: PrismaService,
    private readonly stale: ImageRegistryStale,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /** Khoá cache (cũng là ETag) cho cặp nguồn + bề rộng + định dạng; null khi tham số không hợp lệ. Không chạm mạng hay đĩa. */
  keyFor(source: unknown, width: number, format: ResizeFormat): string | null {
    if (!isAllowedWidth(width)) return null;
    const own = parseOwnImagePath(source);
    if (own) return cacheKey(ownRef(own), width, format);
    const remote = parseRemoteSource(source);
    return remote ? cacheKey(remote.toString(), width, format) : null;
  }

  async get(source: unknown, width: number, format: ResizeFormat, client = ''): Promise<ResizedImage> {
    if (!isAllowedWidth(width)) throw new BadRequestException('Bề rộng ảnh không được hỗ trợ.');
    const key = this.keyFor(source, width, format);
    if (!key) throw new BadRequestException('Nguồn ảnh không được hỗ trợ.');
    const mime = FORMAT_MIME[format];
    const etag = `"${key}"`;
    // Kiểm trước khi phát bản đã cache (cache ở volume, còn qua deploy): ảnh bị gỡ khỏi danh sách (gian hàng bị gỡ, đổi ảnh) không được phát tiếp tới 14 ngày nữa.
    // Ảnh của chính API kiểm trong job (`produce`): DB xác nhận còn công khai và đúng ?v= rồi mới phát bản đã cache.
    const own = parseOwnImagePath(source);
    if (!own) {
      if (!(await this.isRegistered(source as string))) throw new NotFoundException('Không tìm thấy ảnh.');
      const hit = await this.readCache(key);
      if (hit) return { data: hit, mime, etag };
    } else {
      // Có ảnh vừa được ghi/đổi (admin, đồng bộ, đối tác): bỏ mọi xác nhận cũ, lần tới kiểm lại DB.
      if (this.stale.isStale()) this.ownVerified.clear();
      // DB vừa xác nhận trong 60 giây: trang nhiều ảnh không xếp hàng đổi cỡ (và không đọc DB) chỉ để phát bản đã có trên đĩa.
      if ((this.ownVerified.get(ownRef(own)) ?? 0) > Date.now()) {
        const hit = await this.readCache(key);
        if (hit) return { data: hit, mime, etag };
      }
    }
    // Đang bận mã hoá AVIF (cache lạnh): không xếp thêm việc AVIF mà phát WebP cùng bề rộng, cache ngắn. Việc AVIF cùng khoá đang chạy thì vẫn chờ chung.
    if (format === 'avif' && !this.inFlight.has(key) && this.avifJobs >= MAX_AVIF_BACKLOG) {
      this.noteFallback('avif-busy');
      const webpKey = this.keyFor(source, width, 'webp') as string;
      const verified = !own || (this.ownVerified.get(ownRef(own)) ?? 0) > Date.now();
      const hit = verified ? await this.readCache(webpKey) : null;
      const webp = hit ? { data: hit, mime: FORMAT_MIME.webp, etag: `"${webpKey}"` } : await this.run(source as string, webpKey, width, 'webp', client);
      return { ...webp, degraded: true };
    }
    return this.run(source as string, key, width, format, client);
  }

  /** Việc đổi cỡ của một khoá: request cùng khoá đang chạy thì dùng chung một lần xử lý (in-flight coalescing). */
  private run(source: string, key: string, width: number, format: ResizeFormat, client: string): Promise<ResizedImage> {
    let job = this.inFlight.get(key);
    if (!job) {
      job = this.produce(source, key, width, format, client).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, job);
    }
    return job;
  }

  /** Ảnh gốc để chuyển hướng tới: URL Pancake/Cloudinary đã chuẩn hoá, hoặc `public-image/...` tương đối so với `/img` (đúng cả khi API nằm sau tiền tố `/api`). */
  private fallbackLocation(source: string): string {
    if (parseOwnImagePath(source)) return source.slice(1);
    const remote = parseRemoteSource(source);
    if (!remote) throw new BadRequestException('Nguồn ảnh không được hỗ trợ.');
    return remote.toString();
  }

  private fallback(source: string, reason: ImageFallbackRedirect['reason']): ImageFallbackRedirect {
    this.noteFallback(reason);
    return new ImageFallbackRedirect(this.fallbackLocation(source), reason);
  }

  private noteFallback(reason: string): void {
    this.fallbackCount += 1;
    const now = Date.now();
    if (now - this.fallbackLoggedAt < 60_000) return;
    this.log.warn(`Đổi cỡ ảnh đang bận (${reason}): ${this.fallbackCount} lần phát bản thay/chuyển hướng về ảnh gốc từ lần ghi trước.`);
    this.fallbackLoggedAt = now;
    this.fallbackCount = 0;
  }

  /**
   * Chỉ đổi cỡ ảnh đang nằm trong sản phẩm, nhãn, vật phẩm/quà đổi rác, banner chiến dịch, ảnh đại diện/bìa gian hàng: host Pancake/Cloudinary chung của mọi cửa hàng, kiểm host
   * thôi sẽ biến endpoint thành proxy ảnh cho bất kỳ ai. Danh sách URL http(s) nạp bằng MỘT truy vấn (ảnh base64 bị loại ngay trong
   * SQL), dùng chung cho mọi request, làm mới mỗi 5 phút và ngay khi ảnh được ghi (sản phẩm: admin, đồng bộ Pancake, đối tác; chiến dịch; gian hàng: ImageRegistryStale); tra một URL là tra trong bộ nhớ, không chạm DB.
   */
  private async isRegistered(raw: string): Promise<boolean> {
    let refreshing: Promise<void> | null = null;
    if (this.registryUntil === 0) {
      // Lần nạp đầu: chưa có danh sách nào để dùng tạm nên phải chờ (lỗi thì 503).
      await this.load(true);
    } else if ((this.stale.isStale() || Date.now() >= this.registryUntil) && Date.now() >= this.retryAfter) {
      // Hết hạn hoặc bị đánh dấu cũ: dùng danh sách hiện có, nạp lại ở nền để ảnh có trong danh sách (kể cả bản đã cache) không chờ truy vấn DB.
      refreshing = this.load(false);
    }
    if (this.registry.has(raw)) return true;
    // Chỉ khi KHÔNG thấy URL mới chờ: đang nạp lại thì chờ lần nạp đó; cờ cũ còn bật (đánh dấu đến giữa chừng) thì nạp thêm một lần; còn lại
    // ảnh vừa thêm/đổi trong ≤5 phút nạp lại một lần, cách nhau ít nhất 30 giây để URL lạ không kéo DB.
    await (refreshing ?? this.registryLoad ?? Promise.resolve()).catch(() => undefined);
    // Có người đã bắt đầu một lần nạp mới trong lúc ta chờ (cờ cũ đã được họ xoá): chờ nốt lần đó thay vì tưởng đã nạp xong.
    if (!this.registry.has(raw) && this.registryLoad) await this.registryLoad.catch(() => undefined);
    if (this.registry.has(raw)) return true;
    // Đang lùi sau lần nạp lỗi (retryAfter) thì không truy vấn: URL lạ không được kéo DB lúc DB đang sự cố.
    if (Date.now() >= this.retryAfter && (this.stale.isStale() || Date.now() - this.registryLoadedAt >= REGISTRY_MISS_RELOAD_MS)) await this.load(true);
    return this.registry.has(raw);
  }

  /** Gọi sau khi lưu ảnh sản phẩm: lần tra kế tiếp nạp lại danh sách (ở nền), không đợi hết 5 phút. */
  invalidateRegistry(): void {
    this.stale.markStale();
    this.ownVerified.clear();
  }

  /**
   * Nạp danh sách (gộp các lần gọi đồng thời vào một truy vấn). `wait` = chờ kết quả: lỗi ở lần nạp đầu thì 503, lỗi sau đó giữ danh sách cũ,
   * ghi cảnh báo và không thử lại trong 30 giây. Chạy nền (`wait` = false) thì không bao giờ ném.
   */
  private load(wait: boolean): Promise<void> {
    this.registryLoad ??= this.loadRegistry().finally(() => {
      this.registryLoad = null;
    });
    const job = this.registryLoad.catch((e: Error) => {
      if (this.registryUntil === 0) throw new ServiceUnavailableException('Máy chủ đang bận, thử lại sau.');
      this.log.warn(`Không làm mới được danh sách ảnh: ${e.message}`);
      this.retryAfter = Date.now() + 30_000;
      this.registryLoadedAt = Date.now();
    });
    return wait ? job : job.catch(() => undefined);
  }

  private async loadRegistry(): Promise<void> {
    // Xoá cờ TRƯỚC truy vấn để lần đánh dấu giữa chừng còn nguyên cho lần nạp kế; truy vấn lỗi thì trả cờ lại, kẻo đánh mất lần đánh dấu.
    const wasStale = this.stale.isStale();
    this.stale.clear();
    try {
      const vis = await this.visibility();
      const rows = await this.prisma.$queryRaw<{ u: string }[]>(registrySql(undefined, undefined, vis));
      this.registry = new Set(rows.map((r) => r.u));
      this.registryUntil = Date.now() + REGISTRY_TTL_MS;
      this.registryLoadedAt = Date.now();
    } catch (e) {
      if (wasStale) this.stale.markStale();
      throw e;
    }
  }

  /** Điều kiện hiển thị công khai của gian hàng (vai trò hưởng hoa hồng, cờ bắt duyệt) đọc từ cấu hình; không có cấu hình thì mặc định nghiêm nhất. */
  private async visibility() {
    return this.config ? loadPublicVisibility(this.config) : undefined;
  }

  /** Đếm theo IP: chỉ IP hay gửi sai ?v= bị chặn, khách khác (và ảnh hợp lệ của IP khác) không bị ảnh hưởng. */
  private ownMissLimited(client: string): boolean {
    const e = this.ownMisses.get(client);
    return !!e && Date.now() - e.start <= 60_000 && e.count >= OWN_MISSES_PER_MIN;
  }

  private noteOwnMiss(client: string): void {
    const now = Date.now();
    const e = this.ownMisses.get(client);
    if (e && now - e.start <= 60_000) e.count += 1;
    else {
      if (this.ownMisses.size >= MAX_MISS_TRACKED) {
        for (const [k, v] of this.ownMisses) if (now - v.start > 60_000) this.ownMisses.delete(k);
        if (this.ownMisses.size >= MAX_MISS_TRACKED) this.ownMisses.clear();
      }
      this.ownMisses.set(client, { start: now, count: 1 });
    }
  }

  private noteOwnVerified(ref: string): void {
    const now = Date.now();
    if (this.ownVerified.size >= MAX_OWN_VERIFIED) {
      for (const [k, until] of this.ownVerified) if (until <= now) this.ownVerified.delete(k);
      if (this.ownVerified.size >= MAX_OWN_VERIFIED) this.ownVerified.clear();
    }
    this.ownVerified.set(ref, now + OWN_VERIFIED_TTL_MS);
  }

  private async produce(source: string, key: string, width: number, format: ResizeFormat, client: string): Promise<ResizedImage> {
    if (format !== 'avif') return this.produceNow(source, key, width, format, client);
    this.avifJobs += 1;
    try {
      return await this.produceNow(source, key, width, format, client);
    } finally {
      this.avifJobs -= 1;
    }
  }

  private async produceNow(source: string, key: string, width: number, format: ResizeFormat, client: string): Promise<ResizedImage> {
    const own = parseOwnImagePath(source) !== null;
    // IP đã gửi quá nhiều ?v= sai (thường là NAT nhà mạng dùng chung): không đọc DB thay họ nữa, chuyển hướng về ảnh gốc (có hạn mức riêng).
    if (own && this.ownMissLimited(client)) throw this.fallback(source, 'miss-limit');
    const mime = FORMAT_MIME[format];
    const release = await this.acquire().catch(() => {
      throw this.fallback(source, 'queue-full');
    });
    let data: Buffer;
    try {
      // Ảnh của chính API: 404 khi sản phẩm bị từ chối, nhãn gỡ công bố, chiến dịch tắt hay ảnh đã thay (sai ?v=), kể cả khi bản đổi cỡ còn trong cache.
      // Lượt đọc DB này nằm trong hàng đợi đổi cỡ để số truy vấn đồng thời vẫn có trần (hàng đợi đầy thì 503).
      const input = await this.loadSource(source, client);
      if (own) {
        const hit = await this.readCache(key);
        if (hit) return { data: hit, mime, etag: `"${key}"` };
      }
      const pipeline = sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'error' }).rotate().resize({ width, withoutEnlargement: true });
      // Đổi tham số ở đây thì tăng RESIZE_PIPELINE_VERSION (image-resize.ts): cache bền qua deploy.
      data =
        format === 'avif'
          ? await this.withAvifSlot(() => pipeline.avif({ quality: 50, effort: 2 }).toBuffer())
          : await (format === 'webp' ? pipeline.webp({ quality: 78 }) : pipeline.jpeg({ quality: 80, mozjpeg: true })).toBuffer();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadGatewayException('Không xử lý được ảnh nguồn.');
    } finally {
      release();
    }
    await this.writeCache(key, data);
    return { data, mime, etag: `"${key}"` };
  }

  private async loadSource(source: string, client: string): Promise<Buffer> {
    const own = parseOwnImagePath(source);
    if (own) {
      const found = await this.own.get(own.kind, own.id, own.slot, own.version).catch((e: unknown) => {
        // DB lỗi không phải lỗi của khách: 503, không tính vào hạn mức sai ?v= của IP.
        if (e instanceof NotFoundException) return null;
        throw new ServiceUnavailableException('Máy chủ đang bận, thử lại sau.');
      });
      if (!found || !found.versionOk) {
        this.noteOwnMiss(client);
        throw new NotFoundException('Không tìm thấy ảnh.');
      }
      this.noteOwnVerified(ownRef(own));
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
    if (this.waiters.length >= MAX_QUEUED_JOBS) return Promise.reject(new Error('queue-full'));
    return new Promise((resolve) => this.waiters.push(() => resolve(take())));
  }

  /** Chỗ được trao thẳng cho việc đang chờ khi trả, nên số việc AVIF chạy cùng lúc không bao giờ vượt `MAX_CONCURRENT_AVIF`. */
  private async withAvifSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.avifActive < MAX_CONCURRENT_AVIF) this.avifActive += 1;
    else await new Promise<void>((resolve) => this.avifWaiters.push(resolve));
    try {
      return await run();
    } finally {
      const next = this.avifWaiters.shift();
      if (next) next();
      else this.avifActive -= 1;
    }
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
    if (this.cacheBytes === null) await (this.firstScan ??= this.prune().catch((e: Error) => this.log.warn(`Quét cache ảnh lỗi: ${e.message}`)));
    if ((this.cacheBytes ?? 0) + data.length > this.maxBytes) {
      if (Date.now() - this.lastPrune > PRUNE_MIN_GAP_WHEN_FULL_MS) {
        this.lastPrune = Date.now();
        await this.prune(true).catch(() => undefined);
      }
      if ((this.cacheBytes ?? 0) + data.length > this.maxBytes) return;
    }
    try {
      await fs.mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
      const tmp = `${file}.${createHash('md5').update(String(Math.random())).digest('hex').slice(0, 8)}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, file);
      this.cacheBytes = (this.cacheBytes ?? 0) + data.length;
      this.writtenBytes += data.length;
    } catch (e) {
      this.log.warn(`Không ghi được cache ảnh: ${(e as Error).message}`);
      return;
    }
    if (Date.now() - this.lastPrune > PRUNE_EVERY_MS) {
      this.lastPrune = Date.now();
      void this.prune().catch((e: Error) => this.log.warn(`Dọn cache ảnh lỗi: ${e.message}`));
    }
  }

  /** Xoá file quá tuổi, rồi xoá file cũ nhất cho tới khi dưới 80% trần dung lượng (khi đã vượt trần hoặc không còn chỗ cho file mới). */
  async prune(lowWater = false): Promise<{ removed: number; bytes: number }> {
    const writtenAtStart = this.writtenBytes;
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
    // Vượt trần thì dọn xuống mức thấp; chưa vượt thì chỉ xoá file quá tuổi.
    const target = lowWater || total > this.maxBytes ? this.maxBytes * PRUNE_LOW_WATER : this.maxBytes;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (now - f.mtime <= CACHE_MAX_AGE_MS && total <= target) break;
      // Không xoá được (file thuộc user khác): giữ trong tổng để dung lượng không bị đếm thiếu.
      if (!(await fs.rm(f.path, { force: true }).then(() => true, () => false))) continue;
      total -= f.size;
      removed += 1;
    }
    // File ghi trong lúc quét có thể đã được đếm ở trên: tính dư thì chỉ dọn sớm hơn, không vượt trần.
    this.cacheBytes = total + (this.writtenBytes - writtenAtStart);
    return { removed, bytes: total };
  }
}

/** Định danh ảnh của API kèm phiên bản (?v=), không gồm bề rộng/định dạng. */
function ownRef(own: NonNullable<ReturnType<typeof parseOwnImagePath>>): string {
  return `own:${own.kind}/${own.id}/${own.slot}?v=${own.version ?? ''}`;
}
