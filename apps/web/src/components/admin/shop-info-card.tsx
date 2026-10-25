'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { LEGAL_PAGES, LEGAL_SLUGS, type LegalSlug } from '@/lib/legal';
import { LegalMarkdown } from '@/components/legal-markdown';
import { BTN_PRIMARY, BTN_SECONDARY, Field, INPUT_CLASS, Notice } from './ui';

const COMPANY_FIELDS = [
  { key: 'company.legal_name', label: 'Tên công ty', hint: 'Đúng tên trên giấy đăng ký kinh doanh. Hiện ở chân trang và các trang chính sách.', placeholder: 'Công ty TNHH ...' },
  { key: 'company.tax_code', label: 'Mã số thuế', hint: 'Hiện cho khách ở chân trang.', placeholder: '0123456789' },
  { key: 'company.address', label: 'Địa chỉ trụ sở', hint: 'Địa chỉ đã đăng ký kinh doanh.', placeholder: 'Số nhà, đường, phường, tỉnh' },
  { key: 'company.bct_notice_url', label: 'Link thông báo Bộ Công Thương', hint: 'Không bắt buộc. Dán link bắt đầu bằng https://. Để trống thì ẩn dòng "Đã thông báo Bộ Công Thương".', placeholder: 'https://online.gov.vn/...' },
] as const;

const LEGAL_MAX = 50_000;
const BCT_URL_MAX = 500;

/** Cùng luật với `httpsUrl` ở API (company-config.ts): link API sẽ bỏ thì không cho lưu. */
function bctLinkProblem(value: string): string | null {
  if (value.length > BCT_URL_MAX) return `Link dài quá ${BCT_URL_MAX} ký tự.`;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return 'Link phải bắt đầu bằng https:// và không có khoảng trắng.';
  }
  if (u.protocol !== 'https:') return 'Link phải bắt đầu bằng https:// và không có khoảng trắng.';
  if (u.username || u.password) return 'Link không được chứa tên đăng nhập hay mật khẩu.';
  return null;
}

const textOf = (rows: ConfigRow[] | undefined, key: string): string => {
  const v = rows?.find((r) => r.key === key)?.value;
  return typeof v === 'string' ? v : '';
};

/**
 * Thông tin cửa hàng và bốn trang chính sách. Giá trị lưu là chuỗi JSON thường: chủ gõ chữ bình thường, không phải gõ
 * dấu ngoặc kép như ở ô "Tất cả tham số (JSON)".
 */
export function ShopInfoCard({ rows }: { rows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ key: string; ok: boolean; text: string } | null>(null);

  const valueOf = (key: string) => draft[key] ?? textOf(rows, key);
  const dirty = (key: string) => draft[key] !== undefined && draft[key] !== textOf(rows, key);

  const save = useMutation({
    mutationFn: async (keys: string[]) => {
      for (const key of keys) await setConfig(key, valueOf(key).trim());
      return keys;
    },
    onSuccess: (keys, _v) => {
      setMsg({ key: keys[0]!, ok: true, text: 'Đã lưu.' });
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e, keys) => setMsg({ key: keys[0]!, ok: false, text: e instanceof Error ? e.message : 'Không lưu được, thử lại sau.' }),
  });

  const companyKeys = COMPANY_FIELDS.map((f) => f.key as string);
  const companyDirty = companyKeys.some(dirty);
  const bct = valueOf('company.bct_notice_url').trim();
  const bctProblem = bct === '' ? null : bctLinkProblem(bct);

  return (
    <section aria-labelledby="shop-info-title" data-shop-info className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h2 id="shop-info-title" className="font-display text-base font-semibold text-stone-900">Thông tin cửa hàng &amp; chính sách</h2>
      <p className="mt-0.5 text-xs text-stone-600">Hiện cho khách ở chân trang và các trang chính sách. Gõ chữ bình thường, không cần dấu ngoặc kép.</p>

      <div className="mt-3 space-y-3">
        {COMPANY_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <input
              type={f.key === 'company.bct_notice_url' ? 'url' : 'text'}
              value={valueOf(f.key)}
              placeholder={f.placeholder}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              className={INPUT_CLASS}
            />
          </Field>
        ))}
        {bctProblem && <Notice tone="warning">{bctProblem}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!companyDirty || save.isPending || !!bctProblem} onClick={() => save.mutate(companyKeys.filter(dirty))} className={BTN_PRIMARY}>
            Lưu thông tin cửa hàng
          </button>
          {msg && companyKeys.includes(msg.key) && (
            <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</span>
          )}
        </div>
        <p className="text-xs text-stone-500">Trang khách cập nhật sau tối đa 5 phút, chân trang tối đa 1 giờ.</p>
      </div>

      <div className="mt-6 space-y-5">
        {LEGAL_SLUGS.map((slug: LegalSlug) => {
          const key = `legal.${slug}`;
          const value = valueOf(key);
          const shown = previewing[slug];
          return (
            <div key={slug} data-legal={slug}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-stone-900">{LEGAL_PAGES[slug].title}</h3>
                <Link href={`/chinh-sach/${slug}`} target="_blank" className="inline-flex min-h-[44px] items-center text-xs font-medium text-forest-700 underline sm:min-h-[36px]">
                  Xem trang khách thấy
                </Link>
              </div>
              <p className="text-xs text-stone-600">Viết dạng markdown: # cho tiêu đề, - cho gạch đầu dòng. Để trống thì khách thấy bản nháp có sẵn.</p>
              {shown ? (
                <div data-legal-preview={slug} className="mt-2 max-h-96 overflow-auto rounded-control border border-stone-200 bg-stone-50 p-3">
                  {value.trim() ? <LegalMarkdown source={value} /> : <p className="text-sm text-stone-500">Đang để trống. Khách thấy bản nháp có sẵn.</p>}
                </div>
              ) : (
                <textarea
                  aria-label={LEGAL_PAGES[slug].title}
                  rows={8}
                  value={value}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  className={`${INPUT_CLASS} mt-2 font-mono text-xs`}
                />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setPreviewing((p) => ({ ...p, [slug]: !p[slug] }))} className={BTN_SECONDARY}>
                  {shown ? 'Quay lại soạn' : 'Xem trước'}
                </button>
                <button type="button" disabled={!dirty(key) || save.isPending || value.length > LEGAL_MAX} onClick={() => save.mutate([key])} className={BTN_PRIMARY}>
                  Lưu
                </button>
                <span className={`text-xs ${value.length > LEGAL_MAX ? 'text-danger-fg' : 'text-stone-500'}`}>{value.length} / 50.000 ký tự</span>
                {msg && msg.key === key && (
                  <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
