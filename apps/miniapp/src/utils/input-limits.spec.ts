import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isTaxCodeValid } from '@tubutree/app-core/commerce/tax-code';
import { ADDRESS_INPUT_LIMIT, INPUT_LIMITS, STAFF_REASON_MIN } from './input-limits';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

type Key = keyof typeof INPUT_LIMITS;
/** `value` là biểu thức `value={...}` của đúng ô nhập đó: maxLength phải nằm trên chính phần tử có value này, không chỉ đâu đó trong file. */
interface DtoRow { key: Key; file: string; cls: string; prop: string; value: string; uses: string[]; maxAttr?: string; addrField?: string }
/**
 * `re` là tên hằng regex (ở `file`). `dto` (nếu có) là thuộc tính DTO nhận giá trị: spec kiểm `@Matches` của đúng thuộc tính đó dùng
 * đúng hằng `re`. Subdomain không có DTO riêng: regex nằm ở service (`normalizeSubdomain`), spec kiểm hàm đó gọi đúng hằng.
 */
interface RegexRow {
  key: Key; file: string; re: string; longest: string; value: string; uses: string[]; cls?: string; prop?: string;
  dto?: { file: string; cls: string; prop: string };
  serviceFn?: string;
}

const MA = 'apps/miniapp/src/';

