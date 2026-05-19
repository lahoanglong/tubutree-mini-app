// Become Affiliate — Form đăng ký CTV
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Input, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { affiliateApi } from "services/api";
import KycImage from "components/kyc-image";
import type { AffiliateApplication } from "types";

const BecomeAffiliatePage: React.FC = () => {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [existing, setExisting] = useState<AffiliateApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    cccd_number: "",
    bank_name: "",
    bank_account_no: "",
    bank_account_name: "",
    email: "",
  });
  const [cccdFront, setCccdFront] = useState<File | null>(null);

  useEffect(() => {
    affiliateApi.getMine()
      .then(d => {
        setExisting(d.active);
        if (d.active) {
          setForm({
            cccd_number: d.active.cccd_number,
            bank_name: d.active.bank_name,
            bank_account_no: d.active.bank_account_no,
            bank_account_name: d.active.bank_account_name,
            email: d.active.email || "",
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Phân loại flow theo status hiện tại
  // - null hoặc REJECTED → submit đơn mới, file CCCD BẮT BUỘC
  // - PENDING → update info, file optional (giữ ảnh cũ nếu không upload mới)
  // - APPROVED → chỉ update bank info, file ignored
  const isNewSubmit = !existing || existing.status === "REJECTED";
  const isEditable = !existing || existing.status === "PENDING" || existing.status === "REJECTED";

  const handleSubmit = async () => {
    if (isNewSubmit && !cccdFront) {
      openSnackbar({ text: "Vui lòng upload ảnh CCCD mặt trước (đơn mới)", type: "error" });
      return;
    }
    if (!/^\d{9,12}$/.test(form.cccd_number)) {
      openSnackbar({ text: "CCCD phải 9-12 chữ số", type: "error" });
      return;
    }
    if (!form.bank_name || !form.bank_account_no || !form.bank_account_name) {
      openSnackbar({ text: "Vui lòng điền đủ thông tin ngân hàng", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      if (isNewSubmit) {
        await affiliateApi.submit({ ...form, cccd_front: cccdFront! });
        openSnackbar({ text: "Đã gửi đơn — chờ admin duyệt", type: "success" });
      } else {
        const payload: any = { ...form };
        if (cccdFront) payload.cccd_front = cccdFront;
        await affiliateApi.update(payload);
        openSnackbar({ text: "Cập nhật thành công", type: "success" });
      }
      navigate("/my-capabilities");
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      openSnackbar({ text: msg, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;

  return (
    <Box p={3}>
      <Text.Title>🤝 Đăng ký Cộng tác viên</Text.Title>
      <Text size="small" style={{ color: "#666", marginBottom: 16 }}>
        Chia sẻ link sản phẩm, nhận hoa hồng khi có khách đặt hàng qua link của bạn.
      </Text>

      {existing && (
        <div style={{ background: "#f0f9ff", padding: 12, borderRadius: 10, marginBottom: 16 }}>
          <Text size="small" bold>Trạng thái: {existing.status}</Text>
          {existing.reject_reason && (
            <Text size="xSmall" style={{ color: "#991b1b", marginTop: 4 }}>
              Lý do từ chối: {existing.reject_reason}
            </Text>
          )}
        </div>
      )}

      <Box mt={2}>
        <Input
          label="Số CCCD *"
          value={form.cccd_number}
          onChange={e => setForm({ ...form, cccd_number: e.target.value.replace(/\D/g, "") })}
          maxLength={12}
          placeholder="012345678901"
          disabled={!isEditable}
        />
        <Input
          label="Tên ngân hàng *"
          value={form.bank_name}
          onChange={e => setForm({ ...form, bank_name: e.target.value })}
          placeholder="VD: Techcombank"
        />
        <Input
          label="Số tài khoản *"
          value={form.bank_account_no}
          onChange={e => setForm({ ...form, bank_account_no: e.target.value.replace(/\D/g, "") })}
          placeholder="9984606774"
        />
        <Input
          label="Tên chủ tài khoản *"
          value={form.bank_account_name}
          onChange={e => setForm({ ...form, bank_account_name: e.target.value.toUpperCase() })}
          placeholder="LA HOANG LONG"
        />
        <Input
          label="Email (tuỳ chọn)"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          placeholder="email@example.com"
        />

        {isEditable && (
          <Box mt={2}>
            <Text size="small" bold style={{ marginBottom: 6 }}>Ảnh CCCD mặt trước *</Text>
            {existing?.cccd_front_url && !cccdFront && (
              <KycImage relativeUrl={existing.cccd_front_url} alt="CCCD"
                        style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, marginBottom: 8 }} />
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp"
                   onChange={e => setCccdFront(e.target.files?.[0] || null)} />
          </Box>
        )}

        {!isEditable && existing?.cccd_front_url && (
          <Box mt={2}>
            <Text size="small" bold>Ảnh CCCD mặt trước</Text>
            <KycImage relativeUrl={existing.cccd_front_url} alt="CCCD"
                      style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, marginTop: 6 }} />
          </Box>
        )}

        <Box mt={3}>
          <Button fullWidth loading={submitting} onClick={handleSubmit}>
            {existing ? "Cập nhật" : "Nộp đơn"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default BecomeAffiliatePage;
