'use client';

import { useEffect, useState } from 'react';
import { getSupportQr, startSupportQr, type SupportQrState } from '@/lib/admin-client';
import { BTN_PRIMARY, BTN_SECONDARY } from '../ui';

const POLL_MS = 2000;
const TERMINAL = new Set(['SUCCESS', 'EXPIRED', 'FAILED']);

const COPY: Record<string, string> = {
  IDLE: 'Đang chờ mã QR…',
  WAITING_SCAN: 'Mở Zalo trên điện thoại của tài khoản cầu nối, quét mã này rồi xác nhận đăng nhập.',
  SCANNED: 'Đã quét. Xác nhận đăng nhập trên điện thoại.',
  SUCCESS: 'Đã đăng nhập.',
  EXPIRED: 'Mã QR đã hết hạn.',
  FAILED: 'Đăng nhập không thành công.',
};

/** Hộp quét QR đăng nhập cầu nối. Hỏi trạng thái mỗi 2 giây cho tới khi xong, hết hạn, lỗi hoặc đóng hộp. */
export function QrModal({ initial, onClose, onSuccess }: { initial: SupportQrState; onClose: () => void; onSuccess: () => void }) {
  const [qr, setQr] = useState<SupportQrState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [round, setRound] = useState(0);
  const done = TERMINAL.has(qr.status);

  useEffect(() => {
    if (done) return;
    let stopped = false;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      getSupportQr()
        .then((r) => {
          if (stopped) return;
          setError(null);
          setQr((prev) => ({ ...r, image: r.image ?? prev.image }));
          if (r.status === 'SUCCESS') onSuccess();
        })
        .catch((e: unknown) => {
          if (!stopped) setError(e instanceof Error ? e.message : 'Không hỏi được trạng thái đăng nhập.');
        })
        .finally(() => {
          busy = false;
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // onSuccess đổi theo mỗi lần render của cha; chỉ vòng hỏi mới (round) hoặc trạng thái cuối mới dựng lại bộ hẹn giờ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, round]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      setQr(await startSupportQr());
      setRound((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lấy được mã QR mới.');
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/40 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-sheet bg-stone-0 p-5 shadow-raised"
      >
        <h2 id="qr-modal-title" className="font-display text-base font-semibold text-stone-900">
          Đăng nhập Zalo cho cầu nối
        </h2>
        {qr.image && !done && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.image} alt="Mã QR đăng nhập Zalo" className="mx-auto mt-3 h-56 w-56 rounded-control border border-stone-200" />
        )}
        <p role="status" className="mt-3 text-sm text-stone-600">
          {COPY[qr.status] ?? qr.status}
          {qr.status === 'SUCCESS' && qr.displayName ? ` Tài khoản: ${qr.displayName}.` : ''}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {(qr.status === 'EXPIRED' || qr.status === 'FAILED') && (
            <button type="button" className={BTN_PRIMARY} disabled={restarting} onClick={() => void restart()}>
              {restarting ? 'Đang lấy…' : 'Lấy mã mới'}
            </button>
          )}
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
