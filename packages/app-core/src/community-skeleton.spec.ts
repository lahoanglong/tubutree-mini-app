import { describe, expect, it } from 'vitest';
import { POST_CARD_SKELETON, POST_CARD_SKELETON_COUNT, POST_CARD_SKELETON_LINES } from './community-skeleton';

describe('khung chờ thẻ bài đăng: số đo dùng chung Mini và web', () => {
  it('nội dung dựng bên trong (đầu bài, tiêu đề, dòng chữ, các khe) nằm gọn trong chiều cao đã chốt', () => {
    const m = POST_CARD_SKELETON;
    const rows = [m.avatar, m.title, ...Array.from({ length: POST_CARD_SKELETON_LINES.length }, () => m.line)];
    const content = rows.reduce((a, b) => a + b, 0) + (rows.length - 1) * m.gap;
    expect(content + 2 * m.inset).toBeLessThanOrEqual(m.height);
  });

  it('hai dòng chữ cạnh ảnh đại diện (tên và giờ đăng) không cao hơn ảnh', () => {
    const m = POST_CARD_SKELETON;
    expect(m.author + m.tight + m.meta).toBeLessThanOrEqual(m.avatar);
  });

  it('chiều cao gần thẻ thật đo ở 375px (176px web, 180px Mini): lệch không quá 16px như e2e buy-flow-4b', () => {
    expect(Math.abs(POST_CARD_SKELETON.height - 178)).toBeLessThanOrEqual(16);
  });

  it('đủ 3 thẻ để lấp màn điện thoại mà không dài hơn danh sách thật', () => {
    expect(POST_CARD_SKELETON_COUNT).toBe(3);
  });
});
