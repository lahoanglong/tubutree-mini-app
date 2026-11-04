import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTaxCodeValid } from '@tubutree/app-core/commerce/tax-code';
import { INPUT_LIMITS, STAFF_REASON_MIN } from './input-limits';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

type Key = keyof typeof INPUT_LIMITS;
interface DtoRow { key: Key; file: string; cls: string; prop: string; uses: string[]; marker?: string }
interface RegexRow { key: Key; file: string; re: string; longest: string; uses: string[] }

const MA = 'apps/miniapp/src/';

/** Ô nhập → DTO nhận giá trị → `@MaxLength`. Thêm ô nhập mới thì thêm dòng ở đây. */
const DTO_ROWS: DtoRow[] = [
  { key: 'reviewComment', file: 'apps/api/src/modules/reviews/dto/review.dto.ts', cls: 'CreateReviewDto', prop: 'comment', uses: ['components/reviews-section.tsx'] },
  { key: 'dealerBusinessName', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'businessName', uses: ['pages/dealer.tsx'] },
  { key: 'dealerOwnerName', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'ownerName', uses: ['pages/dealer.tsx'] },
  { key: 'dealerPhone', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'phone', uses: ['pages/dealer.tsx'] },
  { key: 'dealerAddress', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'address', uses: ['pages/dealer.tsx'] },
  { key: 'dealerTemplateName', file: 'apps/api/src/modules/dealer/dealer.controller.ts', cls: 'SaveTemplateDto', prop: 'name', uses: ['pages/dealer.tsx'] },
  { key: 'addressRecipient', file: 'apps/api/src/modules/users/dto/address.dto.ts', cls: 'CreateAddressDto', prop: 'recipient', uses: ['components/address-form.tsx'], marker: 'ADDRESS_INPUT_LIMIT' },
  { key: 'addressPhone', file: 'apps/api/src/modules/users/dto/address.dto.ts', cls: 'CreateAddressDto', prop: 'phone', uses: ['components/address-form.tsx'], marker: 'ADDRESS_INPUT_LIMIT' },
  { key: 'addressStreet', file: 'apps/api/src/modules/users/dto/address.dto.ts', cls: 'CreateAddressDto', prop: 'street', uses: ['components/address-form.tsx'], marker: 'ADDRESS_INPUT_LIMIT' },
  { key: 'invoiceCompanyName', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', cls: 'InvoiceRequestDto', prop: 'companyName', uses: ['pages/checkout.tsx'] },
  { key: 'invoiceAddress', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', cls: 'InvoiceRequestDto', prop: 'address', uses: ['pages/checkout.tsx'] },
  { key: 'invoiceEmail', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', cls: 'InvoiceRequestDto', prop: 'email', uses: ['pages/checkout.tsx'] },
  { key: 'storefrontTitle', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'title', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'storefrontWarehouseAddress', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'warehouseAddress', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'storefrontWarehouseCity', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'warehouseCity', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'storefrontWarehousePhone', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'warehousePhone', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'collectionTitle', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateCollectionDto', prop: 'title', uses: ['pages/storefront-builder.tsx'] },
  { key: 'brandTagline', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'UpdateOwnedBrandDto', prop: 'tagline', uses: ['pages/brand-owner.tsx'] },
  { key: 'brandOrigin', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'UpdateOwnedBrandDto', prop: 'origin', uses: ['pages/brand-owner.tsx'] },
  { key: 'brandStory', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'UpdateOwnedBrandDto', prop: 'story', uses: ['pages/brand-owner.tsx'] },
  { key: 'promoTitle', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'PromotionDto', prop: 'title', uses: ['pages/brand-owner.tsx'] },
  { key: 'promoSubtitle', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'PromotionDto', prop: 'subtitle', uses: ['pages/brand-owner.tsx'] },
  { key: 'promoCouponCode', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'PromotionDto', prop: 'couponCode', uses: ['pages/brand-owner.tsx'] },
  { key: 'shiftTemplateName', file: 'apps/api/src/modules/staff/shifts/dto/shift.dto.ts', cls: 'ShiftTemplateDto', prop: 'name', uses: ['pages/admin.tsx'] },
  { key: 'shiftRejectReason', file: 'apps/api/src/modules/staff/shifts/dto/shift.dto.ts', cls: 'RejectShiftDto', prop: 'reason', uses: ['pages/admin.tsx'] },
  { key: 'shiftCancelReason', file: 'apps/api/src/modules/staff/shifts/dto/shift.dto.ts', cls: 'CancelShiftDto', prop: 'reason', uses: ['pages/staff.tsx'] },
  { key: 'payrollNote', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'MarkPaidDto', prop: 'note', uses: ['pages/admin.tsx'] },
  { key: 'bankAccountNo', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'UpdateBankDto', prop: 'bankAccountNo', uses: ['pages/my-payroll.tsx'] },
  { key: 'bankAccountName', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'UpdateBankDto', prop: 'bankAccountName', uses: ['pages/my-payroll.tsx'] },
  { key: 'recycleCarrier', file: 'apps/api/src/modules/waste-exchange/customer/waste-customer.controller.ts', cls: 'WasteTrackingDto', prop: 'carrier', uses: ['pages/recycle-request.tsx'] },
  { key: 'recycleTrackingCode', file: 'apps/api/src/modules/waste-exchange/customer/waste-customer.controller.ts', cls: 'WasteTrackingDto', prop: 'trackingCode', uses: ['pages/recycle-request.tsx'] },
  { key: 'recycleDeskCode', file: 'apps/api/src/modules/waste-exchange/receiving/waste-admin-requests.controller.ts', cls: 'WasteLookupQueryDto', prop: 'code', uses: ['pages/recycle-desk.tsx'] },
  { key: 'recycleRejectNote', file: 'apps/api/src/modules/waste-exchange/receiving/waste-receiving.dto.ts', cls: 'WasteRejectDto', prop: 'rejectionNote', uses: ['pages/recycle-desk.tsx'] },
  { key: 'staffReason', file: 'apps/api/src/modules/staff/dto/grant-role.dto.ts', cls: 'GrantRoleDto', prop: 'reason', uses: ['pages/admin.tsx'] },
  { key: 'staffReason', file: 'apps/api/src/modules/staff/dto/revoke-role.dto.ts', cls: 'RevokeRoleDto', prop: 'reason', uses: ['pages/admin.tsx'] },
  { key: 'externalPointsCode', file: 'apps/api/src/modules/external-points/external-claims.controller.ts', cls: 'SubmitExternalClaimDto', prop: 'code', uses: ['pages/external-points.tsx'] },
  { key: 'voucherCode', file: 'apps/api/src/modules/admin/admin.controller.ts', cls: 'CreateCouponDto', prop: 'code', uses: ['components/checkout/voucher-sheet.tsx'] },
];

/** Ô mà DTO giới hạn bằng regex: trần là độ dài chuỗi dài nhất regex còn nhận. */
const REGEX_ROWS: RegexRow[] = [
  { key: 'dealerTaxCode', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', re: 'TAX_CODE_RE', longest: '1234567890-123', uses: ['pages/dealer.tsx'] },
  { key: 'storefrontSubdomain', file: 'apps/api/src/modules/storefront/identifier-validation.ts', re: 'SUBDOMAIN_RE', longest: 'a'.repeat(30), uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'affiliateTaxId', file: 'apps/api/src/modules/affiliate/affiliate.service.ts', re: 'PERSONAL_TAX_ID_PATTERN', longest: '1234567890-123', uses: ['pages/affiliate.tsx'] },
  { key: 'bankBin', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', re: '', longest: '970407', uses: ['pages/my-payroll.tsx'] },
];

/**
 * Ô nhập mà client chuẩn hoá (bỏ khoảng trắng, dấu chấm) trước khi kiểm: trần của ô áp lên chuỗi THÔ nên phải rộng hơn trần DTO.
 * `pasted` là các chuỗi khách thật sự dán vào; ô phải nhận trọn từng chuỗi.
 */
const RAW_ROWS: { key: Key; pasted: string[]; uses: string[] }[] = [
  { key: 'invoiceTaxCode', pasted: ['0312.345.678-001', '0312 345 678 - 001', '001 234 567 890', '0 3 1 2 3 4 5 6 7 8 - 0 0 1'], uses: ['pages/checkout.tsx'] },
];

function maxLengthOf(src: string, cls: string, prop: string): number | null {
  const start = src.indexOf(`class ${cls}`);
  if (start < 0) throw new Error(`không thấy class ${cls}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = src.slice(open, end);
  const decl = new RegExp(`((?:\\s*@[^\\n]*\\n)*)([^\\n]*@[^\\n]*)?\\b${prop}[?!]?\\s*:`).exec(body);
  if (!decl) throw new Error(`không thấy ${cls}.${prop}`);
  const head = body.slice(Math.max(0, decl.index - 400), decl.index + decl[0].length);
  const decos = head.split(/\n\s*\n/).pop() ?? '';
  const name = [...decos.matchAll(/MaxLength\(\s*(\w+)/g)].pop()?.[1];
  if (!name) return null;
  if (/^\d+$/.test(name)) return Number(name);
  const c = new RegExp(`const ${name}\\s*=\\s*([\\d_]+)`).exec(src);
  return c?.[1] ? Number(c[1].replace(/_/g, '')) : null;
}

function usesLimit(file: string, marker: string): boolean {
  return read(MA + file).includes(marker);
}

describe('ô nhập Mini App: maxLength bằng trần DTO', () => {
  it.each(DTO_ROWS)('$key = $cls.$prop', (row) => {
    expect(maxLengthOf(read(row.file), row.cls, row.prop)).toBe(INPUT_LIMITS[row.key]);
    for (const f of row.uses) expect(usesLimit(f, row.marker ?? `maxLength={INPUT_LIMITS.${row.key}}`), `${f} thiếu maxLength cho ${row.key}`).toBe(true);
  });

  it.each(REGEX_ROWS)('$key khớp độ dài lớn nhất regex nhận', (row) => {
    expect(row.longest.length).toBe(INPUT_LIMITS[row.key]);
    if (row.re) {
      const m = new RegExp(`${row.re}\\s*=\\s*/(.+)/[a-z]*;`).exec(read(row.file));
      expect(m, `không thấy ${row.re}`).toBeTruthy();
      const re = new RegExp(m?.[1] ?? '');
      expect(re.test(row.longest)).toBe(true);
      expect(re.test(row.longest + '1')).toBe(false);
    } else {
      expect(/@Matches\(\/\^\(\\d\{6\}\)\?\$\//.test(read(row.file))).toBe(true);
    }
    for (const f of row.uses) expect(usesLimit(f, `maxLength={INPUT_LIMITS.${row.key}}`), `${f} thiếu maxLength cho ${row.key}`).toBe(true);
  });

  it.each(RAW_ROWS)('$key nhận trọn chuỗi thô khách dán rồi mới chuẩn hoá', (row) => {
    for (const p of row.pasted) {
      expect(isTaxCodeValid(p), `${p} phải hợp lệ sau chuẩn hoá`).toBe(true);
      expect(p.length, `${p} dài hơn trần ô`).toBeLessThanOrEqual(INPUT_LIMITS[row.key]);
    }
    for (const f of row.uses) expect(usesLimit(f, `maxLength={INPUT_LIMITS.${row.key}}`)).toBe(true);
  });

  it('lý do tối thiểu bằng @MinLength của DTO', () => {
    for (const f of ['grant-role', 'revoke-role']) {
      expect(new RegExp(`MinLength\\(${STAFF_REASON_MIN},`).test(read(`apps/api/src/modules/staff/dto/${f}.dto.ts`))).toBe(true);
    }
  });

  it('không có khoá thừa trong bảng', () => {
    const covered = new Set<string>([...DTO_ROWS, ...REGEX_ROWS, ...RAW_ROWS].map((r) => r.key));
    for (const k of Object.keys(INPUT_LIMITS)) expect(covered.has(k), `${k} chưa có dòng đối chiếu`).toBe(true);
  });
});
