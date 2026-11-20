import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * w11-02 (Bộ Công Thương): migration sửa đúng từng câu của chính sách bảo mật / vận chuyển đã lưu trên PROD cho khớp luật đang chạy
 * (Đổi rác chỉ còn mang tới điểm nhận + shipper lấy tận nhà/thu kèm đơn; lịch kho TP.HCM 1–2, tỉnh khác 2–4 ngày làm việc) và ghi
 * "Cập nhật ngày" ở dòng hiệu lực của bản có đổi, trên Postgres THẬT.
 */
const SQL = readFileSync(join(__dirname, '../../prisma/migrations/20261120233000_w11_02_legal_live_rules/migration.sql'), 'utf-8');

const BAO_MAT = [
  'Hiệu lực từ ngày 31/10/2026.',
  '',
  'Chúng tôi xử lý thông tin cá nhân theo pháp luật Việt Nam, gồm Luật Bảo vệ dữ liệu cá nhân 2025 (số 91/2025/QH15) và Nghị định 356/2025/NĐ-CP hướng dẫn luật này.',
  '',
  '- Nếu bạn tham gia Đổi rác lấy quà: loại và số lượng vỏ, bao bì bạn gửi, cách gửi (mang tới điểm nhận, gửi về kho hoặc thu kèm đơn hàng), mã vận đơn khi gửi về kho, kết quả kiểm đếm, quà đã đổi.',
  '- **Đơn vị vận chuyển**: họ tên. Nếu bạn chọn thu gom vỏ, bao bì kèm đơn hàng (Đổi rác lấy quà), thông tin này còn đến Gomdon.',
].join('\n');

const VAN_CHUYEN = [
  'Hiệu lực từ ngày 31/10/2026.',
  '',
  '## 5. Thời gian giao hàng dự kiến',
  '',
  '- Nội thành Thành phố Hồ Chí Minh: 1–2 ngày làm việc.',
  '- Các tỉnh thành khác: 3–5 ngày làm việc.',
  '- Với hàng do Tubu Tree giao, ứng dụng hiển thị ngày giao dự kiến ở bước thanh toán và chi tiết đơn. Ngày này tính theo ngày lịch kể từ lúc bạn đặt hàng nên chỉ để tham khảo; thời gian giao áp dụng là thời gian ở hai dòng trên.',
  '- Thời gian tính từ lúc đơn được xác nhận.',
].join('\n');

const KEYS = ['legal.bao-mat', 'legal.van-chuyen'];

