// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_INTERNAL_TARGETS } from '@tubutree/app-core/commerce/campaign';
import { CAMPAIGN_ENTITY_SLUG_MAX } from '@tubutree/shared-types';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import { CHECK_DEBOUNCE_MS } from '@/lib/use-campaign-check';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@/lib/admin-campaigns-client', () => ({
  listAdminCampaigns: mocks.list,
  getAdminCampaign: mocks.get,
  createAdminCampaign: mocks.create,
  updateAdminCampaign: mocks.update,
  deleteAdminCampaign: mocks.remove,
  checkAdminCampaign: mocks.check,
}));
vi.mock('./product-picker', () => ({
  ProductPicker: ({ onChange, label }: { onChange: (v: { id: string; label: string } | null) => void; label: string }) => (
    <button type="button" onClick={() => onChange({ id: 'p1', label: 'Nước rửa chén' })}>
      {`Chọn: ${label}`}
    </button>
  ),
}));
vi.mock('./image-url-field', () => ({
  ImageUrlField: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CampaignsTab } from './campaigns-tab';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `cd-${id}`,
  title: `Chiến dịch ${id}`,
  subtitle: null,
  placement: 'HOME_TOP',
  image: `https://img.test/${id}.jpg`,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-10-31T17:00:00.000Z',
  endAt: '2026-11-10T16:59:00.000Z',
  sortOrder: 0,
  isActive: true,
  productCount: 0,
  couponCount: 0,
  status: 'live',
  health: { blockers: 0, warnings: 0 },
  ...over,
});
const detail = (id: string, over: Record<string, unknown> = {}) => {
  const { productCount: _p, couponCount: _c, health: _h, ...base } = row(id);
  return { ...base, image: `https://img.test/${id}.jpg`, products: [{ id: 'p9', name: 'Sản phẩm cũ', slug: 'sp-cu' }], couponCodes: ['OLD10'], ...over };
};

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<CampaignsTab />);
  await flush(6);
  return mounted.container;
};
const field = (c: HTMLElement, label: string) => c.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
const chip = (c: HTMLElement, name: string) => byText(c, 'button[aria-pressed]', name)!;

