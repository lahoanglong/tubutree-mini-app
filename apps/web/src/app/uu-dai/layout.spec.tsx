import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OffersLayout, { metadata } from './layout';

describe('/uu-dai (layout)', () => {
  it('noindex + nofollow: vẫn Disallow trong robots như trước khi mở cho khách chưa đăng nhập', () => {
    expect(metadata.title).toBe('Ưu đãi — Tubu Tree');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });

  it('rời khung Tài khoản: layout trả nguyên children, không thanh menu bao ngoài', () => {
    expect(renderToStaticMarkup(<OffersLayout><i id="x" /></OffersLayout>)).toBe('<i id="x"></i>');
  });
});
