import { verifyPresence, type AttnConfig } from './verify';

const OFFICE = { lat: 10.7769, lng: 106.7009 };
const base: AttnConfig = {
  officeIps: ['113.161.1.0/24'],
  lat: OFFICE.lat,
  lng: OFFICE.lng,
  radiusM: 150,
  enforceIp: true,
};

describe('verifyPresence', () => {
  it('chưa cấu hình gì → NOT_CONFIGURED', () => {
    const r = verifyPresence({ officeIps: [], lat: null, lng: null, radiusM: 150, enforceIp: true }, '1.2.3.4', 0, 0);
    expect(r).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
  });

  it('enforceIp + sai IP → IP_NOT_ALLOWED', () => {
    const r = verifyPresence(base, '8.8.8.8', OFFICE.lat, OFFICE.lng);
    expect(r).toEqual({ ok: false, reason: 'IP_NOT_ALLOWED' });
  });

  it('đúng IP + ngoài bán kính → OUT_OF_RADIUS', () => {
    const r = verifyPresence(base, '113.161.1.5', 10.9, 106.9); // xa
    expect(r).toEqual({ ok: false, reason: 'OUT_OF_RADIUS' });
  });

  it('đúng IP + trong bán kính → ok', () => {
    const r = verifyPresence(base, '113.161.1.5', OFFICE.lat + 0.0003, OFFICE.lng);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.distanceM).toBeLessThanOrEqual(150);
  });

  it('enforce_ip=false + trong bán kính → ok (bỏ qua IP)', () => {
    const r = verifyPresence({ ...base, enforceIp: false }, '8.8.8.8', OFFICE.lat, OFFICE.lng);
    expect(r.ok).toBe(true);
  });

  it('chỉ có IP (không toạ độ) + đúng IP → ok', () => {
    const r = verifyPresence({ ...base, lat: null, lng: null }, '113.161.1.5', 0, 0);
    expect(r).toEqual({ ok: true, distanceM: 0 });
  });
});
