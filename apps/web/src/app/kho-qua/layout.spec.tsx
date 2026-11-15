import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RewardsLayout, { metadata } from './layout';

describe('/kho-qua (layout)', () => {
  it('noindex + nofollow bằng meta', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('rời khung Tài khoản: layout trả nguyên children, không thanh menu dọc bao ngoài', () => {
    expect(renderToStaticMarkup(<RewardsLayout><i id="x" /></RewardsLayout>)).toBe('<i id="x"></i>');
  });
});
