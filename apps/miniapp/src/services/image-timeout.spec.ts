import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const ok = () => Promise.resolve({ data: {}, status: 200, headers: {} });
  return { get: vi.fn(ok), post: vi.fn(ok), put: vi.fn(ok), patch: vi.fn(ok), delete: vi.fn(ok) };
});
vi.mock('./api', () => ({ api: mocks }));

import { IMAGE_UPLOAD_TIMEOUT_MS } from './http';
import { createReview } from './shop-api';
import { requestReturn } from './shop-api';
import { applyDealer } from './dealer-api';
import { updateMe } from './account-api';
import { updateOwnedBrand } from './brand-owner-api';
import { updateStorefront } from './storefront-api';
import { updateBank, markPaid } from './payroll-api';
import { cancelShift } from './shifts-api';
import { createPost, editPost, createEvent } from './feed-api';
import { sendSupportChat } from './support-chat-api';

beforeEach(() => vi.clearAllMocks());

/** Mini App PROD không có Cloudinary: ảnh đi base64 trong body, nên mọi gọi mang ảnh cần trần thời gian riêng. */
const IMAGE_CALLS: [string, () => Promise<unknown>, 'post' | 'put' | 'patch'][] = [
  ['createReview', () => createReview('s', { rating: 5, images: ['data:image/jpeg;base64,AA'], orderId: 'o' }), 'post'],
  ['requestReturn', () => requestReturn('C1', { reasonCode: 'DAMAGED' as never, images: ['data:image/jpeg;base64,AA'], items: [] }), 'post'],
  ['applyDealer', () => applyDealer({ businessName: 'a', ownerName: 'b', phone: '0900000000', address: 'c', cccdFrontUrl: 'data:x', cccdBackUrl: 'data:y' }), 'post'],
  ['updateMe', () => updateMe({ avatarUrl: 'data:image/jpeg;base64,AA' }), 'patch'],
  ['updateOwnedBrand', () => updateOwnedBrand({ logoUrl: 'data:x' }), 'patch'],
  ['updateStorefront', () => updateStorefront({ avatarUrl: 'data:x' }), 'patch'],
  ['updateBank', () => updateBank({ qrImageUrl: 'data:x' }), 'put'],
  ['markPaid', () => markPaid('s', { year: 2026, month: 10, proofImageUrl: 'data:x' }), 'post'],
  ['cancelShift', () => cancelShift('i', { reason: 'abc', evidenceUrl: 'data:x' }), 'post'],
  ['createPost', () => createPost({ title: 't', body: 'b', images: ['data:x'] } as never), 'post'],
  ['editPost', () => editPost('p', { images: ['data:x'] }), 'patch'],
  ['createEvent', () => createEvent({ title: 't', coverUrl: 'data:x' } as never), 'post'],
  ['sendSupportChat', () => sendSupportChat({ clientMsgId: 'c', imageUrl: 'data:x' }), 'post'],
];

describe('gọi API mang ảnh', () => {
  it('trần thời gian là 90 giây', () => {
    expect(IMAGE_UPLOAD_TIMEOUT_MS).toBe(90_000);
  });

  it.each(IMAGE_CALLS)('%s dùng timeout 90 giây', async (_name, call, method) => {
    await call();
    const args = mocks[method].mock.calls[0];
    expect(args[args.length - 1]).toMatchObject({ timeout: 90_000 });
  });

  it('yêu cầu thường không đặt timeout riêng (giữ 15 giây mặc định)', async () => {
    const { createStorefront } = await import('./storefront-api');
    await createStorefront();
    expect(mocks.post.mock.calls[0]).toEqual(['/storefront']);
  });
});
