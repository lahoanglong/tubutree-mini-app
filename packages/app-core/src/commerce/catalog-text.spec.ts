import { describe, expect, it } from 'vitest';
import { isBlankHtmlText } from './catalog-text';

describe('isBlankHtmlText', () => {
  it('rỗng, null, khoảng trắng và thẻ trống đều là trống', () => {
    for (const v of [null, undefined, '', '   ', '\n\t', '<p></p>', '<p><br/></p>', '<p>&nbsp;</p>']) expect(isBlankHtmlText(v)).toBe(true);
  });

  it('thực thể NBSP dạng số và ký tự rộng 0 cũng là trống (web vẽ ra trắng)', () => {
    for (const v of ['&#160;', '&#xa0;', '&#XA0;', '&#0160;', '<p>&#160;</p>', '\u00a0', '\u200b', '\u200c\u200d', '\ufeff', '<p>\u200b&nbsp;&#160;</p>']) {
      expect(isBlankHtmlText(v)).toBe(true);
    }
  });

  it('có chữ thật thì không trống, kể cả chữ bao quanh ký tự rộng 0', () => {
    for (const v of ['Rửa chén', '<p>Rửa chén</p>', '&nbsp;Rửa', '\u200bRửa\u200b', '&#7919;']) expect(isBlankHtmlText(v)).toBe(false);
  });
});
