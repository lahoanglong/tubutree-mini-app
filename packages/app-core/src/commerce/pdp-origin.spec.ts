import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { BRAND_ORIGINS, productOrigin } from '../brand-origins';
import { claimsIn } from './copy-claims-guard';
import {
  PDP_GUIDE_LINE_CHARS,
  PDP_GUIDE_LINES_MAX,
  PDP_ORIGIN_COPY,
  PDP_ORIGIN_COPY_MAX,
  descriptionGuide,
  pdpOriginCopy,
  pdpOriginView,
  type PdpOriginCopyKey,
} from './pdp-origin';
import { PROD_CATALOG_2026_11_12 } from './prod-catalog-full.fixture';

const SHELL = 'Tubu Tree';

describe('productOrigin', () => {
  it('theo nhãn của sản phẩm trước (như chip xuất xứ); Pineboo mượn vùng nhà máy Fuwa3e', () => {
    expect(productOrigin({ brand: 'Sokfram', name: 'Bánh tráng' })).toEqual({ id: 'sokfram', province: 'Trà Vinh', brand: 'Sokfarm', viaFactory: false });
    expect(productOrigin({ brand: 'Pineboo', name: 'Xịt tràm cho bé' })).toEqual({ id: 'fuwa3e', province: 'Thanh Hóa', brand: 'Fuwa3e', viaFactory: true });
  });

  it('vỏ "Tubu Tree" hay nhãn trống: theo tên, kể cả nhãn mượn nhà máy', () => {
    expect(productOrigin({ brand: SHELL, name: 'Nước rửa chén Fuwa3e 500ml' })?.id).toBe('fuwa3e');
    expect(productOrigin({ brand: '', name: 'Mật ong rừng BH.NONG 500g' })?.id).toBe('bhnong');
    expect(productOrigin({ brand: SHELL, name: 'Xịt tràm cho bé Pineboo 150ml' })).toEqual({ id: 'fuwa3e', province: 'Thanh Hóa', brand: 'Fuwa3e', viaFactory: true });
    // Pineboo và Fuwa3e cùng một vùng: tên nhắc cả hai vẫn là một nơi, ghi theo nhãn có ghim.
    expect(productOrigin({ brand: SHELL, name: 'Bộ Pineboo + Fuwa3e' })).toMatchObject({ id: 'fuwa3e', viaFactory: false });
  });

  it('tên nhắc hai vùng (combo nhiều nhãn), nhãn thật chưa có ghim, hay không nhắc nhãn nào: null', () => {
    expect(productOrigin({ brand: SHELL, name: 'Combo Fuwa3e + Pơ Lang' })).toBeNull();
    expect(productOrigin({ brand: 'Xanh Việt', name: 'Nước giặt Fuwa3e' })).toBeNull();
    expect(productOrigin({ brand: SHELL, name: 'Túi vải canvas' })).toBeNull();
  });

  it('111 SKU PROD (nhãn "Tubu Tree"): mọi tên một nhãn ra đúng vùng của nhãn đó', () => {
    let found = 0;
    for (const row of PROD_CATALOG_2026_11_12) {
      const o = productOrigin({ brand: SHELL, name: row.name });
      if (!o) continue;
      found += 1;
      expect(BRAND_ORIGINS.some((b) => b.id === o.id && b.province === o.province), row.name).toBe(true);
    }
    expect(found).toBeGreaterThanOrEqual(96);
  });
});

