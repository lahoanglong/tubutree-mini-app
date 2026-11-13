// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import type { ProductDetail } from '@/lib/product-categories';
import { ProductStoryStudio } from './product-story-studio';

vi.mock('@/components/mini/product-story-showcase', () => ({
  ProductStoryShowcase: (p: { previewConfig?: ProductStoryConfig }) => <div data-testid="mock-showcase" data-scenes={p.previewConfig?.scenes.length ?? 'none'} />,
}));

// Bảng khoanh khung có spec riêng (story-roi-cutout.spec): ở đây chỉ kiểm cách Studio mở nó và nhận ảnh trả về.
vi.mock('./story-roi-cutout', () => ({
  StoryRoiCutout: (p: { src: string; disabled?: boolean; onUse: (d: string) => void; onClose: () => void }) => (
    <div data-testid="mock-roi" data-src={p.src} data-disabled={String(!!p.disabled)}>
      <button type="button" onClick={() => p.onUse('data:image/webp;base64,ROI')}>
        mock-dùng-ảnh-cắt
      </button>
      <button type="button" onClick={p.onClose}>
        mock-đóng
      </button>
    </div>
  ),
}));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const product = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: 'p1',
  slug: 'dau-goi',
  name: 'Dầu gội bưởi',
  brand: 'Pơ Lang',
  description: 'Mô tả',
  shortDesc: null,
  images: ['https://cdn.example.com/a.jpg'],
  isActive: true,
  isFeatured: false,
  categoryIds: [],
  basePrice: 165000,
  salePrice: null,
  managedByPancake: false,
  partnerOwned: false,
  cannotShowReason: null,
  ingredients: [{ name: 'Bồ kết', percentage: '3%', benefit: 'Làm sạch dịu nhẹ' }, { name: 'Hương nhu' }],
  certifications: ['Vegan'],
  variations: [{ id: 'v1', name: '300ml' }, { id: 'v2', name: '500ml' }],
  ...over,
});

const config = (): ProductStoryConfig => ({
  version: 1,
  enabled: true,
  scenes: [
    {
      kind: 'ingredient_assembly',
      steps: [{ title: 'Tinh tuyển', body: 'Chọn kỹ.', layers: [{ id: 'l1', spriteId: 'pomelo-peel', label: 'Vỏ bưởi', from: 'top', xPct: 30, yPct: 30, scale: 1, rotateDeg: 0 }] }],
    },
    { kind: 'hud_callouts', closing: 'Xong', points: [{ id: 'h1', xPct: 10, yPct: 10, label: 'Bồ kết', side: 'left' }, { id: 'h2', xPct: 80, yPct: 80, label: 'Hương nhu', side: 'right' }] },
  ],
});

function mount(opts: { value: ProductStoryConfig | null; product?: ProductDetail; disabled?: boolean; onAddImage?: (d: string) => void; routes?: Parameters<typeof mockFetch>[0] }) {
  const onChange = vi.fn();
  const m = mockFetch(opts.routes ?? {});
  vi.stubGlobal('fetch', vi.fn(m.fn));
  function Harness() {
    const [v, setV] = useState<ProductStoryConfig | null>(opts.value);
    return (
      <ProductStoryStudio
        product={opts.product ?? product()}
        value={v}
        disabled={opts.disabled}
        onAddImage={opts.onAddImage}
        onChange={(n) => {
          onChange(n);
          setV(n);
        }}
      />
    );
  }
  const r = render(<Harness />);
  mounted.push(r);
  return { onChange, m, r };
}
const last = (f: ReturnType<typeof vi.fn>) => f.mock.calls.at(-1)![0] as ProductStoryConfig | null;
const hudPoints = (c: ProductStoryConfig | null) => {
  const h = c?.scenes.find((s) => s.kind === 'hud_callouts');
  return h && h.kind === 'hud_callouts' ? h.points : [];
};

