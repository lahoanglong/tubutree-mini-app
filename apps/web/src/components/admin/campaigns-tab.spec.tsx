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
  setProducts: vi.fn(),
  setCoupons: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@/lib/admin-campaigns-client', () => ({
  listAdminCampaigns: mocks.list,
  getAdminCampaign: mocks.get,
  createAdminCampaign: mocks.create,
  updateAdminCampaign: mocks.update,
  deleteAdminCampaign: mocks.remove,
  setAdminCampaignProducts: mocks.setProducts,
  setAdminCampaignCoupons: mocks.setCoupons,
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
  mocks.setProducts.mockReset().mockResolvedValue({ count: 1 });
  mocks.setCoupons.mockReset().mockResolvedValue({ count: 1 });
  mocks.check.mockReset().mockResolvedValue({ issues: [], blockers: 0, warnings: 0, usable: { products: 1, coupons: 0 } });
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
      isActive: false,
    });
    expect(mocks.update).toHaveBeenCalledWith('new1', { isActive: true });
    expect(mocks.setProducts).not.toHaveBeenCalled();
    expect(mocks.setCoupons).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Đã lưu chiến dịch');
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

  it('chọn sản phẩm bằng ProductPicker rồi nhập mã: sau khi tạo gọi đặt sản phẩm và đặt mã với id vừa tạo', async () => {
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    await flush(2);
    expect(c.textContent).toContain('Nước rửa chén');
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'THU10, xanh5\nTHU10');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.setProducts).toHaveBeenCalledWith('new1', ['p1']);
    expect(mocks.setCoupons).toHaveBeenCalledWith('new1', ['THU10', 'xanh5']);
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

  it('tạo được nhưng gắn mã lỗi (mã không có thật): báo rõ đã lưu chiến dịch, form giữ lại; bấm Lưu lại thì SỬA chiến dịch vừa tạo, không tạo trùng', async () => {
    mocks.setCoupons.mockRejectedValueOnce(new Error('Không tìm thấy mã: XANH5'));
    const c = await mount();
    await open(c);
    fillBasics(c);
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'XANH5');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Đã lưu chiến dịch nhưng chưa gắn được mã');
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không tìm thấy mã: XANH5');
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'THU10');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith('new1', expect.objectContaining({ title: 'Giữa Thu' }));
    expect(mocks.setCoupons).toHaveBeenLastCalledWith('new1', ['THU10']);
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
    expect(mocks.setProducts).not.toHaveBeenCalled();
    expect(mocks.setCoupons).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('bỏ hết sản phẩm và đổi mã: đặt lại danh sách rỗng và mã mới', async () => {
    const c = await mount();
    await openEdit(c);
    click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'MOI5');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    expect(mocks.setProducts).toHaveBeenCalledWith('a', []);
    expect(mocks.setCoupons).toHaveBeenCalledWith('a', ['MOI5']);
  });

  it('xoá subtitle và giá trị đích bằng null để API xoá thật', async () => {
    mocks.get.mockResolvedValue(detail('a', { subtitle: 'Phụ đề cũ', linkType: 'PRODUCT', linkValue: 'nuoc-rua-chen' }));
    const c = await mount();
    await openEdit(c);
    typeInto(field(c, 'Phụ đề'), '');
    selectValue(field(c, 'Đích khi bấm'), 'CAMPAIGN_PAGE');
    click(byText(c, 'button', 'Lưu chiến dịch'));
    await flush(8);
    // Chiến dịch đang chạy đổi đích: trường khác lưu trước, đích để bước cuối.
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ subtitle: null });
    expect(mocks.update.mock.calls[0]![1]).not.toHaveProperty('linkType');
    expect(mocks.update.mock.calls[1]![1]).toEqual({ linkType: 'CAMPAIGN_PAGE', linkValue: null });
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

  it('lỗi chặn hiện đỏ, cảnh báo hiện vàng; còn lỗi chặn mà "Đang bật" thì nút Lưu khoá kèm lý do, bỏ chọn "Đang bật" để lưu nháp', async () => {
    mocks.check.mockResolvedValue({
      issues: [issue('PAGE_EMPTY', 'BLOCK', 'Trang chiến dịch đang trống.'), issue('ENDED', 'WARN', 'Ngày kết thúc đã qua.')],
      blockers: 1,
      warnings: 1,
    });
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
    expect(c.querySelector('[data-testid="campaign-check-lock"]')!.textContent).toContain('1 lỗi chặn');
    expect(save(c).getAttribute('aria-describedby')).toBe('campaign-lock-reason');

    click(c.querySelector('input[aria-label="Đang bật"]'));
    expect(save(c).disabled).toBe(false);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')).toBeNull();
    click(save(c));
    await flush(8);
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ isActive: false });
    expect(mocks.update).not.toHaveBeenCalled();
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
    mocks.check.mockResolvedValueOnce({ issues: [issue('LINK_PRODUCT_MISSING', 'BLOCK', 'Không có sản phẩm với slug "sai".')], blockers: 1, warnings: 0 });
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

  it('thứ tự lưu: tạo tắt, gắn sản phẩm, gắn mã, rồi bật ở bước cuối', async () => {
    const order: string[] = [];
    mocks.create.mockImplementation(async () => (order.push('create'), detail('new1')));
    mocks.setProducts.mockImplementation(async () => (order.push('products'), { count: 1 }));
    mocks.setCoupons.mockImplementation(async () => (order.push('coupons'), { count: 1 }));
    mocks.update.mockImplementation(async () => (order.push('activate'), detail('new1')));
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    typeInto(field(c, 'Mã giảm giá gắn kèm'), 'THU10');
    click(save(c));
    await flush(10);
    expect(order).toEqual(['create', 'products', 'coupons', 'activate']);
    expect(mocks.update).toHaveBeenCalledWith('new1', { isActive: true });
  });

  it('bật ở bước cuối bị máy chủ từ chối: báo đã lưu nhưng chưa bật được, form giữ lại; Lưu lại không tạo trùng và thử bật lại', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Trang chiến dịch đang trống: thêm sản phẩm.'));
    const c = await mount();
    await open(c);
    fillBasics(c);
    click(save(c));
    await flush(10);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Đã lưu chiến dịch nhưng chưa bật được');
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Trang chiến dịch đang trống');
    expect(c.textContent).not.toContain('Đã lưu chiến dịch.');
    click(save(c));
    await flush(10);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenLastCalledWith('new1', { isActive: true });
    expect(c.textContent).toContain('Đã lưu chiến dịch.');
  });

  it('sửa chiến dịch đang bật: giữ bật trong lần sửa, không gọi bật thêm; sửa chiến dịch đang tắt và bật: sửa tắt rồi bật ở cuối', async () => {
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
    expect(mocks.update.mock.calls.map((x) => x[1].isActive)).toEqual([false, true]);
  });

  describe('thứ tự gắn sản phẩm và mã: không bao giờ đi qua trang trống', () => {
    // [sản phẩm, mã] cũ → mới; `usable` là số món dùng được của danh sách MỚI do máy chủ báo (sản phẩm hiển thị, mã dùng được).
    const run = async (opts: { oldProducts: boolean; oldCodes: string[]; newProduct: boolean; newCodes: string; usable: { products: number; coupons: number } }) => {
      const order: string[] = [];
      mocks.setProducts.mockImplementation(async () => (order.push('products'), { count: 0 }));
      mocks.setCoupons.mockImplementation(async () => (order.push('coupons'), { count: 0 }));
      mocks.get.mockResolvedValue(detail('a', { products: opts.oldProducts ? [{ id: 'p9', name: 'Sản phẩm cũ', slug: 'sp-cu' }] : [], couponCodes: opts.oldCodes }));
      mocks.check.mockResolvedValue({ issues: [], blockers: 0, warnings: 0, usable: opts.usable });
      const c = await mount();
      click(c.querySelector('button[aria-label="Sửa chiến dịch Chiến dịch a"]'));
      await flush(6);
      if (opts.oldProducts) click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
      if (opts.newProduct) click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
      typeInto(field(c, 'Mã giảm giá gắn kèm'), opts.newCodes);
      click(byText(c, 'button', 'Lưu chiến dịch'));
      await flush(10);
      return order;
    };

    it('[A, ∅] → [H ẩn, Y]: danh sách mới chỉ có mã dùng được, gắn mã trước rồi mới đổi sản phẩm', async () => {
      expect(await run({ oldProducts: true, oldCodes: [], newProduct: true, newCodes: 'Y', usable: { products: 0, coupons: 1 } })).toEqual(['coupons', 'products']);
    });

    it('[∅, X] → [B, ∅]: danh sách mới chỉ có sản phẩm dùng được, gắn sản phẩm trước rồi mới gỡ mã', async () => {
      expect(await run({ oldProducts: false, oldCodes: ['X'], newProduct: true, newCodes: '', usable: { products: 1, coupons: 0 } })).toEqual(['products', 'coupons']);
    });

    it('[A, X] → [B, ∅]: sản phẩm trước', async () => {
      expect(await run({ oldProducts: true, oldCodes: ['X'], newProduct: true, newCodes: '', usable: { products: 1, coupons: 0 } })).toEqual(['products', 'coupons']);
    });

    it('cả hai danh sách mới đều dùng được: sản phẩm trước', async () => {
      expect(await run({ oldProducts: true, oldCodes: ['X'], newProduct: true, newCodes: 'Y', usable: { products: 1, coupons: 1 } })).toEqual(['products', 'coupons']);
    });
  });

  it('xem trước banner: hai khung dựng bằng băng chuyền thật với ảnh và tên đang nhập', async () => {
    const c = await mount();
    await open(c);
    expect(c.textContent).toContain('Chọn ảnh để xem trước');
    fillBasics(c);
    expect(c.querySelector('[data-testid="campaign-preview-phone"] img')!.getAttribute('src')).toBe('https://img.test/thu.jpg');
    expect(c.querySelector('[data-testid="campaign-preview-desktop"] img')!.getAttribute('alt')).toBe('Giữa Thu');
    expect(c.querySelectorAll('[data-testid^="campaign-preview-"] section[aria-roledescription="carousel"]')).toHaveLength(2);
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

describe('CampaignsTab: luật "bật" của form khớp máy chủ', () => {
  const BLOCK = { issues: [{ code: 'LINK_PRODUCT_HIDDEN', level: 'BLOCK', message: 'Sản phẩm "sua-hat" đang ẩn.' }], blockers: 1, warnings: 0, usable: { products: 1, coupons: 0 } };
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

  it('chiến dịch đang chạy mà có lỗi cũ (sản phẩm đích bị ẩn sau này): đổi tiêu đề vẫn lưu được, khối kiểm vẫn hiện lỗi', async () => {
    mocks.check.mockResolvedValue(BLOCK);
    const c = await mount();
    await edit(c);
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    await settle();
    expect(c.querySelector('[data-testid="campaign-check"] [data-level="BLOCK"]')!.textContent).toContain('đang ẩn');
    expect(saveBtn(c).disabled).toBe(false);
    expect(c.querySelector('[data-testid="campaign-check-lock"]')).toBeNull();
  });

  it('đang chạy mà đổi đích còn lỗi chặn: khoá nút Lưu như máy chủ', async () => {
    mocks.check.mockResolvedValue(BLOCK);
    const c = await mount();
    await edit(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'sua-hat');
    await settle();
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('chiến dịch đang tắt, bật lên mà còn lỗi chặn: khoá nút Lưu', async () => {
    mocks.list.mockResolvedValue([row('d', { status: 'off', isActive: false })]);
    mocks.get.mockResolvedValue(detail('d', { isActive: false, status: 'off' }));
    mocks.check.mockResolvedValue(BLOCK);
    const c = await mount();
    await edit(c, 'd');
    await settle();
    expect(saveBtn(c).disabled).toBe(false);
    click(c.querySelector('input[aria-label="Đang bật"]'));
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('chiến dịch đã hết hạn (vẫn đánh dấu bật) mà gia hạn: là một lần bật, còn lỗi chặn thì khoá', async () => {
    mocks.list.mockResolvedValue([row('e', { status: 'ended' })]);
    mocks.get.mockResolvedValue(detail('e', { status: 'ended', endAt: '2026-11-02T16:59:00.000Z' }));
    mocks.check.mockResolvedValue(BLOCK);
    const c = await mount();
    await edit(c, 'e');
    await settle();
    expect(saveBtn(c).disabled).toBe(false);
    typeInto(field(c, 'Kết thúc: ngày'), '30/11/2026');
    await settle();
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('đang chạy đổi đích sang trang chiến dịch kèm sản phẩm: lưu các trường khác trước (vẫn chạy đích cũ, không tắt), gắn sản phẩm, đổi đích ở cuối', async () => {
    mocks.list.mockResolvedValue([row('u')]);
    mocks.get.mockResolvedValue(detail('u', { linkType: 'URL_INTERNAL', linkValue: '/offers', products: [], couponCodes: [] }));
    const order: string[] = [];
    mocks.update.mockImplementation(async (_id: string, body: Record<string, unknown>) => (order.push(`update:${Object.keys(body).includes('linkType') ? 'đích' : 'trường'}`), detail('u')));
    mocks.setProducts.mockImplementation(async () => (order.push('products'), { count: 1 }));
    const c = await mount();
    await edit(c, 'u');
    typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
    selectValue(field(c, 'Đích khi bấm'), 'CAMPAIGN_PAGE');
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    click(saveBtn(c));
    await flush(10);
    expect(order).toEqual(['update:trường', 'products', 'update:đích']);
    expect(calls().every((b) => b.isActive !== false)).toBe(true);
    expect(calls()[0]).toMatchObject({ title: 'Tên mới', isActive: true });
    expect(calls()[0]).not.toHaveProperty('linkType');
    expect(calls()[1]).toEqual({ linkType: 'CAMPAIGN_PAGE', linkValue: null });
  });

  it('gia hạn chiến dịch đã hết hạn kèm sản phẩm: ngày gia hạn lưu ở cuối, sau khi gắn sản phẩm', async () => {
    mocks.list.mockResolvedValue([row('e', { status: 'ended' })]);
    mocks.get.mockResolvedValue(detail('e', { status: 'ended', endAt: '2026-11-02T16:59:00.000Z', products: [], couponCodes: [] }));
    const order: string[] = [];
    mocks.update.mockImplementation(async (_id: string, body: Record<string, unknown>) => (order.push(`update:${'endAt' in body ? 'ngày' : 'trường'}`), detail('e')));
    mocks.setProducts.mockImplementation(async () => (order.push('products'), { count: 1 }));
    const c = await mount();
    await edit(c, 'e');
    typeInto(field(c, 'Kết thúc: ngày'), '30/11/2026');
    click(byText(c, 'button', 'Chọn: Thêm sản phẩm'));
    click(saveBtn(c));
    await flush(10);
    expect(order).toEqual(['update:trường', 'products', 'update:ngày']);
    expect(calls()[1]).toMatchObject({ endAt: '2026-11-30T16:59:00.000Z' });
  });

  it('đang chạy CAMPAIGN_PAGE [A], đổi sang PRODUCT và bỏ A: đích đi ở bước 1, rồi mới gỡ sản phẩm (không để trang cũ trống)', async () => {
    const order: string[] = [];
    mocks.update.mockImplementation(async (_id: string, body: Record<string, unknown>) => (order.push(`update:${'linkType' in body ? 'đích' : 'trường'}`), detail('a')));
    mocks.setProducts.mockImplementation(async () => (order.push('products'), { count: 0 }));
    const c = await mount();
    await edit(c);
    selectValue(field(c, 'Đích khi bấm'), 'PRODUCT');
    typeInto(field(c, 'Slug sản phẩm'), 'sua-hat');
    click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
    click(saveBtn(c));
    await flush(10);
    expect(order).toEqual(['update:đích', 'products']);
    expect(calls()[0]).toMatchObject({ linkType: 'PRODUCT', linkValue: 'sua-hat' });
    expect(calls()).toHaveLength(1);
  });

  describe('khoá khi lần lưu làm trang đang chạy thành trống', () => {
    const PAGE_EMPTY = { issues: [{ code: 'PAGE_EMPTY', level: 'BLOCK', message: 'Trang chiến dịch chưa có sản phẩm hay mã.' }], blockers: 1, warnings: 0, usable: { products: 0, coupons: 0 } };

    it('bỏ A và sửa tiêu đề trên trang đang chạy: khoá, lý do nêu rõ', async () => {
      mocks.check.mockResolvedValue(PAGE_EMPTY);
      const c = await mount();
      await edit(c);
      click(c.querySelector('button[aria-label="Bỏ Sản phẩm cũ khỏi chiến dịch"]'));
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      expect(saveBtn(c).disabled).toBe(true);
      expect(c.querySelector('[data-testid="campaign-check-lock"]')!.textContent).toContain('Lần lưu này làm trang đang chạy thành trống');
    });

    it('dời giờ bắt đầu của trang đang chạy (không đụng danh sách): máy chủ kiểm lại trang theo mốc mới nên form cũng khoá khi kiểm trả PAGE_EMPTY', async () => {
      mocks.check.mockResolvedValue(PAGE_EMPTY);
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Bắt đầu: ngày'), '20/11/2026');
      typeInto(field(c, 'Kết thúc: ngày'), '30/11/2026');
      await settle();
      expect(saveBtn(c).disabled).toBe(true);
      expect(c.querySelector('[data-testid="campaign-check-lock"]')!.textContent).toContain('làm trang đang chạy thành trống');
    });

    it('trang trống sẵn, chỉ sửa tiêu đề (không đụng danh sách): không khoá', async () => {
      mocks.get.mockResolvedValue(detail('a', { products: [], couponCodes: [] }));
      mocks.check.mockResolvedValue(PAGE_EMPTY);
      const c = await mount();
      await edit(c);
      typeInto(field(c, 'Tên chiến dịch'), 'Tên mới');
      await settle();
      expect(saveBtn(c).disabled).toBe(false);
      expect(c.querySelector('[data-testid="campaign-check-lock"]')).toBeNull();
    });
  });

  it('đồng hồ máy admin chậm 5 phút: dùng `now` của máy chủ để biết chiến dịch đã hết hạn (gia hạn là một lần bật, còn lỗi chặn thì khoá)', async () => {
    mocks.get.mockResolvedValue(detail('a', { endAt: '2026-11-05T05:03:00.000Z' }));
    mocks.check.mockResolvedValue({ ...BLOCK, now: '2026-11-05T05:05:00.000Z' });
    const c = await mount();
    await edit(c);
    await settle();
    typeInto(field(c, 'Kết thúc: ngày'), '30/11/2026');
    await settle();
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('đổi đích khi chiến dịch đang tắt: lưu một lần cùng các trường khác, bật ở cuối', async () => {
    mocks.list.mockResolvedValue([row('d', { status: 'off', isActive: false })]);
    mocks.get.mockResolvedValue(detail('d', { isActive: false, status: 'off', linkType: 'URL_INTERNAL', linkValue: '/offers' }));
    const c = await mount();
    await edit(c, 'd');
    selectValue(field(c, 'Đích khi bấm'), 'CAMPAIGN_PAGE');
    click(c.querySelector('input[aria-label="Đang bật"]'));
    click(saveBtn(c));
    await flush(10);
    expect(calls()).toHaveLength(2);
    expect(calls()[0]).toMatchObject({ linkType: 'CAMPAIGN_PAGE', isActive: false });
    expect(calls()[1]).toEqual({ isActive: true });
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

