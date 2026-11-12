import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COPY_DRAFT_MAX_BATCH } from '@tubutree/shared-types';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { CatalogAuditService } from './catalog-audit.service';
import { CatalogQualityController, CopyApproveDto, CopyDraftsDto } from './catalog-quality.controller';
import type { CopyApproveService } from './copy-approve.service';
import type { CopyDraftService } from './copy-draft.service';

const errs = (cls: new () => object, body: object) => validate(plainToInstance(cls, body));
const approveItem = (id: string, over: object = {}) => ({ id, shortDesc: 'ngắn', description: 'Mô tả', ingredients: ['Bơ'], ...over });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('DTO copy-drafts', () => {
  it(`ids: 1..${COPY_DRAFT_MAX_BATCH} chuỗi không rỗng, không trùng`, async () => {
    expect(await errs(CopyDraftsDto, { ids: ['a'] })).toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: ids(COPY_DRAFT_MAX_BATCH) })).toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: [] })).not.toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: ids(COPY_DRAFT_MAX_BATCH + 1) })).not.toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: ['a', 'a'] })).not.toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: [''] })).not.toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: [1] })).not.toHaveLength(0);
    expect(await errs(CopyDraftsDto, { ids: 'a' })).not.toHaveLength(0);
    expect(await errs(CopyDraftsDto, {})).not.toHaveLength(0);
  });
});

describe('DTO copy-approve', () => {
  it(`items: 1..${COPY_DRAFT_MAX_BATCH} mục đúng dạng, id không trùng`, async () => {
    expect(await errs(CopyApproveDto, { items: [approveItem('a')] })).toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: ids(COPY_DRAFT_MAX_BATCH).map((i) => approveItem(i)) })).toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: ids(COPY_DRAFT_MAX_BATCH + 1).map((i) => approveItem(i)) })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a'), approveItem('a')] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, {})).not.toHaveLength(0);
  });

  it('phần tử null hay không phải đối tượng trong items: lỗi xác thực (400), không ném TypeError (500)', async () => {
    for (const items of [[null], [undefined], [approveItem('a'), null], ['a'], [5], [[]]]) {
      await expect(errs(CopyApproveDto, { items })).resolves.not.toHaveLength(0);
    }
  });

  it('items: [null] đi qua ValidationPipe thật thành BadRequestException', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(pipe.transform({ items: [null] }, { type: 'body', metatype: CopyApproveDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ items: [approveItem('a'), null] }, { type: 'body', metatype: CopyApproveDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ items: [approveItem('a')] }, { type: 'body', metatype: CopyApproveDto })).resolves.toBeInstanceOf(CopyApproveDto);
  });

  it('mục thiếu hay sai kiểu bị 400; chữ rỗng thì qua DTO (service từ chối riêng mục đó)', async () => {
    expect(await errs(CopyApproveDto, { items: [{ id: 'a', description: 'x', ingredients: [] }] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { ingredients: 'Bơ' })] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { ingredients: [3] })] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { id: '' })] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { description: '', shortDesc: '', ingredients: [] })] })).toHaveLength(0);
  });

  it('trần thô chặn thân quá lớn nhưng không chặn mục vượt trần nội dung (140/800/8/80) để service nêu lý do', async () => {
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { description: 'x'.repeat(900), shortDesc: 'y'.repeat(200), ingredients: ids(12) })] })).toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { description: 'x'.repeat(6001) })] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { shortDesc: 'y'.repeat(401) })] })).not.toHaveLength(0);
    expect(await errs(CopyApproveDto, { items: [approveItem('a', { ingredients: ids(21) })] })).not.toHaveLength(0);
  });

  it('chữ được cắt khoảng trắng và ký tự vô hình hai đầu', () => {
    const dto = plainToInstance(CopyApproveDto, { items: [approveItem('a', { description: '\u200b  Mô tả \u200b', ingredients: [' Bơ '] })] });
    expect(dto.items[0]!.description).toBe('Mô tả');
    expect(dto.items[0]!.ingredients).toEqual(['Bơ']);
  });
});

describe('CatalogQualityController', () => {
  const audit = { audit: jest.fn().mockResolvedValue({ products: [], truncated: false }) };
  const drafts = { generate: jest.fn().mockResolvedValue({ drafts: [], failed: [] }) };
  const approval = { approve: jest.fn().mockResolvedValue({ saved: [], rejected: [] }) };
  const ctrl = new CatalogQualityController(audit as unknown as CatalogAuditService, drafts as unknown as CopyDraftService, approval as unknown as CopyApproveService);

  it('chỉ ADMIN, prefix admin/catalog-quality (không dưới admin/catalog-products/:id)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CatalogQualityController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata('path', CatalogQualityController)).toBe('admin/catalog-quality');
    const proto = CatalogQualityController.prototype;
    expect(Reflect.getMetadata('path', proto.getAudit)).toBe('audit');
    expect(Reflect.getMetadata('path', proto.getPancakeZeroPrice)).toBe('pancake-zero-price');
    expect(Reflect.getMetadata('path', proto.copyDrafts)).toBe('copy-drafts');
    expect(Reflect.getMetadata('path', proto.copyApprove)).toBe('copy-approve');
  });

  it('copy-drafts giới hạn 6 lượt mỗi phút (gọi AI trả phí)', () => {
    const proto = CatalogQualityController.prototype;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.copyDrafts)).toBe(6);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto.copyDrafts)).toBe(60_000);
  });

  it('chuyển ids, items và id admin cho service', async () => {
    await ctrl.getAudit();
    await ctrl.copyDrafts({ ids: ['a'] });
    await ctrl.copyApprove('admin1', { items: [approveItem('a')] });
    expect(audit.audit).toHaveBeenCalledTimes(1);
    expect(drafts.generate).toHaveBeenCalledWith(['a']);
    expect(approval.approve).toHaveBeenCalledWith('admin1', [approveItem('a')]);
  });
});
