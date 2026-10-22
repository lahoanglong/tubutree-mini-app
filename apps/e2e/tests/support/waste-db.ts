import path from 'path';

/**
 * Trang /doi-rac/quy-dinh đọc thể lệ từ API thật ở phía máy chủ web và được dựng sẵn lúc `next build` (ISR 300 giây), nên mock trình duyệt không chạm tới khi API trả 200
 * và ghi DB giữa ca là quá muộn: web-gate.sh gọi hàm này sau seed, trước khi build. Chỉ ghi vào DB tạm của web-gate.sh (khớp đúng chuỗi kết nối của script), không bao giờ vào DB khác.
 */
const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;

export const WASTE_RULES_TEXT = 'Điểm Xanh là ưu đãi cho khách.\nKhông đổi ra tiền.';

export async function seedWasteRulesText(text: string): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!GATE_DB.test(url)) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.systemConfig.upsert({
      where: { key: 'waste.rules_text' },
      update: { value: text },
      create: { key: 'waste.rules_text', value: text, category: 'waste' },
    });
  } finally {
    await prisma.$disconnect();
  }
}
