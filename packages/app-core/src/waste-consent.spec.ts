import { describe, expect, it } from 'vitest';
import { WASTE_RULES_UPDATED_NOTE, consentStillValid } from './waste-consent';

describe('consentStillValid', () => {
  it('cùng phiên bản: còn hiệu lực', () => expect(consentStillValid('2026-10-17.1', '2026-10-17.1')).toBe(true));
  it('admin đổi phiên bản sau khi khách tick: hết hiệu lực, phải tick lại', () => expect(consentStillValid('2026-10-17.1', '2026-11-05.2')).toBe(false));
  it('chưa biết phiên bản hiện hành hoặc lúc tick: tin ô đã tick, máy chủ kiểm lại', () => {
    expect(consentStillValid('2026-10-17.1', undefined)).toBe(true);
    expect(consentStillValid(null, '2026-11-05.2')).toBe(true);
    expect(consentStillValid(undefined, undefined)).toBe(true);
  });
  it('câu nhắc bảo đọc lại thể lệ', () => expect(WASTE_RULES_UPDATED_NOTE).toContain('đọc lại Thể lệ'));
});
