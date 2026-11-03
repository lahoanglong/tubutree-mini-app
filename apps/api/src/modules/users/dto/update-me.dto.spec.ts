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

  // BAOMAT-05: trước đây nhận mọi host (kể cả http://169.254.169.254/).
  it.each([
    'https://s120-ava-talk.zadn.vn/a/b/c/1234.jpg',
    'https://zalo-api.zadn.vn/avatar.png',
    'https://s75-ava-talk.zdn.vn/x.jpg',
  ])('nhận ảnh đại diện Zalo %s', (avatarUrl) => {
    expect(errorsOf({ avatarUrl })).toEqual([]);
  });

  it.each([
    'https://evil.example/a.png',
    'http://169.254.169.254/',
    'http://res.cloudinary.com/demo/a.jpg',
    'https://res.cloudinary.com.evil.example/a.jpg',
    'https://evilzadn.vn/a.jpg',
    'https://user:pass@res.cloudinary.com/a.jpg',
    'https://zadn.vn.evil.example/a.jpg',
  ])('từ chối host ngoài danh sách %s', (avatarUrl) => {
    expect(errorsOf({ avatarUrl })).toEqual(['avatarUrl']);
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

// BAOMAT-09: `<` `>` được kiểm ở UsersService.updateMe (chỉ khi tên đổi), xem users.service.spec.ts.
describe('UpdateMeDto.fullName', () => {
  it('nhận tên có dấu, dấu nháy và dấu gạch; vẫn nhận tên Zalo có < để service so với tên đang lưu', () => {
    expect(errorsOf({ fullName: "Lã Hoàng Long O'Neil-Trần" })).toEqual([]);
    expect(errorsOf({ fullName: 'Hoa <3' })).toEqual([]);
  });
  it('từ chối tên quá 120 ký tự', () => {
    expect(errorsOf({ fullName: 'a'.repeat(121) })).toEqual(['fullName']);
  });
});
