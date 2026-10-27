'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Check, Copy, Plus, Share2, Store } from 'lucide-react';
import { followBrand, unfollowBrand } from '@tubutree/app-core/api/brand';
import { brandFollowQuery, brandShareToEarnQuery } from '@tubutree/app-core/queries/brand';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { Sheet } from '@/components/ui/sheet';
import { QrCode } from '@/components/ui/qr-code';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneSecondary } from '@/lib/phone-ui';
import { platformBridge } from '@/lib/platform-bridge';
import { loginHref } from '@/lib/return-to';
import { isWebRouteReady } from '@/lib/route-map';

type Note = { text: string; error: boolean } | null;

// Bài mẫu cho CTV; biểu tượng ghi bằng escape vì là chữ mẫu họ đăng lên mạng xã hội, không phải icon giao diện.
const LEAF = '\u{1F33F}';
const HEART = '\u{1F49A}';

/**
 * Hàng hành động của trang nhãn: số người theo dõi, Theo dõi/Bỏ theo dõi, Chia sẻ và dải chia sẻ kiếm tiền cho CTV đủ điều kiện.
 * Trang nhãn công khai và render sẵn ở server; mọi thứ theo từng người xem (trạng thái theo dõi, tư cách CTV) chỉ tải ở trình duyệt
 * khi đã đăng nhập. Khách chạm Theo dõi thì sang đăng nhập rồi quay lại đúng trang.
 */