describe('descriptionGuide', () => {
  it('câu một dòng có dấu hai chấm (chữ thường hay HTML in đậm)', () => {
    expect(descriptionGuide('Nước rửa chén.\nHướng dẫn sử dụng: pha 1 nắp với 2 lít nước.\nBảo quản: nơi khô ráo, thoáng mát.')).toEqual({
      usage: ['Pha 1 nắp với 2 lít nước.'],
      storage: ['Nơi khô ráo, thoáng mát.'],
    });
    expect(descriptionGuide('<p><strong>Cách dùng:</strong> lắc đều trước khi dùng.</p><p>- Bảo quản – tránh ánh nắng trực tiếp</p>')).toEqual({
      usage: ['Lắc đều trước khi dùng.'],
      storage: ['Tránh ánh nắng trực tiếp'],
    });
  });

  it('"Bảo quản nơi…" không dấu hai chấm vẫn là câu bảo quản; "chất bảo quản", "Bảo quản tự nhiên", "Cách dùng đơn giản" thì không', () => {
    expect(descriptionGuide('Bảo quản nơi khô ráo, tránh ánh nắng.').storage).toEqual(['Nơi khô ráo, tránh ánh nắng.']);
    expect(descriptionGuide('BẢO QUẢN TRONG TỦ LẠNH SAU KHI MỞ NẮP').storage).toEqual(['TRONG TỦ LẠNH SAU KHI MỞ NẮP']);
    expect(descriptionGuide('Không chứa chất bảo quản.\nBảo quản tự nhiên từ muối.\nCách dùng đơn giản cho cả nhà.')).toEqual({ usage: null, storage: null });
    // "Bảo quản sản phẩm" chỉ là câu bảo quản khi theo sau là nơi hay cách giữ.
    expect(descriptionGuide('Bảo quản sản phẩm ở nơi thoáng mát.').storage).toEqual(['Sản phẩm ở nơi thoáng mát.']);
    expect(descriptionGuide('Bảo quản sản phẩm lâu hơn nhờ chiết xuất tự nhiên.').storage).toBeNull();
  });

  it('tiêu đề không in đậm: dừng ở tên mục khác ("Thành phần:", dòng ngắn "Công dụng"), không nuốt sang mục sau', () => {
    const text = 'Cách dùng\nLắc đều trước khi dùng.\nThành phần: nước, muối biển, tinh dầu tràm.\nCông dụng\nLàm sạch dịu nhẹ.';
    expect(descriptionGuide(text).usage).toEqual(['Lắc đều trước khi dùng.']);
    expect(descriptionGuide('Bảo quản\nNơi khô ráo\nQuy cách 500ml').storage).toEqual(['Nơi khô ráo']);
    // Câu dài có tên mục ở giữa câu vẫn là câu hướng dẫn.
    expect(descriptionGuide('Cách dùng\nThông thoáng phòng sau khi xịt, rửa tay sạch.').usage).toEqual(['Thông thoáng phòng sau khi xịt, rửa tay sạch.']);
  });

  it('tiêu đề đứng riêng rồi các mục bên dưới, dừng ở tiêu đề kế tiếp; tối đa PDP_GUIDE_LINES_MAX câu', () => {
    const html =
      '<h3>HƯỚNG DẪN SỬ DỤNG</h3><ul><li>Bước 1 lắc đều</li><li>Bước 2 xịt lên bề mặt</li><li>Bước 3 lau khô</li><li>Bước 4 rửa tay</li></ul>' +
      '<p><strong>Bảo quản</strong></p><p>Đậy kín nắp sau khi dùng.</p><p><strong>Thông tin khác</strong></p><p>Sản xuất tại Việt Nam.</p>';
    const guide = descriptionGuide(html);
    expect(guide.usage).toEqual(['Bước 1 lắc đều', 'Bước 2 xịt lên bề mặt', 'Bước 3 lau khô']);
    expect(guide.usage).toHaveLength(PDP_GUIDE_LINES_MAX);
    expect(guide.storage).toEqual(['Đậy kín nắp sau khi dùng.']);
  });

  it('tiêu đề không có dòng nào theo sau thì không có câu; lấy lần xuất hiện đầu', () => {
    expect(descriptionGuide('Mô tả.\nHƯỚNG DẪN SỬ DỤNG:\nBẢO QUẢN:\nNơi thoáng mát').usage).toBeNull();
    expect(descriptionGuide('Bảo quản: nơi khô ráo.\nBảo quản: tủ lạnh.').storage).toEqual(['Nơi khô ráo.']);
  });

  it('câu dài cắt ở ranh giới từ kèm "…"; mô tả rỗng hay null thì không có gì', () => {
    const long = `Cách dùng: ${'pha loãng với nước sạch rồi dùng '.repeat(10)}`;
    const [line] = descriptionGuide(long).usage!;
    expect(line!.length).toBeLessThanOrEqual(PDP_GUIDE_LINE_CHARS);
    expect(line!.endsWith('…')).toBe(true);
    expect(line!.endsWith(' …')).toBe(false);
    expect(descriptionGuide('')).toEqual({ usage: null, storage: null });
    expect(descriptionGuide(null)).toEqual({ usage: null, storage: null });
  });

  it('mô tả ở dạng tách dấu (NFD) vẫn đọc được nhãn và giữ đúng chữ', () => {
    expect(descriptionGuide('Bảo quản: nơi khô ráo'.normalize('NFD')).storage).toEqual(['Nơi khô ráo']);
  });
});