beforeEach(() => {
  // Chỉ giả Date (không giả setTimeout): mốc endAt của dữ liệu mẫu so với "bây giờ" phải cố định để luật "bật" không đổi theo ngày chạy test.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T05:00:00Z'));
  mocks.list.mockReset().mockResolvedValue([row('a')]);
  mocks.get.mockReset().mockResolvedValue(detail('a'));
  mocks.create.mockReset().mockResolvedValue(detail('new1'));
  mocks.update.mockReset().mockResolvedValue(detail('a'));
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
  mocks.check.mockReset().mockResolvedValue({ issues: [], blockers: 0, warnings: 0, verdict: { blocked: false, codes: [] } });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('CampaignsTab: danh sách', () => {
  it('mỗi dòng: ảnh nhỏ, tên, khoảng ngày giờ VN, nhãn trạng thái; mở tab gọi liệt kê không lọc', async () => {
    mocks.list.mockResolvedValue([
      row('a'),
      row('b', { status: 'scheduled' }),
      row('c', { status: 'ended' }),
      row('d', { status: 'off', isActive: false }),
    ]);
    const c = await mount();
    expect(mocks.list).toHaveBeenCalledWith(undefined);
    expect(c.textContent).toContain('Chiến dịch a');
    expect(c.textContent).toContain('01/11/2026 00:00 → 10/11/2026 23:59');
    expect(c.querySelector('img[src="https://img.test/a.jpg"]')).not.toBeNull();
    for (const t of ['Đang chạy', 'Sắp chạy', 'Đã kết thúc', 'Đang tắt']) expect(c.textContent).toContain(t);
  });

  it('không có chiến dịch nào: một câu hướng dẫn thay cho danh sách trống', async () => {
    mocks.list.mockResolvedValue([]);
    const c = await mount();
    expect(c.textContent).toContain('Chưa có chiến dịch nào');
  });

  it('tải lỗi: báo lỗi kèm Thử lại, bấm Thử lại gọi lại', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Máy chủ đang bận'));
    const c = await mount();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không tải được danh sách chiến dịch');
    click(byText(c, 'button', 'Thử lại'));
    await flush(4);
    expect(c.textContent).toContain('Chiến dịch a');
  });

  it('chip lọc theo vị trí: Tất cả / Đầu Trang chủ / Đầu Ưu đãi, aria-pressed, gọi liệt kê đúng vị trí', async () => {
    const c = await mount();
    expect(chip(c, 'Tất cả').getAttribute('aria-pressed')).toBe('true');
    click(chip(c, 'Đầu Trang chủ'));
    await flush(4);
    expect(mocks.list).toHaveBeenLastCalledWith('HOME_TOP');
    expect(chip(c, 'Đầu Trang chủ').getAttribute('aria-pressed')).toBe('true');
    expect(chip(c, 'Tất cả').getAttribute('aria-pressed')).toBe('false');
    click(chip(c, 'Đầu Ưu đãi'));
    await flush(4);
    expect(mocks.list).toHaveBeenLastCalledWith('OFFERS_TOP');
    click(chip(c, 'Tất cả'));
    await flush(4);
    expect(mocks.list).toHaveBeenLastCalledWith(undefined);
  });
});

describe('CampaignsTab: bật tắt và xoá', () => {
  it('Tắt gọi update(id, {isActive:false}) rồi làm mới danh sách; dòng đang tắt có nút Bật gọi {isActive:true}', async () => {
    mocks.list.mockResolvedValue([row('a'), row('d', { status: 'off', isActive: false })]);
    const c = await mount();
    const before = mocks.list.mock.calls.length;
    click(c.querySelector('button[aria-label="Tắt chiến dịch Chiến dịch a"]'));
    await flush(4);
    expect(mocks.update).toHaveBeenCalledWith('a', { isActive: false });
    expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
    click(c.querySelector('button[aria-label="Bật chiến dịch Chiến dịch d"]'));
    await flush(4);
    expect(mocks.update).toHaveBeenCalledWith('d', { isActive: true });
  });

  it('đang mở form: Sửa và Tắt/Bật của mọi dòng bị khoá (Tắt rồi Lưu form sẽ bật lại, Sửa dòng khác làm mất bản nháp); đóng form thì mở lại', async () => {
    mocks.list.mockResolvedValue([row('a'), row('b')]);
    const c = await mount();
    const at = (label: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(at('Tắt chiến dịch Chiến dịch a').disabled).toBe(false);
    click(at('Sửa chiến dịch Chiến dịch a'));
    await flush(4);
    for (const label of ['Sửa chiến dịch Chiến dịch a', 'Tắt chiến dịch Chiến dịch a', 'Sửa chiến dịch Chiến dịch b', 'Tắt chiến dịch Chiến dịch b']) {
      expect(at(label).disabled).toBe(true);
    }
    click(at('Tắt chiến dịch Chiến dịch a'));
    await flush(2);
    expect(mocks.update).not.toHaveBeenCalled();
    click(byText(c, 'button', 'Đóng'));
    await flush(2);
    expect(at('Tắt chiến dịch Chiến dịch a').disabled).toBe(false);
    expect(at('Sửa chiến dịch Chiến dịch b').disabled).toBe(false);
  });

  it('bật tắt lỗi: báo lỗi ngay tại dòng, không mất danh sách', async () => {
    mocks.update.mockRejectedValue(new Error('Chiến dịch không tồn tại'));
    const c = await mount();
    click(c.querySelector('button[aria-label="Tắt chiến dịch Chiến dịch a"]'));
    await flush(4);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Chiến dịch không tồn tại');
    expect(c.textContent).toContain('Chiến dịch a');
  });

  it('Xoá chỉ chạy sau khi xác nhận: huỷ thì không gọi API, đồng ý thì gọi xoá và làm mới', async () => {
    const c = await mount();
    click(c.querySelector('button[aria-label="Xoá chiến dịch Chiến dịch a"]'));
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush(2);
    expect(mocks.remove).not.toHaveBeenCalled();
    click(c.querySelector('button[aria-label="Xoá chiến dịch Chiến dịch a"]'));
    const before = mocks.list.mock.calls.length;
    answerConfirm(true);
    await flush(4);
    expect(mocks.remove).toHaveBeenCalledWith('a');
    expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('CampaignsTab: tạo chiến dịch', () => {
  const open = async (c: HTMLElement) => {
    click(byText(c, 'button', 'Tạo chiến dịch'));
    await flush(2);
  };
  const fillBasics = (c: HTMLElement, start = '01/11/2026', end = '10/11/2026') => {
    typeInto(field(c, 'Tên chiến dịch'), 'Giữa Thu');
    typeInto(field(c, 'Ảnh banner (tỉ lệ 5:2, ví dụ 1500×600)'), 'https://img.test/thu.jpg');
    typeInto(field(c, 'Bắt đầu: ngày'), start);
    typeInto(field(c, 'Kết thúc: ngày'), end);
  };

  it('vị trí Đầu Ưu đãi nhắc đặt chữ và logo ở dải giữa ảnh (web máy tính cắt banner xuống khung 4:1); Đầu Trang chủ không có lời nhắc', async () => {
    const c = await mount();
    await open(c);
    expect(c.querySelector('[data-testid="offers-banner-safe-zone"]')).toBeNull();
    selectValue(field(c, 'Vị trí'), 'OFFERS_TOP');
    await flush(2);
    expect(c.querySelector('[data-testid="offers-banner-safe-zone"]')!.textContent).toContain('dải giữa');
    selectValue(field(c, 'Vị trí'), 'HOME_TOP');
    await flush(2);
    expect(c.querySelector('[data-testid="offers-banner-safe-zone"]')).toBeNull();
  });

  it('gửi mốc theo giờ VN (+07:00) bất kể múi giờ máy: 01/11/2026 00:00 → 2026-10-31T17:00:00.000Z; mặc định Trang chủ, mọi khách, trang chiến dịch', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(6);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).toEqual({
      title: 'Giữa Thu',
      placement: 'HOME_TOP',
      image: 'https://img.test/thu.jpg',
      linkType: 'CAMPAIGN_PAGE',
      audience: 'ALL',
      startAt: '2026-10-31T17:00:00.000Z',
      endAt: '2026-11-09T17:00:00.000Z',
      sortOrder: 0,
      isActive: true,
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('giờ và phút chọn ở hai ô giờ/phút được cộng vào mốc (09:15 VN = 02:15 UTC)', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    selectValue(field(c, 'Bắt đầu: giờ'), '09');
    selectValue(field(c, 'Bắt đầu: phút'), '15');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(6);
    expect(mocks.create.mock.calls[0]![0].startAt).toBe('2026-11-01T02:15:00.000Z');
  });

  it('giờ kết thúc không sau giờ bắt đầu: chặn gửi và báo lỗi', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c, '10/11/2026', '10/11/2026');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(4);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Giờ kết thúc phải sau giờ bắt đầu');
  });

  it('thứ tự ngoài 0 đến 9999: form tự báo bằng tiếng Việt thay vì bong bóng kiểm tra của trình duyệt, không gửi gì', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    typeInto(field(c, 'Thứ tự hiển thị'), '99999');
    expect(c.querySelector('form')!.noValidate).toBe(true);
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(4);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Thứ tự là số nguyên từ 0 đến 9999.');
  });

  it.each([
    ['ô trống', ''],
    ['gõ "5e" (trình duyệt trả value rỗng)', '5e'],
    ['gõ "-" (trình duyệt trả value rỗng)', '-'],
  ])('thứ tự %s: báo bằng tiếng Việt, không lưu im lặng thành 0', async (_name, typed) => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    typeInto(field(c, 'Thứ tự hiển thị'), typed);
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(4);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Thứ tự là số nguyên từ 0 đến 9999.');
  });

  it('thứ tự mà trình duyệt báo badInput (chữ dở dang trong ô số) cũng bị chặn dù state còn số cũ', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    const input = field(c, 'Thứ tự hiển thị');
    typeInto(input, '5');
    Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(4);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Thứ tự là số nguyên từ 0 đến 9999.');
  });

  it('thiếu tên, ảnh hoặc mốc thì nút Lưu khoá, không gửi gì', async () => {
    const c = await mount();
    await open(c);
    expect(byText(c, 'button', 'Lưu chiến dịch')!.hasAttribute('disabled')).toBe(true);
    typeInto(field(c, 'Tên chiến dịch'), 'Giữa Thu');
    expect(byText(c, 'button', 'Lưu chiến dịch')!.hasAttribute('disabled')).toBe(true);
  });

  it('đích bấm: Trang chiến dịch không có ô giá trị; Sản phẩm và Danh mục có ô nhập slug', async () => {
    const c = await mount();
    await open(c);
    expect(c.querySelector('[aria-label="Slug sản phẩm"], [aria-label="Slug danh mục"], [aria-label="Trang trong app"]')).toBeNull();
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    expect(field(c, 'Slug sản phẩm')).not.toBeNull();
    selectValue(field(c, 'Đích khi bấm'), 'CATEGORY');
    expect(field(c, 'Slug danh mục')).not.toBeNull();
  });

  it('ô slug sản phẩm và danh mục nhận tới CAMPAIGN_ENTITY_SLUG_MAX ký tự như DTO, slug dài không bị cắt', async () => {
    const c = await mount();
    await open(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    expect((field(c, 'Slug sản phẩm') as HTMLInputElement).maxLength).toBe(CAMPAIGN_ENTITY_SLUG_MAX);
    selectValue(field(c, 'Đích khi bấm'), 'CATEGORY');
    expect((field(c, 'Slug danh mục') as HTMLInputElement).maxLength).toBe(CAMPAIGN_ENTITY_SLUG_MAX);
  });

  it('đích Trang trong app: không có ô gõ tự do, chỉ liệt kê đích hợp lệ của CAMPAIGN_INTERNAL_TARGETS, gửi giá trị đã chọn', async () => {
    const c = await mount();
    await open(c);
    selectValue(field(c, 'Đích khi bấm'), 'URL_INTERNAL');
    expect(c.querySelector('input[aria-label="Slug sản phẩm"], input[aria-label="Đường dẫn"]')).toBeNull();
    const select = field(c, 'Trang trong app') as HTMLSelectElement;
    const options = Array.from(select.options).filter((o) => o.value !== '');
    expect(options.map((o) => o.value)).toEqual(CAMPAIGN_INTERNAL_TARGETS.map((t) => t.value));
    expect(options.map((o) => o.textContent)).toEqual(CAMPAIGN_INTERNAL_TARGETS.map((t) => t.label));
    fillBasics(c);
    expect(byText(c, 'button', 'Lưu chiến dịch')!.hasAttribute('disabled')).toBe(true);
    selectValue(select, '/offers');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(6);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ linkType: 'URL_INTERNAL', linkValue: '/offers' });
  });

  it('chọn sản phẩm bằng ProductPicker rồi nhập mã: MỘT lệnh tạo mang cả sản phẩm và mã (đã bỏ trùng), không còn lệnh PUT riêng', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    await flush(2);
    expect(c.textContent).toContain('Nước rửa chén');
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'THU10, xanh5\nTHU10');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ isActive: true, productIds: ['p1'], couponCodes: ['THU10', 'xanh5'] });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('chọn cùng một sản phẩm hai lần chỉ giữ một dòng; bỏ sản phẩm khỏi danh sách được', async () => {
    const c = await mount();
    await open(c);
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    await flush(2);
    expect(c.querySelectorAll('[data-testid="campaign-product"]')).toHaveLength(1);
    click(c.querySelector('button[aria-label="Bỏ Nước rửa chén khỏi chiến dịch"]'));
    expect(c.querySelectorAll('[data-testid="campaign-product"]')).toHaveLength(0);
  });

  it('máy chủ từ chối cả lệnh tạo (mã không có thật): hiện đúng câu lỗi, không có chiến dịch dở dang, form giữ lại và bấm Lưu lại vẫn là TẠO', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Không tìm thấy mã: XANH5'));
    const c = await mount();
    await open(c);
    fillBasics(c);
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'XANH5');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không tìm thấy mã: XANH5');
    expect(c.querySelector('[role="alert"]')!.textContent).not.toContain('Đã lưu chiến dịch');
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'THU10');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]![0]).toMatchObject({ couponCodes: ['THU10'] });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('lỗi từ máy chủ khi tạo (trùng slug): hiện lời máy chủ, form giữ nguyên để sửa', async () => {
    mocks.create.mockRejectedValue(new Error('Đã có chiến dịch dùng slug "giua-thu".'));
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(6);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Đã có chiến dịch dùng slug');
    expect(field(c, 'Tên chiến dịch').value).toBe('Giữa Thu');
  });

  it('ô slug chỉ có khi tạo (đổi slug làm gãy link đã chia sẻ); gõ slug thì gửi lên', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    typeInto(field(c, 'Slug (đường dẫn trang)'), 'giua-thu-2026');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(6);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ slug: 'giua-thu-2026' });
  });
});

