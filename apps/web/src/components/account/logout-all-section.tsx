'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { mini } from '@/components/order-mobile/mobile-ui';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/client-api';
import { actionErrorText } from '@/lib/error-text';
import { ui } from '@/lib/guest-ui';

/** Đăng xuất mọi thiết bị (cùng nội dung với `logout-all-section.tsx` của Mini App): máy chủ cắt hết phiên, rồi máy này tự đăng xuất. */
export function LogoutAllSection() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const logoutAllM = useMutation({
    mutationFn: () => apiFetch('/auth/logout-all', { method: 'POST' }),
    onSuccess: () => void logout(),
  });

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${ui.btnSecondary} w-full ${mini.secondary}`}>
        Đăng xuất mọi thiết bị
      </button>
    );
  }
  return (
    <div className={`${ui.card} p-4 ${mini.card}`}>
      <p className="text-sm font-bold text-stone-900">Đăng xuất khỏi mọi thiết bị?</p>
      <p className="mt-1 text-xs text-stone-700">Mọi máy đang đăng nhập tài khoản này, kể cả máy này, sẽ phải đăng nhập lại.</p>
      {logoutAllM.isError && (
        <p role="alert" className={`mt-2 ${ui.error}`}>
          {actionErrorText(logoutAllM.error)}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={logoutAllM.isPending} onClick={() => setConfirming(false)} className={`${ui.btnSecondary} w-24 shrink-0 ${mini.secondary}`}>
          Huỷ
        </button>
        <button type="button" disabled={logoutAllM.isPending} onClick={() => logoutAllM.mutate()} className={`${ui.btnPrimary} flex-1`}>
          Đăng xuất mọi máy
        </button>
      </div>
    </div>
  );
}
