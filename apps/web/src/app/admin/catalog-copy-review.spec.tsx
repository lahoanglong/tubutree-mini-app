// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CopyApproveResponse, CopyDraft, CopyDraftsResponse } from '@tubutree/shared-types';
import { CatalogCopyReview, parseIngredients, type CopyReviewSelection, type CurrentCopy } from './catalog-copy-review';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const D = (id: string, over: Partial<CopyDraft> = {}): CopyDraft => ({
  id,
  slug: `sp-${id}`,
  name: `Sản phẩm ${id}`,
  shortDesc: `Ngắn ${id}`,
  description: `Mô tả ${id}`,
  ingredients: ['Dứa', 'Muối'],
  source: 'ai',
  warnings: [],
  ...over,
});
const sel = (...ids: string[]): CopyReviewSelection[] => ids.map((id) => ({ id, name: `Sản phẩm ${id}` }));
const CURRENT = new Map<string, CurrentCopy>([
  ['a', { shortDesc: 'Ngắn cũ', description: '<p>Mô tả <b>cũ</b>&nbsp;của a</p><p>Dòng hai</p>', hasIngredients: false }],
  ['b', { shortDesc: null, description: '', hasIngredients: true }],
]);

interface HarnessProps {
  batches: CopyReviewSelection[][];
  onSaved?: (ids: readonly string[]) => Promise<unknown>;
  auditBusy?: boolean;
  onSelectEmpty?: () => void;
}
function Harness({ batches, onSaved = async () => true, auditBusy = false, onSelectEmpty = () => {} }: HarnessProps) {
  const [i, setI] = useState(0);
  return (
    <>
      <button type="button" data-next onClick={() => setI((x) => x + 1)}>
        lô kế
      </button>
      <CatalogCopyReview selected={batches[i]!} current={CURRENT} emptyCount={3} auditBusy={auditBusy} onSelectEmpty={onSelectEmpty} onSaved={onSaved} />
    </>
  );
}
const mount = (props: HarnessProps) => {
  const r = render(<Harness {...props} />);
  mounted.push(r);
  return r;
};

type Route = { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown });
const api = (drafts: Route, approve: Route = { body: { saved: [], rejected: [] } }) => {
  const m = mockFetch({ '/admin/catalog-quality/copy-drafts': drafts, '/admin/catalog-quality/copy-approve': approve });
  vi.stubGlobal('fetch', m.fn);
  return m;
};
const draftsOk = (...drafts: CopyDraft[]): { body: CopyDraftsResponse } => ({ body: { drafts, failed: [] } });
const approveOk = (saved: string[], rejected: CopyApproveResponse['rejected'] = []): { body: CopyApproveResponse } => ({ body: { saved, rejected } });
const posts = (m: ReturnType<typeof mockFetch>, part: string) => m.calls.filter((c) => c.url.includes(part));
const bodyOf = (c: { init?: RequestInit }) => JSON.parse(String(c.init!.body));
const composeBtn = (r: Rendered) => byText(r.container, 'button', 'Soạn mô tả bằng AI') ?? byText(r.container, 'button', 'Đang soạn')!;
const card = (r: Rendered, id: string) => r.container.querySelector<HTMLElement>(`[data-copy-card="${id}"]`)!;
const field = (c: HTMLElement, label: string) => {
  const l = Array.from(c.querySelectorAll('label')).find((x) => x.textContent?.trim() === label)!;
  return document.getElementById(l.htmlFor) as HTMLTextAreaElement;
};
const approveBtn = (c: HTMLElement) => (byText(c, 'button', 'Duyệt & Lưu vào DB') ?? byText(c, 'button', 'Đang lưu')) as HTMLButtonElement;
const compose = async (r: Rendered) => {
  click(composeBtn(r));
  await flush(20);
};

