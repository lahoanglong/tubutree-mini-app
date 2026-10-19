import 'reflect-metadata';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AcademyController } from '../academy/academy.controller';
import { ContentKitController } from '../content-kit/content-kit.controller';

/**
 * Màn CTV và trang sản phẩm miniapp hiện bộ nội dung bán hàng và Academy cho mọi tài khoản có isAffiliate, gồm đại lý còn gian
 * hàng CTV hoặc hoa hồng (D3-03). Hai controller phải cho vai trò DEALER vào, nếu không nút ở màn CTV trả 403. Quyền mở theo vai
 * trò, cho mọi đại lý (khớp D3-13): không route nào ở đây ghi vào sổ tiền.
 */
describe('Công cụ CTV mở cho đại lý (D3-03)', () => {
  it.each([
    ['content-kit', ContentKitController],
    ['academy', AcademyController],
  ])('%s: AFFILIATE, DEALER, STAFF, ADMIN', (_name, controller) => {
    expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual(expect.arrayContaining(['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN']));
  });

  it.each([
    ['content-kit', ContentKitController],
    ['academy', AcademyController],
  ])('%s: khách thường vẫn bị chặn', (_name, controller) => {
    expect(Reflect.getMetadata(ROLES_KEY, controller)).not.toContain('CUSTOMER');
  });
});
