import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCampaignDto, SetCampaignCouponsDto, SetCampaignProductsDto, UpdateCampaignDto } from './campaign.dto';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const ok = {
  title: 'Giữa Thu',
  placement: 'HOME_TOP',
  image: 'https://cdn.example.com/a.jpg',
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-11-11T16:59:59.000Z',
};
const errs = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));

describe('CreateCampaignDto', () => {
  it('hợp lệ với bản tối thiểu (link https hoặc ảnh PNG base64)', async () => {
    expect(await errs(CreateCampaignDto, ok)).toHaveLength(0);
    expect(await errs(CreateCampaignDto, { ...ok, image: PNG, audience: 'NEW', linkType: 'URL_INTERNAL', linkValue: '/offers', sortOrder: 3, isActive: false })).toHaveLength(0);
  });

  it.each([
    ['ảnh javascript:', { image: 'javascript:alert(1)' }],
    ['ảnh http (không mã hoá)', { image: 'http://cdn.example.com/a.jpg' }],
    ['ảnh SVG (chạy được script)', { image: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    ['ảnh rỗng', { image: '' }],
    ['ảnh quá dài', { image: `data:image/png;base64,${'A'.repeat(1_500_100)}` }],
    ['tên rỗng', { title: '   ' }],
    ['tên quá 120 ký tự', { title: 'x'.repeat(121) }],
    ['vị trí lạ', { placement: 'BROWSE_TOP' }],
    ['đối tượng lạ', { audience: 'VIP' }],
    ['slug có dấu và hoa', { slug: 'Chiến-Dịch' }],
    ['slug quá 80 ký tự', { slug: 'a'.repeat(81) }],
    ['ngày sai định dạng', { startAt: 'mai' }],
    ['thứ tự âm', { sortOrder: -1 }],
    ['loại đích lạ', { linkType: 'EXTERNAL' }],
  ])('chặn: %s', async (_name, patch) => {
    expect(await errs(CreateCampaignDto, { ...ok, ...patch })).not.toHaveLength(0);
  });
});

describe('UpdateCampaignDto', () => {
  it('toàn bộ trường tuỳ chọn, nhưng null không được là giá trị của cột không-null', async () => {
    expect(await errs(UpdateCampaignDto, {})).toHaveLength(0);
    expect(await errs(UpdateCampaignDto, { isActive: false })).toHaveLength(0);
    expect(await errs(UpdateCampaignDto, { subtitle: null })).toHaveLength(0);
    expect(await errs(UpdateCampaignDto, { title: null })).not.toHaveLength(0);
    expect(await errs(UpdateCampaignDto, { image: 'javascript:alert(1)' })).not.toHaveLength(0);
  });
  it('không nhận slug: đổi slug làm gãy mọi liên kết đã chia sẻ', async () => {
    const dto = plainToInstance(UpdateCampaignDto, { slug: 'moi' }) as unknown as Record<string, unknown>;
    expect(Object.keys(dto)).toContain('slug');
    expect(await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });
});

describe('Set*Dto', () => {
  it('sản phẩm tối đa 200, mã tối đa 10, đều là chuỗi', async () => {
    expect(await errs(SetCampaignProductsDto, { productIds: ['a', 'b'] })).toHaveLength(0);
    expect(await errs(SetCampaignProductsDto, { productIds: Array.from({ length: 201 }, (_, i) => `p${i}`) })).not.toHaveLength(0);
    expect(await errs(SetCampaignProductsDto, { productIds: [1] })).not.toHaveLength(0);
    expect(await errs(SetCampaignCouponsDto, { codes: ['THU10'] })).toHaveLength(0);
    expect(await errs(SetCampaignCouponsDto, { codes: Array.from({ length: 11 }, (_, i) => `M${i}`) })).not.toHaveLength(0);
  });
});
