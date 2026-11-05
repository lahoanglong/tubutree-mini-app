import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { createValidationPipe } from './validation-pipe';
import { CreateAddressDto } from '../modules/users/dto/address.dto';
import { PlaceOrderDto } from '../modules/checkout/dto/checkout.dto';
import { CreatePostDto } from '../modules/feed/community-feed.controller';
import { CreateReviewDto } from '../modules/reviews/dto/review.dto';
import { ProductQuery } from '../modules/catalog/dto/product-query.dto';
import { SuggestQuery } from '../modules/catalog/dto/suggest-query.dto';
import { ApplyDealerDto } from '../modules/dealer/dto/dealer.dto';
import { SendMessageDto } from '../modules/support-chat/dto/send-message.dto';
import { ApplyCouponDto } from '../modules/cart/dto/cart.dto';
import { UpsertContentKitDto } from '../modules/content-kit/dto/content-kit.dto';
import { ZaloMiniAppLoginDto } from '../modules/auth/dto/zalo-login.dto';
import { EnsurePhoneDto } from '../modules/auth/dto/ensure-phone.dto';
import { RefreshTokenDto } from '../modules/auth/dto/refresh.dto';

/**
 * Trim hai đầu (cả ký tự vô hình) chạy qua ValidationPipe thật của API cho chữ tự do khách/admin gõ. Không áp cho: mật khẩu,
 * token, secret, chữ ký, OTP thô, payload webhook ngoài (Pancake, Zalo, ngân hàng, cổng thanh toán), data URL/base64, id/cuid,
 * enum. Nhóm "không đụng" ở cuối kiểm các trường token/code của đăng nhập giữ nguyên văn.
 */
const pipe = createValidationPipe();
const run = <T>(type: new () => T, body: Record<string, unknown>, kind: ArgumentMetadata['type'] = 'body') =>
  pipe.transform(body, { type: kind, metatype: type } as ArgumentMetadata) as Promise<T>;
const messageOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? String(e));
  }
};

const ZW = '\u200b';
const NBSP = '\u00a0';

