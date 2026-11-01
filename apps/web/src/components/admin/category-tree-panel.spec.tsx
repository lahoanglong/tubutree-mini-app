// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CategoryTreePanel } from './category-tree-panel';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { listAdminCategories, type AdminCategory, type AdminCategoryList } from '@/lib/product-categories';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const row = (id: string, name: string, parentId: string | null, sortOrder: number, productCount = 0, totalCount = productCount): AdminCategory => ({
  id,
  name,
  slug: id,
  parentId,
  sortOrder,
  productCount,
  totalCount,
});

function fixture(): AdminCategoryList {
  return {
    items: [
      row('A', 'Nhà bếp', null, 0, 1, 6),
      row('A1', 'Chén bát', 'A', 0, 3),
      row('A2', 'Dao thớt', 'A', 1, 2),
      row('B', 'Giặt tẩy', null, 1, 4),
      row('C', 'Chăm sóc cá nhân', null, 2, 0),
    ],
    limits: { maxRoots: 8, maxChildren: 8 },
  };
}

function Host({ collapsible = false, startOpen = true }: { collapsible?: boolean; startOpen?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tree'], queryFn: listAdminCategories });
  const [open, setOpen] = useState(startOpen);
  return (
    <CategoryTreePanel
      {...(collapsible ? { open, onToggle: () => setOpen((v) => !v) } : {})}
      data={q.data}
      loading={q.isLoading}
      error={q.isError ? (q.error as Error).message : null}
      onRetry={() => void q.refetch()}
      onChanged={() => qc.invalidateQueries({ queryKey: ['tree'] })}
    />
  );
}

interface Opts {
  collapsible?: boolean;
  startOpen?: boolean;
  list?: AdminCategoryList;
  mutate?: { status?: number; body: unknown };
  listStatus?: number;
  /** Máy chủ đòi xác nhận gốc đang có sản phẩm gắn thẳng: câu trả về; lệnh gửi lại có `confirmDirectProducts` thì được. */
  needsConfirm?: string;
}
const PARENT_HAS_PRODUCTS = 'CATEGORY_PARENT_HAS_PRODUCTS';
function setup(opts: Opts = {}) {
  let list = opts.list ?? fixture();
  const confirmGate = (init?: RequestInit) => {
    if (!opts.needsConfirm || (JSON.parse(String(init?.body)) as { confirmDirectProducts?: boolean }).confirmDirectProducts) return null;
    return { status: 400, body: { code: PARENT_HAS_PRODUCTS, message: opts.needsConfirm } };
  };
  const m: ReturnType<typeof mockFetch> = mockFetch({
    '/admin/categories/order': (init) => {
      if (opts.mutate) return opts.mutate;
      const body = JSON.parse(String(init?.body)) as { parentId: string | null; orderedIds: string[] };
      list = {
        ...list,
        items: list.items.map((c) => (body.orderedIds.includes(c.id) ? { ...c, sortOrder: body.orderedIds.indexOf(c.id) } : c)),
      };
      return { body: list };
    },
    '/admin/categories/': (init) => {
      if (opts.mutate) return opts.mutate;
      const gate = confirmGate(init);
      if (gate) return gate;
      // PATCH đổi cha thật: cây tải lại khác cây cũ, như máy chủ (react-query giữ nguyên tham chiếu khi dữ liệu y hệt).
      if (init?.method === 'PATCH') {
        const id = decodeURIComponent(m.calls.at(-1)!.url.split('/').pop()!);
        const { parentId } = JSON.parse(String(init.body)) as { parentId?: string | null };
        if (parentId !== undefined) list = { ...list, items: list.items.map((c) => (c.id === id ? { ...c, parentId } : c)) };
      }
      return { body: row('X', 'x', null, 0) };
    },
    '/admin/categories': (init) => {
      if (init?.method === 'POST') return opts.mutate ?? confirmGate(init) ?? { body: row('N', 'n', null, 9) };
      if (opts.listStatus) return { status: opts.listStatus, body: { message: 'Máy chủ lỗi.' } };
      return { body: list };
    },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  const r = render(<Host collapsible={opts.collapsible} startOpen={opts.startOpen} />);
  mounted.push(r);
  const calls = (method: string) => m.calls.filter((c) => (c.init?.method ?? 'GET') === method);
  return { m, container: r.container, calls };
}

const btn = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label) ?? null;
const exact = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text) ?? null;
const names = (container: HTMLElement) => [...container.querySelectorAll('[data-cat-name]')].map((e) => e.textContent);

describe('CategoryTreePanel', () => {
  it('hiện tiêu đề, bộ đếm tầng 1 và cây hai tầng với số sản phẩm', async () => {
    const { container } = setup();
    await flush();
    expect(container.querySelector('h3')!.textContent).toBe('Cây danh mục');
    expect(container.textContent).toContain('Tầng 1: 3/8 · tối đa 8 mục con mỗi mục');
    expect(names(container)).toEqual(['Nhà bếp', 'Chén bát', 'Dao thớt', 'Giặt tẩy', 'Chăm sóc cá nhân']);
    // Mục cha đếm cả mục con; mục lá đếm sản phẩm gắn thẳng.
    expect(container.textContent).toContain('6 sản phẩm, cả mục con');
    expect(container.textContent).toContain('4 sản phẩm');
  });

  it('↑ ở gốc thứ hai gửi PUT order, báo vị trí mới và giữ focus ở nút vừa bấm', async () => {
    const { container, calls } = setup();
    await flush();
    const up = btn('Đưa "Giặt tẩy" lên trên')!;
    up.focus();
    click(up);
    await flush();
    const put = calls('PUT');
    expect(put).toHaveLength(1);
    expect(put[0]!.url).toContain('/admin/categories/order');
    expect(JSON.parse(String(put[0]!.init!.body))).toEqual({ parentId: null, orderedIds: ['B', 'A', 'C'] });
    expect(names(container)).toEqual(['Giặt tẩy', 'Nhà bếp', 'Chén bát', 'Dao thớt', 'Chăm sóc cá nhân']);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Đã đưa "Giặt tẩy" lên vị trí 1/3.');
    expect(document.activeElement).toBe(btn('Đưa "Giặt tẩy" lên trên'));
  });

  it('↓ ở gốc đầu: sau khi cây sắp lại focus vẫn ở nút đã bấm', async () => {
    const { container } = setup();
    await flush();
    const down = btn('Đưa "Nhà bếp" xuống dưới')!;
    down.focus();
    click(down);
    await flush();
    expect(names(container).slice(0, 3)).toEqual(['Giặt tẩy', 'Nhà bếp', 'Chén bát']);
    expect(document.activeElement).toBe(btn('Đưa "Nhà bếp" xuống dưới'));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã đưa "Nhà bếp" xuống vị trí 2/3.');
  });

  it('↓ ở mục con gửi parentId của mục cha và đúng thứ tự anh em', async () => {
    const { calls } = setup();
    await flush();
    click(btn('Đưa "Chén bát" xuống dưới'));
    await flush();
    expect(JSON.parse(String(calls('PUT')[0]!.init!.body))).toEqual({ parentId: 'A', orderedIds: ['A2', 'A1'] });
  });

  it('ở đầu và cuối danh sách nút ↑↓ dùng aria-disabled (giữ focus được) và không gọi API', async () => {
    const { calls } = setup();
    await flush();
    const first = btn('Đưa "Nhà bếp" lên trên')!;
    const last = btn('Đưa "Chăm sóc cá nhân" xuống dưới')!;
    for (const b of [first, last]) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
      click(b);
    }
    await flush();
    expect(calls('PUT')).toHaveLength(0);
    expect(btn('Đưa "Giặt tẩy" lên trên')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('đủ 8 gốc: nút "Thêm danh mục gốc" bị khoá kèm lý do; mục cha vẫn thêm được mục con', async () => {
    const full = fixture();
    for (let i = 0; i < 5; i++) full.items.push(row(`R${i}`, `Gốc ${i}`, null, 10 + i));
    const { container } = setup({ list: full });
    await flush();
    const add = byText(container, 'button', 'Thêm danh mục gốc') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(container.textContent).toContain('Đã đủ 8 danh mục gốc');
    expect(btn('Thêm mục con vào "Nhà bếp"')!.disabled).toBe(false);
  });

  it('mục cha đủ 8 con: chỉ nút thêm con của mục đó bị khoá', async () => {
    const full = fixture();
    for (let i = 0; i < 6; i++) full.items.push(row(`K${i}`, `Con ${i}`, 'A', 10 + i));
    const { container } = setup({ list: full });
    await flush();
    expect(btn('Thêm mục con vào "Nhà bếp"')!.disabled).toBe(true);
    expect(container.textContent).toContain('Đã đủ 8 mục con');
    expect(btn('Thêm mục con vào "Giặt tẩy"')!.disabled).toBe(false);
  });

  it('thêm danh mục gốc gửi POST { name } rồi tải lại cây', async () => {
    const { container, calls } = setup();
    await flush();
    click(byText(container, 'button', 'Thêm danh mục gốc'));
    typeInto(container.querySelector('input[aria-label="Tên danh mục gốc mới"]'), '  Đồ chơi ');
    click(exact('Thêm'));
    await flush();
    const post = calls('POST');
    expect(post).toHaveLength(1);
    expect(JSON.parse(String(post[0]!.init!.body))).toEqual({ name: 'Đồ chơi' });
    expect(calls('GET').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('input[aria-label="Tên danh mục gốc mới"]')).toBeNull();
  });

  it('thêm mục con gửi POST { name, parentId }', async () => {
    const { container, calls } = setup();
    await flush();
    click(btn('Thêm mục con vào "Giặt tẩy"'));
    typeInto(container.querySelector('input[aria-label="Tên mục con mới của \\"Giặt tẩy\\""]'), 'Nước giặt');
    click(exact('Thêm'));
    await flush();
    expect(JSON.parse(String(calls('POST')[0]!.init!.body))).toEqual({ name: 'Nước giặt', parentId: 'B' });
  });

  describe('gốc đang có sản phẩm gắn thẳng (máy chủ đòi xác nhận, mã CATEGORY_PARENT_HAS_PRODUCTS)', () => {
    const MSG = 'Danh mục "Giặt tẩy" đang có 4 sản phẩm gắn thẳng. Khi có mục con, các sản phẩm này vẫn nằm ở "Giặt tẩy" và chưa thuộc mục con nào; sau khi thêm, gán chúng sang mục con.';
    const addChild = (container: HTMLElement) => {
      click(btn('Thêm mục con vào "Giặt tẩy"'));
      typeInto(container.querySelector('input[aria-label="Tên mục con mới của \\"Giặt tẩy\\""]'), 'Nước giặt');
      click(exact('Thêm'));
    };

    it('thêm mục con: hộp xác nhận nêu đúng câu của máy chủ; đồng ý thì gửi lại POST kèm confirmDirectProducts', async () => {
      const { container, calls } = setup({ needsConfirm: MSG });
      await flush();
      addChild(container);
      await flush();
      expect(confirmDialog()?.textContent).toContain(MSG);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(calls('POST')).toHaveLength(1);
      answerConfirm(true);
      await flush();
      const post = calls('POST');
      expect(post).toHaveLength(2);
      expect(JSON.parse(String(post[1]!.init!.body))).toEqual({ name: 'Nước giặt', parentId: 'B', confirmDirectProducts: true });
      expect(container.querySelector('input[aria-label^="Tên mục con mới"]')).toBeNull();
      expect(container.textContent).toContain('Đã thêm "Nước giặt".');
    });

    it('thêm mục con: Huỷ thì không gửi lại, không báo lỗi, ô nhập giữ tên đã gõ', async () => {
      const { container, calls } = setup({ needsConfirm: MSG });
      await flush();
      addChild(container);
      await flush();
      answerConfirm(false);
      await flush();
      expect(calls('POST')).toHaveLength(1);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>('input[aria-label^="Tên mục con mới"]')!.value).toBe('Nước giặt');
      expect(container.textContent).not.toContain('Đã thêm');
    });

    it('chuyển mục vào gốc đó: đồng ý thì gửi lại PATCH kèm confirmDirectProducts; Huỷ thì giữ lựa chọn', async () => {
      const { container, calls } = setup({ needsConfirm: MSG });
      await flush();
      const sel = () => document.querySelector<HTMLSelectElement>('select[aria-label="Chuyển \\"Chăm sóc cá nhân\\" sang mục khác"]')!;
      selectValue(sel(), 'B');
      click(btn('Chuyển "Chăm sóc cá nhân" vào "Giặt tẩy"'));
      await flush();
      expect(confirmDialog()?.textContent).toContain(MSG);
      answerConfirm(false);
      await flush();
      expect(calls('PATCH')).toHaveLength(1);
      expect(sel().value).toBe('B');
      expect(container.querySelector('[role="alert"]')).toBeNull();
      click(btn('Chuyển "Chăm sóc cá nhân" vào "Giặt tẩy"'));
      await flush();
      answerConfirm(true);
      await flush();
      const patch = calls('PATCH');
      expect(patch).toHaveLength(3);
      expect(JSON.parse(String(patch[2]!.init!.body))).toEqual({ parentId: 'B', confirmDirectProducts: true });
    });
  });

  it('đổi tên điền sẵn tên cũ, gửi PATCH { name }; Huỷ đóng ô và trả focus về nút Đổi tên', async () => {
    const { container, calls } = setup();
    await flush();
    click(btn('Đổi tên "Giặt tẩy"'));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Tên mới của \\"Giặt tẩy\\""]')!;
    expect(input.value).toBe('Giặt tẩy');
    typeInto(input, 'Giặt giũ');
    click(exact('Lưu'));
    await flush();
    const patch = calls('PATCH');
    expect(patch[0]!.url).toContain('/admin/categories/B');
    expect(JSON.parse(String(patch[0]!.init!.body))).toEqual({ name: 'Giặt giũ' });

    click(btn('Đổi tên "Chăm sóc cá nhân"'));
    click(exact('Huỷ'));
    await flush();
    expect(container.querySelector('input[aria-label^="Tên mới của"]')).toBeNull();
    expect(document.activeElement).toBe(btn('Đổi tên "Chăm sóc cá nhân"'));
  });

  it('ô "chuyển vào" chỉ có ở mục chưa có con; chọn đích chưa ghi gì, bấm nút "Chuyển" mới gửi PATCH { parentId }', async () => {
    const { calls } = setup();
    await flush();
    expect(document.querySelector('select[aria-label="Chuyển \\"Nhà bếp\\" sang mục khác"]')).toBeNull();
    const sel = document.querySelector<HTMLSelectElement>('select[aria-label="Chuyển \\"Giặt tẩy\\" sang mục khác"]')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Chuyển…', 'Vào "Nhà bếp"', 'Vào "Chăm sóc cá nhân"']);
    expect(btn('Chuyển "Giặt tẩy" vào "Nhà bếp"')).toBeNull();
    selectValue(sel, 'A');
    await flush();
    // Mũi tên trên ô chọn đóng lại cũng ra onChange: chọn xong không được chuyển ngay.
    expect(calls('PATCH')).toHaveLength(0);
    const confirmBtn = btn('Chuyển "Giặt tẩy" vào "Nhà bếp"')!;
    expect(confirmBtn.textContent).toBe('Chuyển');
    click(confirmBtn);
    await flush();
    expect(JSON.parse(String(calls('PATCH')[0]!.init!.body))).toEqual({ parentId: 'A' });
    expect(btn('Chuyển "Giặt tẩy" vào "Nhà bếp"')).toBeNull();
    expect(document.activeElement).toBe(btn('Đưa "Giặt tẩy" lên trên'));
    // Mục con có thêm lựa chọn "thành danh mục gốc".
    const child = document.querySelector<HTMLSelectElement>('select[aria-label="Chuyển \\"Chén bát\\" sang mục khác"]')!;
    expect([...child.options].map((o) => o.textContent)).toContain('Thành danh mục gốc');
    selectValue(child, '__root__');
    await flush();
    expect(calls('PATCH')).toHaveLength(1);
    click(btn('Chuyển "Chén bát" thành danh mục gốc'));
    await flush();
    expect(JSON.parse(String(calls('PATCH')[1]!.init!.body))).toEqual({ parentId: null });
  });

  it('chuyển bị máy chủ từ chối: lỗi hiện cạnh mục, lựa chọn và nút "Chuyển" còn nguyên để thử lại', async () => {
    const msg = 'Danh mục "Nhà bếp" đã đủ 8 mục con. Xoá bớt một mục con trước khi thêm.';
    const { container } = setup({ mutate: { status: 400, body: { message: msg } } });
    await flush();
    const sel = () => document.querySelector<HTMLSelectElement>('select[aria-label="Chuyển \\"Giặt tẩy\\" sang mục khác"]')!;
    selectValue(sel(), 'A');
    click(btn('Chuyển "Giặt tẩy" vào "Nhà bếp"'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
    expect(sel().value).toBe('A');
    expect(btn('Chuyển "Giặt tẩy" vào "Nhà bếp"')).not.toBeNull();
  });

  it('xoá hỏi xác nhận trước, chỉ gọi DELETE khi đồng ý', async () => {
    const { calls } = setup();
    await flush();
    click(btn('Xoá "Chăm sóc cá nhân"'));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    expect(calls('DELETE')).toHaveLength(0);
    answerConfirm(false);
    await flush();
    expect(calls('DELETE')).toHaveLength(0);

    click(btn('Xoá "Chăm sóc cá nhân"'));
    await flush();
    answerConfirm(true);
    await flush();
    const del = calls('DELETE');
    expect(del).toHaveLength(1);
    expect(del[0]!.url).toContain('/admin/categories/C');
  });

  it('lỗi 400 của API hiện nguyên văn trong role="alert"', async () => {
    const msg = 'Danh mục "Nhà bếp" đã đủ 8 mục con. Xoá bớt một mục con trước khi thêm.';
    const { container } = setup({ mutate: { status: 400, body: { message: msg } } });
    await flush();
    click(btn('Thêm mục con vào "Giặt tẩy"'));
    typeInto(container.querySelector('input[aria-label="Tên mục con mới của \\"Giặt tẩy\\""]'), 'Nước giặt');
    click(exact('Thêm'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
    // Ô nhập giữ lại để sửa tên rồi thử lại.
    expect(container.querySelector<HTMLInputElement>('input[aria-label^="Tên mục con mới"]')!.value).toBe('Nước giặt');
  });

  it('đang tải hiện "Đang tải…", lỗi tải hiện nút Thử lại gọi lại API', async () => {
    const { container, calls } = setup({ listStatus: 500 });
    expect(container.textContent).toContain('Đang tải…');
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ lỗi.');
    const before = calls('GET').length;
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(calls('GET').length).toBeGreaterThan(before);
  });

  it('lỗi tải hiện cả khi panel thu gọn, kèm Thử lại gọi lại API; mở ra vẫn chỉ một bản', async () => {
    const { container, calls } = setup({ collapsible: true, startOpen: false, listStatus: 500 });
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ lỗi.');
    expect(container.querySelector('ul[aria-label="Cây danh mục"]')).toBeNull();
    const before = calls('GET').length;
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(calls('GET').length).toBeGreaterThan(before);
    click(exact('Mở rộng'));
    await flush();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('mọi nút trong cây mang tên mục trong tên truy cập (đọc màn hình biết đang thao tác mục nào)', async () => {
    const { container } = setup();
    await flush();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Cây danh mục"] button')];
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) expect(b.getAttribute('aria-label') ?? '').toMatch(/"[^"]+"/);
  });

  it('có onToggle: nút Thu gọn/Mở rộng điều khiển phần thân qua aria-expanded; thu gọn vẫn giữ tiêu đề và bộ đếm', async () => {
    const { container } = setup({ collapsible: true, startOpen: false });
    await flush();
    const toggle = exact('Mở rộng')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('h3')!.textContent).toBe('Cây danh mục');
    expect(container.textContent).toContain('Tầng 1: 3/8');
    expect(container.querySelector('ul[aria-label="Cây danh mục"]')).toBeNull();
    click(toggle);
    await flush();
    expect(exact('Thu gọn')!.getAttribute('aria-expanded')).toBe('true');
    expect(names(container)).toContain('Giặt tẩy');
  });
});