describe('CatalogCopyReview: soạn bản nháp', () => {
  it('bấm Soạn gửi đúng danh sách id; kết quả là thẻ mỗi sản phẩm có tên, nhãn AI soạn, ô sửa điền sẵn và nhắc kiểm thành phần với bao bì', async () => {
    const m = api(draftsOk(D('a'), D('b')));
    const r = mount({ batches: [sel('a', 'b')] });
    expect(composeBtn(r).textContent).toBe('Soạn mô tả bằng AI (2)');
    await compose(r);
    expect(posts(m, 'copy-drafts')).toHaveLength(1);
    expect(bodyOf(posts(m, 'copy-drafts')[0]!)).toEqual({ ids: ['a', 'b'] });
    expect(r.container.querySelectorAll('ul[aria-label="Bản nháp mô tả"] > li')).toHaveLength(2);
    const a = card(r, 'a');
    expect(a.textContent).toContain('Sản phẩm a');
    expect(a.textContent).toContain('AI soạn');
    expect(field(a, 'Mô tả ngắn').value).toBe('Ngắn a');
    expect(field(a, 'Mô tả').value).toBe('Mô tả a');
    expect(field(a, 'Thành phần').value).toBe('Dứa\nMuối');
    expect(r.container.textContent).toContain('Kiểm lại thành phần với bao bì trước khi lưu.');
    expect(r.container.querySelector('[role="status"]')).toBeNull();
  });

  it('khối "Hiện tại trong DB" thu gọn, hiện chữ đang có (bỏ thẻ HTML) để đối chiếu', async () => {
    api(draftsOk(D('a'), D('b')));
    const r = mount({ batches: [sel('a', 'b')] });
    await compose(r);
    const d = card(r, 'a').querySelector('details')!;
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')!.textContent).toBe('Hiện tại trong DB');
    expect(d.querySelector('summary')!.className).toMatch(/min-h-\[44px\]/);
    expect(d.textContent).toContain('Ngắn cũ');
    expect(d.textContent).toContain('Mô tả cũ của a');
    expect(d.textContent).not.toContain('<p>');
    expect(d.textContent).toContain('Chưa có');
    const dB = card(r, 'b').querySelector('details')!.textContent!;
    expect(dB).toContain('Đã có trong DB');
  });

  it('sản phẩm đang có mô tả gốc: thẻ nháp cảnh báo Pancake sẽ ghi đè khi đồng bộ; mô tả trống hay không có dữ liệu thì không', async () => {
    api(draftsOk(D('a'), D('b'), D('c')));
    const r = mount({ batches: [sel('a', 'b', 'c')] });
    await compose(r);
    const WARN = 'Sản phẩm này đã có mô tả từ Pancake. Mô tả từ 80 ký tự (không phải bản chép tên sản phẩm) được giữ: đồng bộ Pancake (mỗi 15 phút) không ghi đè. Ngắn hơn 80 ký tự thì đồng bộ vẫn ghi đè khi Pancake có chữ thật từ 40 ký tự; mô tả vừa lưu chỉ bền khi ô mô tả trên Pancake để trống.';
    expect(card(r, 'a').textContent).toContain(WARN);
    expect(card(r, 'b').textContent).not.toContain('đã có mô tả từ Pancake');
    expect(card(r, 'c').textContent).not.toContain('đã có mô tả từ Pancake');
  });

  it('mô tả gốc chỉ có thẻ trống hay &nbsp; tính là chưa có: không cảnh báo ghi đè', async () => {
    api(draftsOk(D('e')));
    const cur = new Map<string, CurrentCopy>([['e', { shortDesc: null, description: '<p>&nbsp;</p>', hasIngredients: false }]]);
    const r = render(<CatalogCopyReview selected={sel('e')} current={cur} emptyCount={0} auditBusy={false} onSelectEmpty={() => {}} onSaved={async () => true} />);
    mounted.push(r);
    await compose(r);
    expect(card(r, 'e').textContent).not.toContain('đã có mô tả từ Pancake');
  });

  it('đang soạn: hiện role=status nói có thể mất tới một phút, nút báo bận; bấm đúp chỉ gửi một request', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const m = mockFetch({ '/admin/catalog-quality/copy-drafts': draftsOk(D('a')) });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      await gate;
      return m.fn(url, init);
    });
    const r = mount({ batches: [sel('a')] });
    const btn = composeBtn(r);
    click(btn);
    click(btn);
    await flush(2);
    expect(r.container.querySelector('[role="status"]')!.textContent).toBe('AI đang soạn, có thể mất tới một phút.');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.textContent).toBe('Đang soạn');
    release();
    await flush(20);
    expect(m.calls).toHaveLength(1);
    expect(r.container.querySelector('[role="status"]')).toBeNull();
    expect(composeBtn(r).getAttribute('aria-busy')).toBeNull();
    expect(card(r, 'a')).not.toBeNull();
  });

  it('503 "đang soạn cho người khác": hiện đúng lời máy chủ kèm Thử lại; thử lại được', async () => {
    let busy = true;
    api(() => (busy ? { status: 503, body: { message: 'Đang soạn mô tả cho quản trị viên khác, thử lại sau ít giây.' } } : { body: { drafts: [D('a')], failed: [] } }));
    const r = mount({ batches: [sel('a')] });
    await compose(r);
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Đang soạn mô tả cho quản trị viên khác, thử lại sau ít giây.');
    expect(card(r, 'a')).toBeNull();
    busy = false;
    click(byText(alert, 'button', 'Thử lại'));
    await flush(20);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(card(r, 'a')).not.toBeNull();
  });

  it('chữ dự phòng đã duyệt: nhãn riêng; cảnh báo bộ chặn hiện trong thẻ; failed[] nêu tên và lý do từng sản phẩm', async () => {
    api({
      body: {
        drafts: [D('a', { source: 'fallback', warnings: ['AI gặp lỗi, dùng chữ dự phòng', 'Đã bỏ câu: "chữa khỏi mọi bệnh"'] })],
        failed: [{ id: 'b', reason: 'Sản phẩm của đối tác: đối tác tự soạn mô tả.' }],
      },
    });
    const r = mount({ batches: [sel('a', 'b')] });
    await compose(r);
    expect(card(r, 'a').textContent).toContain('Chữ dự phòng đã duyệt');
    expect(card(r, 'a').textContent).not.toContain('AI soạn');
    expect(card(r, 'a').textContent).toContain('Đã bỏ câu: "chữa khỏi mọi bệnh"');
    expect(card(r, 'a').textContent).toContain('AI gặp lỗi, dùng chữ dự phòng');
    const t = r.container.textContent!;
    expect(t).toContain('Chưa soạn được 1 sản phẩm');
    expect(t).toContain('Sản phẩm b: Sản phẩm của đối tác: đối tác tự soạn mô tả.');
    expect(card(r, 'b')).toBeNull();
  });

  it('không chọn gì hoặc chọn quá 10: nút Soạn báo khoá và bấm không gửi gì', async () => {
    const m = api(draftsOk(D('a')));
    const none = mount({ batches: [[]] });
    click(composeBtn(none));
    await flush(5);
    expect(composeBtn(none).getAttribute('aria-disabled')).toBe('true');
    const eleven = mount({ batches: [sel(...Array.from({ length: 11 }, (_, i) => `x${i}`))] });
    expect(composeBtn(eleven).textContent).toBe('Soạn mô tả bằng AI (11)');
    expect(composeBtn(eleven).getAttribute('aria-disabled')).toBe('true');
    click(composeBtn(eleven));
    await flush(5);
    const ten = mount({ batches: [sel(...Array.from({ length: 10 }, (_, i) => `y${i}`))] });
    expect(composeBtn(ten).getAttribute('aria-disabled')).toBeNull();
    expect(m.calls).toHaveLength(0);
  });

  it('lần kiểm đang chạy lại: khoá soạn và nút chọn nhanh', async () => {
    const m = api(draftsOk(D('a')));
    const onSelectEmpty = vi.fn();
    const r = mount({ batches: [sel('a')], auditBusy: true, onSelectEmpty });
    click(composeBtn(r));
    click(byText(r.container, 'button', 'Chọn các dòng trống mô tả')!);
    await flush(5);
    expect(composeBtn(r).getAttribute('aria-disabled')).toBe('true');
    expect(m.calls).toHaveLength(0);
    expect(onSelectEmpty).not.toHaveBeenCalled();
  });

  it('"Chọn các dòng trống mô tả" gọi chọn nhanh khi rảnh; nút hiện tối đa 10', async () => {
    const onSelectEmpty = vi.fn();
    const r = mount({ batches: [sel('a')], onSelectEmpty });
    click(byText(r.container, 'button', 'Chọn các dòng trống mô tả')!);
    expect(onSelectEmpty).toHaveBeenCalledTimes(1);
    expect(byText(r.container, 'button', 'Chọn các dòng trống mô tả')!.textContent).toBe('Chọn các dòng trống mô tả (3)');
  });
});

