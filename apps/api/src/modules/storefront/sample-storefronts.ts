import type { PrismaClient, StorefrontType, UserRole } from '@prisma/client';

/**
 * Gian hàng mẫu để giới thiệu tính năng trên máy thử. Chỉ chạy qua `pnpm --filter api seed:sample-storefronts`, không nằm trong
 * seed tham chiếu hay bước deploy nào. Dòng gian hàng mang `isSample = true` (khách thấy nhãn "Gian hàng mẫu", không lên danh sách
 * công khai, không ghi công đơn, không sinh hoa hồng); chủ gian hàng là tài khoản giả đánh dấu `metadata.sampleStorefront`.
 */

export const PROD_FLAG = '--i-know-this-is-prod';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Tên DB máy thử: race test (`tubutree_it`) và hai tên dành cho môi trường dev/UAT. Không có `tubutree` vì đó cũng là tên DB PROD (docker-compose.vietnix.yml), nên qua tunnel SSH về localhost sẽ lọt. */
export const ALLOWED_DB_NAMES: ReadonlySet<string> = new Set(['tubutree_it', 'tubutree_dev', 'tubutree_uat_tpl']);
/** DB dev cục bộ trong `.env.example` tên `tubutree`: phải xin đích danh bằng `--allow-db=tubutree`, khác hẳn cờ PROD. */
export const ALLOW_DB_FLAG_PREFIX = '--allow-db=';

/** Nơi script sẽ ghi, để in ra trước khi chạy (không có mật khẩu). */
export function describeDatabaseTarget(databaseUrl: string | undefined): string {
  try {
    const u = new URL(databaseUrl ?? '');
    return `${u.hostname}${u.port ? `:${u.port}` : ''}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`;
  } catch {
    return '(không đọc được DATABASE_URL)';
  }
}

export interface SampleStorefrontDef {
  slug: string;
  title: string;
  headerNote: string;
  themeColor: string;
  type: StorefrontType;
  ownerRole: UserRole;
  ownerName: string;
  isPartner: boolean;
  collections: { title: string; items: { productSlug: string; note?: string }[] }[];
}

export const SAMPLE_STOREFRONTS: SampleStorefrontDef[] = [
  {
    slug: 'mebimla',
    title: 'Góc Mẹ Bỉm Lá',
    headerNote: 'Đồ cho bé và mẹ bầu mình đã dùng thật, chia sẻ lại cho các mẹ đỡ mất công tìm.',
    themeColor: '#16a34a',
    type: 'CTV',
    ownerRole: 'AFFILIATE',
    ownerName: 'Mẹ Bỉm Lá',
    isPartner: false,
    collections: [
      {
        title: 'Cho bé',
        items: [
          { productSlug: 'dau-tram-be-cobote', note: 'Giữ ấm cho bé những hôm trời mưa, mùi dịu, không hắc.' },
          { productSlug: 'nuoc-tam-goi-be-cobote', note: 'Tắm xong da bé không bị khô.' },
          { productSlug: 'kem-chong-ham-cobote' },
          { productSlug: 'phan-rom-thao-duoc-cobote' },
          { productSlug: 'dau-massage-be-cobote' },
        ],
      },
      {
        title: 'Cho mẹ',
        items: [
          { productSlug: 'kem-duong-ba-bau-visante', note: 'Mình dùng suốt thai kỳ, thấy da bụng đỡ căng rát.' },
          { productSlug: 'nuoc-rua-binh-sua-fuwa3e' },
        ],
      },
    ],
  },
  {
    slug: 'bepxanhmay',
    title: 'Bếp Xanh Nhà Mây',
    headerNote: 'Đồ tẩy rửa sinh học dịu tay cho bếp và nhà cửa, mình dùng thật rồi mới giới thiệu.',
    themeColor: '#0d9488',
    type: 'CTV',
    ownerRole: 'AFFILIATE',
    ownerName: 'Bếp Xanh Nhà Mây',
    isPartner: false,
    collections: [
      {
        title: 'Bếp sạch dịu tay',
        items: [
          { productSlug: 'nuoc-rua-chen-fuwa3e' },
          { productSlug: 'nuoc-rua-tay-fuwa3e' },
          { productSlug: 'nuoc-lau-kinh-fuwa3e' },
        ],
      },
      {
        title: 'Giặt giũ và lau nhà',
        items: [{ productSlug: 'nuoc-giat-fuwa3e' }, { productSlug: 'nuoc-lau-san-fuwa3e' }],
      },
      {
        title: 'Chăm sóc cá nhân',
        items: [{ productSlug: 'dau-goi-buoi-po-lang' }, { productSlug: 'sua-tam-sa-po-lang' }],
      },
    ],
  },
  {
    slug: 'quatangxanh',
    title: 'Quà Xanh Gửi Tặng',
    headerNote: 'Gợi ý quà tặng sống xanh cho người thân, đồng nghiệp và dịp lễ: cà phê, mật ong, hạt dinh dưỡng.',
    themeColor: '#b45309',
    type: 'CTV',
    ownerRole: 'AFFILIATE',
    ownerName: 'Quà Xanh Gửi Tặng',
    isPartner: false,
    collections: [
      {
        title: 'Quà cho người thích cà phê',
        items: [
          { productSlug: 'arabica-cau-dat-le-plateau', note: 'Rang vừa, hậu ngọt, hợp làm quà biếu.' },
          { productSlug: 'cold-brew-tui-loc-le-plateau' },
          { productSlug: 'robusta-honey-le-plateau' },
        ],
      },
      {
        title: 'Quà ăn vặt lành mạnh',
        items: [
          { productSlug: 'mat-ong-rung-bhnong', note: 'Hộp quà Tết nhà mình năm nào cũng có hũ này.' },
          { productSlug: 'hat-dieu-rang-moc-bhnong' },
          { productSlug: 'granola-hat-sokfram' },
          { productSlug: 'gao-lut-huyet-rong-sokfram' },
        ],
      },
    ],
  },
];

