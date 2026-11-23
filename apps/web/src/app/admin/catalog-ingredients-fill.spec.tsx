// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogIngredientsFill, type IngredientsFillProduct } from './catalog-ingredients-fill';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

const compress = vi.hoisted(() => ({ readImageForLabelOcr: vi.fn() }));
vi.mock('@/lib/image-compress', async (orig) => ({ ...(await orig<typeof import('@/lib/image-compress')>()), readImageForLabelOcr: compress.readImageForLabelOcr }));
const clip = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => true) }));
vi.mock('@/lib/copy-text', () => ({ copyText: clip.copyText }));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  compress.readImageForLabelOcr.mockReset();
  clip.copyText.mockReset();
  clip.copyText.mockImplementation(async () => true);
});

const DATA_URL = 'data:image/jpeg;base64,QUJD';
const PRODUCTS = [
  { id: 'p1', name: 'Mật cô đặc 250g' },
  { id: 'p2', name: 'Xoài sấy dẻo' },
];

interface Opts {
  products?: IngredientsFillProduct[];
  total?: number;
  extract?: { status?: number; body: unknown } | (() => { status?: number; body: unknown });
  save?: { status?: number; body: unknown } | (() => { status?: number; body: unknown });
  holdExtract?: Promise<void>;
}

function setup(opts: Opts = {}) {
  const onSaved = vi.fn(async () => true);
  const m = mockFetch({
    '/extract-ingredients': opts.extract ?? { body: { id: 'p1', readable: true, ingredients: ['Đường', 'Muối'], warnings: [] } },
    '/ingredients': opts.save ?? { body: { id: 'p1', ingredients: ['Đường', 'Muối'], added: 2 } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (opts.holdExtract && url.includes('/extract-ingredients')) await opts.holdExtract;
      return m.fn(url, init);
    }),
  );
  const client = new QueryClient();
  const tree = (products: IngredientsFillProduct[]) => (
    <QueryClientProvider client={client}>
      <CatalogIngredientsFill products={products} total={opts.total ?? 10} onSaved={onSaved} />
    </QueryClientProvider>
  );
  const r = render(tree(opts.products ?? PRODUCTS), client);
  mounted.push(r);
  // `render` đã bọc một QueryClientProvider ngoài `tree`; giữ đúng lớp đó để React cập nhật props thay vì dựng lại component (mất state).
  const rerender = (products: IngredientsFillProduct[]) => act(() => r.root.render(<QueryClientProvider client={client}>{tree(products)}</QueryClientProvider>));
  return { m, onSaved, container: r.container, rerender };
}

