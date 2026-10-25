// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorefrontOgCard } from './og-card';

const data = { name: 'Góc Mẹ Bỉm Lá', avatar: null, thumbnails: [], color: '#16a34a' };
const images = { avatar: null, thumbnails: [] };

describe('StorefrontOgCard', () => {
  it('gian hàng mẫu có nhãn "Gian hàng mẫu" trên ảnh; gian hàng thật không', () => {
    expect(renderToStaticMarkup(<StorefrontOgCard data={{ ...data, isSample: true }} images={images} />)).toContain('Gian hàng mẫu');
    expect(renderToStaticMarkup(<StorefrontOgCard data={{ ...data, isSample: false }} images={images} />)).not.toContain('Gian hàng mẫu');
  });
});
