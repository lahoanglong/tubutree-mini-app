import { describe, it, expect, vi, beforeEach } from 'vitest';

const zmp = vi.hoisted(() => ({
  shareLink: vi.fn(),
  openExternal: vi.fn(),
  callPhone: vi.fn(),
  openOAChat: vi.fn(),
  followOA: vi.fn(),
  hasOA: true,
}));
vi.mock('./zmp-bridge', () => zmp);

const sdk = vi.hoisted(() => ({ getStorage: vi.fn(), setStorage: vi.fn(), saveImageToGallery: vi.fn() }));
vi.mock('zmp-sdk/apis', () => sdk);

import { platformBridge } from './platform-bridge';

beforeEach(() => {
  for (const f of [zmp.shareLink, zmp.openExternal, zmp.callPhone, zmp.openOAChat, zmp.followOA, sdk.getStorage, sdk.setStorage, sdk.saveImageToGallery]) f.mockReset();
  zmp.shareLink.mockResolvedValue(undefined);
  zmp.openExternal.mockResolvedValue(undefined);
  zmp.callPhone.mockResolvedValue(undefined);
  zmp.openOAChat.mockResolvedValue(undefined);
});

describe('platform-bridge (Mini App)', () => {
  it('platform miniapp, mọi capability bật, OA theo hasOA', () => {
    expect(platformBridge.platform).toBe('miniapp');
    expect(platformBridge.capabilities).toEqual({ verifiedPhone: true, zaloLocation: true, qrScan: true, zaloNotifyPermission: true });
    expect(platformBridge.oa.available).toBe(true);
  });

  it('share gọi shareLink với description lấy từ text, rơi về title', async () => {
    expect(await platformBridge.share({ title: 'Cây', text: 'Xem nè', path: '/product/x' })).toBe('shared');
    expect(zmp.shareLink).toHaveBeenCalledWith({ title: 'Cây', description: 'Xem nè', path: '/product/x' });
    await platformBridge.share({ title: 'Cây', path: '/a' });
    expect(zmp.shareLink).toHaveBeenLastCalledWith({ title: 'Cây', description: 'Cây', path: '/a' });
  });

  it('share lỗi SDK: failed, không ném', async () => {
    zmp.shareLink.mockRejectedValue(new Error('boom'));
    expect(await platformBridge.share({ title: 't', path: '/a' })).toBe('failed');
  });

  it('share bị khách huỷ hộp thoại (mã -2003): cancelled, không phải failed', async () => {
    zmp.shareLink.mockRejectedValue({ code: -2003, message: 'User cancel' });
    expect(await platformBridge.share({ title: 't', path: '/a' })).toBe('cancelled');
  });

  it('oa.openChat không ném khi SDK từ chối mở chat', async () => {
    zmp.openOAChat.mockRejectedValue(new Error('denied'));
    await expect(platformBridge.oa.openChat('hi')).resolves.toBeUndefined();
  });

  it('openExternal, callPhone chuyển nguyên đối số và không ném khi hàm gốc reject', () => {
    zmp.openExternal.mockRejectedValue(new Error('x'));
    zmp.callPhone.mockRejectedValue(new Error('x'));
    platformBridge.openExternal('https://shopee.vn');
    platformBridge.callPhone('1800 6868');
    expect(zmp.openExternal).toHaveBeenCalledWith('https://shopee.vn');
    expect(zmp.callPhone).toHaveBeenCalledWith('1800 6868');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'not a url'])('openExternal không chuyển URL ngoài http(s) cho zmp: %s', (url) => {
    platformBridge.openExternal(url);
    expect(zmp.openExternal).not.toHaveBeenCalled();
  });

  it('saveImage lưu ảnh vào thư viện máy: saved, SDK lỗi: failed, URL không phải http(s): failed không gọi SDK', async () => {
    sdk.saveImageToGallery.mockResolvedValue(undefined);
    expect(await platformBridge.saveImage('https://img.vietqr.io/x.png', 'qr.png')).toBe('saved');
    expect(sdk.saveImageToGallery).toHaveBeenCalledWith({ imageUrl: 'https://img.vietqr.io/x.png' });
    sdk.saveImageToGallery.mockRejectedValue(new Error('denied'));
    expect(await platformBridge.saveImage('https://img.vietqr.io/x.png', 'qr.png')).toBe('failed');
    sdk.saveImageToGallery.mockClear();
    expect(await platformBridge.saveImage('javascript:1', 'qr.png')).toBe('failed');
    expect(sdk.saveImageToGallery).not.toHaveBeenCalled();
  });

  it('oa.openChat và follow chuyển cho zmp-bridge', async () => {
    zmp.followOA.mockResolvedValue(true);
    await platformBridge.oa.openChat('hi');
    expect(zmp.openOAChat).toHaveBeenCalledWith('hi');
    expect(await platformBridge.oa.follow()).toBe(true);
    expect(zmp.followOA).toHaveBeenCalledWith();
  });

  describe('storage', () => {
    it('get đọc theo khoá, trả chuỗi hoặc null', async () => {
      sdk.getStorage.mockResolvedValue({ k: 'v' });
      expect(await platformBridge.storage.get('k')).toBe('v');
      expect(sdk.getStorage).toHaveBeenCalledWith({ keys: ['k'] });
      sdk.getStorage.mockResolvedValue({});
      expect(await platformBridge.storage.get('k')).toBeNull();
      sdk.getStorage.mockResolvedValue({ k: 5 });
      expect(await platformBridge.storage.get('k')).toBeNull();
    });

    it('get lỗi SDK (ngoài Zalo): null', async () => {
      sdk.getStorage.mockRejectedValue(new Error('x'));
      expect(await platformBridge.storage.get('k')).toBeNull();
    });

    it('set ghi dạng data và không ném khi lỗi', async () => {
      sdk.setStorage.mockResolvedValue(undefined);
      await platformBridge.storage.set('k', 'v');
      expect(sdk.setStorage).toHaveBeenCalledWith({ data: { k: 'v' } });
      sdk.setStorage.mockRejectedValue(new Error('x'));
      await expect(platformBridge.storage.set('k', 'v')).resolves.toBeUndefined();
    });
  });
});
