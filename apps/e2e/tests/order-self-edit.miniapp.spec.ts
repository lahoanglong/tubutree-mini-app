import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, reply, type MockApi } from './support/mock-api';
import { STATES, mockWorld } from './support/order-detail-states';

/**
 * tubu-w39-03: khách tự sửa địa chỉ cùng tỉnh và ghi chú ở chi tiết đơn Mini App `/order/<mã>`. Lối vào duy nhất là nút "Sửa" ở khối Địa chỉ
 * nhận hàng, chỉ hiện khi GET /orders/:code trả `canEdit: true`. Tấm sửa (chunk lười) khoá tỉnh của đơn, chỉ gửi trường đã đổi qua PATCH
 * /orders/:code/delivery; lưu xong báo bằng snackbar. Lỗi không phải từ chối nghiệp vụ hiện ngay trong tấm (tấm vẫn mở). Đặt SHOT_DIR thì chụp
 * 360×800 và 390×844.
 */
const CONFIRMED = STATES.find((s) => s.key === 'confirmed')!;
const SIZES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;
const ADDRESS = {
  recipient: 'Nguyễn Văn A',
  phone: '0901234567',
  province: 'TP. Hồ Chí Minh',
  district: '',
  ward: 'Phường Sài Gòn',
  street: '123 Lê Lợi',
  provinceCode: '84_VN79',
  districtCode: '',
  wardCode: '84_VN79_26734',
};
const NEW_STREET = '45 Nguyễn Huệ';

const entries = (page: Page) => page.getByTestId('order-edit-open').filter({ visible: true });
const sheet = (page: Page) => page.getByTestId('order-edit-sheet').filter({ visible: true });

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

/** Mở chi tiết đơn Đã xác nhận với địa chỉ theo địa giới mới; `canEdit` undefined = API cũ không trả trường. */
async function openOrder(page: Page, api: MockApi, canEdit: boolean | undefined) {
  const w = await mockWorld(api, page, 'miniapp', CONFIRMED, Date.now());
  const state = { order: { ...w.order, shippingAddress: { ...ADDRESS }, ...(canEdit === undefined ? {} : { canEdit }) } };
  api.get('/orders/:code', ({ params }) => (params.code === state.order.code ? state.order : reply(404, { statusCode: 404, message: 'Không tìm thấy đơn hàng' })));
  api.get('/geo/communes', [
    { code: '84_VN79_26734', name: 'Phường Sài Gòn' },
    { code: '84_VN79_26737', name: 'Phường Bến Thành' },
  ]);
  await page.goto(`/order/${state.order.code}`);
  return state;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() =>
    Math.max(...[document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')].map((el) => el.scrollWidth - el.clientWidth)),
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('Chi tiết đơn Mini App: khách tự sửa địa chỉ và ghi chú (w39-03)', () => {
  for (const size of SIZES) {
    test(`${size.width}×${size.height}: một lối vào "Sửa", tấm khoá tỉnh, lưu chỉ gửi địa chỉ đã đổi rồi báo còn lượt`, async ({ page, api }) => {
      await page.setViewportSize(size);
      const state = await openOrder(page, api, true);
      const code = state.order.code;
      api.patch('/orders/:code/delivery', ({ call }) => {
        const body = call.body as { address?: Partial<typeof ADDRESS> };
        state.order = { ...state.order, shippingAddress: { ...ADDRESS, ...body.address } };
        return { code, shippingAddress: state.order.shippingAddress, note: null, notifyRecipientZalo: true, editsLeft: 2 };
      });

      await expect(entries(page)).toHaveCount(1, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: `Sửa địa chỉ và ghi chú đơn ${code}` })).toHaveCount(1);
      await entries(page).click();
      await expect(sheet(page)).toBeVisible({ timeout: 15_000 });
      await expect(sheet(page).getByText('Tỉnh/thành: TP. Hồ Chí Minh (không đổi được)')).toBeVisible();
      await expect(page.getByLabel('Số nhà, tên đường')).toHaveValue(ADDRESS.street);
      await noHorizontalScroll(page);
      await shoot(page, `mini-${size.width}-sheet-open`);

      await page.getByLabel('Số nhà, tên đường').fill(NEW_STREET);
      const patch = api.waitForCall('PATCH', '/orders/:code/delivery');
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
      const call = await patch;
      expect(call.body).toEqual({
        address: {
          recipient: ADDRESS.recipient,
          phone: ADDRESS.phone,
          ward: ADDRESS.ward,
          street: NEW_STREET,
          provinceCode: ADDRESS.provinceCode,
          districtCode: '',
          wardCode: ADDRESS.wardCode,
        },
      });
      await expect(page.getByText(`Đã cập nhật đơn ${code}. Còn 2 lần sửa cho đơn này.`).filter({ visible: true }).first()).toBeVisible();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByText(NEW_STREET).filter({ visible: true }).first()).toBeVisible();
      expect(api.callsTo('PATCH', '/orders/:code/delivery')).toHaveLength(1);
    });

    test(`${size.width}×${size.height}: lỗi máy chủ hiện trong tấm, tấm vẫn mở để thử lại`, async ({ page, api }) => {
      await page.setViewportSize(size);
      await openOrder(page, api, true);
      api.patch('/orders/:code/delivery', reply(500, { statusCode: 500, message: 'Internal server error' }));

      await entries(page).click({ timeout: 20_000 });
      await expect(sheet(page)).toBeVisible({ timeout: 15_000 });
      await page.getByLabel('Số nhà, tên đường').fill(NEW_STREET);
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
      await expect(page.getByTestId('order-edit-error')).toBeVisible();
      await expect(sheet(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled();
      await noHorizontalScroll(page);
      await shoot(page, `mini-${size.width}-sheet-error`);
    });
  }

  test('máy chủ bảo không sửa được hoặc API cũ không trả canEdit: không có lối "Sửa"', async ({ page, api }) => {
    await page.setViewportSize(SIZES[1]);
    for (const canEdit of [false, undefined]) {
      await openOrder(page, api, canEdit);
      await expect(page.getByText(ADDRESS.street).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('order-edit-open')).toHaveCount(0);
    }
    expect(api.callsTo('PATCH', '/orders/:code/delivery')).toHaveLength(0);
  });
});