describe('migration w11_02_legal_live_rules (real Postgres)', () => {
  let prisma: PrismaService;

  const put = async (key: string, value: Prisma.InputJsonValue | typeof Prisma.JsonNull) =>
    prisma.systemConfig.upsert({ where: { key }, create: { key, value, category: 'legal' }, update: { value } });
  const read = async (key: string) => (await prisma.systemConfig.findUniqueOrThrow({ where: { key } })).value;
  const history = () => prisma.systemConfigHistory.findMany({ where: { key: { in: KEYS } }, orderBy: { key: 'asc' } });
  /** Ngày migration ghi vào dòng "Cập nhật ngày", lấy từ chính Postgres để không lệch khi test chạy qua nửa đêm. */
  const todayVn = async () =>
    (await prisma.$queryRawUnsafe<{ d: string }[]>(`SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') AS d`))[0]!.d;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.systemConfigHistory.deleteMany({ where: { key: { in: KEYS } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('bản PROD còn câu cũ: thay đúng các câu đó, giữ phần còn lại, ghi lịch sử một lần; chạy lại không đổi gì', async () => {
    await put('legal.bao-mat', BAO_MAT);
    await put('legal.van-chuyen', VAN_CHUYEN);

    expect(await prisma.$executeRawUnsafe(SQL)).toBe(2);
    const header = `Hiệu lực từ ngày 31/10/2026. Cập nhật ngày ${await todayVn()}.`;

    const bm = (await read('legal.bao-mat')) as string;
    expect(bm.startsWith(`${header}\n\nChúng tôi xử lý`)).toBe(true);
    expect(bm).not.toContain('gửi về kho');
    expect(bm).toContain('cách gửi (mang tới điểm nhận, shipper lấy tận nhà hoặc thu kèm đơn hàng), mã vận đơn của chuyến lấy hàng (nếu có), kết quả kiểm đếm, quà đã đổi.');
    expect(bm).toContain('Nếu bạn chọn shipper lấy tận nhà hoặc thu gom vỏ, bao bì kèm đơn hàng (Đổi rác lấy quà), thông tin này còn đến Gomdon.');
    expect(bm).toContain('hướng dẫn luật này, cùng các quy định về bảo vệ thông tin cá nhân trong thương mại điện tử tại Nghị định 52/2013/NĐ-CP, Nghị định 85/2021/NĐ-CP');

    const vc = (await read('legal.van-chuyen')) as string;
    expect(vc).toBe(
      [
        header,
        '',
        '## 5. Thời gian giao hàng dự kiến',
        '',
        '- Nội thành Thành phố Hồ Chí Minh: 1–2 ngày làm việc.',
        '- Các tỉnh thành khác: 2–4 ngày làm việc.',
        '- Kho Tubu Tree xuất hàng từ Thứ 2 đến Thứ 7, trừ ngày lễ. Đơn đặt trước 15:00 của ngày kho làm việc thường được xuất kho trong ngày, đặt sau giờ này thì xuất kho vào ngày làm việc kế tiếp. Ngày nhận dự kiến hiển thị trong ứng dụng chỉ để tham khảo; thời gian giao áp dụng là thời gian ở hai dòng trên.',
        '- Thời gian tính từ lúc đơn được xác nhận.',
      ].join('\n'),
    );

    const h = await history();
    expect(h.map((r) => [r.key, r.changedBy, r.oldValue, r.newValue])).toEqual([
      ['legal.bao-mat', 'migration:w11_02_legal_live_rules', BAO_MAT, bm],
      ['legal.van-chuyen', 'migration:w11_02_legal_live_rules', VAN_CHUYEN, vc],
    ]);

    expect(await prisma.$executeRawUnsafe(SQL)).toBe(0);
    expect(await read('legal.bao-mat')).toBe(bm);
    expect(await read('legal.van-chuyen')).toBe(vc);
    expect(await history()).toHaveLength(2);
  });

  it('bản admin tự viết lại (không còn câu cũ) hoặc chưa nhập (rỗng, JSON null): không đụng, không ghi lịch sử', async () => {
    const own = 'Hiệu lực từ ngày 31/10/2026.\n\n## Thời gian giao\n\n- Các tỉnh thành khác: 3 đến 6 ngày.';
    await put('legal.van-chuyen', own);
    await put('legal.bao-mat', '');
    expect(await prisma.$executeRawUnsafe(SQL)).toBe(0);
    expect(await read('legal.van-chuyen')).toBe(own);
    expect(await read('legal.bao-mat')).toBe('');

    await put('legal.bao-mat', Prisma.JsonNull);
    expect(await prisma.$executeRawUnsafe(SQL)).toBe(0);
    expect(await read('legal.bao-mat')).toBeNull();
    expect(await history()).toHaveLength(0);
  });

  it('chỉ còn một câu cũ: thay câu đó, câu admin đã sửa giữ nguyên; chữ lưu dạng NFD vẫn khớp', async () => {
    const edited = VAN_CHUYEN.replace('- Các tỉnh thành khác: 3–5 ngày làm việc.', '- Các tỉnh thành khác: 3–6 ngày làm việc.');
    await put('legal.van-chuyen', edited.normalize('NFD'));
    await put('legal.bao-mat', '');
    expect(await prisma.$executeRawUnsafe(SQL)).toBe(1);
    const vc = (await read('legal.van-chuyen')) as string;
    expect(vc).toContain('- Các tỉnh thành khác: 3–6 ngày làm việc.');
    expect(vc).toContain('- Kho Tubu Tree xuất hàng từ Thứ 2 đến Thứ 7');
    expect(vc).not.toContain('ngày lịch');
    expect(vc.startsWith(`Hiệu lực từ ngày 31/10/2026. Cập nhật ngày ${await todayVn()}.\n`)).toBe(true);
  });

  it('dòng hiệu lực đã có "Cập nhật ngày" cũ: thay bằng ngày mới, không nhân đôi', async () => {
    await put('legal.bao-mat', '');
    await put('legal.van-chuyen', VAN_CHUYEN.replace('Hiệu lực từ ngày 31/10/2026.', 'Hiệu lực từ ngày 31/10/2026. Cập nhật ngày 05/11/2026.'));
    expect(await prisma.$executeRawUnsafe(SQL)).toBe(1);
    const vc = (await read('legal.van-chuyen')) as string;
    expect(vc.split('\n')[0]).toBe(`Hiệu lực từ ngày 31/10/2026. Cập nhật ngày ${await todayVn()}.`);
    expect(vc.match(/Cập nhật ngày/g)).toHaveLength(1);
  });
});