export function BrandActions({ slug, name, followerCount }: { slug: string; name: string; followerCount: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const { retrySession } = useAuth();
  const authed = phase === 'authenticated';
  const [note, setNote] = useState<Note>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const followQ = useQuery({ ...brandFollowQuery(coreHttp, slug), enabled: authed, retry: false });
  // Lỗi hoặc không phải CTV thì coi như ẩn dải, không chặn phần còn lại của trang.
  const steQ = useQuery({ ...brandShareToEarnQuery(coreHttp, slug), enabled: authed, retry: false, staleTime: 60_000 });
  const ste = steQ.data;
  const eligible = ste?.eligible === true;
  const myRef = ste?.eligible ? ste.referralCode : null;
  const following = followQ.data?.following === true;
  const count = followQ.data?.followerCount ?? followerCount;

  const followMut = useMutation({
    mutationFn: () => (following ? unfollowBrand(coreHttp, slug) : followBrand(coreHttp, slug)),
    onSuccess: (r) => {
      qc.setQueryData(brandFollowQuery(coreHttp, slug).queryKey, r);
      setNote({ text: r.following ? 'Đã theo dõi nhãn' : 'Đã bỏ theo dõi', error: false });
    },
    onError: () => setNote({ text: 'Cần đăng nhập để theo dõi nhãn.', error: true }),
  });

  const onFollow = () => {
    if (authed) {
      setNote(null);
      followMut.mutate();
    } else if (phase === 'unavailable') void retrySession();
    else if (phase === 'guest') router.push(loginHref(`${window.location.pathname}${window.location.search}`));
  };

  return (
    <div className="mt-3 max-md:mt-0">
      {count > 0 && <p className="text-xs text-stone-600 max-md:mt-0.5 max-md:text-[length:var(--type-caption-size)] max-md:text-[var(--color-text-tertiary)]">{count} người theo dõi</p>}
      {/* Điện thoại: thanh dính đáy như StickyActionBar của Mini App (Theo dõi nền nhạt + Chia sẻ nền đậm); từ md nằm ngay dưới tên. */}
      <div
        data-testid="brand-actions-bar"
        data-sticky-bar
        className="max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:bg-stone-0 max-md:p-4 max-md:pb-[calc(16px+var(--safe-bottom))] max-md:shadow-[var(--elevation-3)]"
      >
        <div className="mt-2 flex gap-2 max-md:mt-0 md:justify-end">
          <button
            type="button"
            aria-pressed={authed ? following : undefined}
            disabled={followMut.isPending}
            onClick={onFollow}
            className={`${ui.btnSecondary} ${phoneSecondary} flex-1 gap-1.5 md:w-auto md:min-w-48 md:flex-none`}
          >
            {following ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {following ? 'Đang theo dõi' : 'Theo dõi'}
          </button>
          <button type="button" onClick={() => setShareOpen(true)} className={`${ui.btnPrimary} flex-1 gap-1.5 md:w-auto md:min-w-48 md:flex-none`}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Chia sẻ
          </button>
        </div>
        {note && (
          <p role={note.error ? 'alert' : 'status'} className={`mt-2 text-sm ${note.error ? 'text-danger-fg' : 'text-success-fg'}`}>
            {note.text}
          </p>
        )}
      </div>

      {ste?.eligible && (
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="mt-3 block min-h-11 w-full rounded-card border border-forest-200 bg-forest-50 p-3 text-left"
        >
          <span className="flex items-center gap-1.5 text-sm font-bold text-forest-800">
            <BadgePercent className="h-[18px] w-[18px]" aria-hidden="true" />
            {ste.maxAffiliateRate > 0 ? `Chia sẻ nhãn này — nhận tới ${ste.maxAffiliateRate}% hoa hồng` : 'Chia sẻ nhãn này'}
          </span>
          <span className="mt-0.5 block text-xs text-forest-700">Bấm để lấy link + lời đăng gắn mã giới thiệu của bạn.</span>
        </button>
      )}

      <BrandShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={slug}
        name={name}
        referralCode={myRef}
        captions={
          eligible
            ? [`Mình tin dùng ${name} ${LEAF} Ghé xem & ưu đãi nha`, `${name} — hàng chính hãng, sống xanh ${HEART}`]
            : []
        }
      />
    </div>
  );
}

function BrandShareSheet({
  open,
  onClose,
  slug,
  name,
  referralCode,
  captions: base,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  name: string;
  referralCode: string | null;
  captions: string[];
}) {
  const [note, setNote] = useState<Note>(null);
  if (!open) return null;

  // Mã giới thiệu đi cùng cả link sao chép lẫn nút chia sẻ, nếu không CTV mất hoa hồng khi khách mở từ nút chia sẻ.
  const path = referralCode ? `/brand/${encodeURIComponent(slug)}?ref=${encodeURIComponent(referralCode)}` : `/brand/${encodeURIComponent(slug)}`;
  const url = `${window.location.origin}${path}`;
  const captions = base.map((c) => (c.includes(url) ? c : `${c} ${url}`));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ text: 'Đã sao chép', error: false });
    } catch {
      setNote({ text: 'Không sao chép được — hãy chọn và chép thủ công.', error: true });
    }
  };
  const share = async () => {
    setNote(null);
    const text = base[0];
    const result = await platformBridge.share({ title: `Cửa hàng ${name}`, ...(text ? { text } : {}), path });
    if (result === 'copied') setNote({ text: 'Đã sao chép', error: false });
    else if (result === 'failed') setNote({ text: 'Không sao chép được — hãy chọn và chép thủ công.', error: true });
  };

  return (
    <Sheet open onClose={onClose} title="Chia sẻ nhãn hàng" size="auto">
      <div className="mb-3 flex justify-center">
        <QrCode value={url} />
      </div>
      <p className="mb-3 break-all text-center text-xs text-stone-600">{url}</p>
      <div className="mb-3 flex flex-col gap-2">
        <button type="button" className={`${ui.btnPrimary} w-full gap-2`} onClick={() => void share()}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Chia sẻ qua thiết bị
        </button>
        <button type="button" className={`${ui.btnSecondary} w-full gap-2`} onClick={() => void copy(url)}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Sao chép link
        </button>
        {note && (
          <p role={note.error ? 'alert' : 'status'} className={`text-sm ${note.error ? 'text-danger-fg' : 'text-success-fg'}`}>
            {note.text}
          </p>
        )}
      </div>
      {captions.length > 0 && (
        <>
          <p className="mb-1.5 text-sm font-semibold text-stone-900">Lời đăng gợi ý (chạm để sao chép)</p>
          <div className="flex flex-col gap-1.5">
            {captions.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => void copy(c)}
                className="min-h-11 w-full rounded-control bg-stone-100 px-3 py-2 text-left text-sm text-stone-700"
              >
                {c}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Mã giảm giá của khuyến mãi nhãn: chạm để chép, khách dán ở bước thanh toán (cùng chữ báo với Mini App). */
export function BrandPromoCode({ code }: { code: string | null | undefined }) {
  const [note, setNote] = useState<string | null>(null);
  if (!code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setNote(`Đã chép mã ${code} — dán ở bước thanh toán`);
    } catch {
      setNote(`Mã giảm giá: ${code}`);
    }
  };
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-label={`Sao chép mã ${code}`}
        onClick={() => void copy()}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-dashed border-promo-solid bg-stone-0 px-3 text-sm font-bold text-promo-fg"
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        {code}
      </button>
      {note && (
        <p role="status" className="mt-1 text-sm text-success-fg">
          {note}
        </p>
      )}
    </div>
  );
}

const PERIOD_LABEL = (p: string) => (p === 'YEAR' ? 'năm' : 'quý');

/**
 * Chương trình thưởng đại lý của nhãn, hiện cho mọi người như Mini App (khối này là lời mời vào kênh đại lý); chữ nút theo
 * trạng thái hồ sơ: đã duyệt "Vào kênh đại lý", đang chờ "Xem hồ sơ đại lý", còn lại "Đăng ký đại lý". Nút chỉ hiện khi trang
 * /dai-ly đã có trên web.
 */
export function BrandDealerBlock({ rewards }: { rewards: { id: string; title: string; description?: string | null; threshold: number; period: string }[] }) {
  const phase = useAuthPhase();
  const meQ = useQuery({ ...dealerMeQuery(coreHttp), enabled: phase === 'authenticated' && rewards.length > 0, retry: false });
  const me = meQ.data;
  const approved = me?.isDealer === true || me?.status === 'APPROVED';
  const pending = me?.status === 'PENDING';
  if (rewards.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-1.5 font-display font-semibold text-stone-900">
        <Store className="h-4 w-4 text-forest-600" aria-hidden="true" />
        <span>Chương trình đại lý</span>
      </h2>
      <div className="space-y-2">
        {rewards.map((d) => (
          <div key={d.id} className="rounded-card border border-stone-200 bg-stone-0 p-3">
            <p className="text-sm font-bold text-stone-900">{d.title}</p>
            {d.description && <p className="text-xs text-stone-700">{d.description}</p>}
            <p className="mt-0.5 text-xs text-stone-600">
              Đạt doanh số {formatVnd(d.threshold)} / {PERIOD_LABEL(d.period)}
            </p>
          </div>
        ))}
      </div>
      {isWebRouteReady('/dai-ly') && (
        <Link href="/dai-ly" className={`${ui.btnSecondary} mt-3`}>
          {approved ? 'Vào kênh đại lý' : pending ? 'Xem hồ sơ đại lý' : 'Đăng ký đại lý'}
        </Link>
      )}
    </section>
  );
}
