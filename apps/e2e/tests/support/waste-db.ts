import path from 'path';

/**
 * Trang /doi-rac/quy-dinh đọc thể lệ từ API thật ở phía máy chủ web và được dựng sẵn lúc `next build` (ISR 300 giây), nên mock trình duyệt không chạm tới khi API trả 200
 * và ghi DB giữa ca là quá muộn: web-gate.sh và e2e.yml gọi hàm này trước khi build. Chỉ ghi vào DB tạm của web-gate.sh (khớp đúng chuỗi kết nối của script)
 * hoặc DB của job CI; không bao giờ vào DB khác.
 */
const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;
// Trên máy dev, localhost:5434 là Postgres dev dùng chung (docker-compose.dev.yml), nên chuỗi này chỉ được ghi khi chạy trong GitHub Actions.
const CI_DB = 'postgresql://tubu:tubu@localhost:5434/tubutree';

/** DB tạm mà spec được phép ghi: DB của web-gate.sh, hoặc DB của job CI. Mọi DB khác (dev dùng chung, PROD) thì không. */
export const writableTempDb = (url: string): boolean => GATE_DB.test(url) || (process.env.GITHUB_ACTIONS === 'true' && url === CI_DB);

export const WASTE_RULES_TEXT = 'Điểm Xanh là ưu đãi cho khách.\nKhông đổi ra tiền.';

/** Ghi một dòng `system_configs` vào DB tạm trước khi build web. Trả `false` khi không ghi (DB không phải DB tạm), để bước CI báo lỗi thay vì im lặng bỏ qua. */
export async function upsertGateConfig(key: string, value: string, category: string): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? '';
  if (!writableTempDb(url)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value, category } });
  } finally {
    await prisma.$disconnect();
  }
  return true;
}

/** Trả `false` khi không ghi (DB không phải DB tạm), để bước CI báo lỗi thay vì im lặng bỏ qua. */
export const seedWasteRulesText = (text: string): Promise<boolean> => upsertGateConfig('waste.rules_text', text, 'waste');

/**
 * Migration 20261128190000_w57_01_theme_seasonal đặt `theme.seasonal` = "christmas" (PROD bật Noel Xanh khi deploy). Trang chủ web dựng ở máy chủ (ISR) đọc mùa từ
 * API thật, còn mock trình duyệt (`publicConfig()` của mock-api.ts) mặc định "none": để nguyên thì khối mùa 184px có trong HTML rồi biến mất khi trình duyệt tải
 * lại cấu hình, mọi spec Trang chủ web lệch số đo và CLS. web-gate.sh và e2e.yml đưa DB tạm về "none" trước khi build; spec Noel bật mùa qua mock.
 */
export const seedSeasonalThemeNone = (): Promise<boolean> => upsertGateConfig('theme.seasonal', 'none', 'theme');
