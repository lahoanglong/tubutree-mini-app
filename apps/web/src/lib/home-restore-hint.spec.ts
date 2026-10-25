import { describe, expect, it } from 'vitest';
import { HOME_HINT_SLUGS, hintOfSlug, hintSlug, parseHintSlug } from './home-restore-hint';

describe('gợi ý bố cục Trang chủ cho khách đã có phiên', () => {
  it('slug khứ hồi cho mọi gợi ý hợp lệ', () => {
    for (const slug of HOME_HINT_SLUGS) expect(hintSlug(hintOfSlug(slug))).toBe(slug);
  });

  it('khách cũ mang số dòng Việc cần làm; khách mới và chưa biết thì không', () => {
    expect(hintSlug({ kind: 'returning', rows: 2 })).toBe('returning-2');
    expect(hintSlug({ kind: 'new', rows: 2 })).toBe('new');
    expect(hintOfSlug('returning-1')).toEqual({ kind: 'returning', rows: 1 });
    expect(hintOfSlug('unknown')).toEqual({ kind: 'unknown', rows: 0 });
  });

  it('giá trị lạ, rỗng hoặc cố đi ra ngoài đường dẫn đều về unknown', () => {
    for (const raw of [undefined, null, '', 'returning-9', '../x', 'RETURNING-1', 'returning-1/../']) expect(parseHintSlug(raw)).toBe('unknown');
  });
});
