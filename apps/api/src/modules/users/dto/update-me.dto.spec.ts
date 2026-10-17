import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateMeDto } from './update-me.dto';

const errorsOf = (body: object) => validateSync(plainToInstance(UpdateMeDto, body)).map((e) => e.property);

// Ảnh đại diện chỉ lưu URL (Cloudinary/Zalo), không lưu base64 trong hồ sơ: avatarUrl hiện ở nhiều danh sách (feed, bảng xếp
// hạng, bình luận) nên ảnh nhúng sẽ phình mọi JSON đó.
describe('UpdateMeDto.avatarUrl', () => {
  it('nhận URL https', () => {
    expect(errorsOf({ avatarUrl: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg' })).toEqual([]);
  });

  it.each([
    'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    'data:image/png;base64,iVBORw0KGgo=',
    'javascript:alert(1)',
    '/relative/avatar.png',
    'avatar.png',
  ])('từ chối %s', (avatarUrl) => {
    expect(errorsOf({ avatarUrl })).toEqual(['avatarUrl']);
  });

  it('từ chối URL quá dài (trần 1000 ký tự)', () => {
    expect(errorsOf({ avatarUrl: `https://res.cloudinary.com/${'a'.repeat(1000)}.jpg` })).toEqual(['avatarUrl']);
  });
});
