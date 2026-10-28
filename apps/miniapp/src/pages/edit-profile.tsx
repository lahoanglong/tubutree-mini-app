import { useEffect, useRef, useState } from 'react';
import { Input, Page, useSnackbar, useNavigate } from 'zmp-ui';
import { Camera, Gift, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDobDisplay, profileCopy } from '@tubutree/app-core/account-copy';
import { getMe, updateMe } from '../services/account-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { isCloudinaryConfigured, readAndCompressImage, uploadToCloudinary } from '../components/image-upload';
import { ProfileAvatar } from '../components/account/profile-avatar';
import { AvatarCropModal } from '../components/avatar-crop-modal';
import { Button } from '../components/ui/button';
import { ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AVATAR_UPLOAD_FAILED = 'Chưa tải được ảnh lên nên ảnh đại diện chưa đổi. Bạn thử lại nhé.';
const AVATAR_NOT_SAVED = 'Đã lưu hồ sơ, riêng ảnh đại diện chưa lưu được. Bạn thử chọn lại ảnh sau nhé.';

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  // Chỉ nhận URL đã lưu (từ hồ sơ hoặc vừa tải lên Cloudinary): API không nhận base64 cho ảnh đại diện.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Ảnh vừa cắt, chỉ để xem trước trong lúc tải lên; không bao giờ được gửi đi.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const canChangeAvatar = isCloudinaryConfigured();
  const [dob, setDob] = useState('');
  const [touched, setTouched] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [confirmingDob, setConfirmingDob] = useState(false);

  // States for Avatar Crop Modal
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [rawImageForCrop, setRawImageForCrop] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (meQ.data) {
      setFullName(meQ.data.fullName ?? '');
      setEmail(meQ.data.email ?? '');
      // `||` vì chuỗi rỗng cũng là chưa có ảnh; ảnh Zalo đã lưu vào user lúc đăng nhập.
      setAvatarUrl(meQ.data.avatarUrl || useAuthStore.getState().user?.avatarUrl || null);
      setDob(meQ.data.dob ?? '');
    }
  }, [meQ.data]);

  // Ngày sinh chưa đặt mà khách vừa chọn: hỏi xác nhận trước khi lưu vì API không cho sửa lại.
  const dobNew = !meQ.data?.dob && dob !== '';
  const dobDisplay = formatDobDisplay(dob);
  const emailInvalid = touched && email.trim() !== '' && !EMAIL.test(email.trim());

  const handlePickAvatar = () => {
    if (!canChangeAvatar || confirmingDob) return;
    haptic('light');
    fileInputRef.current?.click();
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      // Compress initial raw photo for smooth cropping performance
      const dataUrl = await readAndCompressImage(file, 1000, 0.9);
      setRawImageForCrop(dataUrl);
      setCropModalVisible(true);
    } catch {
      openSnackbar({ text: 'Không tải được ảnh, vui lòng thử lại.', type: 'error', position: 'top' });
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmCrop = async (croppedUrl: string) => {
    // Xem trước ngay bằng ảnh đã cắt (không đợi mạng), nhưng chỉ URL Cloudinary mới được giữ làm ảnh đại diện: tải lên lỗi
    // thì nói thẳng và giữ ảnh cũ, không báo "đã chọn" rồi âm thầm bỏ ảnh lúc lưu.
    setAvatarPreview(croppedUrl);
    setCropModalVisible(false);
    setRawImageForCrop(null);
    setUploadingAvatar(true);
    try {
      const blob = await (await fetch(croppedUrl)).blob();
      const secureUrl = await uploadToCloudinary(blob);
      if (secureUrl) {
        setAvatarUrl(secureUrl);
        setAvatarChanged(true);
        openSnackbar({ text: 'Đã chọn ảnh đại diện mới. Bấm "Lưu thay đổi" để lưu.', type: 'success', position: 'top' });
      } else {
        openSnackbar({ text: AVATAR_UPLOAD_FAILED, type: 'error', position: 'top' });
      }
    } catch {
      openSnackbar({ text: AVATAR_UPLOAD_FAILED, type: 'error', position: 'top' });
    } finally {
      setAvatarPreview(null);
      setUploadingAvatar(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      // API chỉ cho đặt ngày sinh một lần và từ chối cả khi gửi lại đúng giá trị cũ, nên đã có thì không gửi.
      const dobToSend = !meQ.data?.dob && dob ? dob : undefined;
      try {
        const res = await updateMe({
          fullName: fullName.trim() || undefined,
          email: email.trim() || undefined,
          avatarUrl: avatarUrl ?? undefined,
          dob: dobToSend,
        });
        return { res, avatarSkipped: false };
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        if (msg.includes('avatarUrl')) {
          // Ảnh cũ không hợp lệ không được chặn việc sửa tên/email/ngày sinh; việc bỏ ảnh được báo ở onSuccess.
          const res = await updateMe({
            fullName: fullName.trim() || undefined,
            email: email.trim() || undefined,
            dob: dobToSend,
          });
          return { res, avatarSkipped: true };
        }
        throw err;
      }
    },
    onSuccess: ({ res, avatarSkipped }) => {
      haptic('medium');
      // Đồng bộ tên & avatar hiển thị vào auth store (header/profile).
      const cur = useAuthStore.getState().user;
      if (cur) {
        useAuthStore.setState({
          user: {
            ...cur,
            fullName: fullName.trim() || cur.fullName,
            avatarUrl: avatarSkipped ? cur.avatarUrl : (avatarUrl ?? res?.avatarUrl ?? cur.avatarUrl),
          },
        });
      }
      // Làm mới cache ['me'] để email/dob/avatar mới đồng bộ ở nơi khác.
      void qc.invalidateQueries({ queryKey: ['me'] });
      if (avatarSkipped && avatarChanged) {
        openSnackbar({ text: AVATAR_NOT_SAVED, type: 'warning', position: 'top' });
      } else {
        openSnackbar({ text: 'Đã cập nhật hồ sơ', type: 'success', position: 'top' });
      }
      navigate(-1);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error', position: 'top' }),
  });

  const avatarFigure = (
    <ProfileAvatar
      size={88}
      name={fullName}
      src={avatarPreview ?? avatarUrl}
      style={{
        border: '3px solid var(--color-bg-surface)',
        boxShadow: 'var(--elevation-2)',
        background: 'var(--color-bg-subtle)',
      }}
    />
  );

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Sửa hồ sơ" />
      {meQ.isLoading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton height={100} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : meQ.isError ? (
        <ErrorState message={getLoadErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />
      ) : (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Avatar Upload Section */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0' }}>
            {canChangeAvatar ? (
              <>
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFile} />
                <button
                  type="button"
                  className="tubu-press"
                  onClick={handlePickAvatar}
                  style={{
                    minHeight: 44,
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ position: 'relative', display: 'inline-block' }}>
                    {avatarFigure}
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--color-action-primary-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px solid var(--color-bg-surface)',
                        boxShadow: 'var(--elevation-1)',
                      }}
                    >
                      <Icon icon={Camera} size="sm" tone="inverse" />
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                    {uploadingAvatar ? (
                      <Icon icon={Loader2} size="sm" tone="brand" className="animate-spin" />
                    ) : (
                      <Icon icon={Camera} size="sm" tone="brand" />
                    )}
                    <Text variant="caption" tone="brand" style={{ fontWeight: 600 }}>
                      {uploadingAvatar ? 'Đang xử lý ảnh…' : 'Chạm để chọn & cắt ảnh đại diện'}
                    </Text>
                  </span>
                </button>
              </>
            ) : (
              avatarFigure
            )}
          </div>

          <Field label="Họ và tên">
            <Input value={fullName} readOnly={confirmingDob} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
          </Field>

          <Field label="Email" error={emailInvalid ? 'Email không hợp lệ' : undefined}>
            <Input
              type="text"
              value={email}
              readOnly={confirmingDob}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              status={emailInvalid ? 'error' : undefined}
            />
          </Field>

          <div>
            <Field label="Ngày sinh">
              <input
                {...(meQ.data?.dob ? { type: 'text', value: formatDobDisplay(meQ.data.dob) || dob } : { type: 'date', lang: 'vi', value: dob })}
                readOnly={Boolean(meQ.data?.dob) || confirmingDob}
                onChange={(e) => {
                  setDob(e.target.value);
                  setConfirmingDob(false);
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: 44,
                  padding: 12,
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--color-border-default)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--type-body-sm-size)',
                  background: 'var(--color-bg-surface)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </Field>
            {dobDisplay && dobNew && (
              <Text variant="caption" tone="secondary" style={{ marginTop: 4, display: 'block' }}>
                {profileCopy.dobPicked(dobDisplay)}
              </Text>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Icon icon={Gift} size="sm" tone="muted" />
              <Text variant="caption" tone="tertiary">
                Nhận mã giảm giá quà tặng vào tháng sinh nhật.
              </Text>
            </div>
            {meQ.data?.dob ? (
              <Text variant="caption" tone="tertiary" style={{ marginTop: 4, display: 'block' }}>
                Ngày sinh chỉ đặt được một lần, cần chỉnh lại thì liên hệ CSKH.
              </Text>
            ) : null}
          </div>

          {confirmingDob && dobNew ? (
            <div role="alertdialog" aria-label={profileCopy.dobConfirm(dobDisplay)} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 'var(--radius-card)', background: 'var(--color-bg-subtle)' }}>
              <Text variant="body-md" tone="primary">{profileCopy.dobConfirm(dobDisplay)}</Text>
              <Button
                fullWidth
                loading={save.isPending}
                disabled={emailInvalid || uploadingAvatar}
                onPress={() => {
                  setTouched(true);
                  if (uploadingAvatar || (email.trim() !== '' && !EMAIL.test(email.trim()))) return;
                  save.mutate();
                }}
              >
                {profileCopy.dobConfirmYes}
              </Button>
              <Button fullWidth variant="secondary" disabled={save.isPending} onPress={() => setConfirmingDob(false)}>
                {profileCopy.dobConfirmNo}
              </Button>
            </div>
          ) : (
            <Button
              fullWidth
              loading={save.isPending}
              disabled={emailInvalid || uploadingAvatar}
              onPress={() => {
                setTouched(true);
                if (email.trim() !== '' && !EMAIL.test(email.trim())) return;
                if (dobNew) setConfirmingDob(true);
                else save.mutate();
              }}
              style={{ marginTop: 4 }}
            >
              Lưu thay đổi
            </Button>
          )}
        </div>
      )}

      {/* Circular Avatar Crop Modal */}
      <AvatarCropModal
        visible={cropModalVisible}
        imageSrc={rawImageForCrop}
        onClose={() => {
          setCropModalVisible(false);
          setRawImageForCrop(null);
        }}
        onConfirm={handleConfirmCrop}
      />
    </Page>
  );
}
