'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, TreePine } from 'lucide-react';
import type { FaqItem, PublicConfig, SupportContact } from '@tubutree/app-core/api/config';
import { faqsQuery, publicConfigQuery, supportContactQuery } from '@tubutree/app-core/queries/config';
import { mini } from '@/components/order-mobile/mobile-ui';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { fallbackFaq } from '@/lib/faq-fallback';
import { ui } from '@/lib/guest-ui';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { platformBridge } from '@/lib/platform-bridge';
import { PAGE_WIDE } from '@/lib/page-frame';

const ALL_CATS = 'Tất cả';
const FAQ_SKELETON_ROWS = 4;
const STALE_MS = 10 * 60_000;

/** Khớp mặc định của API và web (DEFAULT_SUPPORT): khi không đọc được cấu hình vẫn còn đường liên hệ. */
const DEFAULT_SUPPORT: SupportContact = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null, hours: null };

const POLICY_LINKS = [
  { label: 'Điều khoản sử dụng', slug: 'dieu-khoan' },
  { label: 'Chính sách bảo mật', slug: 'bao-mat' },
  { label: 'Chính sách đổi trả', slug: 'doi-tra' },
  { label: 'Chính sách vận chuyển', slug: 'van-chuyen' },
] as const;

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Về Tubu Tree (cùng nội dung với `about.tsx` của Mini App): giới thiệu, FAQ, liên hệ, chính sách; đăng xuất và xoá tài khoản nằm ở Cài đặt. */
export function AboutView({ initialFaqs, initialConfig, initialSupport }: { initialFaqs?: FaqItem[]; initialConfig?: PublicConfig; initialSupport?: SupportContact }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
      <PageHeader title="Về Tubu Tree" />
      <section className="mt-4 rounded-card bg-forest-800 p-5 text-stone-0 shadow-card max-md:mx-4 max-md:mt-3 max-md:bg-[linear-gradient(135deg,var(--color-action-primary-bg),var(--color-action-primary-bg-pressed))] max-md:shadow-none">
        <TreePine className="h-8 w-8 max-md:h-6 max-md:w-6" aria-hidden="true" />
        <h2 className="mt-2 font-display text-xl font-semibold max-md:text-[length:var(--type-title-md-size)] max-md:leading-[var(--type-title-md-lh)]">
          Sống Xanh An Lành
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-100">
          Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên. Chúng tôi kết nối bạn với những thương hiệu Việt tử tế — minh bạch
          nguồn gốc, lành cho da, nhẹ với đất.
        </p>
      </section>

      <div className="mt-3 grid gap-3 md:grid-cols-2 max-md:grid-cols-[minmax(0,1fr)] max-md:px-4">
        <div className="md:col-span-2">
          <FaqSection initialFaqs={initialFaqs} initialConfig={initialConfig} />
        </div>
        <SupportSection initialSupport={initialSupport} />
        <Section title="Điều khoản & Chính sách">
          {POLICY_LINKS.map((p, i) => (
            <Link
              key={p.slug}
              href={`/chinh-sach/${p.slug}`}
              className={`flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-stone-900 hover:text-forest-700 max-md:font-semibold ${i < POLICY_LINKS.length - 1 ? 'border-b border-stone-200' : ''}`}
            >
              {p.label}
              <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
            </Link>
          ))}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${ui.card} p-4 ${mini.card}`}>
      <h2 className={`mb-2 font-display text-base font-semibold text-stone-900 max-md:font-ui max-md:text-[15px] max-md:font-bold`}>{title}</h2>
      {children}
    </section>
  );
}

function FaqSection({ initialFaqs, initialConfig }: { initialFaqs?: FaqItem[]; initialConfig?: PublicConfig }) {
  const faqQ = useQuery({ ...faqsQuery(coreHttp), staleTime: STALE_MS, initialData: initialFaqs });
  const configQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: STALE_MS, initialData: initialConfig });
  const [open, setOpen] = useState<number | null>(0);
  const [cat, setCat] = useState(ALL_CATS);

  // FAQ do admin nhập; chưa có dòng nào hoặc lỗi mạng thì dùng bản dự phòng. Đang tải thì chưa hiện gì để khỏi nháy nội dung.
  const faq = faqQ.data && faqQ.data.length > 0 ? faqQ.data : faqQ.isLoading ? [] : fallbackFaq(configQ.data);
  const cats = [ALL_CATS, ...new Set(faq.map((f) => f.cat))];
  const shown = faq.filter((f) => cat === ALL_CATS || f.cat === cat);

  return (
    <Section title="Câu hỏi thường gặp">
      <div role="group" aria-label="Nhóm câu hỏi" className="mb-1 flex flex-wrap gap-2 py-1.5 max-md:flex-nowrap max-md:overflow-x-auto">
        {cats.map((c) => {
          const selected = cat === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setCat(c);
                setOpen(null);
              }}
              className={`relative min-h-11 rounded-control border px-4 text-sm font-medium transition active:scale-95 max-md:shrink-0 max-md:whitespace-nowrap max-md:rounded-full max-md:border-transparent max-md:px-3.5 max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-1 max-md:after:content-[''] ${
                selected
                  ? 'border-forest-600 bg-forest-600 text-stone-0 max-md:bg-[var(--color-action-primary-bg)] max-md:text-[color:var(--color-action-primary-fg)]'
                  : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50 max-md:bg-[var(--stone-100)] max-md:text-[color:var(--color-text-secondary)]'
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>
      {faqQ.isLoading && (
        <div aria-hidden="true" className="flex flex-col gap-4 py-3">
          {Array.from({ length: FAQ_SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} height={16} width={i % 2 ? '70%' : '90%'} />
          ))}
        </div>
      )}
      {shown.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={item.q} className={i < shown.length - 1 ? 'border-b border-stone-200' : ''}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`faq-answer-${i}`}
              onClick={() => setOpen(expanded ? null : i)}
              className="flex min-h-11 w-full items-center justify-between gap-2 py-3 text-left"
            >
              <span className="flex-1 text-sm font-semibold text-stone-900">{item.q}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {expanded && (
              <p id={`faq-answer-${i}`} className="pb-3 text-sm text-stone-700">
                {item.a}
              </p>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function SupportSection({ initialSupport }: { initialSupport?: SupportContact }) {
  const supportQ = useQuery({ ...supportContactQuery(coreHttp), staleTime: STALE_MS, initialData: initialSupport });
  const configQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: STALE_MS });
  const chatOn = configQ.data?.chat?.enabled === true;
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  const oa = platformBridge.oa.available;
  // Dòng chưa có giá trị thì ẩn hẳn (Q-17), không hiện nhãn trống.
  const rows: { label: string; value: ReactNode }[] = [];
  if (support?.hotline) {
    rows.push({
      label: 'Hotline',
      value: (
        <a href={telHref(support.hotline)} aria-label={`Hotline ${formatPhoneDisplay(support.hotline)}, bấm để gọi`} className={`${ui.backLink} font-semibold max-md:text-[color:var(--color-text-brand)] max-md:no-underline`}>
          {formatPhoneDisplay(support.hotline)}
        </a>
      ),
    });
  }
  if (support?.zaloOaName) {
    rows.push({
      label: 'Zalo OA',
      value: (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-stone-900">{support.zaloOaName}</span>
          {oa && (
            <button type="button" onClick={() => void platformBridge.oa.openChat()} className={ui.btnSecondary}>
              Nhắn Zalo OA
            </button>
          )}
        </span>
      ),
    });
  }
  if (support?.email) {
    rows.push({
      label: 'Email',
      value: (
        <a href={`mailto:${support.email}`} className={`${ui.backLink} break-all max-md:font-semibold max-md:text-[color:var(--color-text-primary)] max-md:no-underline`}>
          {support.email}
        </a>
      ),
    });
  }
  if (rows.length === 0 && !chatOn) return null;
  return (
    <Section title="Hỗ trợ khách hàng">
      {chatOn && (
        <Link
          href="/ho-tro/chat"
          className={`flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-stone-900 hover:text-forest-700 max-md:font-semibold ${rows.length > 0 ? 'border-b border-stone-200' : ''}`}
        >
          Chat với Tubu Tree
          <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
        </Link>
      )}
      {rows.map((r, i) => (
        <div key={r.label} className={`flex min-h-11 items-center justify-between gap-3 py-1 ${i < rows.length - 1 ? 'border-b border-stone-200' : ''}`}>
          <span className="text-sm text-stone-600">{r.label}</span>
          {r.value}
        </div>
      ))}
    </Section>
  );
}