const rowOf = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="ingredients-row-${id}"]`)!;
const areaOf = (c: HTMLElement, id: string) => rowOf(c, id).querySelector<HTMLTextAreaElement>('textarea')!;
const zoneOf = (c: HTMLElement, id: string) => rowOf(c, id).querySelector<HTMLElement>('[data-testid="image-drop-zone"]')!;
const saveBtn = (c: HTMLElement, id: string) => byText(rowOf(c, id), 'button', 'Lưu thành phần')!;
const alertOf = (c: HTMLElement, id: string) => rowOf(c, id).querySelector('[role="alert"]')?.textContent ?? null;
const callsTo = (m: ReturnType<typeof mockFetch>, part: string) => m.calls.filter((x) => x.url.includes(part) && x.init?.method === 'POST');
const bodyOf = (call: { init?: RequestInit }) => JSON.parse(String(call.init?.body));
const png = (name = 'nhan.png') => new File(['x'], name, { type: 'image/png' });
const dropOn = (zone: Element, file: File) => {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  act(() => {
    zone.dispatchEvent(ev);
  });
};

describe('CatalogIngredientsFill — bổ sung thành phần cho sản phẩm còn thiếu', () => {
  it('có tiến độ "Đã đủ thành phần X/Y", mỗi sản phẩm một dòng có ô nhập, ô ảnh bao bì và nút Lưu', () => {
    const { container } = setup({ total: 10 });
    expect(container.querySelector('[data-testid="ingredients-progress"]')?.textContent).toBe('Đã đủ thành phần 8/10 sản phẩm.');
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Tiến độ bổ sung thành phần');
    expect(bar.getAttribute('aria-valuenow')).toBe('8');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(container.querySelectorAll('[data-testid^="ingredients-row-"]')).toHaveLength(2);
    const row = rowOf(container, 'p1');
    expect(row.querySelector('h4')?.textContent).toBe('Mật cô đặc 250g');
    expect(row.querySelector('label')?.textContent).toBe('Thành phần của Mật cô đặc 250g');
    expect(areaOf(container, 'p1').getAttribute('id')).toBe(row.querySelector('label')?.getAttribute('for'));
    expect(zoneOf(container, 'p1').getAttribute('aria-label')).toBe('Ảnh bao bì của Mật cô đặc 250g');
    expect(byText(row, 'button', 'Đọc từ ảnh bao bì')).not.toBeNull();
  });

  it('không còn sản phẩm nào thiếu: báo đã đủ, không vẽ dòng nào', () => {
    const { container } = setup({ products: [], total: 10 });
    expect(container.textContent).toContain('Mọi sản phẩm đang bán đều đã có thành phần.');
    expect(container.querySelector('[data-testid="ingredients-progress"]')?.textContent).toBe('Đã đủ thành phần 10/10 sản phẩm.');
    expect(container.querySelectorAll('[data-testid^="ingredients-row-"]')).toHaveLength(0);
  });

  it('nút Lưu bị khoá khi ô nhập trống; gõ rồi lưu thì gửi đúng danh sách tên, báo đã lưu, tăng tiến độ và nạp lại lần kiểm', async () => {
    const { m, onSaved, container } = setup();
    expect(saveBtn(container, 'p1').getAttribute('aria-disabled')).toBe('true');
    click(saveBtn(container, 'p1'));
    await flush();
    expect(callsTo(m, '/ingredients')).toHaveLength(0);

    typeInto(areaOf(container, 'p1'), 'Đường, Muối\nDầu thực vật (dầu cọ, dầu dừa)');
    expect(saveBtn(container, 'p1').getAttribute('aria-disabled')).toBeNull();
    click(saveBtn(container, 'p1'));
    await flush();
    const posts = callsTo(m, '/ingredients');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/admin/catalog-quality/p1/ingredients');
    expect(bodyOf(posts[0]!)).toEqual({ ingredients: ['Đường', 'Muối', 'Dầu thực vật (dầu cọ, dầu dừa)'] });
    expect(container.textContent).toContain('Đã lưu 2 thành phần cho "Mật cô đặc 250g".');
    expect(rowOf(container, 'p1').textContent).toContain('Đã lưu thành phần.');
    expect(rowOf(container, 'p1').querySelector('textarea')).toBeNull();
    expect(container.querySelector('[data-testid="ingredients-progress"]')?.textContent).toBe('Đã đủ thành phần 9/10 sản phẩm.');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('máy chủ báo không nối thêm tên nào (đã có sẵn): nói rõ, không giả vờ là đã thêm', async () => {
    const { container } = setup({ save: { body: { id: 'p1', ingredients: ['Đường'], added: 0 } } });
    typeInto(areaOf(container, 'p1'), 'Đường');
    click(saveBtn(container, 'p1'));
    await flush();
    expect(container.textContent).toContain('Các thành phần này đã có sẵn trong "Mật cô đặc 250g".');
    expect(container.textContent).not.toContain('Đã lưu 0 thành phần');
  });

  it('quá 20 tên hoặc một tên quá 80 ký tự: báo ngay tại dòng, không gọi máy chủ, giữ nguyên chữ đã gõ; đủ 20 tên (nhãn INCI) thì không báo', async () => {
    const { m, container } = setup();
    const twenty = Array.from({ length: 20 }, (_, i) => `INCI ${i + 1}`).join('\n');
    typeInto(areaOf(container, 'p1'), twenty);
    expect(container.querySelector('[data-testid="ingredients-row-p1"]')!.textContent).toContain('20/20');
    expect(areaOf(container, 'p1').getAttribute('aria-invalid')).toBeNull();
    const many = Array.from({ length: 21 }, (_, i) => `Thành phần ${i + 1}`).join('\n');
    typeInto(areaOf(container, 'p1'), many);
    expect(areaOf(container, 'p1').getAttribute('aria-invalid')).toBe('true');
    click(saveBtn(container, 'p1'));
    await flush();
    expect(alertOf(container, 'p1')).toBe('Tối đa 20 thành phần mỗi lần lưu (đang có 21). Bớt đi rồi lưu.');
    expect(areaOf(container, 'p1').value).toBe(many);

    typeInto(areaOf(container, 'p1'), 'x'.repeat(81));
    click(saveBtn(container, 'p1'));
    await flush();
    expect(alertOf(container, 'p1')).toBe('Mỗi thành phần tối đa 80 ký tự.');
    expect(callsTo(m, '/ingredients')).toHaveLength(0);

    typeInto(areaOf(container, 'p1'), 'Đường');
    expect(alertOf(container, 'p1')).toBeNull();
  });

  it('máy chủ từ chối lúc lưu (vd lời tuyên bố bị chặn): hiện đúng lý do tiếng Việt tại dòng, ô nhập còn nguyên để sửa', async () => {
    const { container, onSaved } = setup({ save: { status: 400, body: { message: 'Thành phần "Chữa khỏi ung thư" chứa lời tuyên bố y tế.' } } });
    typeInto(areaOf(container, 'p1'), 'Chữa khỏi ung thư');
    click(saveBtn(container, 'p1'));
    await flush();
    expect(alertOf(container, 'p1')).toBe('Thành phần "Chữa khỏi ung thư" chứa lời tuyên bố y tế.');
    expect(areaOf(container, 'p1').value).toBe('Chữa khỏi ung thư');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('thả ảnh bao bì: nén ảnh, gửi AI đọc, điền bản nháp vào ô nhập (mỗi tên một dòng) và CHƯA lưu gì', async () => {
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    const { m, container } = setup({ extract: { body: { id: 'p1', readable: true, ingredients: ['Đường', 'Muối', 'Dầu thực vật (dầu cọ, dầu dừa)'], warnings: [] } } });
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(compress.readImageForLabelOcr).toHaveBeenCalledTimes(1);
    const posts = callsTo(m, '/extract-ingredients');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain('/admin/catalog-quality/p1/extract-ingredients');
    expect(bodyOf(posts[0]!)).toEqual({ image: DATA_URL });
    expect(areaOf(container, 'p1').value).toBe('Đường\nMuối\nDầu thực vật (dầu cọ, dầu dừa)');
    expect(rowOf(container, 'p1').textContent).toContain('Bản nháp đọc từ ảnh bao bì: xem lại rồi bấm "Lưu thành phần".');
    expect(callsTo(m, '/ingredients')).toHaveLength(0);
  });

  it('đang đọc ảnh: hiện trạng thái, khoá mọi dòng (không đọc hay lưu đồng thời); xong thì mở lại', async () => {
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const { m, container } = setup({ holdExtract: hold });
    typeInto(areaOf(container, 'p2'), 'Xoài');
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(rowOf(container, 'p1').querySelector('[role="status"]')?.textContent).toBe('Đang đọc ảnh bao bì…');
    expect(zoneOf(container, 'p1').getAttribute('aria-busy')).toBe('true');
    expect(saveBtn(container, 'p2').getAttribute('aria-disabled')).toBe('true');
    click(saveBtn(container, 'p2'));
    dropOn(zoneOf(container, 'p2'), png('khac.png'));
    await flush();
    expect(callsTo(m, '/ingredients')).toHaveLength(0);
    release();
    await flush();
    expect(callsTo(m, '/extract-ingredients')).toHaveLength(1);
    expect(compress.readImageForLabelOcr).toHaveBeenCalledTimes(1);
    expect(rowOf(container, 'p1').querySelector('[role="status"]')).toBeNull();
    expect(saveBtn(container, 'p2').getAttribute('aria-disabled')).toBeNull();
  });

  it('đã có chữ nhân viên gõ: bản đọc từ ảnh chỉ nối thêm tên mới (không nuốt chữ đã gõ, không trùng)', async () => {
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    const { container } = setup({ extract: { body: { id: 'p1', readable: true, ingredients: ['muối', 'Tiêu'], warnings: [] } } });
    typeInto(areaOf(container, 'p1'), 'Đường\nMuối');
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(areaOf(container, 'p1').value).toBe('Đường\nMuối\nTiêu');
  });

  it('AI nói đọc được nhưng có cảnh báo (tên bị bộ chặn, quá trần): hiện từng cảnh báo để nhân viên sửa, bản nháp vẫn điền', async () => {
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    const { container } = setup({ extract: { body: { id: 'p1', readable: true, ingredients: ['Đường', 'Trị tiểu đường'], warnings: ['Thành phần "Trị tiểu đường" chứa lời tuyên bố y tế.'] } } });
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(areaOf(container, 'p1').value).toBe('Đường\nTrị tiểu đường');
    expect(rowOf(container, 'p1').textContent).toContain('Thành phần "Trị tiểu đường" chứa lời tuyên bố y tế.');
  });

  it('ảnh không đọc được (mờ, không phải bao bì): hiện lý do, ô nhập giữ nguyên chữ đã gõ', async () => {
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    const { container } = setup({ extract: { body: { id: 'p1', readable: false, ingredients: [], warnings: ['Ảnh chưa đọc được mục Thành phần. Chụp lại rõ hơn.'] } } });
    typeInto(areaOf(container, 'p1'), 'Đường');
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(rowOf(container, 'p1').textContent).toContain('Ảnh chưa đọc được mục Thành phần. Chụp lại rõ hơn.');
    expect(rowOf(container, 'p1').textContent).not.toContain('Bản nháp đọc từ ảnh bao bì');
    expect(areaOf(container, 'p1').value).toBe('Đường');
  });

  it('chưa có khoá AI (503 tiếng Việt): hiện nguyên lời máy chủ, nhắc nhập tay, ô nhập còn nguyên', async () => {
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    const msg = 'AI đọc ảnh chưa được cấu hình. Hãy nhập tay thành phần.';
    const { container } = setup({ extract: { status: 503, body: { message: msg } } });
    typeInto(areaOf(container, 'p1'), 'Đường');
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(alertOf(container, 'p1')).toBe(msg);
    expect(areaOf(container, 'p1').value).toBe('Đường');
  });

  it('không nén được ảnh: báo tại dòng, không gọi máy chủ, mở khoá để chọn ảnh khác', async () => {
    compress.readImageForLabelOcr.mockRejectedValue(new Error('Ảnh quá nặng sau khi nén'));
    const { m, container } = setup();
    dropOn(zoneOf(container, 'p1'), png());
    await flush();
    expect(alertOf(container, 'p1')).toBe('Không xử lý được ảnh bao bì này. Chụp lại hoặc chọn ảnh khác.');
    expect(callsTo(m, '/extract-ingredients')).toHaveLength(0);
    compress.readImageForLabelOcr.mockResolvedValue(DATA_URL);
    dropOn(zoneOf(container, 'p1'), png('lai.png'));
    await flush();
    expect(callsTo(m, '/extract-ingredients')).toHaveLength(1);
    expect(alertOf(container, 'p1')).toBeNull();
  });

  it('lần kiểm nạp lại đã bỏ sản phẩm vừa lưu khỏi danh sách: tiến độ giữ nguyên, không đếm hai lần', async () => {
    const { container, rerender } = setup({ total: 10 });
    typeInto(areaOf(container, 'p1'), 'Đường');
    click(saveBtn(container, 'p1'));
    await flush();
    expect(container.querySelector('[data-testid="ingredients-progress"]')?.textContent).toBe('Đã đủ thành phần 9/10 sản phẩm.');
    rerender([PRODUCTS[1]!]);
    expect(container.querySelector('[data-testid="ingredients-progress"]')?.textContent).toBe('Đã đủ thành phần 9/10 sản phẩm.');
    expect(container.querySelectorAll('[data-testid^="ingredients-row-"]')).toHaveLength(1);
  });
});

describe('CatalogIngredientsFill — gom theo thương hiệu và chép checklist gửi nhãn', () => {
  const BRANDED: IngredientsFillProduct[] = [
    { id: 'f1', name: 'Xịt thơm Fuwa3e 300ml', brand: { name: 'Fuwa3e' } },
    { id: 'pl1', name: 'Nước mùi già PƠ LANG 160ml', brand: { name: 'PƠ LANG' } },
    { id: 'v1', name: 'Dầu gội Visante', brand: { name: 'Visante' } },
    { id: 'pl2', name: 'Sữa tắm PƠ LANG', brand: { name: 'pơ lang' } },
    { id: 'x1', name: 'Hàng chưa rõ nhãn', brand: null },
  ];
  const chips = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Lọc theo thương hiệu"] button'));
  const rowIds = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid^="ingredients-row-"]')).map((el) => el.getAttribute('data-testid')!.replace('ingredients-row-', ''));
  const copyBtn = (c: HTMLElement) => byText(c, 'button', 'Chép checklist gửi thương hiệu');

  it('chip theo nhãn (đếm SKU còn thiếu, nhiều trước, chưa rõ nhãn cuối); chọn nhãn thì chỉ còn dòng của nhãn đó; "Mọi thương hiệu" về đủ', () => {
    const { container } = setup({ products: BRANDED });
    expect(chips(container).map((b) => b.textContent)).toEqual(['Mọi thương hiệu (5)', 'PƠ LANG (2)', 'Fuwa3e (1)', 'Visante (1)', 'Chưa rõ thương hiệu (1)']);
    expect(chips(container)[0]!.getAttribute('aria-pressed')).toBe('true');
    click(byText(container, 'button', 'PƠ LANG (2)'));
    expect(byText(container, 'button', 'PƠ LANG (2)')!.getAttribute('aria-pressed')).toBe('true');
    expect(rowIds(container)).toEqual(['pl1', 'pl2']);
    click(byText(container, 'button', 'Mọi thương hiệu'));
    expect(rowIds(container)).toEqual(['f1', 'pl1', 'v1', 'pl2', 'x1']);
    for (const b of [...chips(container), copyBtn(container)!]) expect(b.className).toContain('min-h-[44px]');
  });

  it('một chạm chép checklist: đã chọn nhãn thì tin chào đích danh nhãn đó; "Mọi thương hiệu" thì liệt kê theo từng nhãn; báo đã chép kèm số SKU', async () => {
    const { container } = setup({ products: BRANDED });
    click(byText(container, 'button', 'PƠ LANG (2)'));
    expect(container.textContent).toContain('Tin nhắn Zalo nhờ PƠ LANG gửi thành phần của 2 sản phẩm.');
    click(copyBtn(container));
    await flush();
    const one = clip.copyText.mock.calls[0]![0];
    expect(one.startsWith('Chào anh/chị bên PƠ LANG,\n')).toBe(true);
    expect(one).toContain('\n1. Nước mùi già PƠ LANG 160ml\n2. Sữa tắm PƠ LANG\n');
    expect(one).not.toContain('Fuwa3e');
    expect(container.textContent).toContain('Đã chép checklist 2 sản phẩm của PƠ LANG. Dán vào Zalo gửi thương hiệu.');

    click(byText(container, 'button', 'Mọi thương hiệu'));
    click(copyBtn(container));
    await flush();
    const all = clip.copyText.mock.calls[1]![0];
    expect(all.startsWith('Chào anh/chị,\n')).toBe(true);
    expect(all).toContain('của 5 sản phẩm sau:');
    expect(all).toContain('\n\nFuwa3e (1 sản phẩm):\n1. Xịt thơm Fuwa3e 300ml\n');
    expect(all).toContain('\n\nChưa rõ thương hiệu (1 sản phẩm):\n1. Hàng chưa rõ nhãn\n');
    expect(container.textContent).toContain('Đã chép checklist 5 sản phẩm của 4 thương hiệu. Dán vào Zalo gửi thương hiệu.');
  });

  it('mọi SKU cùng một nhãn: không vẽ chip, nút vẫn chép tin chào đích danh nhãn đó', async () => {
    const { container } = setup({ products: BRANDED.filter((p) => p.id.startsWith('pl')) });
    expect(chips(container)).toHaveLength(0);
    expect(container.textContent).toContain('Tin nhắn Zalo nhờ PƠ LANG gửi thành phần của 2 sản phẩm.');
    click(copyBtn(container));
    await flush();
    expect(clip.copyText.mock.calls[0]![0].startsWith('Chào anh/chị bên PƠ LANG,\n')).toBe(true);
  });

  it('trình duyệt chặn sao chép: báo lỗi rõ (role alert), không nói là đã chép', async () => {
    clip.copyText.mockImplementation(async () => false);
    const { container } = setup({ products: BRANDED });
    click(copyBtn(container));
    await flush();
    expect(byText(container, '[role="alert"]', 'Trình duyệt chặn sao chép.')).not.toBeNull();
    expect(container.textContent).not.toContain('Đã chép checklist');
  });

  it('lưu xong SKU cuối của nhãn đang chọn: chip nhãn đó rời đi, về "Mọi thương hiệu"; checklist không còn SKU vừa lưu', async () => {
    const { container } = setup({ products: BRANDED });
    click(byText(container, 'button', 'Fuwa3e (1)'));
    typeInto(areaOf(container, 'f1'), 'Nước');
    click(saveBtn(container, 'f1'));
    await flush();
    expect(byText(container, 'button', 'Fuwa3e (')).toBeNull();
    expect(chips(container)[0]!.textContent).toBe('Mọi thương hiệu (4)');
    expect(chips(container)[0]!.getAttribute('aria-pressed')).toBe('true');
    click(copyBtn(container));
    await flush();
    expect(clip.copyText.mock.calls[0]![0]).not.toContain('Xịt thơm Fuwa3e 300ml');
  });

  it('đang chọn một thương hiệu mà danh sách còn thiếu co về đúng thương hiệu đó: chip ẩn thì bỏ lọc, dòng đã lưu của thương hiệu khác vẫn hiện', async () => {
    const { container, rerender } = setup({ products: BRANDED, save: { body: { id: 'f1', ingredients: ['Nước'], added: 1 } } });
    typeInto(areaOf(container, 'f1'), 'Nước');
    click(saveBtn(container, 'f1'));
    await flush();
    click(byText(container, 'button', 'PƠ LANG (2)'));
    expect(rowIds(container)).toEqual(['pl1', 'pl2']);
    rerender(BRANDED.filter((p) => p.id === 'f1' || p.id.startsWith('pl')));
    expect(chips(container)).toEqual([]);
    expect(rowIds(container)).toEqual(['f1', 'pl1', 'pl2']);
  });

  it('không còn SKU thiếu (hoặc API cũ chưa trả nhãn): không có nút chép khi danh sách trống; thiếu nhãn thì gom vào "Chưa rõ thương hiệu"', () => {
    const empty = setup({ products: [] });
    expect(copyBtn(empty.container)).toBeNull();
    const old = setup({ products: PRODUCTS });
    expect(chips(old.container)).toHaveLength(0);
    expect(old.container.textContent).toContain('Tin nhắn Zalo liệt kê 2 sản phẩm chưa rõ thương hiệu.');
  });
});
