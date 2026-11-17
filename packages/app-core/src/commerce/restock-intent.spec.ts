import { describe, expect, it } from 'vitest';
import { restockButtonView, restockIntentAction } from './restock-intent';

const out = [{ id: 'v1', stock: 0 }, { id: 'v2', stock: 3 }];

describe('restockIntentAction', () => {
  it('đăng ký nốt khi tính năng bật, phân loại còn hết hàng và khách chưa đăng ký', () => {
    expect(restockIntentAction({ variationId: 'v1' }, { enabled: true, variationIds: [] }, out)).toBe('subscribe');
  });

  it('bỏ khi đã đăng ký từ trước (gửi lại là huỷ), khi hàng đã về, khi tính năng tắt hoặc phân loại lạ', () => {
    expect(restockIntentAction({ variationId: 'v1' }, { enabled: true, variationIds: ['v1'] }, out)).toBe('drop');
    expect(restockIntentAction({ variationId: 'v2' }, { enabled: true, variationIds: [] }, out)).toBe('drop');
    expect(restockIntentAction({ variationId: 'v1' }, { enabled: false, variationIds: [] }, out)).toBe('drop');
    expect(restockIntentAction({ variationId: 'v9' }, { enabled: true, variationIds: [] }, out)).toBe('drop');
  });
});

describe('restockButtonView', () => {
  it('chưa có trạng thái hoặc cờ tắt: nút xám như cũ', () => {
    expect(restockButtonView(undefined, 'v1')).toEqual({ kind: 'off' });
    expect(restockButtonView({ enabled: false, variationIds: [] }, 'v1')).toEqual({ kind: 'off' });
    expect(restockButtonView({ enabled: true, variationIds: [] }, undefined)).toEqual({ kind: 'off' });
  });

  it('cờ bật: theo việc khách đã đăng ký phân loại đang chọn chưa', () => {
    expect(restockButtonView({ enabled: true, variationIds: [] }, 'v1')).toEqual({ kind: 'subscribe' });
    expect(restockButtonView({ enabled: true, variationIds: ['v1'] }, 'v1')).toEqual({ kind: 'subscribed' });
  });
});
