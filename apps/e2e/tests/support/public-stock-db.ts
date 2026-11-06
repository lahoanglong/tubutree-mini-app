import { createHmac, randomBytes } from 'crypto';
import path from 'path';
import { seedDatabaseUrl } from './a11y-db';
import { parseEnvFile } from './env-file';
import { writableTempDb } from './waste-db';

/**
 * Dữ liệu cho spec tồn công khai (W31): một khách riêng, một sản phẩm riêng với tồn ở mọi vùng, giỏ có dòng vượt tồn, một đơn đã giao.
 * Chỉ ghi vào DB tạm (writableTempDb). Id sản phẩm bắt đầu bằng "zz" để xếp cuối danh sách mặc định (isFeatured, id), spec khác lấy sản phẩm đầu danh sách không đụng tới.
 */
export const REAL = { mid: 57, low: 8, over: 25, virtual: 99_999_988 } as const;
export const OVER_QTY = 30;

export interface StockWorld {
  token: string;
  slug: string;
  orderCode: string;
  ids: { user: string; product: string; order: string; mid: string; low: string; over: string; virtual: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prisma = any;

function prismaFor(url: string): Prisma {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  return new PrismaClient({ datasources: { db: { url } } });
}

function signAccessToken(userId: string): string | null {
  const secret = process.env.JWT_ACCESS_SECRET ?? parseEnvFile(path.resolve(__dirname, '../../../api/.env'))['JWT_ACCESS_SECRET'] ?? '';
  if (secret.length < 16) return null;
  const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: userId, role: 'CUSTOMER', iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}

/** `null` khi DB không phải DB tạm hoặc thiếu khoá ký JWT. */
export async function seedStockWorld(): Promise<StockWorld | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  const tag = randomBytes(4).toString('hex');
  const userId = `e2e-w31-${tag}`;
  const token = signAccessToken(userId);
  if (!token) return null;
  const prisma = prismaFor(url);
  try {
    await prisma.user.create({ data: { id: userId, role: 'CUSTOMER', fullName: 'Khách W31', referralCode: `W31${tag}`.toUpperCase() } });
    const productId = `zz-e2e-w31-${tag}`;
    const slug = `e2e-w31-ton-kho-${tag}`;
    await prisma.product.create({
      data: {
        id: productId, slug, name: `Nước rửa chén W31 ${tag}`, brand: 'Tubu Tree', description: 'Sản phẩm thử tồn kho công khai.', basePrice: 45_000,
        // Cũ nhất theo ngày tạo: kệ "Mới nhất" và mọi cách xếp theo ngày không đưa sản phẩm này lên đầu cho spec khác.
        createdAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    const vid = (key: keyof typeof REAL) => `${productId}-${key}`;
    const variation = (key: keyof typeof REAL, name: string) =>
      prisma.variation.create({
        data: { id: vid(key), productId, sku: `W31-${tag}-${key}`, name, attributes: { size: name }, retailPrice: 45_000, stock: REAL[key], weight: 500 },
      });
    await variation('mid', '500ml');
    await variation('low', '1 lít');
    await variation('over', '2 lít');
    await variation('virtual', '5 lít');
    await prisma.cart.create({
      data: {
        userId,
        items: { create: [{ variationId: vid('mid'), quantity: 2 }, { variationId: vid('low'), quantity: 3 }, { variationId: vid('over'), quantity: OVER_QTY }, { variationId: vid('virtual'), quantity: 1 }] },
      },
    });
    const orderCode = `E2EW31${tag.toUpperCase()}`;
    const lines = (['mid', 'over', 'low'] as const).map((key) => ({
      variationId: vid(key), productName: `Nước rửa chén W31 ${tag}`, productSlug: slug, variationName: key, unitPrice: 45_000, quantity: 1, total: 45_000,
    }));
    const order = await prisma.order.create({
      data: {
        code: orderCode, userId, type: 'RETAIL', status: 'DELIVERED', subtotal: 135_000, total: 135_000, paymentMethod: 'COD', paymentStatus: 'PAID',
        shippingAddress: { recipient: 'Khách W31', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Phường Ba Đình', street: '12 Phố Huế' },
        items: { create: lines },
      },
    });
    return {
      token, slug, orderCode,
      ids: { user: userId, product: productId, order: order.id, mid: vid('mid'), low: vid('low'), over: vid('over'), virtual: vid('virtual') },
    };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Xoá dữ liệu của `seedStockWorld`, không ném lỗi giữa chừng (hook afterAll lỗi là đỏ cả lượt). Bảng khác có thể đã ghi khoá ngoại tới sản phẩm hay khách
 * (lượt xem...): sản phẩm xoá không được thì tắt để danh sách không còn thấy; khách xoá không được thì để lại trong DB tạm.
 */
export async function removeStockWorld(world: StockWorld): Promise<void> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return;
  const prisma = prismaFor(url);
  try {
    const tried = (op: Promise<unknown>) => op.then(() => true, () => false);
    await tried(prisma.orderItem.deleteMany({ where: { orderId: world.ids.order } }));
    await tried(prisma.order.deleteMany({ where: { id: world.ids.order } }));
    await tried(prisma.cart.deleteMany({ where: { userId: world.ids.user } }));
    const gone =
      (await tried(prisma.variation.deleteMany({ where: { productId: world.ids.product } }))) &&
      (await tried(prisma.product.deleteMany({ where: { id: world.ids.product } })));
    if (!gone) await tried(prisma.product.updateMany({ where: { id: world.ids.product }, data: { isActive: false } }));
    await tried(prisma.user.deleteMany({ where: { id: world.ids.user } }));
  } finally {
    await prisma.$disconnect();
  }
}
