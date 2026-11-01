// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_INTERNAL_TARGETS } from '@tubutree/app-core/commerce/campaign';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { unlabeledFields, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setProducts: vi.fn(),
  setCoupons: vi.fn(),
}));
vi.mock('@/lib/admin-campaigns-client', () => ({
  listAdminCampaigns: mocks.list,
  getAdminCampaign: mocks.get,
  createAdminCampaign: mocks.create,
  updateAdminCampaign: mocks.update,
  deleteAdminCampaign: mocks.remove,
  setAdminCampaignProducts: mocks.setProducts,
  setAdminCampaignCoupons: mocks.setCoupons,
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
  ...over,
});
const detail = (id: string, over: Record<string, unknown> = {}) => {
  const { productCount: _p, couponCount: _c, ...base } = row(id);
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
  mocks.list.mockReset().mockResolvedValue([row('a')]);
  mocks.get.mockReset().mockResolvedValue(detail('a'));
  mocks.create.mockReset().mockResolvedValue(detail('new1'));
  mocks.update.mockReset().mockResolvedValue(detail('a'));
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
  mocks.setProducts.mockReset().mockResolvedValue({ count: 1 });
  mocks.setCoupons.mockReset().mockResolvedValue({ count: 1 });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
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