/** Ô nhập → DTO nhận giá trị → `@MaxLength`. Thêm ô nhập mới thì thêm dòng ở đây. */
const DTO_ROWS: DtoRow[] = [
  { key: 'reviewComment', file: 'apps/api/src/modules/reviews/dto/review.dto.ts', cls: 'CreateReviewDto', prop: 'comment', value: 'comment', uses: ['components/reviews-section.tsx'] },
  { key: 'dealerBusinessName', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'businessName', value: 'form.businessName', uses: ['pages/dealer.tsx'] },
  { key: 'dealerOwnerName', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'ownerName', value: 'form.ownerName', uses: ['pages/dealer.tsx'] },
  { key: 'dealerPhone', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'phone', value: 'form.phone', uses: ['pages/dealer.tsx'] },
  { key: 'dealerAddress', file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'address', value: 'form.address', uses: ['pages/dealer.tsx'] },
  { key: 'dealerTemplateName', file: 'apps/api/src/modules/dealer/dealer.controller.ts', cls: 'SaveTemplateDto', prop: 'name', value: 'tplName', uses: ['pages/dealer.tsx'] },
  { key: 'addressRecipient', file: 'apps/api/src/modules/users/dto/address.dto.ts', cls: 'CreateAddressDto', prop: 'recipient', value: 'form[k]', uses: ['components/address-form.tsx'], maxAttr: 'ADDRESS_INPUT_LIMIT[k]', addrField: 'recipient' },
  { key: 'addressPhone', file: 'apps/api/src/modules/users/dto/address.dto.ts', cls: 'CreateAddressDto', prop: 'phone', value: 'form[k]', uses: ['components/address-form.tsx'], maxAttr: 'ADDRESS_INPUT_LIMIT[k]', addrField: 'phone' },
  { key: 'addressStreet', file: 'apps/api/src/modules/users/dto/address.dto.ts', cls: 'CreateAddressDto', prop: 'street', value: 'form[k]', uses: ['components/address-form.tsx'], maxAttr: 'ADDRESS_INPUT_LIMIT[k]', addrField: 'street' },
  { key: 'invoiceCompanyName', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', cls: 'InvoiceRequestDto', prop: 'companyName', value: 'invoice.companyName', uses: ['pages/checkout.tsx'] },
  { key: 'invoiceAddress', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', cls: 'InvoiceRequestDto', prop: 'address', value: 'invoice.address', uses: ['pages/checkout.tsx'] },
  { key: 'invoiceEmail', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', cls: 'InvoiceRequestDto', prop: 'email', value: 'invoice.email', uses: ['pages/checkout.tsx'] },
  { key: 'storefrontTitle', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'title', value: 'form.title', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'storefrontWarehouseAddress', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'warehouseAddress', value: 'form.warehouseAddress', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'storefrontWarehouseCity', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'warehouseCity', value: 'form.warehouseCity', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'storefrontWarehousePhone', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateStorefrontDto', prop: 'warehousePhone', value: 'form.warehousePhone', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'collectionTitle', file: 'apps/api/src/modules/storefront/storefront.controller.ts', cls: 'UpdateCollectionDto', prop: 'title', value: 'renaming.title', uses: ['pages/storefront-builder.tsx'] },
  { key: 'brandTagline', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'UpdateOwnedBrandDto', prop: 'tagline', value: 'f.tagline', uses: ['pages/brand-owner.tsx'] },
  { key: 'brandOrigin', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'UpdateOwnedBrandDto', prop: 'origin', value: 'f.origin', uses: ['pages/brand-owner.tsx'] },
  { key: 'brandStory', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'UpdateOwnedBrandDto', prop: 'story', value: 'f.story', uses: ['pages/brand-owner.tsx'] },
  { key: 'promoTitle', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'PromotionDto', prop: 'title', value: 'promo.title', uses: ['pages/brand-owner.tsx'] },
  { key: 'promoSubtitle', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'PromotionDto', prop: 'subtitle', value: 'promo.subtitle', uses: ['pages/brand-owner.tsx'] },
  { key: 'promoCouponCode', file: 'apps/api/src/modules/brand/dto/brand.dto.ts', cls: 'PromotionDto', prop: 'couponCode', value: 'promo.couponCode', uses: ['pages/brand-owner.tsx'] },
  { key: 'shiftTemplateName', file: 'apps/api/src/modules/staff/shifts/dto/shift.dto.ts', cls: 'ShiftTemplateDto', prop: 'name', value: 'name', uses: ['pages/admin.tsx'] },
  { key: 'shiftRejectReason', file: 'apps/api/src/modules/staff/shifts/dto/shift.dto.ts', cls: 'RejectShiftDto', prop: 'reason', value: 'rejectReason', uses: ['pages/admin.tsx'] },
  { key: 'shiftCancelReason', file: 'apps/api/src/modules/staff/shifts/dto/shift.dto.ts', cls: 'CancelShiftDto', prop: 'reason', value: 'cancelReason', uses: ['pages/staff.tsx'] },
  { key: 'payrollNote', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'MarkPaidDto', prop: 'note', value: 'note', uses: ['pages/admin.tsx'] },
  { key: 'bankAccountNo', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'UpdateBankDto', prop: 'bankAccountNo', value: 'accNo', uses: ['pages/my-payroll.tsx'] },
  { key: 'bankAccountName', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'UpdateBankDto', prop: 'bankAccountName', value: 'accName', uses: ['pages/my-payroll.tsx'] },
  { key: 'recycleCarrier', file: 'apps/api/src/modules/waste-exchange/customer/waste-customer.controller.ts', cls: 'WasteTrackingDto', prop: 'carrier', value: 'carrier', uses: ['pages/recycle-request.tsx'] },
  { key: 'recycleTrackingCode', file: 'apps/api/src/modules/waste-exchange/customer/waste-customer.controller.ts', cls: 'WasteTrackingDto', prop: 'trackingCode', value: 'code', uses: ['pages/recycle-request.tsx'] },
  { key: 'recycleDeskCode', file: 'apps/api/src/modules/waste-exchange/receiving/waste-admin-requests.controller.ts', cls: 'WasteLookupQueryDto', prop: 'code', value: 'code', uses: ['pages/recycle-desk.tsx'] },
  { key: 'recycleRejectNote', file: 'apps/api/src/modules/waste-exchange/receiving/waste-receiving.dto.ts', cls: 'WasteRejectDto', prop: 'rejectionNote', value: 'note', uses: ['pages/recycle-desk.tsx'] },
  { key: 'staffReason', file: 'apps/api/src/modules/staff/dto/grant-role.dto.ts', cls: 'GrantRoleDto', prop: 'reason', value: 'grantReason', uses: ['pages/admin.tsx'] },
  { key: 'staffReason', file: 'apps/api/src/modules/staff/dto/revoke-role.dto.ts', cls: 'RevokeRoleDto', prop: 'reason', value: 'revokeReason', uses: ['pages/admin.tsx'] },
  { key: 'externalPointsCode', file: 'apps/api/src/modules/external-points/external-claims.controller.ts', cls: 'SubmitExternalClaimDto', prop: 'code', value: 'code', uses: ['pages/external-points.tsx'] },
  { key: 'voucherCode', file: 'apps/api/src/modules/admin/admin.controller.ts', cls: 'CreateCouponDto', prop: 'code', value: 'customCode', uses: ['components/checkout/voucher-sheet.tsx'] },
];

/** Ô mà DTO giới hạn bằng regex: trần là độ dài chuỗi dài nhất regex còn nhận. */
const REGEX_ROWS: RegexRow[] = [
  { key: 'dealerTaxCode', file: 'apps/api/src/modules/checkout/dto/checkout.dto.ts', re: 'TAX_CODE_RE', longest: '1234567890-123', value: "form.taxCode ?? ''", dto: { file: 'apps/api/src/modules/dealer/dto/dealer.dto.ts', cls: 'ApplyDealerDto', prop: 'taxCode' }, uses: ['pages/dealer.tsx'] },
  { key: 'storefrontSubdomain', file: 'apps/api/src/modules/storefront/identifier-validation.ts', re: 'SUBDOMAIN_RE', longest: 'a'.repeat(30), value: 'form.subdomain', serviceFn: 'normalizeSubdomain', uses: ['components/storefront-builder/config-sheet.tsx'] },
  { key: 'affiliateTaxId', file: 'apps/api/src/modules/affiliate/affiliate.service.ts', re: 'PERSONAL_TAX_ID_PATTERN', longest: '1234567890-123', value: 'taxId', dto: { file: 'apps/api/src/modules/affiliate/affiliate.controller.ts', cls: 'PayoutDto', prop: 'taxId' }, uses: ['pages/affiliate.tsx'] },
  { key: 'bankBin', file: 'apps/api/src/modules/staff/payroll/payroll.dto.ts', cls: 'UpdateBankDto', prop: 'bankBin', re: '', longest: '970407', value: 'bin', uses: ['pages/my-payroll.tsx'] },
];

/**
 * Ô nhập mà client chuẩn hoá (bỏ khoảng trắng, dấu chấm) trước khi kiểm: trần của ô áp lên chuỗi THÔ nên phải rộng hơn trần DTO.
 * `pasted` là các chuỗi khách thật sự dán vào; ô phải nhận trọn từng chuỗi.
 */
const RAW_ROWS: { key: Key; pasted: string[]; value: string; uses: string[] }[] = [
  { key: 'invoiceTaxCode', pasted: ['0312.345.678-001', '0312 345 678 - 001', '001 234 567 890', '0 3 1 2 3 4 5 6 7 8 - 0 0 1'], value: 'invoice.taxCode', uses: ['pages/checkout.tsx'] },
];

function parse(src: string, kind: ts.ScriptKind = ts.ScriptKind.TS): ts.SourceFile {
  return ts.createSourceFile('x', src, ts.ScriptTarget.Latest, true, kind);
}

/** Thuộc tính `prop` của `class cls`, đọc bằng cây cú pháp: chỉ decorator gắn ĐÚNG thuộc tính đó, không lẫn thuộc tính liền trước. */
function classProp(sf: ts.SourceFile, cls: string, prop: string): ts.PropertyDeclaration {
  let found: ts.PropertyDeclaration | undefined;
  let sawClass = false;
  sf.forEachChild(function visit(n) {
    if (ts.isClassDeclaration(n) && n.name?.text === cls) {
      sawClass = true;
      for (const m of n.members) if (ts.isPropertyDeclaration(m) && m.name.getText() === prop) found = m;
    }
    if (!found) n.forEachChild(visit);
  });
  if (!sawClass) throw new Error(`không thấy class ${cls}`);
  if (!found) throw new Error(`không thấy ${cls}.${prop}`);
  return found;
}

function decorator(p: ts.PropertyDeclaration, name: string): ts.CallExpression | undefined {
  for (const d of ts.getDecorators(p) ?? []) {
    if (ts.isCallExpression(d.expression) && d.expression.expression.getText() === name) return d.expression;
  }
  return undefined;
}

function numericConst(sf: ts.SourceFile, name: string): number | null {
  let v: number | null = null;
  sf.forEachChild((n) => {
    if (!ts.isVariableStatement(n)) return;
    for (const d of n.declarationList.declarations) {
      if (d.name.getText() === name && d.initializer && ts.isNumericLiteral(d.initializer)) v = Number(d.initializer.text);
    }
  });
  return v;
}

function maxLengthOf(src: string, cls: string, prop: string): number | null {
  const sf = parse(src);
  const call = decorator(classProp(sf, cls, prop), 'MaxLength');
  const arg = call?.arguments[0];
  if (!arg) return null;
  if (ts.isNumericLiteral(arg)) return Number(arg.text);
  return ts.isIdentifier(arg) ? numericConst(sf, arg.text) : null;
}

/** Regex ở `@Matches(...)` của đúng thuộc tính, khi đó là một regex literal. */
function matchesRegexOf(src: string, cls: string, prop: string): RegExp | null {
  const arg = decorator(classProp(parse(src), cls, prop), 'Matches')?.arguments[0];
  if (!arg || !ts.isRegularExpressionLiteral(arg)) return null;
  const m = /^\/(.*)\/([a-z]*)$/.exec(arg.text);
  return m ? new RegExp(m[1] ?? '', m[2]) : null;
}

/** Tên hằng truyền cho `@Matches(...)` của đúng thuộc tính (khi đối số là một identifier). */
function matchesIdentifierOf(src: string, cls: string, prop: string): string | null {
  const arg = decorator(classProp(parse(src), cls, prop), 'Matches')?.arguments[0];
  return arg && ts.isIdentifier(arg) ? arg.text : null;
}

/** Hàm `fn` ở cấp file có nhắc tới identifier `name` trong thân không. */
function functionUses(src: string, fn: string, name: string): boolean {
  let used = false;
  parse(src).forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === fn && n.body) {
      (function visit(x: ts.Node) {
        if (ts.isIdentifier(x) && x.text === name) used = true;
        x.forEachChild(visit);
      })(n.body);
    }
  });
  return used;
}

/** Có phần tử JSX mang `maxLength={maxAttr}` VÀ `value={value}` cùng lúc không (tức đúng ô nhập, không chỉ có chuỗi trong file). */
function usesLimit(file: string, maxAttr: string, value: string): boolean {
  const sf = parse(read(MA + file), ts.ScriptKind.TSX);
  let ok = false;
  const exprOf = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, attr: string): string | undefined => {
    for (const a of el.attributes.properties) {
      if (ts.isJsxAttribute(a) && a.name.getText() === attr && a.initializer && ts.isJsxExpression(a.initializer)) {
        return a.initializer.expression?.getText();
      }
    }
    return undefined;
  };
  sf.forEachChild(function visit(n) {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && exprOf(n, 'maxLength') === maxAttr && exprOf(n, 'value') === value) ok = true;
    n.forEachChild(visit);
  });
  return ok;
}

