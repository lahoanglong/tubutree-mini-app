import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const ok = () => Promise.resolve({ data: {}, status: 200, headers: {} });
  return { get: vi.fn(ok), post: vi.fn(ok), put: vi.fn(ok), patch: vi.fn(ok), delete: vi.fn(ok) };
});
vi.mock('./api', () => ({ api: mocks }));

import { IMAGE_UPLOAD_TIMEOUT_MS, imageTimeout } from './http';
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

const IMG = 'data:image/jpeg;base64,AA';

/** Mini App PROD không có Cloudinary: ảnh đi base64 trong body. Chỉ request thật sự mang ảnh mới cần trần 90 s; chữ thuần giữ 15 s mặc định. */
const CALLS: { name: string; method: 'post' | 'put' | 'patch'; withImage: () => Promise<unknown>; textOnly: () => Promise<unknown> }[] = [
  { name: 'createReview', method: 'post', withImage: () => createReview('s', { rating: 5, images: [IMG], orderId: 'o' }), textOnly: () => createReview('s', { rating: 5, comment: 'ok', orderId: 'o' }) },
  { name: 'requestReturn', method: 'post', withImage: () => requestReturn('C1', { reasonCode: 'DAMAGED' as never, images: [IMG], items: [] }), textOnly: () => requestReturn('C1', { reasonCode: 'DAMAGED' as never, items: [] }) },
  { name: 'applyDealer', method: 'post', withImage: () => applyDealer({ businessName: 'a', ownerName: 'b', phone: '0900000000', address: 'c', cccdFrontUrl: IMG, cccdBackUrl: IMG }), textOnly: () => applyDealer({ businessName: 'a', ownerName: 'b', phone: '0900000000', address: 'c', cccdFrontUrl: 'https://img/1.jpg', cccdBackUrl: 'https://img/2.jpg' }) },
  { name: 'updateMe', method: 'patch', withImage: () => updateMe({ avatarUrl: IMG }), textOnly: () => updateMe({ fullName: 'An' }) },
  { name: 'updateOwnedBrand', method: 'patch', withImage: () => updateOwnedBrand({ logoUrl: IMG }), textOnly: () => updateOwnedBrand({ tagline: 'x' }) },
  { name: 'updateStorefront', method: 'patch', withImage: () => updateStorefront({ avatarUrl: IMG }), textOnly: () => updateStorefront({ title: 'x' }) },
  { name: 'updateBank', method: 'put', withImage: () => updateBank({ qrImageUrl: IMG }), textOnly: () => updateBank({ bankAccountNo: '123' }) },
  { name: 'markPaid', method: 'post', withImage: () => markPaid('s', { year: 2026, month: 10, proofImageUrl: IMG }), textOnly: () => markPaid('s', { year: 2026, month: 10, proofImageUrl: 'https://img/p.png' }) },
  { name: 'cancelShift', method: 'post', withImage: () => cancelShift('i', { reason: 'abc', evidenceUrl: IMG }), textOnly: () => cancelShift('i', { reason: 'abc' }) },
  { name: 'createPost', method: 'post', withImage: () => createPost({ title: 't', body: 'b', images: [IMG] } as never), textOnly: () => createPost({ title: 't', body: 'b' } as never) },
  { name: 'editPost', method: 'patch', withImage: () => editPost('p', { images: [IMG] }), textOnly: () => editPost('p', { title: 'x' }) },
  { name: 'createEvent', method: 'post', withImage: () => createEvent({ title: 't', coverUrl: IMG } as never), textOnly: () => createEvent({ title: 't' } as never) },
  { name: 'sendSupportChat', method: 'post', withImage: () => sendSupportChat({ clientMsgId: 'c', imageUrl: IMG }), textOnly: () => sendSupportChat({ clientMsgId: 'c', body: 'xin chào' }) },
];

const lastArg = (method: 'post' | 'put' | 'patch') => {
  const args = mocks[method].mock.calls[0] as unknown[];
  return args[args.length - 1];
};

describe('imageTimeout', () => {
  it('trần là 90 giây', () => {
    expect(IMAGE_UPLOAD_TIMEOUT_MS).toBe(90_000);
  });
  it('có chuỗi data: ở bất kỳ tầng lồng nào → trần 90 s; chỉ chữ/URL → không đặt', () => {
    expect(imageTimeout({ a: { b: [{ c: IMG }] } })).toEqual({ timeout: 90_000 });
    expect(imageTimeout([IMG])).toEqual({ timeout: 90_000 });
    expect(imageTimeout({ note: 'xem data:image/png là gì', url: 'https://x/y.jpg' })).toBeUndefined();
    expect(imageTimeout(undefined)).toBeUndefined();
    expect(imageTimeout({ n: 1, ok: true, nothing: null })).toBeUndefined();
  });
});

describe('gọi API có thể mang ảnh', () => {
  it.each(CALLS)('$name: có ảnh thì timeout 90 giây', async ({ withImage, method }) => {
    await withImage();
    expect(lastArg(method)).toMatchObject({ timeout: 90_000 });
  });

  it.each(CALLS)('$name: chỉ có chữ thì giữ 15 giây mặc định (không đặt timeout)', async ({ textOnly, method }) => {
    await textOnly();
    const last = lastArg(method) as { timeout?: number } | undefined;
    expect(last?.timeout).toBeUndefined();
  });

  it('yêu cầu thường không đặt timeout riêng', async () => {
    const { createStorefront } = await import('./storefront-api');
    await createStorefront();
    expect(mocks.post.mock.calls[0]).toEqual(['/storefront']);
  });
});