describe('Trim qua ValidationPipe: chữ tự do', () => {
  it('địa chỉ: tên người nhận, SĐT, phường, đường bị cắt NBSP/U+200B hai đầu; mã địa giới giữ nguyên', async () => {
    const dto = await run(CreateAddressDto, {
      recipient: `${NBSP}Nguyễn Văn A${ZW}`,
      phone: `${ZW}0912345678${NBSP}`,
      province: ' Hà Nội ',
      district: '',
      ward: `${ZW}Phường 1`,
      street: ` 1 Lê Lợi${ZW}`,
      provinceCode: '84_VN01',
      districtCode: '',
      wardCode: '84_VN01_001',
    });
    expect(dto).toMatchObject({ recipient: 'Nguyễn Văn A', phone: '0912345678', province: 'Hà Nội', ward: 'Phường 1', street: '1 Lê Lợi' });
  });

  it('đặt hàng: ghi chú và hoá đơn (MST có NBSP đuôi qua kiểm mẫu, công ty, email) được cắt; addressId không bị đụng', async () => {
    const dto = await run(PlaceOrderDto, {
      addressId: 'addr1',
      paymentMethod: 'COD',
      note: `${ZW} giao giờ hành chính ${NBSP}`,
      referralCode: ' ABC123 ',
      invoiceRequest: { taxCode: `0312345678${NBSP}`, companyName: ` Công ty Tubu${ZW}`, address: ' 1 Lê Lợi ', email: ' ketoan@tubu.vn ' },
    });
    expect(dto.note).toBe('giao giờ hành chính');
    expect(dto.referralCode).toBe('ABC123');
    expect(dto.invoiceRequest).toMatchObject({ taxCode: '0312345678', companyName: 'Công ty Tubu', address: '1 Lê Lợi', email: 'ketoan@tubu.vn' });
  });

  it('bài đăng chỉ có ký tự vô hình bị chặn ở MinLength, tiêu đề được cắt, emoji ghép giữa bài giữ nguyên', async () => {
    expect(await messageOf(run(CreatePostDto, { body: `${ZW}${ZW}` }))).toContain('Nội dung phải có ít nhất 1 ký tự');
    const family = '👨‍👩‍👧';
    const dto = await run(CreatePostDto, { title: ` ${family} `, body: `${ZW} Cả nhà ${family} ${NBSP}` });
    expect(dto.title).toBe(family);
    expect(dto.body).toBe(`Cả nhà ${family}`);
  });

  it('đánh giá: bình luận được cắt; ô tìm kiếm q của sản phẩm và gợi ý được cắt rồi mới cắt theo trần', async () => {
    expect((await run(CreateReviewDto, { rating: 5, comment: `${ZW}  Rất tốt ${NBSP}` })).comment).toBe('Rất tốt');
    expect((await run(ProductQuery, { q: `${ZW}  sữa hạt  ` }, 'query')).q).toBe('sữa hạt');
    expect((await run(SuggestQuery, { q: `${NBSP}trà${ZW}` }, 'query')).q).toBe('trà');
  });

  it('mã giảm giá trong giỏ, tin nhắn CSKH, đại lý được cắt', async () => {
    expect((await run(ApplyCouponDto, { code: ` TUBU10${ZW}` })).code).toBe('TUBU10');
    const chat = await run(SendMessageDto, { clientMsgId: 'c-1234567', body: `${ZW}Xin chào ${NBSP}`, context: { orderCode: ' TT123 ' } });
    expect(chat.body).toBe('Xin chào');
    expect(chat.context?.orderCode).toBe('TT123');
    const dealer = plainToInstance(ApplyDealerDto, { businessName: ` Đại lý A${ZW}`, ownerName: ' Trần B ', address: ` 2 Nguyễn Huệ${NBSP}`, notes: `${ZW}ghi chú ` });
    expect(dealer).toMatchObject({ businessName: 'Đại lý A', ownerName: 'Trần B', address: '2 Nguyễn Huệ', notes: 'ghi chú' });
  });

  it('bộ nội dung CTV: mảng chuỗi cắt từng phần tử, FAQ q/a cắt hai đầu', async () => {
    const dto = await run(UpsertContentKitDto, { captions: [` a${ZW}`], usps: [`${NBSP}b`], videoUrls: [' https://v.vn/1 '], faqs: [{ q: ` q${ZW}`, a: ` a${NBSP}` }] });
    expect(dto).toMatchObject({ captions: ['a'], usps: ['b'], videoUrls: ['https://v.vn/1'], faqs: [{ q: 'q', a: 'a' }] });
  });
});

describe('Trim KHÔNG áp cho token, code OAuth, refresh token (đi nguyên văn tới nơi so khớp)', () => {
  it('ZaloMiniAppLoginDto: code, accessToken, phoneToken giữ nguyên khoảng trắng; referralCode (chữ người dùng) được cắt', async () => {
    const dto = await run(ZaloMiniAppLoginDto, { code: ` c${ZW}`, accessToken: ` t${NBSP}`, phoneToken: ' p ', referralCode: ` REF${ZW}`, firstTouch: { source: 'x' } });
    expect(dto).toMatchObject({ code: ` c${ZW}`, accessToken: ` t${NBSP}`, phoneToken: ' p ', referralCode: 'REF' });
  });

  it('EnsurePhoneDto và RefreshTokenDto giữ nguyên chuỗi', async () => {
    expect(await run(EnsurePhoneDto, { code: ' c ', accessToken: ' a ', phoneToken: ' p ' })).toMatchObject({ code: ' c ', accessToken: ' a ', phoneToken: ' p ' });
    expect((await run(RefreshTokenDto, { refreshToken: ` r${ZW}` })).refreshToken).toBe(` r${ZW}`);
  });
});
