'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requestAccountDeletion } from '@tubutree/app-core/api/account';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import {
  WALLET_FORFEIT_AGREE,
  WALLET_FORFEIT_LOADING,
  WALLET_FORFEIT_UNKNOWN,
  canSubmitDeletion,
  walletForfeitConsent,
  walletForfeitNotice,
} from '@tubutree/app-core/account-deletion-copy';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { mini } from '@/components/order-mobile/mobile-ui';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { formatVnd } from '@/lib/format-vnd';
import { platformBridge } from '@/lib/platform-bridge';
import { actionErrorText } from '@/lib/error-text';

const DELETE_OA_MESSAGE = 'Tôi muốn xoá tài khoản Tubu Tree';

/** Ghi nhận yêu cầu xoá THẬT (không xoá ngay: CSKH xác minh và xử lý), cùng endpoint với Mini App. */
export function AccountDeletionSection() {
  const [confirming, setConfirming] = useState(false);
  const qc = useQueryClient();
  const [agreedBalance, setAgreedBalance] = useState<number | null>(null);
  const walletQ = useQuery({ ...walletQuery(coreHttp), enabled: confirming });
  const balance = walletQ.data?.walletBalance;
  // Đồng ý bỏ số dư gắn với đúng số tiền khách đã thấy: số dư đổi (Thử lại, tải lại sau lỗi) thì phải tick lại.
  const agreed = balance !== undefined && agreedBalance === balance;
  // Truy vấn lỗi mà chưa có số dư bị react-query đặt về pending lúc tải lại và xoá lỗi; giữ vùng lỗi + nút Thử lại đứng yên
  // (không mất focus) tới khi lượt tải lại có kết quả.
  const [walletRetrying, setWalletRetrying] = useState(false);
  const walletWaiting = walletRetrying && walletQ.isPending;
  const walletRetryLock = useRef(false);
  // Yêu cầu xoá không hoàn tác: phần đồng ý tính ở nút theo đúng số dư khách đang thấy rồi truyền vào, không đọc lại state lúc lệnh thực sự chạy.
  // Khoá ref chặn cú bấm thứ hai ngay trong khung hình (`isPending` chỉ đúng sau lần vẽ kế) và nhả ở `onSettled`, cả khi lỗi.
  const del = useLockedMutation({
    mutationFn: (consent: ReturnType<typeof walletForfeitConsent>) => requestAccountDeletion(coreHttp, undefined, consent),
    onError: () => {
      setAgreedBalance(null);
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const oa = platformBridge.oa.available;

  return (
    <div className="grid gap-3">
      {del.isSuccess ? (
        <div role="status" className="rounded-card bg-stone-100 p-4">
          <p className="text-sm text-stone-900">{del.data?.message}</p>
          {oa && (
            <button type="button" onClick={() => void platformBridge.oa.openChat(DELETE_OA_MESSAGE)} className={`${ui.btnSecondary} mt-3`}>
              Nhắn Zalo OA về việc xoá tài khoản
            </button>
          )}
        </div>
      ) : confirming ? (
        <div className="rounded-card bg-danger-bg p-4">
          <p className="text-sm font-bold text-danger-fg">Xoá tài khoản vĩnh viễn?</p>
          <p className="mt-1 text-xs text-stone-700">
            Gửi yêu cầu để CSKH liên hệ xác minh và xử lý xoá tài khoản theo quy định — tài khoản CHƯA bị xoá ngay khi bạn bấm nút này.
          </p>
          {del.isError && (
            <p role="alert" className={`mt-2 ${ui.error}`}>
              {actionErrorText(del.error)}
            </p>
          )}
          {walletQ.isLoading && !walletWaiting && <p className="mt-2 text-xs text-stone-600">{WALLET_FORFEIT_LOADING}</p>}
          {walletQ.isError || walletWaiting ? (
            <div role="alert" className="mt-2 flex flex-wrap items-center gap-2">
              <p className={`min-w-0 flex-1 ${ui.error}`}>{WALLET_FORFEIT_UNKNOWN}</p>
              <button
                type="button"
                disabled={del.isPending}
                aria-busy={walletQ.isFetching || undefined}
                aria-disabled={walletQ.isFetching || undefined}
                onClick={() => {
                  if (walletRetryLock.current || walletQ.isFetching || del.isPending) return;
                  walletRetryLock.current = true;
                  setWalletRetrying(true);
                  const release = () => {
                    walletRetryLock.current = false;
                  };
                  void walletQ.refetch().then(release, (err: unknown) => {
                    release();
                    throw err;
                  });
                }}
                className={`${ui.btnSecondary} shrink-0`}
              >
                Thử lại
              </button>
            </div>
          ) : null}
          {balance !== undefined && balance > 0 && (
            <div className="mt-3">
              <p className="text-sm font-bold tabular-nums text-stone-900">{walletForfeitNotice(formatVnd(balance))}</p>
              <label className="mt-2 flex min-h-11 items-start gap-2 text-xs text-stone-700">
                <input type="checkbox" checked={agreed} disabled={del.isPending} onChange={(e) => setAgreedBalance(e.target.checked ? (balance ?? null) : null)} className="mt-0.5 size-5 shrink-0" style={{ accentColor: 'var(--color-action-primary-bg)' }} />
                <span>{WALLET_FORFEIT_AGREE}</span>
              </label>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => {
                if (del.isPending) return;
                del.reset();
                setConfirming(false);
                setAgreedBalance(null);
                setWalletRetrying(false);
              }}
              className={`${ui.btnSecondary} w-24 shrink-0 ${mini.secondary}`}
            >
              Huỷ
            </button>
            {/* Đang gửi giữ aria-busy/aria-disabled chứ không `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */}
            <button
              type="button"
              disabled={!canSubmitDeletion(balance, agreed)}
              aria-busy={del.isPending || undefined}
              aria-disabled={del.isPending || undefined}
              onClick={() => {
                if (del.isPending || !canSubmitDeletion(balance, agreed)) return;
                del.mutate(walletForfeitConsent(balance, agreed));
              }}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 transition active:scale-95 disabled:opacity-60 aria-disabled:opacity-60"
            >
              {del.isPending ? 'Đang gửi…' : 'Gửi yêu cầu xoá'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            del.reset();
            setConfirming(true);
          }}
          className={`${ui.btnSecondary} w-full text-danger-fg max-md:border-transparent max-md:bg-transparent max-md:text-[color:var(--color-text-danger)] max-md:shadow-none`}
        >
          Xoá tài khoản
        </button>
      )}
    </div>
  );
}