describe('pdpOriginView', () => {
  it('đủ dữ liệu: tiêu đề Nguồn gốc & cách dùng, gợi ý tỉnh, bốn dòng theo thứ tự, lối bản đồ khi đầu trang chưa có chip', () => {
    const v = pdpOriginView(
      { brand: SHELL, name: 'Nước giặt Fuwa3e 2L', description: 'Cách dùng: 1 nắp cho 4kg đồ.\nBảo quản: nơi khô ráo.' },
      { originChip: false },
    );
    expect(v).toEqual({
      title: 'Nguồn gốc & cách dùng',
      hint: 'Thanh Hóa',
      rows: [
        { key: 'origin', label: 'Đến từ', lines: ['Fuwa3e · Thanh Hóa'] },
        { key: 'usage', label: 'Cách dùng', lines: ['1 nắp cho 4kg đồ.'] },
        { key: 'storage', label: 'Bảo quản', lines: ['Nơi khô ráo.'] },
        { key: 'lot', label: 'Hạn dùng, số lô', lines: ['In trên bao bì sản phẩm'] },
      ],
      map: { id: 'fuwa3e', spoken: 'Xem Fuwa3e ở Thanh Hóa trên bản đồ' },
    });
  });

  it('chip xuất xứ đầu trang đã trỏ bản đồ: không thêm lối thứ hai; nhãn mượn nhà máy ghi "Nhà máy"; tiêu đề chỉ nói phần khối có', () => {
    const v = pdpOriginView({ brand: 'Pineboo', name: 'Bọt tắm Pineboo', description: '' }, { originChip: true })!;
    expect(v.map).toBeNull();
    expect(v.title).toBe('Nguồn gốc & hạn dùng');
    expect(v.rows).toEqual([
      { key: 'origin', label: 'Đến từ', lines: ['Nhà máy Fuwa3e · Thanh Hóa'] },
      { key: 'lot', label: 'Hạn dùng, số lô', lines: ['In trên bao bì sản phẩm'] },
    ]);
    const stored = pdpOriginView({ brand: 'Pineboo', name: 'Bọt tắm Pineboo', description: 'Bảo quản nơi khô ráo.' }, { originChip: true })!;
    expect(stored.title).toBe('Nguồn gốc & bảo quản');
  });

  it('không rõ xuất xứ: tiêu đề theo phần có, không gợi ý tỉnh, không lối bản đồ', () => {
    const usage = pdpOriginView({ brand: SHELL, name: 'Túi vải', description: 'HDSD: giặt tay.' }, { originChip: false })!;
    expect(usage.title).toBe('Cách dùng & hạn dùng');
    expect(usage.hint).toBeNull();
    expect(usage.map).toBeNull();
    const storage = pdpOriginView({ brand: SHELL, name: 'Túi vải', description: 'Bảo quản nơi khô ráo' }, { originChip: false })!;
    expect(storage.title).toBe('Bảo quản & hạn dùng');
    expect(storage.rows.map((r) => r.key)).toEqual(['storage', 'lot']);
    const both = pdpOriginView({ brand: SHELL, name: 'Túi vải', description: 'HDSD: giặt tay.\nBảo quản nơi khô ráo' }, { originChip: false })!;
    expect(both.title).toBe('Cách dùng & bảo quản');
  });

  it('không xuất xứ, không cách dùng, không bảo quản: không có khối', () => {
    expect(pdpOriginView({ brand: SHELL, name: 'Túi vải canvas', description: 'Túi vải bền.' }, { originChip: false })).toBeNull();
    expect(pdpOriginView({ brand: 'Xanh Việt', name: 'Nước giặt Fuwa3e' }, { originChip: false })).toBeNull();
  });
});

describe('PDP_ORIGIN_COPY', () => {
  // Giá trị dài nhất của bảng nhãn: tiêu đề, gợi ý tỉnh và câu đọc vẫn trong ngân sách.
  const longestProvince = BRAND_ORIGINS.map((o) => o.province).sort((a, b) => b.length - a.length)[0]!;
  const longestBrand = BRAND_ORIGINS.map((o) => o.brand).sort((a, b) => b.length - a.length)[0]!;
  it('không thuật ngữ cấm, không tuyên bố, không vượt ngân sách', () => {
    for (const key of Object.keys(PDP_ORIGIN_COPY) as PdpOriginCopyKey[]) {
      const text = pdpOriginCopy(key, { province: longestProvince, brand: longestBrand });
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(text, `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(text), key).toEqual([]);
      expect(text.length, key).toBeLessThanOrEqual(PDP_ORIGIN_COPY_MAX[key]);
    }
  });
});
