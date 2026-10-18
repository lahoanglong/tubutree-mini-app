import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMISSION_META, CTV_TERMS, PAYOUT_META, WITHDRAWING_META } from './ctv-copy';

const miniappVi = readFileSync(fileURLToPath(new URL('../../../../miniapp/src/i18n/vi.ts', import.meta.url)), 'utf8');
const miniappPage = readFileSync(fileURLToPath(new URL('../../../../miniapp/src/pages/affiliate.tsx', import.meta.url)), 'utf8');

describe('chữ CTV giữ khớp Mini App', () => {
  it('điều khoản và phiên bản điều khoản trùng vi.ctvTerms của Mini App (máy chủ lưu phiên bản này)', () => {
    expect(miniappVi).toContain(`version: '${CTV_TERMS.version}'`);
    expect(miniappVi).toContain(`heading: '${CTV_TERMS.heading}'`);
    for (const item of [...CTV_TERMS.items, CTV_TERMS.agree, CTV_TERMS.mustAgree]) expect(miniappVi).toContain(`'${item}'`);
  });

  it('nhãn trạng thái hoa hồng và lệnh rút trùng COMMISSION_META/PAYOUT_META của Mini App', () => {
    for (const m of [...Object.values(COMMISSION_META), WITHDRAWING_META, ...Object.values(PAYOUT_META)]) {
      expect(miniappPage).toContain(`label: '${m.label}'`);
    }
  });

  it('thẻ Đang chờ gộp PENDING và LOCKED nên hai nhãn cùng tiền tố "Đang chờ"', () => {
    expect(COMMISSION_META.PENDING.label.startsWith('Đang chờ')).toBe(true);
    expect(COMMISSION_META.LOCKED.label.startsWith('Đang chờ')).toBe(true);
  });
});
