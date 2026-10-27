import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBrandDto, UpdateBrandDto, UpdateOwnedBrandDto } from './brand.dto';

const errors = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CLASSES = [CreateBrandDto, UpdateBrandDto, UpdateOwnedBrandDto];

describe('Logo và ảnh bìa nhãn hàng', () => {
  it.each(['https://res.cloudinary.com/x/logo.jpg', PNG])('nhận %p ở cả ba DTO, cả logoUrl lẫn coverUrl', async (v) => {
    for (const cls of CLASSES) {
      expect(await errors(cls, { name: 'Nhãn', logoUrl: v, coverUrl: v })).toHaveLength(0);
    }
  });

  it.each(['javascript:alert(1)', 'http://x/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', '/public-image/brand/b/logo?v=x'])(
    'từ chối %p ở cả ba DTO',
    async (v) => {
      for (const cls of CLASSES) {
        expect(await errors(cls, { name: 'Nhãn', logoUrl: v })).not.toHaveLength(0);
        expect(await errors(cls, { name: 'Nhãn', coverUrl: v })).not.toHaveLength(0);
      }
    },
  );
});
