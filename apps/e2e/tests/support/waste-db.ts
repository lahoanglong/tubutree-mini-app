import path from 'path';

/**
 * Trang /doi-rac/quy-dinh đọc thể lệ từ API thật ở phía máy chủ web và được dựng sẵn lúc `next build` (ISR 300 giây), nên mock trình duyệt không chạm tới khi API trả 200
 * và ghi DB giữa ca là quá muộn: web-gate.sh và e2e.yml gọi hàm này trước khi build. Chỉ ghi vào DB tạm của web-gate.sh (khớp đúng chuỗi kết nối của script)
 * hoặc DB của job CI; không bao giờ vào DB khác.
 */
const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;
// Trên máy dev, localhost:5434 là Postgres dev dùng chung (docker-compose.dev.yml), nên chuỗi này chỉ được ghi khi chạy trong GitHub Actions.
const CI_DB = 'postgresql://tubu:tubu@localhost:5434/tubutree';

const writable = (url: string): boolean => GATE_DB.test(url) || (process.env.GITHUB_ACTIONS === 'true' && url === CI_DB);

export const WASTE_RULES_TEXT = 'Điểm Xanh là ưu đãi cho khách.\nKhông đổi ra tiền.';

/** Trả `false` khi không ghi (DB không phải DB tạm), để bước CI báo lỗi thay vì im lặng bỏ qua. */
export async function seedWasteRulesText(text: string): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? '';
  if (!writable(url)) return false;
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
  return true;
}
