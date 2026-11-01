'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const [agreed, setAgreed] = useState(false);
  const walletQ = useQuery({ ...walletQuery(coreHttp), enabled: confirming });
  const balance = walletQ.data?.walletBalance;
  const del = useMutation({
    mutationFn: () => requestAccountDeletion(coreHttp, undefined, walletForfeitConsent(balance, agreed)),
    onError: () => {
      setAgreed(false);
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const oa = platformBridge.oa.available;

  return (
    <div className="grid gap-3">
      {del.isSuccess ? (
        <div role="status" className="rounded-card bg-stone-100 p-4">
          <p className="text-sm text-stone-900">{del.data.message}</p>
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
          {walletQ.isLoading && <p className="mt-2 text-xs text-stone-600">{WALLET_FORFEIT_LOADING}</p>}
          {walletQ.isError && (
            <p role="alert" className={`mt-2 ${ui.error}`}>
              {WALLET_FORFEIT_UNKNOWN}
            </p>
          )}
          {balance !== undefined && balance > 0 && (
            <div className="mt-3">
              <p className="text-sm font-bold text-stone-900">{walletForfeitNotice(formatVnd(balance))}</p>
              <label className="mt-2 flex min-h-11 items-start gap-2 text-xs text-stone-700">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 shrink-0" style={{ accentColor: 'var(--color-action-primary-bg)' }} />
                <span>{WALLET_FORFEIT_AGREE}</span>
              </label>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setAgreed(false);
              }}
              className={`${ui.btnSecondary} w-24 shrink-0 ${mini.secondary}`}
            >
              Huỷ
            </button>
            <button
              type="button"
              disabled={del.isPending || !canSubmitDeletion(balance, agreed)}
              onClick={() => del.mutate()}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 transition active:scale-95 disabled:opacity-60"
            >
              Gửi yêu cầu xoá
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${ui.btnSecondary} w-full text-danger-fg max-md:border-transparent max-md:bg-[var(--color-bg-surface)] max-md:text-[color:var(--color-text-danger)] max-md:shadow-[var(--elevation-1)]`}>
          Xoá tài khoản
        </button>
      )}
    </div>
  );
}
