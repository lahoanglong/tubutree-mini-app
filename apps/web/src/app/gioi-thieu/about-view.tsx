'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, TreePine } from 'lucide-react';
import { requestAccountDeletion } from '@tubutree/app-core/api/account';
import type { SupportContact } from '@tubutree/app-core/api/config';
import { faqsQuery, publicConfigQuery, supportContactQuery } from '@tubutree/app-core/queries/config';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { fallbackFaq } from '@/lib/faq-fallback';
import { ui } from '@/lib/guest-ui';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { platformBridge } from '@/lib/platform-bridge';

const ALL_CATS = 'Tất cả';
const FAQ_SKELETON_ROWS = 4;
const STALE_MS = 10 * 60_000;
const DELETE_FAILED = 'Chưa gửi được yêu cầu. Kiểm tra mạng rồi thử lại.';
const DELETE_OA_MESSAGE = 'Tôi muốn xoá tài khoản Tubu Tree';

/** Khớp mặc định của API và web (DEFAULT_SUPPORT): khi không đọc được cấu hình vẫn còn đường liên hệ. */
const DEFAULT_SUPPORT: SupportContact = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null };

const POLICY_LINKS = [
  { label: 'Điều khoản sử dụng', slug: 'dieu-khoan' },
  { label: 'Chính sách bảo mật', slug: 'bao-mat' },
  { label: 'Chính sách đổi trả', slug: 'doi-tra' },
  { label: 'Chính sách vận chuyển', slug: 'van-chuyen' },
] as const;

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Về Tubu Tree (cùng nội dung với `about.tsx` của Mini App): giới thiệu, FAQ, liên hệ, chính sách; khách đã đăng nhập có thêm xoá tài khoản và đăng xuất. */
export function AboutView() {
  const phase = useAuthPhase();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader title="Về Tubu Tree" />
      <section className="mt-4 rounded-card bg-forest-800 p-5 text-stone-0 shadow-card">
        <TreePine className="h-8 w-8" aria-hidden="true" />
        <h2 className="mt-2 font-display text-xl font-semibold">Sống Xanh An Lành</h2>
        <p className="mt-2 max-w-3xl text-sm text-stone-100">
          Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên. Chúng tôi kết nối bạn với những thương hiệu Việt tử tế — minh bạch
          nguồn gốc, lành cho da, nhẹ với đất.
        </p>
      </section>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <FaqSection />
        </div>
        <SupportSection />
        <Section title="Điều khoản & Chính sách">
          {POLICY_LINKS.map((p, i) => (
            <Link
              key={p.slug}
              href={`/chinh-sach/${p.slug}`}
              className={`flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-stone-900 hover:text-forest-700 ${i < POLICY_LINKS.length - 1 ? 'border-b border-stone-200' : ''}`}
            >
              {p.label}
              <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
            </Link>
          ))}
        </Section>
        {phase === 'authenticated' && (
          <div className="md:col-span-2">
            <AccountSection />
          </div>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${ui.card} p-4`}>
      <h2 className="mb-2 font-display text-base font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function FaqSection() {
  const faqQ = useQuery({ ...faqsQuery(coreHttp), staleTime: STALE_MS });
  const configQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: STALE_MS });
  const [open, setOpen] = useState<number | null>(0);
  const [cat, setCat] = useState(ALL_CATS);

  // FAQ do admin nhập; chưa có dòng nào hoặc lỗi mạng thì dùng bản dự phòng. Đang tải thì chưa hiện gì để khỏi nháy nội dung.
  const faq = faqQ.data && faqQ.data.length > 0 ? faqQ.data : faqQ.isLoading ? [] : fallbackFaq(configQ.data);
  const cats = [ALL_CATS, ...new Set(faq.map((f) => f.cat))];
  const shown = faq.filter((f) => cat === ALL_CATS || f.cat === cat);

  return (
    <Section title="Câu hỏi thường gặp">
      <div role="group" aria-label="Nhóm câu hỏi" className="mb-1 flex flex-wrap gap-2 py-1.5">
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
              className={`min-h-11 rounded-control border px-4 text-sm font-medium transition active:scale-95 ${
                selected ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50'
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

function SupportSection() {
  const supportQ = useQuery({ ...supportContactQuery(coreHttp), staleTime: STALE_MS });
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  const oa = platformBridge.oa.available;
  // Dòng chưa có giá trị thì ẩn hẳn (Q-17), không hiện nhãn trống.
  const rows: { label: string; value: ReactNode }[] = [];
  if (support?.hotline) {
    rows.push({
      label: 'Hotline',
      value: (
        <a href={telHref(support.hotline)} aria-label={`Hotline ${formatPhoneDisplay(support.hotline)}, bấm để gọi`} className={`${ui.backLink} font-semibold`}>
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
        <a href={`mailto:${support.email}`} className={`${ui.backLink} break-all`}>
          {support.email}
        </a>
      ),
    });
  }
  if (rows.length === 0) return null;
  return (
    <Section title="Hỗ trợ khách hàng">
      {rows.map((r, i) => (
        <div key={r.label} className={`flex min-h-11 items-center justify-between gap-3 py-1 ${i < rows.length - 1 ? 'border-b border-stone-200' : ''}`}>
          <span className="text-sm text-stone-600">{r.label}</span>
          {r.value}
        </div>
      ))}
    </Section>
  );
}

/** Ghi nhận yêu cầu xoá THẬT (không xoá ngay: CSKH xác minh và xử lý), cùng endpoint với Mini App. */
function AccountSection() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({ mutationFn: () => requestAccountDeletion(coreHttp) });
  const oa = platformBridge.oa.available;

  return (
    <div className="grid gap-3">
      {del.isSuccess ? (
        <div role="status" className="rounded-card bg-stone-100 p-4">
          <p className="text-sm text-stone-900">{del.data.message}</p>
          {oa && (
            <button type="button" onClick={() => void platformBridge.oa.openChat(DELETE_OA_MESSAGE)} className={`${ui.btnSecondary} mt-3`}>
              Nhắn Zalo OA về việc xóa tài khoản
            </button>
          )}
        </div>
      ) : confirming ? (
        <div className="rounded-card bg-danger-bg p-4">
          <p className="text-sm font-bold text-danger-fg">Xóa tài khoản vĩnh viễn?</p>
          <p className="mt-1 text-xs text-stone-700">
            Gửi yêu cầu để CSKH liên hệ xác minh và xử lý xóa tài khoản theo quy định — tài khoản CHƯA bị xóa ngay khi bạn bấm nút này.
          </p>
          {del.isError && (
            <p role="alert" className={`mt-2 ${ui.error}`}>
              {del.error instanceof Error && del.error.message ? del.error.message : DELETE_FAILED}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={`${ui.btnSecondary} flex-1`}>
              Hủy
            </button>
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => del.mutate()}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 transition active:scale-95 disabled:opacity-60"
            >
              Gửi yêu cầu xóa
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${ui.btnSecondary} w-full text-danger-fg`}>
          Xóa tài khoản
        </button>
      )}
      <button type="button" onClick={() => void logout()} className={`${ui.btnSecondary} w-full`}>
        Đăng xuất
      </button>
    </div>
  );
}
