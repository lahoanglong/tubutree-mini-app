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
    const { onChange } = mount({ value: null, product: product({ ingredients: null, variations: [{ id: 'v1', name: '1' }] }) });
    click(byText(document.body, 'button', 'Tự sinh Story'));
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Chưa đủ dữ liệu');
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

  it('disabled khoá mọi nút sửa', () => {
    mount({ value: config(), disabled: true });
    expect(byText(document.body, 'button', 'Tự sinh Story')?.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-testid="story-enabled"]')!.disabled).toBe(true);
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
});