describe('ProductStoryStudio', () => {
  it('nút tự sinh dựng cấu hình từ thành phần và biến thể của sản phẩm', () => {
    const { onChange } = mount({ value: null });
    click(byText(document.body, 'button', 'Tự sinh Story'));
    const c = last(onChange)!;
    expect(c.enabled).toBe(true);
    expect(c.scenes.map((s) => s.kind)).toEqual(expect.arrayContaining(['variant_arc', 'ingredient_assembly', 'hud_callouts']));
  });

  it('không đủ dữ liệu để sinh thì báo bằng chữ, không đổi cấu hình', () => {
    const { onChange } = mount({ value: null, product: product({ brand: 'Tubu', name: 'Xà phòng', ingredients: null, variations: [{ id: 'v1', name: '1' }] }) });
    click(byText(document.body, 'button', 'Tự sinh Story'));
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Chưa đủ dữ liệu');
  });

  it('sản phẩm của nhãn chủ lực chưa có dữ liệu: Tự sinh cho đúng kịch bản cấp nhãn mà khách đang thấy (điểm Thương hiệu từ tên)', () => {
    const { onChange } = mount({ value: null, product: product({ brand: 'Tubu Tree', name: 'Dầu gội thảo dược PƠ LANG 300g', ingredients: null, variations: [{ id: 'v1', name: '300g' }] }) });
    click(byText(document.body, 'button', 'Tự sinh Story'));
    const pts = hudPoints(last(onChange));
    expect(pts.map((p) => [p.label, p.value])).toEqual([
      ['Thương hiệu', 'Pơ Lang'],
      ['Quy cách', '300g'],
    ]);
  });

  it('công tắc bật/tắt đổi enabled', () => {
    const { onChange } = mount({ value: config() });
    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"][data-testid="story-enabled"]')!;
    expect(box.checked).toBe(true);
    click(box);
    expect(last(onChange)!.enabled).toBe(false);
  });

  it('bấm lên ảnh đặt xPct, yPct (số nguyên) cho điểm chỉ đang chọn', () => {
    const { onChange } = mount({ value: config() });
    const canvas = document.querySelector<HTMLElement>('[data-testid="story-hud-canvas"]')!;
    canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 400, right: 300, bottom: 450, x: 100, y: 50, toJSON: () => ({}) });
    click(byText(document.body, 'button', 'Hương nhu'));
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 250, clientY: 150 }));
    const pts = hudPoints(last(onChange));
    expect(pts[1]).toMatchObject({ id: 'h2', xPct: 75, yPct: 25 });
    expect(pts[0]).toMatchObject({ id: 'h1', xPct: 10, yPct: 10 });
  });

  it('bấm ngoài khung ảnh vẫn kẹp về 0–100', () => {
    const { onChange } = mount({ value: config() });
    const canvas = document.querySelector<HTMLElement>('[data-testid="story-hud-canvas"]')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: -20 }));
    expect(hudPoints(last(onChange))[0]).toMatchObject({ xPct: 100, yPct: 0 });
  });

  it('sửa tiêu đề bước cập nhật cấu hình', () => {
    const { onChange } = mount({ value: config() });
    typeInto(document.querySelector('input[aria-label="Tiêu đề bước 1"]'), 'Tinh tuyển mới');
    const asm = last(onChange)!.scenes.find((s) => s.kind === 'ingredient_assembly');
    expect(asm && asm.kind === 'ingredient_assembly' && asm.steps[0]!.title).toBe('Tinh tuyển mới');
  });

  it('chọn sprite thêm một lớp nguyên liệu vào bước; xoá được lớp', () => {
    const { onChange } = mount({ value: config() });
    selectValue(document.querySelector('select[aria-label="Thêm nguyên liệu vào bước 1"]'), 'honey-drop');
    let asm = last(onChange)!.scenes.find((s) => s.kind === 'ingredient_assembly');
    expect(asm && asm.kind === 'ingredient_assembly' && asm.steps[0]!.layers.map((l) => l.spriteId)).toEqual(['pomelo-peel', 'honey-drop']);
    click(document.querySelector('button[aria-label="Xoá Vỏ bưởi khỏi bước 1"]'));
    asm = last(onChange)!.scenes.find((s) => s.kind === 'ingredient_assembly');
    expect(asm && asm.kind === 'ingredient_assembly' && asm.steps[0]!.layers.map((l) => l.spriteId)).toEqual(['honey-drop']);
  });

  it('cấu hình sai hiện lỗi role=alert, cấu hình đúng thì không', () => {
    const bad = config();
    const hud = bad.scenes[1]!;
    if (hud.kind === 'hud_callouts') hud.points[0]!.xPct = Number.NaN;
    mount({ value: bad });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('không hợp lệ');
    document.body.innerHTML = '';
    mount({ value: config() });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('xem trước chuyển giữa điện thoại 375px và máy tính, luôn vẽ cấu hình đang sửa', () => {
    mount({ value: config() });
    const frame = () => document.querySelector<HTMLElement>('[data-testid="story-preview-frame"]')!;
    expect(frame().dataset.mode).toBe('phone');
    expect(document.querySelector('[data-testid="mock-showcase"]')?.getAttribute('data-scenes')).toBe('2');
    click(byText(document.body, 'button', 'Máy tính'));
    expect(frame().dataset.mode).toBe('desktop');
    click(byText(document.body, 'button', 'Điện thoại'));
    expect(frame().dataset.mode).toBe('phone');
  });

  it('lấy ảnh từ link: lỗi từ máy chủ hiện role=alert', async () => {
    mount({ value: config(), routes: { '/story-assets/extract': { status: 400, body: { message: 'Không tải được trang.' } } } });
    typeInto(document.querySelector('input[aria-label="Link trang sản phẩm hoặc ảnh"]'), 'https://shop.example.com/p');
    click(byText(document.body, 'button', 'Lấy ảnh'));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Không tải được');
  });

  it('lấy ảnh thành công: liệt kê ảnh, "Dùng làm ảnh sân khấu" đặt cutoutUrl bằng link gốc', async () => {
    const { onChange, m } = mount({
      value: config(),
      routes: { '/story-assets/extract': { body: { images: [{ url: 'https://shop.example.com/a.png', width: 800, height: 800 }], cutouts: [{ sourceUrl: 'https://shop.example.com/a.png', dataUrl: 'data:image/webp;base64,AAAA' }] } } },
    });
    typeInto(document.querySelector('input[aria-label="Link trang sản phẩm hoặc ảnh"]'), 'https://shop.example.com/p');
    click(byText(document.body, 'button', 'Lấy ảnh'));
    await flush();
    expect(JSON.parse(String(m.calls[0]!.init!.body))).toEqual({ pageUrl: 'https://shop.example.com/p' });
    click(byText(document.body, 'button', 'Dùng làm ảnh sân khấu'));
    expect(last(onChange)!.cutoutUrl).toBe('https://shop.example.com/a.png');
  });

  it('có bản tách nền và chỗ thêm ảnh: đăng ký bản tách nền làm ảnh sản phẩm rồi trỏ cutoutUrl vào ảnh đó, không trỏ link bên thứ ba', async () => {
    const onAddImage = vi.fn();
    const { onChange } = mount({
      value: config(),
      onAddImage,
      routes: { '/story-assets/extract': { body: { images: [{ url: 'https://shop.example.com/a.png', width: 800, height: 800 }], cutouts: [{ sourceUrl: 'https://shop.example.com/a.png', dataUrl: 'data:image/webp;base64,AAAA' }] } } },
    });
    typeInto(document.querySelector('input[aria-label="Link trang sản phẩm hoặc ảnh"]'), 'https://shop.example.com/p');
    click(byText(document.body, 'button', 'Lấy ảnh'));
    await flush();
    click(byText(document.body, 'button', 'Dùng làm ảnh sân khấu'));
    expect(onAddImage).toHaveBeenCalledWith('data:image/webp;base64,AAAA');
    expect(last(onChange)!.cutoutUrl).toBe('/public-image/product/p1/1');
  });

  describe('cắt khung rồi tách nền (poster có khung màu chạm mép)', () => {
    const extracted = { '/story-assets/extract': { body: { images: [{ url: 'https://shop.example.com/a.png', width: 800, height: 800 }], cutouts: [{ sourceUrl: 'https://shop.example.com/a.png', dataUrl: 'data:image/webp;base64,AAAA' }] } } };
    const fetchImages = async () => {
      typeInto(document.querySelector('input[aria-label="Link trang sản phẩm hoặc ảnh"]'), 'https://shop.example.com/p');
      click(byText(document.body, 'button', 'Lấy ảnh'));
      await flush();
    };

    it('có bản tách nền và chỗ thêm ảnh: nút mở bảng khoanh khung cho đúng ảnh đó, bấm lần nữa thì đóng', async () => {
      mount({ value: config(), onAddImage: vi.fn(), routes: extracted });
      await fetchImages();
      const open = byText(document.body, 'button', 'Cắt khung rồi tách nền')!;
      expect(open.getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector('[data-testid="mock-roi"]')).toBeNull();
      click(open);
      expect(document.querySelector('[data-testid="mock-roi"]')?.getAttribute('data-src')).toBe('data:image/webp;base64,AAAA');
      expect(byText(document.body, 'button', 'Cắt khung rồi tách nền')!.getAttribute('aria-expanded')).toBe('true');
      click(byText(document.body, 'button', 'Cắt khung rồi tách nền'));
      expect(document.querySelector('[data-testid="mock-roi"]')).toBeNull();
    });

    it('ảnh đã cắt trả về được đăng ký làm ảnh sản phẩm và cutoutUrl trỏ vào ảnh đó (không phải bản tách nền không cắt); bảng đóng lại', async () => {
      const onAddImage = vi.fn();
      const { onChange } = mount({ value: config(), onAddImage, routes: extracted });
      await fetchImages();
      click(byText(document.body, 'button', 'Cắt khung rồi tách nền'));
      click(byText(document.body, 'button', 'mock-dùng-ảnh-cắt'));
      expect(onAddImage).toHaveBeenCalledTimes(1);
      expect(onAddImage).toHaveBeenCalledWith('data:image/webp;base64,ROI');
      expect(last(onChange)!.cutoutUrl).toBe('/public-image/product/p1/1');
      expect(document.querySelector('[data-testid="mock-roi"]')).toBeNull();
    });

    it('"Đóng" trong bảng không đăng ký ảnh và không đổi cấu hình', async () => {
      const onAddImage = vi.fn();
      const { onChange } = mount({ value: config(), onAddImage, routes: extracted });
      await fetchImages();
      click(byText(document.body, 'button', 'Cắt khung rồi tách nền'));
      click(byText(document.body, 'button', 'mock-đóng'));
      expect(document.querySelector('[data-testid="mock-roi"]')).toBeNull();
      expect(onAddImage).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('không có chỗ thêm ảnh hoặc không có bản tách nền: không có nút cắt khung (không có điểm ảnh để đọc)', async () => {
      mount({ value: config(), routes: extracted });
      await fetchImages();
      expect(byText(document.body, 'button', 'Cắt khung rồi tách nền')).toBeFalsy();
    });

    it('lấy ảnh lần mới đóng bảng đang mở của danh sách cũ', async () => {
      mount({ value: config(), onAddImage: vi.fn(), routes: extracted });
      await fetchImages();
      click(byText(document.body, 'button', 'Cắt khung rồi tách nền'));
      expect(document.querySelector('[data-testid="mock-roi"]')).not.toBeNull();
      click(byText(document.body, 'button', 'Lấy ảnh'));
      await flush();
      expect(document.querySelector('[data-testid="mock-roi"]')).toBeNull();
    });
  });

  it('xem trước và khung chỉ điểm vẽ ảnh đã đăng ký bằng chính ảnh trong form, vì đường dẫn tương đối chưa trỏ được tới API', () => {
    const images = ['https://cdn.example.com/a.jpg', 'data:image/webp;base64,BBBB'];
    mount({ value: { ...config(), cutoutUrl: '/public-image/product/p1/1' }, product: product({ images }) });
    expect(document.querySelector('[data-testid="story-hud-canvas"] img')?.getAttribute('src')).toBe(images[1]);
  });

  it('ảnh http không có bản tách nền: không có nút dùng (cấu hình sẽ không hợp lệ)', async () => {
    mount({ value: config(), routes: { '/story-assets/extract': { body: { images: [{ url: 'http://shop.example.com/a.png', width: 800, height: 800 }], cutouts: [] } } } });
    typeInto(document.querySelector('input[aria-label="Link trang sản phẩm hoặc ảnh"]'), 'https://shop.example.com/p');
    click(byText(document.body, 'button', 'Lấy ảnh'));
    await flush();
    expect(byText(document.body, 'button', 'Dùng làm ảnh sân khấu')).toBeFalsy();
  });

  it('link ảnh trực tiếp gửi imageUrls thay vì pageUrl', async () => {
    const { m } = mount({ value: config(), routes: { '/story-assets/extract': { body: { images: [], cutouts: [] } } } });
    typeInto(document.querySelector('input[aria-label="Link trang sản phẩm hoặc ảnh"]'), 'https://cdn.example.com/chai.webp');
    click(byText(document.body, 'button', 'Lấy ảnh'));
    await flush();
    expect(JSON.parse(String(m.calls[0]!.init!.body))).toEqual({ imageUrls: ['https://cdn.example.com/chai.webp'] });
  });

  it('xoá cấu hình đưa về null (dùng kịch bản mẫu)', () => {
    const { onChange } = mount({ value: config() });
    click(byText(document.body, 'button', 'Dùng kịch bản mẫu'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('khung ngoài (fieldset) có min-w-0: mặc định fieldset rộng tối thiểu bằng nội dung nên khung xem trước 375px làm Studio tràn ngang ở màn 360px', () => {
    mount({ value: config() });
    expect(document.querySelector('fieldset')?.className).toContain('min-w-0');
  });

  it('disabled khoá mọi nút sửa', () => {
    mount({ value: config(), disabled: true });
    expect(byText(document.body, 'button', 'Tự sinh Story')?.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-testid="story-enabled"]')!.disabled).toBe(true);
  });

  describe('Story Completeness Check trên khung xem trước', () => {
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="story-check-row"]'));
    const keyed = (key: string) => rows().find((r) => r.dataset.key === key)!;

    it('chưa lưu cấu hình riêng: panel hiện ngay trên khung xem trước, mọi chương ghi "Tự động từ sản phẩm"', () => {
      mount({ value: null });
      const panel = document.querySelector('[data-testid="story-completeness"]')!;
      const frame = document.querySelector('[data-testid="story-preview-frame"]')!;
      expect(panel).not.toBeNull();
      expect(panel.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const chapters = rows().filter((r) => r.dataset.key!.startsWith('step-'));
      expect(chapters.length).toBeGreaterThan(0);
      expect(chapters.every((r) => r.dataset.source === 'auto')).toBe(true);
      expect(panel.textContent).toContain('Tự động từ sản phẩm');
    });

    it('chương đã sửa chuyển sang "Đã chỉnh tay", chương giữ nguyên bản tự sinh vẫn là tự động', () => {
      mount({ value: null });
      click(byText(document.body, 'button', 'Tự sinh Story'));
      const before = keyed('step-02').dataset.source;
      expect(before).toBe('auto');
      typeInto(document.querySelector('input[aria-label="Nội dung bước 1"]'), 'Câu do admin viết lại.');
      expect(keyed('step-01').dataset.source).toBe('custom');
      expect(keyed('step-02').dataset.source).toBe('auto');
      expect(keyed('step-01').textContent).toContain('Đã chỉnh tay');
    });

    it('xoá nội dung một chương thì chương đó "Cần xem" và ghi rõ thiếu gì; trạng thái đọc được bằng chữ, không chỉ bằng màu', () => {
      mount({ value: config() });
      typeInto(document.querySelector('input[aria-label="Nội dung bước 1"]'), '');
      const row = keyed('step-01');
      expect(row.dataset.state).toBe('warn');
      expect(row.textContent).toContain('Cần xem');
      expect(row.textContent).toContain('Thiếu nội dung');
    });

    it('ảnh sân khấu: có ảnh gốc mà chưa tách nền là cần xem; sản phẩm không có ảnh là thiếu và panel báo chưa nên xuất bản', () => {
      mount({ value: config() });
      expect(keyed('stage').dataset.state).toBe('warn');
      document.body.innerHTML = '';
      mount({ value: config(), product: product({ images: [] }) });
      expect(keyed('stage').dataset.state).toBe('missing');
      expect(document.querySelector('[data-testid="story-completeness"]')!.getAttribute('data-verdict')).toBe('blocked');
      expect(document.querySelector('[data-testid="story-completeness-verdict"]')!.textContent).toContain('Chưa nên xuất bản');
    });

    it('ảnh tách nền trỏ tới ảnh sản phẩm đã xoá: ảnh sân khấu báo thiếu và chặn xuất bản', () => {
      const cfg = config();
      cfg.cutoutUrl = '/public-image/product/p1/9';
      mount({ value: cfg });
      expect(keyed('stage').dataset.state).toBe('missing');
      expect(keyed('stage').textContent).toContain('không còn trong ảnh sản phẩm');
      expect(document.querySelector('[data-testid="story-completeness"]')!.getAttribute('data-verdict')).toBe('blocked');
    });

    it('độ tương phản: liệt kê từng nền đang dùng kèm tỷ lệ và Đạt, vòng cung dùng nền nào thì đo nền đó', () => {
      mount({ value: null });
      const ambients = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="story-contrast-row"]'));
      expect(ambients.map((a) => a.dataset.ambient)).toEqual(expect.arrayContaining(['sand', 'leaf', 'amber']));
      expect(ambients.every((a) => a.dataset.pass === 'true')).toBe(true);
      expect(ambients[0]!.textContent).toMatch(/\d+\.\d:1 · Đạt/);
    });

    it('sửa xong đủ ảnh tách nền, chữ, nguyên liệu và điểm chỉ: panel báo sẵn sàng', () => {
      const cfg = config();
      cfg.cutoutUrl = 'https://cdn.example.com/cut.png';
      mount({ value: cfg });
      const panel = document.querySelector('[data-testid="story-completeness"]')!;
      expect(panel.getAttribute('data-verdict')).toBe('ready');
      expect(document.querySelector('[data-testid="story-completeness-verdict"]')!.textContent).toContain('Sẵn sàng xuất bản');
    });
  });

  describe('AI Tạo kịch bản câu chuyện', () => {
    const AI_ASM = {
      kind: 'ingredient_assembly' as const,
      steps: [{ title: 'Hái hoa dừa', body: 'Mật lấy từ cụm hoa.', layers: [{ id: 'l1', spriteId: 'honey-drop', label: 'Mật hoa dừa', from: 'top' as const, xPct: 28, yPct: 24, scale: 1, rotateDeg: -15 }] }],
    };
    const AI_HUD = { kind: 'hud_callouts' as const, closing: 'Vị ngọt tự nhiên', points: [{ id: 'h1', xPct: 26, yPct: 30, label: 'Vị ngọt dịu', side: 'left' as const }] };
    const aiBody = (warnings: string[] = []) => ({ config: { version: 1, enabled: true, scenes: [AI_ASM, AI_HUD] }, provider: 'anthropic', warnings });
    const gen = () => document.querySelector<HTMLButtonElement>('[data-testid="story-ai-generate"]')!;

    it('bấm nút gửi ghi chú tới API của đúng sản phẩm và điền bản nháp vào form, chưa lưu gì', async () => {
      const { onChange, m } = mount({ value: config(), routes: { '/admin/products/p1/story-config/generate': { body: aiBody() } } });
      typeInto(document.querySelector('textarea'), '  Làm từ hoa dừa Bến Tre  ');
      click(gen());
      await flush();
      const call = m.calls.find((c) => c.url.includes('/story-config/generate'))!;
      expect(call.init?.method).toBe('POST');
      expect(JSON.parse(call.init!.body as string)).toEqual({ note: 'Làm từ hoa dừa Bến Tre' });
      const c = last(onChange)!;
      expect(c.scenes.map((s) => s.kind)).toEqual(['ingredient_assembly', 'hud_callouts']);
      const asm = c.scenes[0];
      expect(asm && asm.kind === 'ingredient_assembly' && asm.steps[0]!.title).toBe('Hái hoa dừa');
      expect(m.calls.some((x) => x.init?.method === 'PATCH' || x.url.includes('catalog-products'))).toBe(false);
      expect(document.querySelector('[data-testid="story-ai-result"]')?.textContent).toContain('Claude đã soạn bản nháp');
    });

    it('không có ghi chú thì gửi thân rỗng', async () => {
      const { m } = mount({ value: config(), routes: { '/story-config/generate': { body: aiBody() } } });
      click(gen());
      await flush();
      expect(JSON.parse(m.calls.find((c) => c.url.includes('/story-config/generate'))!.init!.body as string)).toEqual({});
    });

    it('giữ vòng cung, ảnh sân khấu và công tắc của sản phẩm; chỉ thay cảnh lắp ghép và điểm chỉ', async () => {
      const arc = { kind: 'variant_arc' as const, items: [{ variationId: 'v1', label: '300ml', ambient: 'leaf' as const }, { variationId: 'v2', label: '500ml', ambient: 'amber' as const }] };
      const start: ProductStoryConfig = { version: 1, enabled: false, cutoutUrl: 'https://cdn.example.com/cut.webp', scenes: [arc, ...config().scenes] };
      const { onChange } = mount({ value: start, routes: { '/story-config/generate': { body: aiBody() } } });
      click(gen());
      await flush();
      const c = last(onChange)!;
      expect(c.enabled).toBe(false);
      expect(c.cutoutUrl).toBe('https://cdn.example.com/cut.webp');
      expect(c.scenes.map((s) => s.kind)).toEqual(['variant_arc', 'ingredient_assembly', 'hud_callouts']);
      expect(c.scenes[0]).toEqual(arc);
    });

    it('hiện cảnh báo của API để admin đọc trước khi Lưu', async () => {
      mount({ value: config(), routes: { '/story-config/generate': { body: aiBody(['Có con số không thấy trong dữ liệu sản phẩm: 98.']) } } });
      click(gen());
      await flush();
      expect(document.querySelector('[data-testid="story-ai-warnings"]')?.textContent).toContain('98');
    });

    it('lỗi 503 hiện role=alert bằng chữ của API và không đổi cấu hình', async () => {
      const { onChange } = mount({ value: config(), routes: { '/story-config/generate': { status: 503, body: { message: 'AI chưa soạn được kịch bản lần này. Thử lại sau ít phút hoặc soạn tay.' } } } });
      click(gen());
      await flush();
      expect(onChange).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('AI chưa soạn được');
      expect(document.querySelector('[data-testid="story-ai-result"]')).toBeNull();
    });

    it('đang soạn thì khoá nút và đổi chữ; disabled khoá cả ô ghi chú lẫn nút', async () => {
      mount({ value: config() });
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
      click(gen());
      await flush();
      expect(gen().disabled).toBe(true);
      expect(gen().textContent).toContain('AI đang soạn');
      mounted.forEach((x) => x.unmount());
      mounted = [];
      mount({ value: config(), disabled: true });
      expect(gen().disabled).toBe(true);
      expect(document.querySelector<HTMLTextAreaElement>('[data-testid="story-ai"] textarea')!.disabled).toBe(true);
    });
  });

  describe('mẫu câu chuyện thương hiệu và khung ảnh', () => {
    const SOKFARM = 'duong-hoa-dua-sokfarm-d6c685';
    const presetBtn = () => document.querySelector<HTMLButtonElement>('[data-testid="story-apply-brand-preset"]');
    const frame = () => document.querySelector<HTMLSelectElement>('[data-testid="story-frame"]')!;
    const kinds = (c: ProductStoryConfig | null) => c?.scenes.map((s) => s.kind);

    it('nút áp mẫu chỉ hiện với sản phẩm có mẫu theo slug (kể cả slug PROD có hậu tố băm)', () => {
      mount({ value: null });
      expect(presetBtn()).toBeNull();
      mount({ value: null, product: product({ slug: SOKFARM }) });
      expect(presetBtn()?.textContent).toBe('Áp dụng mẫu câu chuyện thương hiệu');
    });

    it('bấm áp mẫu: điền vòng cung từ phân loại thật cộng lắp ghép và điểm chỉ của mẫu, giữ ảnh sân khấu, khung ảnh và công tắc; chưa lưu gì', () => {
      const saved: ProductStoryConfig = { ...config(), enabled: false, cutoutUrl: 'https://cdn.example.com/cut.png', imageFrame: 'floating-card' };
      const { onChange, m } = mount({ value: saved, product: product({ slug: SOKFARM, name: 'Đường hoa dừa SOKFARM' }) });
      click(presetBtn());
      const c = last(onChange)!;
      expect(kinds(c)).toEqual(['variant_arc', 'ingredient_assembly', 'hud_callouts']);
      const asm = c.scenes.find((s) => s.kind === 'ingredient_assembly');
      expect(asm && asm.kind === 'ingredient_assembly' && asm.steps.map((st) => st.title)).toEqual(['Ngọt dịu từ hoa dừa', 'Chậm rãi từng công đoạn', 'Giữ vẻ mộc mạc']);
      expect(c.enabled).toBe(false);
      expect(c.cutoutUrl).toBe('https://cdn.example.com/cut.png');
      expect(c.imageFrame).toBe('floating-card');
      expect(document.body.textContent).toContain('Đã áp dụng mẫu câu chuyện thương hiệu');
      expect(m.calls).toHaveLength(0);
    });

    it('khung ảnh: mặc định Tự động; chọn thẻ nổi hoặc ảnh tách nền ghi imageFrame; chọn lại Tự động xoá khoá', () => {
      const { onChange } = mount({ value: config() });
      expect(frame().value).toBe('auto');
      selectValue(frame(), 'floating-card');
      expect(last(onChange)?.imageFrame).toBe('floating-card');
      expect(frame().value).toBe('floating-card');
      selectValue(frame(), 'cutout');
      expect(last(onChange)?.imageFrame).toBe('cutout');
      selectValue(frame(), 'auto');
      expect(last(onChange)).not.toHaveProperty('imageFrame');
      expect(frame().value).toBe('auto');
    });

    it('khung ảnh khoá khi form bị khoá', () => {
      mount({ value: config(), disabled: true });
      expect(frame().disabled).toBe(true);
    });
  });
});
