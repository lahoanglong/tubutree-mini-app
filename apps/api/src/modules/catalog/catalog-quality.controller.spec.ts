import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COPY_DRAFT_MAX_BATCH } from '@tubutree/shared-types';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { CatalogAuditService } from './catalog-audit.service';
import { CatalogQualityController, CopyApproveDto, CopyDraftsDto, ExtractIngredientsDto, INGREDIENT_IMAGE_DTO_MAX, SaveIngredientsDto, SeoApplyDto } from './catalog-quality.controller';
import type { CopyApproveService } from './copy-approve.service';
import type { CopyDraftService } from './copy-draft.service';
import type { IngredientEnrichService } from './ingredient-enrich.service';
import { SEO_APPLY_MAX_BATCH, SEO_DESC_MAX, SEO_TITLE_MAX, type SeoEnrichService } from './seo-enrich.service';
import { OCR_IMAGE_MAX_BYTES } from '../ai-advisor/ingredient-ocr';

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
  const enrich = {
    extract: jest.fn().mockResolvedValue({ id: 'p1', readable: true, ingredients: [], warnings: [] }),
    save: jest.fn().mockResolvedValue({ id: 'p1', ingredients: [], added: 0 }),
  };
  const seo = {
    list: jest.fn().mockResolvedValue({ rows: [], total: 0, missing: 0, truncated: false }),
    apply: jest.fn().mockResolvedValue({ updated: 1, skippedIds: [] }),
  };
  const ctrl = new CatalogQualityController(
    audit as unknown as CatalogAuditService,
    drafts as unknown as CopyDraftService,
    approval as unknown as CopyApproveService,
    enrich as unknown as IngredientEnrichService,
    seo as unknown as SeoEnrichService,
  );

  it('chỉ ADMIN, prefix admin/catalog-quality (không dưới admin/catalog-products/:id)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CatalogQualityController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata('path', CatalogQualityController)).toBe('admin/catalog-quality');
    const proto = CatalogQualityController.prototype;
    expect(Reflect.getMetadata('path', proto.getAudit)).toBe('audit');
    expect(Reflect.getMetadata('path', proto.getPancakeZeroPrice)).toBe('pancake-zero-price');
    expect(Reflect.getMetadata('path', proto.copyDrafts)).toBe('copy-drafts');
    expect(Reflect.getMetadata('path', proto.copyApprove)).toBe('copy-approve');
    expect(Reflect.getMetadata('path', proto.extractIngredients)).toBe(':id/extract-ingredients');
    expect(Reflect.getMetadata('path', proto.saveIngredients)).toBe(':id/ingredients');
    expect(Reflect.getMetadata('path', proto.getSeo)).toBe('seo');
    expect(Reflect.getMetadata('path', proto.applySeo)).toBe('seo/apply');
  });

  it('route SEO không đè route theo id (`seo/apply` không khớp `:id/ingredients` hay `:id/extract-ingredients`)', () => {
    const proto = CatalogQualityController.prototype;
    const paths = [proto.getSeo, proto.applySeo].map((h) => Reflect.getMetadata('path', h) as string);
    for (const p of paths) expect(p).not.toMatch(/^:id/);
  });

  it('chuyển id admin và các mục SEO cho SeoEnrichService', async () => {
    const items = [{ productId: 'a', metaTitle: 'T | Tubu Tree', metaDesc: 'Mô tả.' }];
    await ctrl.getSeo();
    await ctrl.applySeo('admin1', { items });
    expect(seo.list).toHaveBeenCalledTimes(1);
    expect(seo.apply).toHaveBeenCalledWith('admin1', items);
  });

  it('extract-ingredients giới hạn 10 lượt mỗi phút (gọi AI trả phí)', () => {
    const proto = CatalogQualityController.prototype;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.extractIngredients)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', proto.extractIngredients)).toBe(60_000);
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

  it('chuyển id sản phẩm, ảnh, tên thành phần và id admin cho IngredientEnrichService', async () => {
    await ctrl.extractIngredients('p1', { image: 'data:image/jpeg;base64,AAAA' });
    await ctrl.saveIngredients('admin1', 'p1', { ingredients: ['Đường'] });
    expect(enrich.extract).toHaveBeenCalledWith('p1', 'data:image/jpeg;base64,AAAA');
    expect(enrich.save).toHaveBeenCalledWith('admin1', 'p1', ['Đường']);
  });
});