describe('CampaignsTab: sửa chiến dịch', () => {
  const openEdit = async (c: HTMLElement) => {
    click(c.querySelector('button[aria-label="Sửa chiến dịch Chiến dịch a"]'));
    await flush(6);
  };

  it('Sửa tải chi tiết, điền sẵn tên, mốc giờ VN, sản phẩm và mã; không có ô slug', async () => {
    const c = await mount();
    await openEdit(c);
    expect(mocks.get).toHaveBeenCalledWith('a');
    expect(field(c, 'Tên chiến dịch').value).toBe('Chiến dịch a');
    expect(field(c, 'Bắt đầu: ngày').value).toBe('01/11/2026');
    expect(field(c, 'Bắt đầu: giờ').value).toBe('00');
    expect(field(c, 'Kết thúc: ngày').value).toBe('10/11/2026');
    expect(field(c, 'Kết thúc: giờ').value).toBe('23');
    expect(c.textContent).toContain('Sản phẩm cũ');
    expect((field(c, 'Mã giảm giá gắn kèm') as HTMLTextAreaElement).value).toBe('OLD10');
    expect(c.querySelector('[aria-label="Slug (đường dẫn trang)"]')).toBeNull();
  });

  it('chỉ đổi tên: gọi update với đủ trường nhưng KHÔNG đặt lại sản phẩm/mã khi danh sách không đổi', async () => {
    const c = await mount();
    await openEdit(c);
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.update).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'Tên mới', startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T16:59:00.000Z' }));
    expect(mocks.update.mock.calls[0]![1]).not.toHaveProperty('slug');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('bỏ hết sản phẩm và đổi mã: MỘT lệnh sửa mang danh sách rỗng và mã mới', async () => {
    const c = await mount();
    await openEdit(c);
    click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'MOI5');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ productIds: [], couponCodes: ['MOI5'] });
  });

  it('xoá subtitle và giá trị đích bằng null để API xoá thật', async () => {
    mocks.get.mockResolvedValue(detail('a', { subtitle: 'Phụ đề cũ', linkType: 'PRODUCT', linkValue: 'nuoc-rua-chen' }));
    const c = await mount();
    await openEdit(c);
    typeInto(field(c, 'Phụ đề'), '');
    selectValue(field(c, 'Đích khi bấm'), 'CAMPAIGN_PAGE');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ subtitle: null, linkType: 'CAMPAIGN_PAGE', linkValue: null });
  });

  it('tải chi tiết lỗi: báo lỗi kèm Thử lại, danh sách vẫn còn', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Máy chủ đang bận'));
    const c = await mount();
    await openEdit(c);
    expect(c.textContent).toContain('Không tải được chiến dịch');
    expect(c.textContent).toContain('Chiến dịch a');
  });
});

