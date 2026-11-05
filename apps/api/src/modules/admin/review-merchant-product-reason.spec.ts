import 'reflect-metadata';
import { createValidationPipe } from '../../common/validation-pipe';
import { SetCampaignCouponsDto } from '../campaigns/dto/campaign.dto';
import { ReviewMerchantProductDto } from './admin.controller';

const pipe = createValidationPipe();
const run = (metatype: new () => object, value: Record<string, unknown>) => pipe.transform(value, { type: 'body', metatype, data: undefined });

describe('ReviewMerchantProductDto.rejectReason', () => {
  it('lý do dài vừa phải được cắt khoảng trắng đầu cuối', async () => {
    await expect(run(ReviewMerchantProductDto, { approve: false, rejectReason: '  Ảnh mờ  ' })).resolves.toMatchObject({ rejectReason: 'Ảnh mờ' });
  });

  it('tối đa 500 ký tự (sau khi cắt), quá thì 400 tiếng Việt', async () => {
    await expect(run(ReviewMerchantProductDto, { approve: false, rejectReason: 'a'.repeat(500) })).resolves.toBeDefined();
    await expect(run(ReviewMerchantProductDto, { approve: false, rejectReason: 'a'.repeat(501) })).rejects.toMatchObject({
      response: { message: ['Lý do từ chối không được dài quá 500 ký tự.'] },
    });
  });
});

describe('SetCampaignCouponsDto.codes', () => {
  it('mỗi mã tối đa 64 ký tự, khớp trần mã giảm giá', async () => {
    await expect(run(SetCampaignCouponsDto, { codes: ['A'.repeat(64)] })).resolves.toBeDefined();
    await expect(run(SetCampaignCouponsDto, { codes: ['OK', 'A'.repeat(65)] })).rejects.toMatchObject({
      response: { message: [expect.stringContaining('không được dài quá 64 ký tự')] },
    });
  });
});