describe('DTO extract-ingredients', () => {
  it('image: chuỗi, không rỗng, không vượt trần thô (đủ cho ảnh 5 MB sau base64)', async () => {
    expect(await errs(ExtractIngredientsDto, { image: 'data:image/jpeg;base64,AAAA' })).toHaveLength(0);
    expect(await errs(ExtractIngredientsDto, { image: '' })).not.toHaveLength(0);
    expect(await errs(ExtractIngredientsDto, { image: 12 })).not.toHaveLength(0);
    expect(await errs(ExtractIngredientsDto, {})).not.toHaveLength(0);
    expect(await errs(ExtractIngredientsDto, { image: 'x'.repeat(INGREDIENT_IMAGE_DTO_MAX + 1) })).not.toHaveLength(0);
    expect(await errs(ExtractIngredientsDto, { image: 'x'.repeat(INGREDIENT_IMAGE_DTO_MAX) })).toHaveLength(0);
  });

  it('trần thô đủ chứa ảnh đúng trần OCR_IMAGE_MAX_BYTES đã mã hoá base64 kèm tiền tố data URL', () => {
    const base64Chars = Math.ceil(OCR_IMAGE_MAX_BYTES / 3) * 4;
    expect(INGREDIENT_IMAGE_DTO_MAX).toBeGreaterThanOrEqual(base64Chars + 'data:image/jpeg;base64,'.length);
  });
});

describe('DTO seo-apply', () => {
  const seoItem = (id: string, over: object = {}) => ({ productId: id, metaTitle: 'Tiêu đề | Tubu Tree', metaDesc: 'Mô tả ngắn.', ...over });

  it(`items: 1..${SEO_APPLY_MAX_BATCH} mục đúng dạng, productId không trùng`, async () => {
    expect(await errs(SeoApplyDto, { items: [seoItem('a')] })).toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: ids(SEO_APPLY_MAX_BATCH).map((i) => seoItem(i)) })).toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [] })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: ids(SEO_APPLY_MAX_BATCH + 1).map((i) => seoItem(i)) })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [seoItem('a'), seoItem('a')] })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, {})).not.toHaveLength(0);
  });

  it('phần tử null hay không phải đối tượng: lỗi xác thực (400), không ném TypeError (500)', async () => {
    for (const items of [[null], [undefined], [seoItem('a'), null], ['a'], [5], [[]]]) {
      await expect(errs(SeoApplyDto, { items })).resolves.not.toHaveLength(0);
    }
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(pipe.transform({ items: [null] }, { type: 'body', metatype: SeoApplyDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ items: [seoItem('a')] }, { type: 'body', metatype: SeoApplyDto })).resolves.toBeInstanceOf(SeoApplyDto);
  });

  it('mục thiếu trường, sai kiểu hay productId rỗng bị 400; chữ rỗng hoặc vượt trần nội dung vẫn qua DTO (service nêu lý do từng mục)', async () => {
    expect(await errs(SeoApplyDto, { items: [{ productId: 'a', metaTitle: 'T' }] })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [seoItem('a', { metaTitle: 5 })] })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [seoItem('a', { productId: '' })] })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [seoItem('a', { metaTitle: '', metaDesc: '' })] })).toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [seoItem('a', { metaTitle: 'T'.repeat(SEO_TITLE_MAX + 20), metaDesc: 'D'.repeat(SEO_DESC_MAX + 50) })] })).toHaveLength(0);
  });

  it('trần thô chặn chuỗi khổng lồ', async () => {
    expect(await errs(SeoApplyDto, { items: [seoItem('a', { metaTitle: 'T'.repeat(401) })] })).not.toHaveLength(0);
    expect(await errs(SeoApplyDto, { items: [seoItem('a', { metaDesc: 'D'.repeat(1001) })] })).not.toHaveLength(0);
  });

  it('chữ được cắt khoảng trắng và ký tự vô hình hai đầu', () => {
    const dto = plainToInstance(SeoApplyDto, { items: [seoItem('a', { metaTitle: '​  Tiêu đề ​', metaDesc: ' Mô tả ' })] });
    expect(dto.items[0]!.metaTitle).toBe('Tiêu đề');
    expect(dto.items[0]!.metaDesc).toBe('Mô tả');
  });
});

describe('DTO save-ingredients', () => {
  it('ingredients: 1..20 chuỗi, mỗi chuỗi tối đa 200 ký tự; chữ được cắt khoảng trắng', async () => {
    expect(await errs(SaveIngredientsDto, { ingredients: ['Đường'] })).toHaveLength(0);
    expect(await errs(SaveIngredientsDto, { ingredients: ids(20) })).toHaveLength(0);
    expect(await errs(SaveIngredientsDto, { ingredients: ids(21) })).not.toHaveLength(0);
    expect(await errs(SaveIngredientsDto, { ingredients: [] })).not.toHaveLength(0);
    expect(await errs(SaveIngredientsDto, { ingredients: 'Đường' })).not.toHaveLength(0);
    expect(await errs(SaveIngredientsDto, { ingredients: [3] })).not.toHaveLength(0);
    expect(await errs(SaveIngredientsDto, { ingredients: ['x'.repeat(201)] })).not.toHaveLength(0);
    expect(await errs(SaveIngredientsDto, {})).not.toHaveLength(0);
    expect(plainToInstance(SaveIngredientsDto, { ingredients: ['\u200b  Đường \u200b'] }).ingredients).toEqual(['Đường']);
  });
});