describe('CampaignsTab: truy cập', () => {
  it('mọi ô nhập, nút và lựa chọn đều có tên đọc được (danh sách và form)', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Tạo chiến dịch'));
    await flush(2);
    expect(unnamedControls(c)).toEqual([]);
    expect(unlabeledFields(c)).toEqual([]);
  });
});

describe('CampaignsTab: danh sách có kết quả kiểm', () => {
  it('mỗi dòng hiện huy hiệu "n lỗi chặn" và "n cảnh báo"; dòng không vấn đề không có huy hiệu', async () => {
    mocks.list.mockResolvedValue([row('a'), row('b', { health: { blockers: 2, warnings: 1 } }), row('c', { health: { blockers: 0, warnings: 3 } })]);
    const c = await mount();
    const text = (id: string) => c.querySelector(`button[aria-label="Sửa chiến dịch Chiến dịch ${id}"]`)!.closest('.rounded-card')!.textContent ?? '';
    expect(text('a')).not.toMatch(/lỗi chặn|cảnh báo/);
    expect(text('b')).toContain('2 lỗi chặn');
    expect(text('b')).toContain('1 cảnh báo');
    expect(text('c')).toContain('3 cảnh báo');
    expect(text('c')).not.toContain('lỗi chặn');
  });

  it('lọc nhanh "Có vấn đề" chỉ giữ dòng có lỗi chặn hoặc cảnh báo; bỏ lọc thì đủ dòng', async () => {
    mocks.list.mockResolvedValue([row('a'), row('b', { health: { blockers: 1, warnings: 0 } })]);
    const c = await mount();
    click(chip(c, 'Có vấn đề'));
    await flush(2);
    expect(c.textContent).not.toContain('Chiến dịch a');
    expect(c.textContent).toContain('Chiến dịch b');
    expect(chip(c, 'Có vấn đề').getAttribute('aria-pressed')).toBe('true');
    click(chip(c, 'Có vấn đề'));
    await flush(2);
    expect(c.textContent).toContain('Chiến dịch a');
  });

  it('chiến dịch đã kết thúc không có lỗi hay cảnh báo (API không tính ENDED vào danh sách) thì lọc "Có vấn đề" không giữ lại', async () => {
    mocks.list.mockResolvedValue([row('cu', { status: 'ended', health: { blockers: 0, warnings: 0 } }), row('b', { health: { blockers: 0, warnings: 1 } })]);
    const c = await mount();
    click(chip(c, 'Có vấn đề'));
    await flush(2);
    expect(c.textContent).not.toContain('Chiến dịch cu');
    expect(c.textContent).toContain('Chiến dịch b');
  });

  it('không dòng nào có vấn đề: lọc "Có vấn đề" báo một câu, không để trống trơn', async () => {
    const c = await mount();
    click(chip(c, 'Có vấn đề'));
    await flush(2);
    expect(c.textContent).toContain('Không có chiến dịch nào có vấn đề');
  });

  it('dòng đang tắt mà còn lỗi chặn: nút Bật khoá kèm lý do; dòng đang bật hay chỉ có cảnh báo thì không khoá', async () => {
    mocks.list.mockResolvedValue([
      row('d', { status: 'off', isActive: false, health: { blockers: 1, warnings: 0 } }),
      row('e', { status: 'off', isActive: false, health: { blockers: 0, warnings: 2 } }),
    ]);
    const c = await mount();
    const on = (id: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="Bật chiến dịch Chiến dịch ${id}"]`)!;
    expect(on('d').disabled).toBe(true);
    expect(on('d').title).toContain('1 lỗi chặn');
    expect(on('e').disabled).toBe(false);
  });
});

describe('CampaignsTab: khối "Kiểm trước khi bật" và xem trước trong form', () => {
  const open = async (c: HTMLElement) => {
    click(byText(c, 'button', 'Tạo chiến dịch'));
    await flush(2);
  };
  const fillBasics = (c: HTMLElement) => {
    typeInto(field(c, 'Tên chiến dịch'), 'Giữa Thu');
    typeInto(field(c, 'Ảnh banner (tỉ lệ 5:2, ví dụ 1500×600)'), 'https://img.test/thu.jpg');
    typeInto(field(c, 'Bắt đầu: ngày'), '01/11/2026');
    typeInto(field(c, 'Kết thúc: ngày'), '10/11/2026');
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));
    });
  const panel = (c: HTMLElement) => c.querySelector('[data-testid="campaign-check"]') as HTMLElement;
  const issue = (code: string, level: 'BLOCK' | 'WARN', message: string) => ({ code, level, message });
  const save = (c: HTMLElement) => byText(c, 'button', 'Lưu chiến dịch') as HTMLButtonElement;

  it('form chưa đủ để kiểm: không gọi máy chủ, nhắc điền ngày và đích', async () => {
    const c = await mount();
    await open(c);
    await settle();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(panel(c).textContent).toContain('Điền ngày bắt đầu');
  });

  it('đủ ngày: gọi kiểm sau khi ngừng gõ (gộp nhiều lần đổi thành một), gửi mốc ISO, sản phẩm và mã đang soạn', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'thu10, xanh5');
    await settle();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.check.mock.calls[0]![0]).toEqual({
      placement: 'HOME_TOP',
      linkType: 'CAMPAIGN_PAGE',
      audience: 'ALL',
      startAt: '2026-10-31T17:00:00.000Z',
      endAt: '2026-11-09T17:00:00.000Z',
      sortOrder: 0,
      isActive: true,
      productIds: ['p1'],
      couponCodes: ['thu10', 'xanh5'],
    });
  });

  it('đổi đích gọi kiểm lại với linkValue; sửa chiến dịch đã lưu gửi kèm id', async () => {
    const c = await mount();
    click(c.querySelector('button[aria-label="Sửa chiến dịch Chiến dịch a"]'));
    await flush(6);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'sua-hat');
    await settle();
    expect(mocks.check).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', linkType: 'PRODUCT', linkValue: 'sua-hat', productIds: ['p9'] }));
  });

  it('kết quả sạch: "Sẵn sàng" màu xanh và nút Lưu mở', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    await settle();
    expect(panel(c).querySelector('[data-testid="campaign-check-ready"]')!.textContent).toBe('Sẵn sàng');
    expect(save(c).disabled).toBe(false);
  });

  const BLOCKED_VERDICT = { blocked: true, codes: ['PAGE_EMPTY'], reason: 'Trang chiến dịch đang trống: thêm sản phẩm hoặc mã.' };

  it('lỗi chặn hiện đỏ, cảnh báo hiện vàng; phán quyết chặn thì nút Lưu khoá kèm đúng lý do của máy chủ; bỏ chọn "Đang bật" thì máy chủ cho lưu nháp', async () => {
    const blocked = {
      issues: [issue('PAGE_EMPTY', 'BLOCK', 'Trang chiến dịch đang trống.'), issue('ENDED', 'WARN', 'Ngày kết thúc đã qua.')],
      blockers: 1,
      warnings: 1,
      verdict: BLOCKED_VERDICT,
    };
    mocks.check.mockImplementation(async (input: { isActive?: boolean }) => (input.isActive === false ? { ...blocked, verdict: { blocked: false, codes: [] } } : blocked));
    const c = await mount();
    await open(c);
    fillBasics(c);
    await settle();
    const block = panel(c).querySelector('[data-level="BLOCK"]')!;
    const warn = panel(c).querySelector('[data-level="WARN"]')!;
    expect(block.textContent).toContain('Trang chiến dịch đang trống.');
    expect(block.className).toBe(warn.className);
    expect(block.querySelector('span')!.className).toContain('danger');
    expect(warn.querySelector('span')!.className).toContain('warning');
    expect(panel(c).querySelector('[data-testid="campaign-check-ready"]')).toBeNull();
    expect(save(c).disabled).toBe(true);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')!.textContent).toBe(BLOCKED_VERDICT.reason);
    expect(save(c).getAttribute('aria-describedby')).toBe('campaign-lock-reason');

    click(c.querySelector('input[aria-label="Đang bật"]'));
    await settle();
    expect(save(c).disabled).toBe(false);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')).toBeNull();
    click(save(c));
    await flush(8);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ isActive: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('đang kiểm lại sau khi vừa gõ: kết quả của bản nháp cũ không khoá và không mở khoá bản nháp mới', async () => {
    mocks.check.mockImplementation(async (input: { linkValue?: string }) => ({ issues: [], blockers: 0, warnings: 0, verdict: input.linkValue === 'sai' ? BLOCKED_VERDICT : { blocked: false, codes: [] } }));
    const c = await mount();
    await open(c);
    fillBasics(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'sai');
    await settle();
    expect(save(c).disabled).toBe(true);
    typeInto(field(c, 'Slug sản phẩm'), 'dung');
    expect(save(c).disabled).toBe(false);
    await settle();
    expect(save(c).disabled).toBe(false);
  });

  it('API cũ chưa trả verdict (chỉ có lỗi chặn trong issues): không khoá nút Lưu, máy chủ quyết lúc lưu', async () => {
    mocks.check.mockResolvedValue({ issues: [issue('PAGE_EMPTY', 'BLOCK', 'Trang chiến dịch đang trống.')], blockers: 1, warnings: 0 });
    const c = await mount();
    await open(c);
    fillBasics(c);
    await settle();
    expect(panel(c).querySelector('[data-level="BLOCK"]')).not.toBeNull();
    expect(save(c).disabled).toBe(false);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')).toBeNull();
  });

  it('chỉ có cảnh báo thì không khoá nút Lưu', async () => {
    mocks.check.mockResolvedValue({ issues: [issue('COUPON_OFF', 'WARN', 'Mã đang tắt: A.')], blockers: 0, warnings: 1 });
    const c = await mount();
    await open(c);
    fillBasics(c);
    await settle();
    expect(panel(c).textContent).toContain('Mã đang tắt: A.');
    expect(save(c).disabled).toBe(false);
  });

  it('sửa đích rồi kiểm lại: lỗi chặn biến mất, hiện "Sẵn sàng" và mở khoá nút', async () => {
    mocks.check.mockResolvedValueOnce({ issues: [issue('INVALID', 'BLOCK', 'Không có sản phẩm với slug "sai". Kiểm lại slug.')], blockers: 1, warnings: 0, verdict: { blocked: true, codes: ['INVALID'], reason: 'Không có sản phẩm với slug "sai". Kiểm lại slug.' } });
    const c = await mount();
    await open(c);
    fillBasics(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'sai');
    await settle();
    expect(save(c).disabled).toBe(true);
    typeInto(field(c, 'Slug sản phẩm'), 'sua-hat');
    await settle();
    expect(panel(c).querySelector('[data-testid="campaign-check-ready"]')).not.toBeNull();
    expect(save(c).disabled).toBe(false);
  });

  it('máy chủ trả 400 vì đích sai định dạng: hiện đúng câu đó như lỗi chặn', async () => {
    mocks.check.mockRejectedValue(new ApiError('Nhập slug sản phẩm hợp lệ.', 400));
    const c = await mount();
    await open(c);
    fillBasics(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'có dấu');
    await settle();
    expect(panel(c).querySelector('[data-level="BLOCK"]')!.textContent).toContain('Nhập slug sản phẩm hợp lệ.');
    expect(save(c).disabled).toBe(true);
  });

  it('kiểm lỗi mạng: báo chưa kiểm được nhưng KHÔNG khoá nút Lưu (máy chủ vẫn kiểm lúc bật)', async () => {
    mocks.check.mockRejectedValue(new Error('mất mạng'));
    const c = await mount();
    await open(c);
    fillBasics(c);
    await settle();
    expect(panel(c).textContent).toContain('Chưa kiểm được');
    expect(save(c).disabled).toBe(false);
  });

  it('lưu là MỘT request: tạo mới đang bật kèm sản phẩm và mã chỉ gọi create một lần, không gọi update hay PUT nào', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'THU10');
    click(save(c));
    await flush(10);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ isActive: true, productIds: ['p1'], couponCodes: ['THU10'] });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('máy chủ từ chối lệnh lưu (400 kèm lý do): hiện đúng câu lý do, không có lưu dở; Lưu lại gửi lại đúng một lệnh tạo', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Trang chiến dịch đang trống: thêm sản phẩm.'));
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(save(c));
    await flush(10);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Trang chiến dịch đang trống');
    expect(c.querySelector('[role="alert"]')!.textContent).not.toContain('Đã lưu chiến dịch');
    click(save(c));
    await flush(10);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('sửa chiến dịch đang bật hay đang tắt rồi bật: luôn đúng một lệnh sửa mang cả isActive', async () => {
    const c = await mount();
    click(c.querySelector('button[aria-label="Sửa chiến dịch Chiến dịch a"]'));
    await flush(6);
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    click(save(c));
    await flush(8);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ title: 'Tên mới', isActive: true });
    mounted?.unmount();

    mocks.update.mockClear();
    mocks.list.mockResolvedValue([row('d', { status: 'off', isActive: false })]);
    mocks.get.mockResolvedValue(detail('d', { isActive: false, status: 'off' }));
    const d = await mount();
    click(d.querySelector('button[aria-label="Sửa chiến dịch Chiến dịch d"]'));
    await flush(6);
    click(d.querySelector('input[aria-label="Đang bật"]'));
    click(save(d));
    await flush(8);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ isActive: true });
  });

  describe('kiểm ảnh ở trình duyệt', () => {
    const RealImage = globalThis.Image;
    const stubImage = (size: { w: number; h: number } | 'error') => {
      class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = size === 'error' ? 0 : size.w;
        naturalHeight = size === 'error' ? 0 : size.h;
        set src(_v: string) {
          setTimeout(() => (size === 'error' ? this.onerror?.() : this.onload?.()), 0);
        }
      }
      globalThis.Image = FakeImage as unknown as typeof Image;
    };
    afterEach(() => {
      globalThis.Image = RealImage;
    });

    it('ảnh lệch khung 5:2 hơn 10%: cảnh báo vàng "ảnh sẽ bị cắt" kèm tỉ lệ đề nghị, không khoá nút', async () => {
      stubImage({ w: 1200, h: 800 });
      const c = await mount();
      await open(c);
      fillBasics(c);
      await settle();
      const warn = panel(c).querySelector('[data-level="WARN"]')!;
      expect(warn.textContent).toContain('sẽ bị cắt');
      expect(warn.textContent).toContain('5:2');
      expect(panel(c).querySelector('[data-testid="campaign-check-ready"]')).toBeNull();
      expect(save(c).disabled).toBe(false);
    });

    it('ảnh đúng tỉ lệ: không cảnh báo', async () => {
      stubImage({ w: 1500, h: 600 });
      const c = await mount();
      await open(c);
      fillBasics(c);
      await settle();
      expect(panel(c).querySelector('[data-level]')).toBeNull();
      expect(panel(c).querySelector('[data-testid="campaign-check-ready"]')).not.toBeNull();
    });

    it('ảnh không tải được: cảnh báo vàng, không khoá nút', async () => {
      stubImage('error');
      const c = await mount();
      await open(c);
      fillBasics(c);
      await settle();
      expect(panel(c).querySelector('[data-level="WARN"]')!.textContent).toContain('Không tải được ảnh');
      expect(save(c).disabled).toBe(false);
    });
  });
});

describe('CampaignsTab: khoá lưu theo phán quyết của máy chủ', () => {
  const REASON = 'Lần lưu này làm trang chiến dịch đang bật thành trống. Trang chiến dịch đang trống: thêm sản phẩm hoặc mã.';
  const OPEN = { blocked: false, codes: [] };
  const SHUT = { blocked: true, codes: ['PAGE_EMPTY'], reason: REASON };
  const result = (verdict?: { blocked: boolean; codes: string[]; reason?: string }) => ({
    issues: [{ code: 'PAGE_EMPTY', level: 'BLOCK', message: 'Trang chiến dịch đang trống.' }],
    blockers: 1,
    warnings: 0,
    ...(verdict ? { verdict } : {}),
  });
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));
    });
  const edit = async (c: HTMLElement, id = 'a') => {
    click(c.querySelector(`button[aria-label="Sửa chiến dịch Chiến dịch ${id}"]`));
    await flush(6);
  };
  const saveBtn = (c: HTMLElement) => byText(c, 'button', 'Lưu chiến dịch') as HTMLButtonElement;
  const calls = () => mocks.update.mock.calls.map((x) => x[1] as Record<string, unknown>);

  it('lỗi cũ của chiến dịch đang chạy mà máy chủ cho lưu (không làm tệ thêm): sửa tiêu đề vẫn lưu được, khối kiểm vẫn hiện lỗi', async () => {
    mocks.check.mockResolvedValue(result(OPEN));
    const c = await mount();
    await edit(c);
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    await settle();
    expect(c.querySelector('[data-testid="campaign-check"] [data-level="BLOCK"]')!.textContent).toContain('đang trống');
    expect(saveBtn(c).disabled).toBe(false);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')).toBeNull();
  });

  it('máy chủ chặn (bỏ A làm trang đang chạy thành trống): nút Lưu khoá và hiện đúng câu lý do', async () => {
    mocks.check.mockImplementation(async (input: { productIds: string[] }) => result(input.productIds.length === 0 ? SHUT : OPEN));
    const c = await mount();
    await edit(c);
    click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    await settle();
    expect(saveBtn(c).disabled).toBe(true);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')!.textContent).toBe(REASON);
  });

  it('kiểm gửi isActive và id của bản nháp; đang tắt rồi bật lên thì máy chủ chặn khoá nút', async () => {
    mocks.list.mockResolvedValue([row('d', { status: 'off', isActive: false })]);
    mocks.get.mockResolvedValue(detail('d', { isActive: false, status: 'off' }));
    mocks.check.mockImplementation(async (input: { isActive?: boolean }) => result(input.isActive ? SHUT : OPEN));
    const c = await mount();
    await edit(c, 'd');
    await settle();
    expect(mocks.check).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd', isActive: false }));
    expect(saveBtn(c).disabled).toBe(false);
    click(c.querySelector('input[aria-label="Đang bật"]'));
    await settle();
    expect(mocks.check).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd', isActive: true }));
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('dời giờ bắt đầu của trang đang chạy: kiểm lại với mốc mới, máy chủ chặn thì khoá', async () => {
    mocks.check.mockImplementation(async (input: { startAt: string }) => result(input.startAt === '2026-11-19T17:00:00.000Z' ? SHUT : OPEN));
    const c = await mount();
    await edit(c);
    typeInto(field(c, 'Bắt đầu: ngày'), '20/11/2026');
    typeInto(field(c, 'Kết thúc: ngày'), '30/11/2026');
    await settle();
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('đang chạy CAMPAIGN_PAGE [A], đổi sang PRODUCT và bỏ A: MỘT lệnh sửa mang đích mới và productIds rỗng', async () => {
    mocks.check.mockResolvedValue(result(OPEN));
    const c = await mount();
    await edit(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'sua-hat');
    click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
    await settle();
    click(saveBtn(c));
    await flush(10);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ linkType: 'PRODUCT', linkValue: 'sua-hat', productIds: [], isActive: true });
  });

  it('gia hạn chiến dịch đã hết hạn kèm thêm sản phẩm: một lệnh sửa mang endAt mới và productIds', async () => {
    mocks.list.mockResolvedValue([row('e', { status: 'ended' })]);
    mocks.get.mockResolvedValue(detail('e', { status: 'ended', endAt: '2026-11-02T16:59:00.000Z', products: [], couponCodes: [] }));
    mocks.check.mockResolvedValue(result(OPEN));
    const c = await mount();
    await edit(c, 'e');
    typeInto(field(c, 'Kết thúc: ngày'), '30/11/2026');
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    await settle();
    click(saveBtn(c));
    await flush(10);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ endAt: '2026-11-30T16:59:00.000Z', productIds: ['p1'] });
  });

  it('chỉ gửi danh sách khi danh sách đổi: sửa tiêu đề thì không có productIds/couponCodes', async () => {
    mocks.check.mockResolvedValue(result(OPEN));
    const c = await mount();
    await edit(c);
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    await settle();
    click(saveBtn(c));
    await flush(10);
    expect(calls()[0]).not.toHaveProperty('productIds');
    expect(calls()[0]).not.toHaveProperty('couponCodes');
  });

  describe('kiểm lại thủ công và khi quay lại cửa sổ', () => {
    const fire = (type: 'focus' | 'visibilitychange') => act(async () => { (type === 'focus' ? window : document).dispatchEvent(new Event(type)); });
    const recheckBtn = (c: HTMLElement) => byText(c, 'button', 'Kiểm lại') as HTMLButtonElement;
    const setVisibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    afterEach(() => setVisibility('visible'));

    it('nút "Kiểm lại" hỏi máy chủ lại ngay với cùng bản nháp và lấy phán quyết mới', async () => {
      mocks.check.mockResolvedValueOnce(result(OPEN)).mockResolvedValue(result(SHUT));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      expect(saveBtn(c).disabled).toBe(false);
      const before = mocks.check.mock.calls.length;
      click(recheckBtn(c));
      await settle();
      expect(mocks.check.mock.calls.length).toBe(before + 1);
      expect(mocks.check.mock.calls.at(-1)![0]).toEqual(mocks.check.mock.calls.at(-2)![0]);
      expect(saveBtn(c).disabled).toBe(true);
    });

    it('kiểm lại không nhấp nháy: trong lúc chờ kết quả mới vẫn giữ kết quả của đúng bản nháp đó', async () => {
      mocks.check.mockResolvedValue(result(SHUT));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      let release!: (v: unknown) => void;
      mocks.check.mockReturnValueOnce(new Promise((r) => (release = r)));
      click(recheckBtn(c));
      await flush(3);
      expect(saveBtn(c).disabled).toBe(true);
      await act(async () => release(result(OPEN)));
      await settle();
      expect(saveBtn(c).disabled).toBe(false);
    });

    it('đang kiểm lại trên kết quả đã có: giữ phán quyết cũ, nút bị khoá và hiện "Đang kiểm lại…"', async () => {
      mocks.check.mockResolvedValue(result(SHUT));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      expect(recheckBtn(c).disabled).toBe(false);
      expect(c.textContent).not.toContain('Đang kiểm lại…');
      let release!: (v: unknown) => void;
      mocks.check.mockReturnValueOnce(new Promise((r) => (release = r)));
      click(recheckBtn(c));
      await flush(3);
      expect(recheckBtn(c).disabled).toBe(true);
      expect(c.querySelector('[data-testid="campaign-check"]')!.textContent).toContain('Đang kiểm lại…');
      expect(saveBtn(c).disabled).toBe(true);
      expect(c.querySelector('[data-testid="campaign-check-lock"]')!.textContent).toBe(REASON);
      await act(async () => release(result(OPEN)));
      await settle();
      expect(c.textContent).not.toContain('Đang kiểm lại…');
      expect(recheckBtn(c).disabled).toBe(false);
      expect(saveBtn(c).disabled).toBe(false);
    });

    it('cửa sổ được focus lại: tự kiểm lại đúng một lần dù focus và visibilitychange cùng bắn', async () => {
      mocks.check.mockResolvedValue(result(OPEN));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      const before = mocks.check.mock.calls.length;
      await fire('focus');
      await fire('visibilitychange');
      await fire('focus');
      await settle();
      expect(mocks.check.mock.calls.length).toBe(before + 1);
    });

    it('tab bị ẩn (visibilitychange sang hidden) thì không kiểm', async () => {
      mocks.check.mockResolvedValue(result(OPEN));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      const before = mocks.check.mock.calls.length;
      setVisibility('hidden');
      await fire('visibilitychange');
      await settle();
      expect(mocks.check.mock.calls.length).toBe(before);
    });

    it('đang lưu thì focus lại không bắn kiểm', async () => {
      mocks.check.mockResolvedValue(result(OPEN));
      let finish!: (v: unknown) => void;
      mocks.update.mockReturnValueOnce(new Promise((r) => (finish = r)));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      click(saveBtn(c));
      await flush(3);
      const before = mocks.check.mock.calls.length;
      await fire('focus');
      await settle();
      expect(mocks.check.mock.calls.length).toBe(before);
      await act(async () => finish(detail('a')));
    });

    it('chưa đủ để kiểm (input null) thì "Kiểm lại" và focus không gọi gì', async () => {
      const c = await mount();
      click(byText(c, 'button', 'Tạo chiến dịch'));
      await flush(4);
      const before = mocks.check.mock.calls.length;
      await fire('focus');
      await settle();
      expect(mocks.check.mock.calls.length).toBe(before);
    });
  });

  describe('lưu bị máy chủ từ chối: kiểm lại để khối kiểm theo kịp', () => {
    const rejectWith = async (status: number) => {
      mocks.check.mockResolvedValueOnce(result(OPEN));
      mocks.update.mockRejectedValueOnce(new ApiError(REASON, status));
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      const before = mocks.check.mock.calls.length;
      click(saveBtn(c));
      await flush(10);
      return { c, before };
    };

    it.each([400, 409])('lỗi %i: gọi kiểm lại ngay và nút Lưu theo phán quyết mới', async (status) => {
      mocks.check.mockResolvedValue(result(SHUT));
      const { c, before } = await rejectWith(status);
      await flush(4);
      expect(mocks.check.mock.calls.length).toBe(before + 1);
      expect(c.querySelector('[role="alert"]')!.textContent).toContain(REASON);
      expect(saveBtn(c).disabled).toBe(true);
    });

    it('lỗi 500 hay lỗi mạng thì không kiểm lại', async () => {
      const { c, before } = await rejectWith(500);
      await settle();
      expect(mocks.check.mock.calls.length).toBe(before);
      expect(c.querySelector('[role="alert"]')).not.toBeNull();
    });
  });

  it('máy chủ từ chối lúc lưu dù form chưa khoá (kiểm chưa kịp hay API cũ): hiện đúng câu lý do, form giữ nguyên', async () => {
    mocks.update.mockRejectedValueOnce(new Error(REASON));
    const c = await mount();
    await edit(c);
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    click(saveBtn(c));
    await flush(10);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Lần lưu này làm trang chiến dịch đang bật thành trống');
    expect(field(c, 'Tên chiến dịch').value).toBe('Tên mới');
  });
});

describe('CampaignsTab: web mới chạy với API cũ chưa trả health', () => {
  it('dòng không có health vẫn vẽ bình thường, không huy hiệu, nút Bật không khoá, lọc "Có vấn đề" không vỡ', async () => {
    const { health: _h, ...legacy } = row('cu', { status: 'off', isActive: false });
    mocks.list.mockResolvedValue([legacy]);
    const c = await mount();
    expect(c.textContent).toContain('Chiến dịch cu');
    expect(c.textContent).not.toMatch(/lỗi chặn|cảnh báo/);
    expect(c.querySelector<HTMLButtonElement>('button[aria-label="Bật chiến dịch Chiến dịch cu"]')!.disabled).toBe(false);
    click(chip(c, 'Có vấn đề'));
    await flush(2);
    expect(c.textContent).toContain('Không có chiến dịch nào có vấn đề');
  });
});

