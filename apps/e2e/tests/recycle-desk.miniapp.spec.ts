import type { Page } from '@playwright/test';
import type { WasteDeskPointDTO, WasteDeskRequestDTO } from '@tubutree/shared-types';
import { SHORTFALL_LABELS } from '../../miniapp/src/utils/waste-labels';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';
import { expectNoOverflow, mockDeskStaff } from './support/waste-mocks';

/**
 * Zalo Mini App — Nhận hàng tại điểm (apps/miniapp/src/pages/recycle-desk.tsx, route /recycle/desk).
 * Route NestJS: waste-desk.controller.ts (GET /waste/desk/points, POST /waste/desk/lookup, POST /waste/desk/requests/:id/confirm).
 */

const POINT: WasteDeskPointDTO = {
  id: 'wp-q1',
  kind: 'PARTNER',
  name: 'Tạp hoá Cô Ba',
  giftHandoverEnabled: false,
  myRole: 'OWNER',
  quota: { limit: 100_000, used: 0, remaining: 100_000 },
  perkText: null,
  perkPendingText: null,
  staffDailyCapRemaining: 1_000_000,
};

const REQUEST: WasteDeskRequestDTO = {
  id: 'wr-desk-1',
  code: 'TR-7K3QP',
  method: 'DROP_OFF',
  status: 'OPEN',
  pointId: 'wp-q1',
  customerName: 'K*** E2E',
  customerPhone: '090****567',
  estimatedPoints: 3000,
  lines: [
    {
      itemId: 'wi-carton',
      itemName: 'Thùng carton cũ',
      unitLabel: 'thùng',
      unitsPerPoint: 1,
      pointsPerGroup: 1000,
      declaredQty: 3,
      receivedQty: null,
      hazardous: false,
    },
  ],
};

function setup(api: MockApi): void {
  mockSession(api, makeUser({ id: 'u-staff', fullName: 'Chủ điểm Cô Ba' }));
  mockDeskStaff(api, { points: [POINT], lookup: { type: 'REQUEST', request: REQUEST } });
}

async function lookUp(page: Page): Promise<void> {
  await page.goto('/recycle/desk');
  await page.getByRole('textbox').first().fill('TR-7K3QP');
  await page.getByRole('button', { name: 'Tra mã' }).click();
}

async function lowerReceived(page: Page, times: number): Promise<void> {
  const line = page.locator('[data-line]').filter({ hasText: 'Thùng carton cũ' });
  await expect(line).toBeVisible();
  await expect(line.getByText('Tối đa 3')).toBeVisible();
  for (let i = 0; i < times; i++) await line.getByRole('button', { name: 'Giảm số lượng' }).click();
}

test.describe('Đổi rác lấy quà — quầy nhận', () => {
  test('tra mã sai: một câu 404 Không tìm thấy mã', async ({ page, api }) => {
    setup(api);
    api.post('/waste/desk/lookup', reply(404, { statusCode: 404, message: 'Không tìm thấy mã' }));
    await lookUp(page);
    await expect(page.getByText('Không tìm thấy mã')).toBeVisible();
    expect(api.callsTo('POST', '/waste/desk/requests/:id/confirm')).toHaveLength(0);
  });

  test('trần ngày của nhân viên: 409 hiện nguyên câu', async ({ page, api }) => {
    setup(api);
    api.post('/waste/desk/requests/:id/confirm', reply(409, { statusCode: 409, message: 'Bạn đã chạm trần điểm xác nhận hôm nay' }));
    await lookUp(page);
    await lowerReceived(page, 0);
    await page.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
    await expect(page.getByText('Bạn đã chạm trần điểm xác nhận hôm nay')).toBeVisible();
    await expect(page.getByText('TR-7K3QP')).toBeVisible();
  });

  test('khách vừa sửa yêu cầu: 409, nhắc tra lại', async ({ page, api }) => {
    setup(api);
    api.post('/waste/desk/requests/:id/confirm', reply(409, { statusCode: 409, message: 'Khách vừa sửa yêu cầu, vui lòng tra lại mã' }));
    await lookUp(page);
    await lowerReceived(page, 0);
    await page.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
    await expect(page.getByText('Khách vừa sửa yêu cầu, vui lòng tra lại mã')).toBeVisible();
  });

  test('nhận thiếu: số thực nhận nhỏ hơn số khai thì phải chọn lý do', async ({ page, api }) => {
    setup(api);
    api.post('/waste/desk/requests/:id/confirm', {
      requestId: 'wr-desk-1',
      code: 'TR-7K3QP',
      status: 'COMPLETED',
      pointsAwarded: 2000,
      dropsAwarded: 0,
      quota: { limit: 100_000, used: 2000, remaining: 98_000 },
      staffDailyCapRemaining: 998_000,
    });
    await lookUp(page);
    await lowerReceived(page, 1);
    const confirm = page.getByRole('button', { name: 'Xác nhận đã nhận' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Lý do nhận thiếu: Thùng carton cũ').selectOption({ label: SHORTFALL_LABELS.WET });
    await expect(confirm).toBeEnabled();
    const confirmed = api.waitForCall('POST', '/waste/desk/requests/:id/confirm');
    await confirm.click();
    const sent = await confirmed;
    expect(sent.body).toEqual({ lines: [{ itemId: 'wi-carton', declaredQty: 3, receivedQty: 2, shortfallReason: 'WET' }] });
    await expect(page.getByText('Đã ghi nhận. Tubu sẽ cộng 2.000 điểm cho khách', { exact: true })).toBeVisible();
    await expect(page.getByText('Yêu cầu TR-7K3QP của K*** E2E đã xong')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhận yêu cầu khác' })).toBeVisible();
  });

  test('/recycle/desk không tràn ngang', async ({ page, api }) => {
    setup(api);
    await expectNoOverflow(page, '/recycle/desk');
  });
});
