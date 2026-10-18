'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Gift, Loader2, User } from 'lucide-react';
import { updateMe } from '@tubutree/app-core/api/account';
import { meQuery } from '@tubutree/app-core/queries/account';
import { AvatarCropSheet } from '@/components/account/avatar-crop-sheet';
import { isCloudinaryConfigured, uploadToCloudinary } from '@/components/account/cloudinary-upload';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { MAX_IMAGE_BYTES, isUsableImageFile, readAndCompressImage } from '@/lib/image-compress';
import { formatPhoneDisplay } from '@/lib/phone-display';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AVATAR_NO_STORAGE = 'Chưa đổi được ảnh đại diện lúc này vì dịch vụ lưu ảnh chưa được bật. Bạn vẫn sửa được tên, email và ngày sinh.';
const AVATAR_UPLOAD_FAILED = 'Chưa tải được ảnh lên nên ảnh đại diện chưa đổi. Bạn thử lại nhé.';
const AVATAR_NOT_SAVED = 'Đã lưu hồ sơ, riêng ảnh đại diện chưa lưu được. Bạn thử chọn lại ảnh sau nhé.';
const AVATAR_READ_FAILED = 'Không tải được ảnh, vui lòng thử lại.';
const SAVE_FAILED = 'Chưa lưu được. Bạn thử lại sau ít phút nhé.';

// Ảnh đã cắt là data URL; đổi sang Blob bằng atob thay vì fetch vì CSP connect-src của web không mở cho data:.
function dataUrlToBlob(dataUrl: string): Blob {
  const [head = '', body = ''] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: /^data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg' });
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : SAVE_FAILED);

