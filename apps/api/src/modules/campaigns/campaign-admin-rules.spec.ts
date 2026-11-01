import { BadRequestException } from '@nestjs/common';
import { assertWindow, campaignStatus, normalizeLink, slugFromTitle } from './campaign-admin-rules';

const NOW = new Date('2026-11-05T05:00:00Z');
const d = (iso: string) => new Date(iso);

describe('slugFromTitle', () => {
  it('bỏ dấu tiếng Việt, đ thành d, chữ thường, nối bằng gạch ngang', () => {
    expect(slugFromTitle('Chiến dịch Giữa Thu')).toBe('chien-dich-giua-thu');
    expect(slugFromTitle('  Đại hạ giá   11.11!! ')).toBe('dai-ha-gia-11-11');
  });
  it('tiêu đề toàn ký hiệu: giá trị dự phòng, không bao giờ rỗng', () => {
    expect(slugFromTitle('!!!')).toBe('chien-dich');
  });
  it('cắt tối đa 80 ký tự và không để gạch ngang ở cuối', () => {
    const slug = slugFromTitle(`${'a'.repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('normalizeLink', () => {
  it('trang chiến dịch bỏ qua giá trị đi kèm', () => {
    expect(normalizeLink('CAMPAIGN_PAGE', 'bat-ky')).toBeNull();
  });
  it('sản phẩm và danh mục cần slug hợp lệ', () => {
    expect(normalizeLink('PRODUCT', ' tinh-dau-sa ')).toBe('tinh-dau-sa');
    expect(normalizeLink('CATEGORY', 'nha-bep')).toBe('nha-bep');
    for (const bad of [undefined, null, '', 'có dấu', 'a b', '-x']) expect(() => normalizeLink('PRODUCT', bad)).toThrow(BadRequestException);
  });
  it('đích nội bộ phải là đường dẫn của app: một dấu "/" đầu, không URL ngoài, không khoảng trắng', () => {
    expect(normalizeLink('URL_INTERNAL', '/offers')).toBe('/offers');
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/a b', '', null, `/${'a'.repeat(200)}`]) {
      expect(() => normalizeLink('URL_INTERNAL', bad)).toThrow(BadRequestException);
    }
  });
});

describe('assertWindow', () => {
  it('kết thúc phải sau bắt đầu', () => {
    expect(() => assertWindow(d('2026-11-01T00:00:00Z'), d('2026-11-02T00:00:00Z'))).not.toThrow();
    expect(() => assertWindow(d('2026-11-02T00:00:00Z'), d('2026-11-02T00:00:00Z'))).toThrow(BadRequestException);
    expect(() => assertWindow(d('2026-11-03T00:00:00Z'), d('2026-11-02T00:00:00Z'))).toThrow(BadRequestException);
  });
});

describe('campaignStatus', () => {
  const win = { startAt: d('2026-11-01T00:00:00Z'), endAt: d('2026-11-10T00:00:00Z') };
  it('tắt thì off bất kể lịch; còn lại theo lịch, đúng lúc endAt là đã kết thúc', () => {
    expect(campaignStatus({ ...win, isActive: false }, NOW)).toBe('off');
    expect(campaignStatus({ ...win, isActive: true }, NOW)).toBe('live');
    expect(campaignStatus({ startAt: d('2026-11-06T00:00:00Z'), endAt: win.endAt, isActive: true }, NOW)).toBe('scheduled');
    expect(campaignStatus({ startAt: win.startAt, endAt: NOW, isActive: true }, NOW)).toBe('ended');
    expect(campaignStatus({ startAt: NOW, endAt: win.endAt, isActive: true }, NOW)).toBe('live');
  });
});
