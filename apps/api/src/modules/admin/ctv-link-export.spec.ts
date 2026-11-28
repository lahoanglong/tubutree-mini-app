import type { PrismaService } from '../../prisma/prisma.service';
import { EXPORT_BATCH } from './admin-export';
import { CTV_LINK_CSV_HEADERS, NO_LINK_TARGET_LABEL, ctvLinkCsvChunks, linkTargetText } from './ctv-link-export';

async function collect(gen: AsyncGenerator<string>) {
  let out = '';
  for await (const c of gen) out += c;
  return out;
}

/** Tách một dòng CSV (ô trong nháy kép có thể chứa dấu phẩy và nháy lồng `""`). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

type SqlArg = { strings: readonly string[]; values: unknown[] };
const sqlText = (q: SqlArg) => q.strings.join('?');

interface Fixture {
  ids: string[][];
  users: { id: string; fullName: string | null; phone: string | null; referralCode: string; role: string }[];
  links: { userId: string; shortCode: string; targetType: string; targetId: string | null; clicks: number; createdAt: Date }[];
  tallies: { user_id: string; link_code: string | null; status: string; n: number; base: bigint; amount: bigint }[];
  products?: { id: string; slug: string; name: string; isActive: boolean; approvalStatus: string; affiliateBlocked: boolean }[];
}

function fakePrisma(f: Fixture) {
  let batch = 0;
  const queryRaw = jest.fn(async (q: SqlArg) => {
    const s = sqlText(q);
    if (s.includes('UNION')) return (f.ids[batch++] ?? []).map((id) => ({ id }));
    if (s.includes('"commissionableTotal"')) return f.tallies;
    throw new Error(`truy vấn lạ: ${s}`);
  });
  const mocks = {
    $queryRaw: queryRaw,
    user: { findMany: jest.fn(async () => f.users) },
    affiliateLink: { findMany: jest.fn(async () => f.links) },
    product: { findMany: jest.fn(async () => f.products ?? []) },
    category: { findMany: jest.fn(async () => []) },
  };
  return { prisma: mocks as unknown as PrismaService, queryRaw, mocks };
}

const col = (name: string) => CTV_LINK_CSV_HEADERS.indexOf(name);
const rowsOf = (csv: string) => csv.trimEnd().split('\r\n').map(parseLine);

describe('ctvLinkCsvChunks (hoa hồng CTV theo link)', () => {
  it('mỗi link một dòng, hoa hồng chia theo trạng thái; đơn ngoài link gom một dòng "Không qua link"; tổng = cộng bốn trạng thái', async () => {
    const { prisma } = fakePrisma({
      ids: [['u1', 'u2']],
      users: [
        { id: 'u1', fullName: 'Lan CTV', phone: '0901234567', referralCode: 'LAN01', role: 'AFFILIATE' },
        { id: 'u2', fullName: 'Hùng, Đại lý', phone: null, referralCode: '000123', role: 'DEALER' },
      ],
      links: [
        { userId: 'u1', shortCode: 'AbCd1', targetType: 'HOMEPAGE', targetId: null, clicks: 40, createdAt: new Date('2026-11-01T01:00:00Z') },
        { userId: 'u1', shortCode: 'XyZ99', targetType: 'PRODUCT', targetId: 'p1', clicks: 7, createdAt: new Date('2026-11-02T01:00:00Z') },
      ],
      products: [{ id: 'p1', slug: 'nuoc-rua', name: 'Nước rửa chén 1L', isActive: true, approvalStatus: 'APPROVED', affiliateBlocked: false }],
      tallies: [
        { user_id: 'u1', link_code: 'AbCd1', status: 'PAID', n: 2, base: 300_000n, amount: 30_000n },
        { user_id: 'u1', link_code: 'AbCd1', status: 'LOCKED', n: 1, base: 100_000n, amount: 10_000n },
        { user_id: 'u1', link_code: null, status: 'APPROVED', n: 1, base: 50_000n, amount: 5_000n },
        { user_id: 'u2', link_code: null, status: 'PENDING', n: 3, base: 3_000_000_000n, amount: 300_000_000n },
      ],
    });
    const lines = rowsOf(await collect(ctvLinkCsvChunks(prisma)));
    expect(lines[0]).toEqual(CTV_LINK_CSV_HEADERS);
    expect(lines).toHaveLength(5);
    const [home, product, u1NoLink, u2NoLink] = lines.slice(1) as string[][];

    expect(home![col('Mã người dùng')]).toBe('u1');
    expect(home![col('Mã giới thiệu')]).toBe('LAN01');
    expect(home![col('Tên CTV')]).toBe('Lan CTV');
    expect(home![col('SĐT CTV')]).toBe('="0901234567"');
    expect(home![col('Vai trò')]).toBe('CTV');
    expect(home![col('Mã link')]).toBe('AbCd1');
    expect(home![col('Đích link')]).toBe('Trang chủ');
    expect(home![col('Ngày tạo link')]).toBe('08:00 01/11/2026');
    expect(home![col('Lượt bấm')]).toBe('40');
    expect(home![col('Số đơn')]).toBe('3');
    expect(home![col('Doanh số tính hoa hồng (VNĐ)')]).toBe('400000');
    expect(home![col('HH đơn chưa giao (VNĐ)')]).toBe('0');
    expect(home![col('HH đang giữ sau giao (VNĐ)')]).toBe('10000');
    expect(home![col('HH đã duyệt chờ chi (VNĐ)')]).toBe('0');
    expect(home![col('HH đã chi (VNĐ)')]).toBe('30000');
    expect(home![col('Tổng hoa hồng trước thuế (VNĐ)')]).toBe('40000');

    // Link chưa có đơn vẫn ra dòng (lượt bấm là số duy nhất), không mượn số của link khác.
    expect(product![col('Đích link')]).toBe('Sản phẩm: Nước rửa chén 1L');
    expect(product![col('Lượt bấm')]).toBe('7');
    expect(product!.slice(col('Số đơn'))).toEqual(['0', '0', '0', '0', '0', '0', '0']);

    expect(u1NoLink![col('Mã link')]).toBe('');
    expect(u1NoLink![col('Đích link')]).toBe(NO_LINK_TARGET_LABEL);
    expect(u1NoLink![col('Lượt bấm')]).toBe('');
    expect(u1NoLink![col('HH đã duyệt chờ chi (VNĐ)')]).toBe('5000');
    expect(u1NoLink![col('Tổng hoa hồng trước thuế (VNĐ)')]).toBe('5000');

    // Người chỉ có hoa hồng ngoài link (đại lý từng là CTV): một dòng; tên có dấu phẩy nằm trong nháy; mã toàn số giữ số 0 đầu; số vượt Int4 không bị kẹp.
    expect(u2NoLink![col('Tên CTV')]).toBe('Hùng, Đại lý');
    expect(u2NoLink![col('Mã giới thiệu')]).toBe('="000123"');
    expect(u2NoLink![col('SĐT CTV')]).toBe('');
    expect(u2NoLink![col('Vai trò')]).toBe('Đại lý');
    expect(u2NoLink![col('Doanh số tính hoa hồng (VNĐ)')]).toBe('3000000000');
    expect(u2NoLink![col('HH đơn chưa giao (VNĐ)')]).toBe('300000000');
  });

  it('kế toán không thấy SĐT đầy đủ thì chỉ nhận 3 số cuối của SĐT CTV', async () => {
    const { prisma } = fakePrisma({
      ids: [['u1']],
      users: [{ id: 'u1', fullName: 'Lan', phone: '0901234567', referralCode: 'LAN01', role: 'AFFILIATE' }],
      links: [{ userId: 'u1', shortCode: 'AbCd1', targetType: 'DEAL', targetId: null, clicks: 1, createdAt: new Date('2026-11-01T01:00:00Z') }],
      tallies: [],
    });
    const lines = rowsOf(await collect(ctvLinkCsvChunks(prisma, { maskPhones: true })));
    expect(lines[1]![col('SĐT CTV')]).toBe('*******567');
    expect(lines[1]![col('Đích link')]).toBe('Giờ vàng');
  });

  it('truy vấn hoa hồng bỏ dòng REJECTED, chỉ ghép link của đúng người hưởng; trạng thái lạ không cộng vào cột nào', async () => {
    const { prisma, queryRaw } = fakePrisma({
      ids: [['u1']],
      users: [{ id: 'u1', fullName: 'Lan', phone: null, referralCode: 'LAN01', role: 'AFFILIATE' }],
      links: [],
      tallies: [{ user_id: 'u1', link_code: null, status: 'REJECTED', n: 9, base: 9n, amount: 9n }],
    });
    expect(rowsOf(await collect(ctvLinkCsvChunks(prisma)))).toHaveLength(1);
    const tallySql = queryRaw.mock.calls.map((c) => c[0]).find((q) => sqlText(q).includes('"commissionableTotal"'))!;
    const s = sqlText(tallySql);
    expect(s).toContain(`c.status <> 'REJECTED'`);
    expect(s).toContain(`l."userId" = c."affiliateUserId"`);
    expect(tallySql.values).toEqual(['u1']);
  });

  it('không có CTV nào: chỉ dòng tiêu đề, không truy vấn người hay link', async () => {
    const { prisma, mocks } = fakePrisma({ ids: [[]], users: [], links: [], tallies: [] });
    expect(await collect(ctvLinkCsvChunks(prisma))).toBe(`${CTV_LINK_CSV_HEADERS.join(',')}\r\n`);
    expect(mocks.user.findMany).not.toHaveBeenCalled();
    expect(mocks.affiliateLink.findMany).not.toHaveBeenCalled();
  });

  it('đọc người theo lô EXPORT_BATCH: lô đủ thì hỏi tiếp sau mã cuối, lô thiếu thì dừng', async () => {
    const first = Array.from({ length: EXPORT_BATCH }, (_, i) => `u${String(i).padStart(4, '0')}`);
    const { prisma, queryRaw } = fakePrisma({ ids: [first, ['u9999']], users: [], links: [], tallies: [] });
    await collect(ctvLinkCsvChunks(prisma));
    const idQueries = queryRaw.mock.calls.map((c) => c[0]).filter((q) => sqlText(q).includes('UNION'));
    expect(idQueries).toHaveLength(2);
    expect(sqlText(idQueries[0]!)).not.toContain('u.id >');
    expect(sqlText(idQueries[1]!)).toContain('u.id >');
    expect(idQueries[1]!.values).toContain(first[first.length - 1]);
  });
});

describe('linkTargetText', () => {
  const link = (targetType: string, targetLabel: string | null, targetAvailable = true) => ({ targetType, targetLabel, targetAvailable });
  it.each([
    [link('HOMEPAGE', null), 'Trang chủ'],
    [link('DEAL', null), 'Giờ vàng'],
    [link('PRODUCT', 'Can 5L'), 'Sản phẩm: Can 5L'],
    [link('PRODUCT', 'Can 5L', false), 'Sản phẩm: Can 5L (ngừng bán)'],
    [link('PRODUCT', null, false), 'Sản phẩm: (đã xoá)'],
    [link('CATEGORY', 'Bếp'), 'Danh mục: Bếp'],
    [link('CATEGORY', null, false), 'Danh mục: (đã xoá)'],
    [link('COMBO', null), 'Bộ quà tặng'],
    [link('CAMPAIGN', 'Tết Xanh'), 'Chiến dịch: Tết Xanh'],
    [link('CAMPAIGN', 'Tết Xanh', false), 'Chiến dịch: Tết Xanh (đã tắt hoặc kết thúc)'],
    [link('CAMPAIGN', null, false), 'Chiến dịch: (đã xoá)'],
  ])('%j → %s', (l, expected) => {
    expect(linkTargetText(l)).toBe(expected);
  });
});