/** Sửa hồ sơ (cùng PATCH /me với `edit-profile.tsx` của Mini App): họ tên, email, ngày sinh, ảnh đại diện; SĐT chỉ đọc. */
export default function EditProfilePage() {
  const { user, updateProfile } = useAuth();
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const meQ = useQuery({ ...meQuery(coreHttp), enabled: phase === 'authenticated' });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  // Chỉ nhận URL đã lưu (từ hồ sơ hoặc vừa tải lên Cloudinary): API không nhận base64 cho ảnh đại diện.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [touched, setTouched] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canChangeAvatar = isCloudinaryConfigured();

  const me = meQ.data;
  useEffect(() => {
    if (!me) return;
    setFullName(me.fullName ?? '');
    setEmail(me.email ?? '');
    setAvatarUrl(me.avatarUrl ?? user?.avatarUrl ?? null);
    setDob(me.dob ?? '');
    // Chỉ nạp lại khi /me đổi, không theo `user`: phiên đổi sau khi lưu không được ghi đè chữ khách đang gõ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const emailInvalid = touched && email.trim() !== '' && !EMAIL.test(email.trim());

  const handleAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarMsg(null);
    setUploadingAvatar(true);
    try {
      if (!isUsableImageFile(file) || file.size > MAX_IMAGE_BYTES) throw new Error('not-image');
      setCropSrc(await readAndCompressImage(file));
    } catch {
      setAvatarMsg({ kind: 'error', text: AVATAR_READ_FAILED });
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmCrop = async (croppedUrl: string) => {
    // Xem trước ngay bằng ảnh đã cắt, nhưng chỉ URL Cloudinary mới được giữ làm ảnh đại diện: tải lên lỗi thì nói thẳng
    // và giữ ảnh cũ, không báo "đã chọn" rồi âm thầm bỏ ảnh lúc lưu.
    setAvatarPreview(croppedUrl);
    setCropSrc(null);
    setUploadingAvatar(true);
    try {
      const secureUrl = await uploadToCloudinary(dataUrlToBlob(croppedUrl));
      if (secureUrl) {
        setAvatarUrl(secureUrl);
        setAvatarChanged(true);
        setAvatarMsg({ kind: 'ok', text: 'Đã chọn ảnh đại diện mới. Bấm "Lưu thay đổi" để lưu.' });
      } else {
        setAvatarMsg({ kind: 'error', text: AVATAR_UPLOAD_FAILED });
      }
    } catch {
      setAvatarMsg({ kind: 'error', text: AVATAR_UPLOAD_FAILED });
    } finally {
      setAvatarPreview(null);
      setUploadingAvatar(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      // API chỉ cho đặt ngày sinh một lần và từ chối cả khi gửi lại đúng giá trị cũ, nên đã có thì không gửi.
      const base = { fullName: fullName.trim() || undefined, email: email.trim() || undefined, dob: !me?.dob && dob ? dob : undefined };
      try {
        return { avatarSkipped: false, res: await updateMe(coreHttp, { ...base, avatarUrl: avatarUrl ?? undefined }) };
      } catch (err) {
        // Ảnh cũ không hợp lệ không được chặn việc sửa tên/email/ngày sinh; việc bỏ ảnh được báo ở onSuccess.
        if (err instanceof Error && err.message.includes('avatarUrl')) return { avatarSkipped: true, res: await updateMe(coreHttp, base) };
        throw err;
      }
    },
    onSuccess: ({ res, avatarSkipped }) => {
      setSaveError(null);
      updateProfile({
        fullName: fullName.trim() || user?.fullName || null,
        avatarUrl: avatarSkipped ? (user?.avatarUrl ?? null) : (avatarUrl ?? res?.avatarUrl ?? user?.avatarUrl ?? null),
      });
      void qc.invalidateQueries({ queryKey: ['me'] });
      setDone(avatarSkipped && avatarChanged ? AVATAR_NOT_SAVED : 'Đã cập nhật hồ sơ');
    },
    onError: (e) => {
      setDone(null);
      setSaveError(errorText(e));
    },
  });

  const submit = () => {
    setTouched(true);
    if (save.isPending || uploadingAvatar) return;
    if (email.trim() !== '' && !EMAIL.test(email.trim())) return;
    setDone(null);
    setSaveError(null);
    save.mutate();
  };

  const shell = (body: React.ReactNode) => (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader title="Sửa hồ sơ" backHref="/tai-khoan" backLabel="Quay lại tài khoản" />
      {body}
    </main>
  );

  if (phase === 'loading') return shell(<AuthLoading />);
  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest' || !user) return shell(<LoginRequired message="Đăng nhập để sửa hồ sơ của bạn." returnTo="/tai-khoan/ho-so" />);

  if (meQ.isLoading) {
    return shell(
      <div className="mt-4 flex flex-col gap-3">
        <Skeleton height={100} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>,
    );
  }
  if (meQ.isError) {
    return shell(
      <div className="mt-4">
        <ErrorState message={errorText(meQ.error)} onRetry={() => void meQ.refetch()} />
      </div>,
    );
  }

  const shownAvatar = avatarPreview ?? avatarUrl;
  const avatarFigure = shownAvatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL Cloudinary hoặc data URL xem trước, domain không cố định
    <img src={shownAvatar} alt="" className="h-22 w-22 rounded-full border-[3px] border-stone-0 bg-stone-100 object-cover shadow-raised" style={{ width: 88, height: 88 }} />
  ) : (
    <span className="flex items-center justify-center rounded-full border-[3px] border-stone-0 bg-stone-100 text-stone-500 shadow-raised" style={{ width: 88, height: 88 }}>
      <User className="h-10 w-10" aria-hidden="true" />
    </span>
  );
  const phoneText = formatPhoneDisplay(me?.phone);

  return shell(
    <form
      noValidate
      className="mx-auto mt-4 flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col items-center py-2">
        {canChangeAvatar ? (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" hidden className="hidden min-h-11" aria-label="Chọn ảnh đại diện" onChange={(e) => void handleAvatarFile(e)} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-11 flex-col items-center">
              <span className="relative inline-block">
                {avatarFigure}
                <span aria-hidden="true" className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-stone-0 bg-forest-600 text-stone-0 shadow-card">
                  <Camera className="h-3.5 w-3.5" />
                </span>
              </span>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-forest-700">
                {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Camera className="h-3.5 w-3.5" aria-hidden="true" />}
                {uploadingAvatar ? 'Đang xử lý ảnh…' : 'Chạm để chọn & cắt ảnh đại diện'}
              </span>
            </button>
          </>
        ) : (
          <>
            {avatarFigure}
            <p className="mt-2 text-center text-xs text-stone-600">{AVATAR_NO_STORAGE}</p>
          </>
        )}
        {avatarMsg && (
          <p role={avatarMsg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-center text-sm ${avatarMsg.kind === 'error' ? 'text-danger-fg' : 'text-success-fg'}`}>
            {avatarMsg.text}
          </p>
        )}
      </div>

      <Field label="Họ và tên">
        <input type="text" value={fullName} maxLength={120} autoComplete="name" onChange={(e) => setFullName(e.target.value)} className={ui.field} />
      </Field>

      <Field label="Email" error={emailInvalid ? 'Email không hợp lệ' : undefined}>
        <input
          type="text"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          className={emailInvalid ? ui.fieldError : ui.field}
        />
      </Field>

      <div>
        <Field label="Ngày sinh">
          <input type="date" value={dob} readOnly={Boolean(me?.dob)} autoComplete="bday" onChange={(e) => setDob(e.target.value)} className={ui.field} />
        </Field>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-600">
          <Gift className="h-3.5 w-3.5" aria-hidden="true" />
          Nhận mã giảm giá quà tặng vào tháng sinh nhật.{me?.dob ? ' Ngày sinh chỉ đặt được một lần, cần chỉnh lại thì liên hệ CSKH.' : ''}
        </p>
      </div>

      <dl className="rounded-control bg-stone-50 px-3 py-2 text-sm">
        <dt className="text-xs text-stone-600">Số điện thoại</dt>
        <dd className="font-medium text-stone-900">{phoneText || 'Chưa có số điện thoại'}</dd>
      </dl>

      {saveError && (
        <p role="alert" className={ui.error}>
          {saveError}
        </p>
      )}
      <p role="status" className={done ? `text-sm ${done === AVATAR_NOT_SAVED ? 'text-warning-fg' : 'text-success-fg'}` : 'sr-only'}>
        {done ?? ''}
      </p>

      <button type="submit" aria-busy={save.isPending ? 'true' : undefined} disabled={emailInvalid || uploadingAvatar} className={`${ui.btnPrimary} w-full`}>
        {save.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Lưu thay đổi
          </>
        ) : (
          'Lưu thay đổi'
        )}
      </button>

      <AvatarCropSheet open={cropSrc !== null} imageSrc={cropSrc} onClose={() => setCropSrc(null)} onConfirm={(url) => void handleConfirmCrop(url)} />
    </form>,
  );
}
