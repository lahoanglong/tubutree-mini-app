import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RewardsLayout, { metadata } from './layout';
import { metadata as myRewardsMeta } from './cua-toi/layout';

describe('/kho-qua (layout)', () => {
  it('trang Kho quà công khai cho phép lập chỉ mục, còn /kho-qua/cua-toi cá nhân vẫn noindex', () => {
    expect(metadata.robots).toBeUndefined();
    expect(myRewardsMeta.robots).toEqual({ index: false, follow: false });
  });

  it('rời khung Tài khoản: layout trả nguyên children (chỉ thêm khối JSON-LD của landing), không thanh menu dọc bao ngoài', () => {
    const markup = renderToStaticMarkup(<RewardsLayout><i id="x" /></RewardsLayout>);
    expect(markup.startsWith('<i id="x"></i><script type="application/ld+json">')).toBe(true);
    expect(markup.replace(/<script type="application\/ld\+json">[\s\S]*<\/script>$/, '')).toBe('<i id="x"></i>');
  });
});
