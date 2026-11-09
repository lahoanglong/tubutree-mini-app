'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { mini } from '@/components/order-mobile/mobile-ui';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
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
    onError: () => setConfirming(false),
  });

  return (
    <>
      <button
        type="button"
        disabled={logoutAllM.isPending}
        onClick={() => {
          if (logoutAllM.isPending) return;
          logoutAllM.reset();
          setConfirming(true);
        }}
        className={`${ui.btnSecondary} w-full ${mini.secondary}`}
      >
        Đăng xuất mọi thiết bị
      </button>
      {logoutAllM.isError && (
        <p role="alert" className={ui.error}>
          {actionErrorText(logoutAllM.error)}
        </p>
      )}
      <ConfirmSheet
        open={confirming}
        title="Đăng xuất khỏi mọi thiết bị?"
        message="Mọi máy đang đăng nhập tài khoản này, kể cả máy này, sẽ phải đăng nhập lại."
        confirmLabel="Đăng xuất mọi máy"
        loading={logoutAllM.isPending}
        onConfirm={() => {
          if (logoutAllM.isPending) return;
          logoutAllM.mutate();
        }}
        onCancel={() => {
          if (logoutAllM.isPending) return;
          setConfirming(false);
        }}
      />
    </>
  );
}