describe('CatalogCopyReview: sửa tay và duyệt', () => {
  it('sửa tay rồi duyệt: gửi đúng chữ đã sửa (ô thành phần tách theo dòng, giữ dấu phẩy trong tên, bỏ trùng); bộ đếm cập nhật', async () => {
    const m = api(draftsOk(D('a')), approveOk(['a']));
    const r = mount({ batches: [sel('a')] });
    await compose(r);
    const a = card(r, 'a');
    expect(a.textContent).toContain('6/140');
    expect(a.textContent).toContain('2/8');
    typeInto(field(a, 'Mô tả ngắn'), 'Nước rửa chén dịu nhẹ');
    typeInto(field(a, 'Mô tả'), 'Chai 500ml, mùi dứa.');
    typeInto(field(a, 'Thành phần'), 'Dứa\nHạt, củ, quả\nGừng\n dứa ');
    expect(a.textContent).toContain('21/140');
    expect(a.textContent).toContain('3/8');
    click(approveBtn(a));
    await flush(20);
    expect(bodyOf(posts(m, 'copy-approve')[0]!)).toEqual({ items: [{ id: 'a', shortDesc: 'Nước rửa chén dịu nhẹ', description: 'Chai 500ml, mùi dứa.', ingredients: ['Dứa', 'Hạt, củ, quả', 'Gừng'] }] });
  });

  it('ô thành phần nói rõ mỗi dòng một thành phần; dấu phẩy và chấm phẩy trong tên không tách làm nhiều', async () => {
    api(draftsOk(D('a', { ingredients: ['Hạt, củ, quả', 'Muối; tiêu'] })));
    const r = mount({ batches: [sel('a')] });
    await compose(r);
    const a = card(r, 'a');
    expect(field(a, 'Thành phần').value).toBe('Hạt, củ, quả\nMuối; tiêu');
    expect(a.textContent).toContain('2/8');
    expect(a.textContent).toContain('Mỗi dòng là một thành phần');
  });

  it('ô chữ có trần độ dài đúng 140 và 800, ô thành phần không chặn; mọi ô rộng hết khổ, không tràn ngang ở 360px', async () => {
    api(draftsOk(D('a')));
    const r = mount({ batches: [sel('a')] });
    await compose(r);
    const a = card(r, 'a');
    expect(field(a, 'Mô tả ngắn').getAttribute('maxlength')).toBe('140');
    expect(field(a, 'Mô tả').getAttribute('maxlength')).toBe('800');
    expect(field(a, 'Thành phần').getAttribute('maxlength')).toBeNull();
    for (const label of ['Mô tả ngắn', 'Mô tả', 'Thành phần']) {
      expect(field(a, label).className).toMatch(/\bw-full\b/);
      expect(field(a, label).className).toMatch(/\bmin-w-0\b/);
    }
    expect(a.className).toMatch(/\bmin-w-0\b/);
    expect(a.querySelector('span.break-words')!.className).toContain('break-words');
    for (const b of Array.from(a.querySelectorAll('button'))) expect(b.className, b.textContent ?? '').toMatch(/min-h-\[44px\]/);
    expect(a.querySelector('label')!.className).toMatch(/min-h-\[44px\]/);
    expect(a.querySelector('label')!.className).toMatch(/min-w-\[44px\]/);
    expect(a.querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('Chọn thẻ Sản phẩm a để duyệt');
  });

  it('duyệt thành công: thẻ báo Đã lưu; khoá giữ tới khi kiểm tra lại xong rồi mới nhả; bấm đúp chỉ gửi một request', async () => {
    let finishReload: () => void = () => {};
    const reload = new Promise<void>((res) => (finishReload = res));
    const onSaved = vi.fn(() => reload);
    const m = api(draftsOk(D('a'), D('b')), approveOk(['a']));
    const r = mount({ batches: [sel('a', 'b')], onSaved });
    await compose(r);
    const btnA = approveBtn(card(r, 'a'));
    click(btnA);
    click(btnA);
    await flush(10);
    expect(posts(m, 'copy-approve')).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(['a']);
    expect(card(r, 'a').textContent).toContain('Đã lưu');
    expect(card(r, 'a').querySelector('textarea')).toBeNull();
    // đang chờ kiểm tra lại: mọi nút duyệt/soạn còn khoá
    const btnB = approveBtn(card(r, 'b'));
    expect(btnB.getAttribute('aria-disabled')).toBe('true');
    expect(composeBtn(r).getAttribute('aria-disabled')).toBe('true');
    click(btnB);
    await flush(5);
    expect(posts(m, 'copy-approve')).toHaveLength(1);
    expect(r.container.querySelector('ul[aria-label="Bản nháp mô tả"]')!.closest('[aria-busy]')!.getAttribute('aria-busy')).toBe('true');
    finishReload();
    await flush(10);
    expect(approveBtn(card(r, 'b')).getAttribute('aria-disabled')).toBeNull();
    expect(composeBtn(r).getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối (rejected): hiện lý do ngay trên thẻ, giữ thẻ và chữ đang sửa, không báo kiểm tra lại; sửa tiếp thì lý do tự mất', async () => {
    const onSaved = vi.fn(async () => true);
    api(draftsOk(D('a')), approveOk([], [{ id: 'a', reasons: ['Mô tả có câu bị chặn: "chữa khỏi mọi bệnh"'] }]));
    const r = mount({ batches: [sel('a')], onSaved });
    await compose(r);
    const a = card(r, 'a');
    typeInto(field(a, 'Mô tả'), 'Chữa khỏi mọi bệnh');
    click(approveBtn(a));
    await flush(20);
    const alert = a.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Mô tả có câu bị chặn: "chữa khỏi mọi bệnh"');
    expect(field(a, 'Mô tả').value).toBe('Chữa khỏi mọi bệnh');
    expect(a.textContent).not.toContain('Đã lưu vào DB');
    expect(onSaved).not.toHaveBeenCalled();
    expect(approveBtn(a).getAttribute('aria-disabled')).toBeNull();
    typeInto(field(a, 'Mô tả'), 'Chai 500ml');
    expect(a.querySelector('[role="alert"]')).toBeNull();
  });

  it('lô đã chọn: một thẻ lưu được, một thẻ bị từ chối; chỉ id đã lưu đi báo kiểm tra lại', async () => {
    const onSaved = vi.fn(async () => true);
    const m = api(draftsOk(D('a'), D('b')), approveOk(['a'], [{ id: 'b', reasons: ['Mô tả đang trống.'] }]));
    const r = mount({ batches: [sel('a', 'b')], onSaved });
    await compose(r);
    expect(byText(r.container, 'button', 'Duyệt lô đã chọn')!.getAttribute('aria-disabled')).toBe('true');
    click(card(r, 'a').querySelector('input[type="checkbox"]'));
    click(card(r, 'b').querySelector('input[type="checkbox"]'));
    expect(byText(r.container, 'button', 'Duyệt lô đã chọn')!.textContent).toBe('Duyệt lô đã chọn (2)');
    click(byText(r.container, 'button', 'Duyệt lô đã chọn')!);
    await flush(20);
    expect(bodyOf(posts(m, 'copy-approve')[0]!).items.map((i: { id: string }) => i.id)).toEqual(['a', 'b']);
    expect(onSaved).toHaveBeenCalledWith(['a']);
    expect(card(r, 'a').textContent).toContain('Đã lưu');
    expect(card(r, 'b').querySelector('[role="alert"]')!.textContent).toContain('Mô tả đang trống.');
  });

  it('lỗi mạng khi duyệt: báo lỗi kèm Thử lại, giữ nguyên bản đang sửa, không báo kiểm tra lại; thử lại được', async () => {
    const onSaved = vi.fn(async () => true);
    const m = mockFetch({ '/admin/catalog-quality/copy-drafts': draftsOk(D('a')), '/admin/catalog-quality/copy-approve': approveOk(['a']) });
    let offline = true;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('copy-approve') && offline) {
        m.calls.push({ url, init });
        throw new TypeError('Failed to fetch');
      }
      return m.fn(url, init);
    });
    const r = mount({ batches: [sel('a')], onSaved });
    await compose(r);
    const a = card(r, 'a');
    typeInto(field(a, 'Mô tả'), 'Bản tôi vừa sửa');
    click(approveBtn(a));
    await flush(20);
    const alert = r.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Chưa lưu được, bản đang sửa vẫn còn đây.');
    expect(alert.textContent).toContain('Chưa kết nối được tới Tubu Tree');
    expect(field(card(r, 'a'), 'Mô tả').value).toBe('Bản tôi vừa sửa');
    expect(onSaved).not.toHaveBeenCalled();
    expect(approveBtn(card(r, 'a')).getAttribute('aria-disabled')).toBeNull();
    offline = false;
    click(byText(alert, 'button', 'Thử lại'));
    await flush(20);
    expect(posts(m, 'copy-approve')).toHaveLength(2);
    expect(bodyOf(posts(m, 'copy-approve')[1]!).items[0].description).toBe('Bản tôi vừa sửa');
    expect(card(r, 'a').textContent).toContain('Đã lưu');
    expect(onSaved).toHaveBeenCalledWith(['a']);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('bản nháp vượt trần (mô tả 801 ký tự, 9 thành phần) hoặc mô tả trống: nêu lý do, nút duyệt khoá và bấm không gửi gì', async () => {
    const m = api(
      draftsOk(
        D('a', { description: 'x'.repeat(801) }),
        D('b', { ingredients: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }),
        D('c', { description: '   ' }),
      ),
      approveOk(['a', 'b', 'c']),
    );
    const r = mount({ batches: [sel('a', 'b', 'c')] });
    await compose(r);
    expect(card(r, 'a').textContent).toContain('Mô tả dài quá 800 ký tự.');
    expect(card(r, 'b').textContent).toContain('Tối đa 8 thành phần (đang 9).');
    expect(card(r, 'c').textContent).toContain('Mô tả đang trống.');
    for (const id of ['a', 'b', 'c']) {
      expect(approveBtn(card(r, id)).getAttribute('aria-disabled')).toBe('true');
      click(approveBtn(card(r, id)));
    }
    await flush(5);
    expect(posts(m, 'copy-approve')).toHaveLength(0);
    typeInto(field(card(r, 'a'), 'Mô tả'), 'Đủ ngắn');
    expect(approveBtn(card(r, 'a')).getAttribute('aria-disabled')).toBeNull();
  });

  it('một lô duyệt tối đa 10 thẻ: chọn 11 thẻ thì nút lô khoá, nói rõ, và bấm không gửi gì', async () => {
    const ids = (p: string) => Array.from({ length: 10 }, (_, i) => `${p}${i}`);
    const m = api((init) => ({ body: { drafts: (JSON.parse(String(init!.body)).ids as string[]).map((id) => D(id)), failed: [] } }), approveOk([]));
    const r = mount({ batches: [sel(...ids('a')), sel(...ids('b'))] });
    await compose(r);
    click(r.container.querySelector('[data-next]'));
    await compose(r);
    expect(r.container.querySelectorAll('ul[aria-label="Bản nháp mô tả"] > li')).toHaveLength(20);
    click(byText(r.container, 'button', 'Chọn các thẻ chưa lưu')!);
    const pickedBoxes = () => Array.from(r.container.querySelectorAll<HTMLInputElement>('ul[aria-label="Bản nháp mô tả"] input[type="checkbox"]')).filter((c) => c.checked);
    expect(pickedBoxes()).toHaveLength(10);
    expect(byText(r.container, 'button', 'Duyệt lô đã chọn')!.textContent).toBe('Duyệt lô đã chọn (10)');
    expect(r.container.textContent).not.toContain('Mỗi lần duyệt tối đa 10 thẻ.');
    const extra = Array.from(r.container.querySelectorAll<HTMLInputElement>('ul[aria-label="Bản nháp mô tả"] input[type="checkbox"]')).find((c) => !c.checked)!;
    click(extra);
    expect(pickedBoxes()).toHaveLength(11);
    expect(r.container.textContent).toContain('Mỗi lần duyệt tối đa 10 thẻ.');
    const batch = byText(r.container, 'button', 'Duyệt lô đã chọn')!;
    expect(batch.getAttribute('aria-disabled')).toBe('true');
    click(batch);
    await flush(5);
    expect(posts(m, 'copy-approve')).toHaveLength(0);
    click(extra);
    expect(batch.getAttribute('aria-disabled')).toBeNull();
    click(batch);
    await flush(20);
    expect(bodyOf(posts(m, 'copy-approve')[0]!).items).toHaveLength(10);
  });

  it('soạn lần hai: thẻ mới lên đầu, thẻ cũ chưa lưu còn nguyên chữ đang sửa, thẻ đã lưu được dọn', async () => {
    const m = api((init) => ({ body: { drafts: (JSON.parse(String(init!.body)).ids as string[]).map((id) => D(id)), failed: [] } }), approveOk(['a']));
    const r = mount({ batches: [sel('a', 'b'), sel('c')] });
    await compose(r);
    typeInto(field(card(r, 'b'), 'Mô tả'), 'Chữ tôi đã sửa ở thẻ b');
    click(approveBtn(card(r, 'a')));
    await flush(20);
    expect(card(r, 'a').textContent).toContain('Đã lưu');
    click(r.container.querySelector('[data-next]'));
    await compose(r);
    expect(Array.from(r.container.querySelectorAll('ul[aria-label="Bản nháp mô tả"] > li')).map((li) => (li as HTMLElement).dataset.copyCard)).toEqual(['c', 'b']);
    expect(field(card(r, 'b'), 'Mô tả').value).toBe('Chữ tôi đã sửa ở thẻ b');
    expect(posts(m, 'copy-drafts')).toHaveLength(2);
  });
});

describe('parseIngredients', () => {
  it('tách CHỈ theo dòng: dấu phẩy và chấm phẩy trong tên được giữ; bỏ tên trống và tên trùng không phân biệt hoa thường; gọn khoảng trắng', () => {
    expect(parseIngredients(' Dứa \n\nGừng\r\n dứa\n  Nước   cốt  chanh ')).toEqual(['Dứa', 'Gừng', 'Nước cốt chanh']);
    expect(parseIngredients('Hạt, củ, quả\nMuối; tiêu')).toEqual(['Hạt, củ, quả', 'Muối; tiêu']);
    expect(parseIngredients('Dứa, muối')).toEqual(['Dứa, muối']);
    expect(parseIngredients('')).toEqual([]);
    expect(parseIngredients(' \n \r\n')).toEqual([]);
  });
});
