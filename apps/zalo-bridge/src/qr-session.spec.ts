import { describe, expect, it } from 'vitest';
import { applyQrEvent, idleQr } from './qr-session';

describe('qr-session', () => {
  it('đi qua các trạng thái và bọc ảnh base64 thành data URL', () => {
    let s = idleQr();
    expect(s.status).toBe('IDLE');
    s = applyQrEvent(s, { type: 0, data: { image: 'AAAA' } });
    expect(s).toMatchObject({ status: 'WAITING_SCAN', image: 'data:image/png;base64,AAAA' });
    s = applyQrEvent(s, { type: 2, data: { display_name: 'Tubu CSKH' } });
    expect(s).toMatchObject({ status: 'SCANNED', displayName: 'Tubu CSKH', image: 'data:image/png;base64,AAAA' });
    s = applyQrEvent(s, { type: 4 });
    expect(s.status).toBe('SUCCESS');
  });

  it('hết hạn và bị từ chối', () => {
    expect(applyQrEvent(idleQr(), { type: 1 }).status).toBe('EXPIRED');
    expect(applyQrEvent(idleQr(), { type: 3 }).status).toBe('FAILED');
  });

  it('giữ nguyên data URL đã có tiền tố', () => {
    expect(applyQrEvent(idleQr(), { type: 0, data: { image: 'data:image/png;base64,ZZ' } }).image).toBe('data:image/png;base64,ZZ');
  });
});