describe('ô nhập Mini App: maxLength bằng trần DTO', () => {
  it.each(DTO_ROWS)('$key = $cls.$prop', (row) => {
    expect(maxLengthOf(read(row.file), row.cls, row.prop)).toBe(INPUT_LIMITS[row.key]);
    if (row.addrField) expect(ADDRESS_INPUT_LIMIT[row.addrField as keyof typeof ADDRESS_INPUT_LIMIT]).toBe(INPUT_LIMITS[row.key]);
    for (const f of row.uses) {
      expect(usesLimit(f, row.maxAttr ?? `INPUT_LIMITS.${row.key}`, row.value), `${f} thiếu maxLength cho ${row.key} trên ô value={${row.value}}`).toBe(true);
    }
  });

  it.each(REGEX_ROWS)('$key khớp độ dài lớn nhất regex nhận', (row) => {
    expect(row.longest.length).toBe(INPUT_LIMITS[row.key]);
    if (row.dto) {
      expect(matchesIdentifierOf(read(row.dto.file), row.dto.cls, row.dto.prop), `${row.dto.cls}.${row.dto.prop} phải dùng @Matches(${row.re})`).toBe(row.re);
    }
    if (row.serviceFn) {
      expect(functionUses(read(row.file), row.serviceFn, row.re), `${row.serviceFn} phải dùng ${row.re}`).toBe(true);
    }
    if (row.re) {
      const m = new RegExp(`${row.re}\\s*=\\s*/(.+)/[a-z]*;`).exec(read(row.file));
      expect(m, `không thấy ${row.re}`).toBeTruthy();
      const re = new RegExp(m?.[1] ?? '');
      expect(re.test(row.longest)).toBe(true);
      expect(re.test(row.longest + '1')).toBe(false);
    } else {
      const re = matchesRegexOf(read(row.file), row.cls ?? '', row.prop ?? '');
      expect(re, `không thấy @Matches regex literal ở ${row.cls}.${row.prop}`).toBeTruthy();
      expect(re?.test(row.longest)).toBe(true);
      expect(re?.test(row.longest + '1')).toBe(false);
    }
    for (const f of row.uses) {
      expect(usesLimit(f, `INPUT_LIMITS.${row.key}`, row.value), `${f} thiếu maxLength cho ${row.key} trên ô value={${row.value}}`).toBe(true);
    }
  });

  it.each(RAW_ROWS)('$key nhận trọn chuỗi thô khách dán rồi mới chuẩn hoá', (row) => {
    for (const p of row.pasted) {
      expect(isTaxCodeValid(p), `${p} phải hợp lệ sau chuẩn hoá`).toBe(true);
      expect(p.length, `${p} dài hơn trần ô`).toBeLessThanOrEqual(INPUT_LIMITS[row.key]);
    }
    for (const f of row.uses) expect(usesLimit(f, `INPUT_LIMITS.${row.key}`, row.value)).toBe(true);
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