export class SampleSeedRefusal extends Error {}

/** Giá trị DATABASE_URL hiệu lực: biến môi trường, hoặc dòng DATABASE_URL trong `.env` nếu biến chưa đặt (Prisma tự nạp `.env`, tsx thì không). */
export function effectiveDatabaseUrl(env: NodeJS.ProcessEnv, dotenvText: string | null): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const m = dotenvText ? /^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(dotenvText) : null;
  return m?.[1];
}

/**
 * Chỉ máy thử: từ chối khi NODE_ENV=production hoặc DATABASE_URL không trỏ localhost/127.0.0.1. Cờ `--i-know-this-is-prod` là
 * lối dành cho chủ khi đã đồng ý đưa mẫu lên PROD; thiếu cờ thì không có đường nào khác để vượt qua.
 */
export function assertSampleSeedAllowed(opts: { env: NodeJS.ProcessEnv; databaseUrl: string | undefined; argv: readonly string[] }): void {
  if (opts.argv.includes(PROD_FLAG)) return;
  if (opts.env.NODE_ENV === 'production') {
    throw new SampleSeedRefusal(`Từ chối chạy khi NODE_ENV=production. Gian hàng mẫu chỉ dành cho máy thử; muốn đưa lên PROD thì thêm cờ ${PROD_FLAG}.`);
  }
  if (!opts.databaseUrl) throw new SampleSeedRefusal('Từ chối chạy: không tìm thấy DATABASE_URL nên không biết đang ghi vào đâu.');
  let host: string;
  let url: URL;
  try {
    url = new URL(opts.databaseUrl);
    host = url.hostname.toLowerCase();
  } catch {
    throw new SampleSeedRefusal('Từ chối chạy: DATABASE_URL không đọc được nên không xác nhận được đây là máy thử.');
  }
  // `?host=` và `?hostaddr=` ghi đè máy chủ trong URL (libpq/Prisma), nên URL trông như localhost vẫn có thể nối ra ngoài.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) {
    throw new SampleSeedRefusal(`Từ chối chạy: DATABASE_URL có tham số host/hostaddr nên không xác nhận được máy chủ thật. Muốn đưa lên PROD thì thêm cờ ${PROD_FLAG}.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new SampleSeedRefusal(`Từ chối chạy: DATABASE_URL trỏ tới "${host}", không phải localhost hoặc 127.0.0.1. Gian hàng mẫu chỉ dành cho máy thử; muốn đưa lên PROD thì thêm cờ ${PROD_FLAG}.`);
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const allowed = opts.argv.filter((a) => a.startsWith(ALLOW_DB_FLAG_PREFIX)).map((a) => a.slice(ALLOW_DB_FLAG_PREFIX.length));
  if (!ALLOWED_DB_NAMES.has(dbName) && !allowed.includes(dbName)) {
    throw new SampleSeedRefusal(`Từ chối chạy: tên DB "${dbName}" không nằm trong danh sách máy thử (${[...ALLOWED_DB_NAMES].join(', ')}). DB dev cục bộ thật sự tên "${dbName}" thì thêm ${ALLOW_DB_FLAG_PREFIX}${dbName}; PROD thì cờ ${PROD_FLAG}.`);
  }
}

type Db = Pick<PrismaClient, 'user' | 'storefront' | 'storefrontCollection' | 'product' | '$transaction'>;

export interface SampleSeedResult {
  slug: string;
  action: 'created' | 'updated';
  items: number;
  missingProducts: string[];
}

const ownerCode = (slug: string) => slug.toUpperCase();

export async function seedSampleStorefronts(db: Db, defs: readonly SampleStorefrontDef[] = SAMPLE_STOREFRONTS): Promise<SampleSeedResult[]> {
  const results: SampleSeedResult[] = [];
  for (const def of defs) {
    const wanted = [...new Set(def.collections.flatMap((c) => c.items.map((i) => i.productSlug)))];
    const products = await db.product.findMany({ where: { slug: { in: wanted } }, select: { id: true, slug: true } });
    const idBySlug = new Map(products.map((p) => [p.slug, p.id]));
    const missingProducts = wanted.filter((s) => !idBySlug.has(s));
    if (idBySlug.size === 0) {
      throw new SampleSeedRefusal(`Không có sản phẩm nào của "${def.slug}" trong DB. Chạy pnpm --filter api prisma:seed (dữ liệu máy thử) trước.`);
    }

    const result = await db.$transaction(async (tx) => {
      const code = ownerCode(def.slug);
      const owner = await tx.user.findUnique({ where: { referralCode: code }, select: { id: true, metadata: true } });
      if (owner && (owner.metadata as { sampleStorefront?: boolean } | null)?.sampleStorefront !== true) {
        throw new SampleSeedRefusal(`Mã giới thiệu ${code} đã thuộc tài khoản thật; không ghi đè. Đổi slug mẫu hoặc gỡ tài khoản đó.`);
      }
      const existing = await tx.storefront.findUnique({ where: { slug: def.slug }, select: { id: true, isSample: true } });
      if (existing && !existing.isSample) {
        throw new SampleSeedRefusal(`Slug ${def.slug} đã là gian hàng thật; không ghi đè.`);
      }
      const ownerId =
        owner?.id ??
        (
          await tx.user.create({
            data: { referralCode: code, fullName: def.ownerName, role: def.ownerRole, metadata: { sampleStorefront: true } },
            select: { id: true },
          })
        ).id;
      const now = new Date();
      const fields = {
        type: def.type,
        isPartner: def.isPartner,
        isSample: true,
        ownerUserId: ownerId,
        title: def.title,
        headerNote: def.headerNote,
        themeColor: def.themeColor,
        isPublished: true,
        publishedAt: now,
        approvedAt: now,
        takenDownAt: null,
        takenDownReason: null,
      };
      const sf = existing
        ? await tx.storefront.update({ where: { id: existing.id }, data: fields, select: { id: true } })
        : await tx.storefront.create({ data: { slug: def.slug, ...fields }, select: { id: true } });
      await tx.storefrontCollection.deleteMany({ where: { storefrontId: sf.id } });
      let items = 0;
      for (const [ci, col] of def.collections.entries()) {
        const rows = col.items.filter((i) => idBySlug.has(i.productSlug));
        if (rows.length === 0) continue;
        await tx.storefrontCollection.create({
          data: {
            storefrontId: sf.id,
            title: col.title,
            layout: 'GRID',
            sortOrder: ci,
            items: { create: rows.map((i, ii) => ({ productId: idBySlug.get(i.productSlug)!, note: i.note ?? null, sortOrder: ii })) },
          },
        });
        items += rows.length;
      }
      return { slug: def.slug, action: (existing ? 'updated' : 'created') as 'created' | 'updated', items, missingProducts };
    });
    results.push(result);
  }
  return results;
}

export interface SampleRemoveResult {
  storefronts: number;
  owners: number;
  keptOwners: string[];
}

/**
 * Gỡ mọi gian hàng đánh dấu mẫu và tài khoản chủ do script tạo. Phần xoá gian hàng + hạ chủ về khách nằm trong một giao dịch: nếu
 * dừng giữa chừng thì không còn chủ mẫu nào giữ vai CTV/đại lý với mã giới thiệu cũ. Sau đó mới thử xoá tài khoản; tài khoản đã
 * phát sinh dữ liệu khác (khoá ngoại) được giữ lại ở vai khách, bị khoá (không nhận thưởng giới thiệu), mã giới thiệu đổi theo
 * nguyên id (cuid tạo liền nhau chung 8 ký tự đầu nên không cắt ngắn), và báo ra.
 */
export async function removeSampleStorefronts(db: Pick<PrismaClient, 'user' | 'storefront' | '$transaction'>): Promise<SampleRemoveResult> {
  const { storefronts, ownerIds } = await db.$transaction(async (tx) => {
    const samples = await tx.storefront.findMany({ where: { isSample: true }, select: { id: true } });
    for (const sf of samples) await tx.storefront.delete({ where: { id: sf.id } });
    const owners = await tx.user.findMany({ where: { metadata: { path: ['sampleStorefront'], equals: true } }, select: { id: true } });
    for (const u of owners) {
      await tx.user.update({ where: { id: u.id }, data: { role: 'CUSTOMER', isBlocked: true, referralCode: `SAMPLE-GONE-${u.id.toUpperCase()}` } });
    }
    return { storefronts: samples.length, ownerIds: owners.map((u) => u.id) };
  });
  let removedOwners = 0;
  const keptOwners: string[] = [];
  for (const id of ownerIds) {
    try {
      await db.user.delete({ where: { id } });
      removedOwners++;
    } catch {
      keptOwners.push(id);
    }
  }
  return { storefronts, owners: removedOwners, keptOwners };
}
