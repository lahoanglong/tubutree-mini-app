import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MerchantController } from './merchant.controller';

/**
 * R5-PARTNER-6: mọi route của cổng /merchant được phân loại. Route trả đơn, đổi trả hay đối soát phải có mặt trong
 * test/integration-race/merchant-buyer-privacy.race-spec.ts (đối chiếu JSON với danh sách cấm: họ tên, SĐT, email, mã tài khoản,
 * tài khoản nhận hoàn của người mua). Thêm route mới mà không xếp vào đây thì spec này đỏ để người viết phải quyết định.
 */
const COVERED_BY_PRIVACY_WALK = [
  'GET orders',
  'PUT orders/:id/status',
  'GET fulfil-orders',
  'POST fulfil-orders/:id/accept',
  'POST fulfil-orders/:id/pack',
  'POST fulfil-orders/:id/ship',
  'POST fulfil-orders/:id/deliver',
  'POST fulfil-orders/:id/fail',
  'POST fulfil-orders/:id/cancel',
  'GET settlement',
  'GET returns',
  'POST returns/:id/received',
];

const NO_ORDER_OR_BUYER_DATA = [
  'GET store',
  'PUT store',
  'POST store/publish',
  'POST store/pause',
  'GET products',
  'POST products',
  'PATCH products/:id',
  'DELETE products/:id',
  'GET pancake-variations/:code',
  'POST resell-products',
  'DELETE resell-products/:productId',
];

describe('MerchantController — phân loại route theo dữ liệu người mua (R5-PARTNER-6)', () => {
  it('mọi route đều được xếp vào nhóm có đi qua bài đối chiếu riêng tư hoặc nhóm không có dữ liệu đơn', () => {
    const proto = MerchantController.prototype as unknown as Record<string, unknown>;
    const routes = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .map((name) => {
        const handler = proto[name] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        return method === undefined ? null : `${RequestMethod[method]} ${path}`;
      })
      .filter((r): r is string => r !== null)
      .sort();
    expect(routes).toEqual([...COVERED_BY_PRIVACY_WALK, ...NO_ORDER_OR_BUYER_DATA].sort());
  });
});
