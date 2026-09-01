import { useEffect, useRef, useState } from 'react';
import { Box, Page, Text, Button, Input, Avatar, useSnackbar, useNavigate } from 'zmp-ui';
import { Camera } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMe, updateMe } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { readAndCompressImage } from '../components/image-upload';
import { AvatarCropModal } from '../components/avatar-crop-modal';
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [dob, setDob] = useState('');
  const [touched, setTouched] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // States for Avatar Crop Modal
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [rawImageForCrop, setRawImageForCrop] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (meQ.data) {
      setFullName(meQ.data.fullName ?? '');
      setEmail(meQ.data.email ?? '');
      setAvatarUrl(meQ.data.avatarUrl ?? useAuthStore.getState().user?.avatarUrl ?? null);
      setDob(meQ.data.dob ?? '');
    }
  }, [meQ.data]);

  const emailInvalid = touched && email.trim() !== '' && !EMAIL.test(email.trim());

  const handlePickAvatar = () => {
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

  const handleConfirmCrop = (croppedUrl: string) => {
    setAvatarUrl(croppedUrl);
    setCropModalVisible(false);
    setRawImageForCrop(null);
    openSnackbar({ text: 'Đã cắt và chọn ảnh đại diện 🌿', type: 'success', position: 'top' });
  };

  const save = useMutation({
    mutationFn: async () => {
      try {
        return await updateMe({
          fullName: fullName.trim() || undefined,
          email: email.trim() || undefined,
          avatarUrl: avatarUrl ?? undefined,
          dob: dob || undefined,
        });
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        if (msg.includes('avatarUrl')) {
          return await updateMe({
            fullName: fullName.trim() || undefined,
            email: email.trim() || undefined,
            dob: dob || undefined,
          });
        }
        throw err;
      }
    },
    onSuccess: (res) => {
      haptic('medium');
      // Đồng bộ tên & avatar hiển thị vào auth store (header/profile).
      const cur = useAuthStore.getState().user;
      if (cur) {
        useAuthStore.setState({
          user: {
            ...cur,
            fullName: fullName.trim() || cur.fullName,
            avatarUrl: avatarUrl ?? res?.avatarUrl ?? cur.avatarUrl,
          },
        });
      }
      // Làm mới cache ['me'] để email/dob/avatar mới đồng bộ ở nơi khác.
      void qc.invalidateQueries({ queryKey: ['me'] });
      openSnackbar({ text: 'Đã cập nhật hồ sơ 🌿', type: 'success', position: 'top' });
      navigate(-1);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error', position: 'top' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      {meQ.isLoading ? (
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Skeleton style={{ height: 100 }} />
          <Skeleton style={{ height: 56 }} />
          <Skeleton style={{ height: 56 }} />
          <Skeleton style={{ height: 56 }} />
        </Box>
      ) : meQ.isError ? (
        <ErrorState message={getErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} />
      ) : (
        <Box p={4} flex flexDirection="column" style={{ gap: 16 }}>
          {/* Avatar Upload Section */}
          <Box flex flexDirection="column" alignItems="center" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFile} />
            <Box
              className="tubu-press"
              onClick={handlePickAvatar}
              style={{
                position: 'relative',
                cursor: 'pointer',
                display: 'inline-block',
              }}
            >
              <Avatar
                size={88}
                src={avatarUrl ?? undefined}
                style={{
                  border: '3px solid var(--neutral-0)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  background: 'var(--leaf-100)',
                }}
              />
              <Box
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--leaf-600)',
                  color: 'var(--neutral-0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid var(--neutral-0)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                }}
              >
                <Camera size={15} />
              </Box>
            </Box>
            <Text
              size="xSmall"
              bold
              onClick={handlePickAvatar}
              style={{ color: 'var(--leaf-700)', marginTop: 8, cursor: 'pointer' }}
            >
              {uploadingAvatar ? '⏳ Đang xử lý ảnh…' : '📷 Chạm để chọn & cắt ảnh đại diện'}
            </Text>
          </Box>

          <Input label="Họ và tên" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />

          <Box>
            <Input
              label="Email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              status={emailInvalid ? 'error' : undefined}
            />
            {emailInvalid && (
              <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 2 }}>
                ⚠ Email không hợp lệ
              </Text>
            )}
          </Box>

          <Box>
            <Text size="xSmall" bold style={{ marginBottom: 4 }}>
              Ngày sinh
            </Text>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--neutral-200)',
                fontFamily: 'inherit',
                fontSize: 14,
                background: 'var(--neutral-0)',
              }}
            />
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
              🎁 Nhận voucher quà tặng vào tháng sinh nhật.
            </Text>
          </Box>

          <Button
            fullWidth
            loading={save.isPending}
            disabled={emailInvalid || uploadingAvatar}
            onClick={() => {
              setTouched(true);
              if (!(email.trim() !== '' && !EMAIL.test(email.trim()))) save.mutate();
            }}
            style={{ background: 'var(--primary-600)', marginTop: 4 }}
          >
            Lưu thay đổi
          </Button>
        </Box>
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
