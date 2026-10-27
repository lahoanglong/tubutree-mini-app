import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCourseDto, UpdateCourseDto } from './academy.dto';

const errors = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('Ảnh bìa khoá học', () => {
  it.each(['https://res.cloudinary.com/x/cover.jpg', 'https://cdn.example.com/a.png', PNG, ''])('nhận %p', async (coverUrl) => {
    expect(await errors(CreateCourseDto, { title: 'Bán hàng', coverUrl })).toHaveLength(0);
    expect(await errors(UpdateCourseDto, { coverUrl })).toHaveLength(0);
  });

  it.each(['javascript:alert(1)', 'http://x/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'khong-phai-link'])(
    'từ chối %p',
    async (coverUrl) => {
      expect(await errors(CreateCourseDto, { title: 'Bán hàng', coverUrl })).not.toHaveLength(0);
      expect(await errors(UpdateCourseDto, { coverUrl })).not.toHaveLength(0);
    },
  );
});
