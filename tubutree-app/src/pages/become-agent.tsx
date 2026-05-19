// Become Agent — Form đăng ký Đại lý
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Input, Select, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { agentApi } from "services/api";
import KycImage from "components/kyc-image";
import type { AgentApplication } from "types";

const FileField: React.FC<{
  label: string; required?: boolean;
  existingUrl?: string | null;
  onChange: (f: File | null) => void;
}> = ({ label, required, existingUrl, onChange }) => (
  <Box mt={2}>
    <Text size="small" bold style={{ marginBottom: 6 }}>{label}{required ? " *" : ""}</Text>
    {existingUrl && (
      <KycImage relativeUrl={existingUrl} alt={label}
                style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 8, marginBottom: 8 }} />
    )}
    <input type="file" accept="image/jpeg,image/png,image/webp"
           onChange={e => onChange(e.target.files?.[0] || null)} />
  </Box>
);

const BecomeAgentPage: React.FC = () => {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [existing, setExisting] = useState<AgentApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    agent_type: "INDIVIDUAL" as "INDIVIDUAL" | "BUSINESS",
    cccd_number: "",
    bank_name: "",
    bank_account_no: "",
    bank_account_name: "",
    warehouse_address: "",
    expected_monthly_revenue: "",
    email: "",
    company_name: "",
    tax_code: "",
    representative_name: "",
  });
  const [files, setFiles] = useState<{
    cccd_front: File | null; cccd_back: File | null;
    selfie: File | null; business_license: File | null;
  }>({ cccd_front: null, cccd_back: null, selfie: null, business_license: null });

  useEffect(() => {
    agentApi.getMine().then(d => {
      setExisting(d.active);
      if (d.active) {
        setForm({
          agent_type: d.active.agent_type,
          cccd_number: d.active.cccd_number,
          bank_name: d.active.bank_name,
          bank_account_no: d.active.bank_account_no,
          bank_account_name: d.active.bank_account_name,
          warehouse_address: d.active.warehouse_address,
          expected_monthly_revenue: String(d.active.expected_monthly_revenue),
          email: d.active.email || "",
          company_name: d.active.company_name || "",
          tax_code: d.active.tax_code || "",
          representative_name: d.active.representative_name || "",
        });
      }
    }).finally(() => setLoading(false));
  }, []);

  const isEditable = !existing || existing.status === "PENDING";

  const handleSubmit = async () => {
    if (!/^\d{9,12}$/.test(form.cccd_number)) {
      openSnackbar({ text: "CCCD phải 9-12 chữ số", type: "error" }); return;
    }
    if (!form.bank_name || !form.bank_account_no || !form.bank_account_name) {
      openSnackbar({ text: "Thiếu thông tin ngân hàng", type: "error" }); return;
    }
    if (!form.warehouse_address) {
      openSnackbar({ text: "Vui lòng điền địa chỉ kho/cửa hàng", type: "error" }); return;
    }
    const rev = Number(form.expected_monthly_revenue);
    if (!rev || rev <= 0) {
      openSnackbar({ text: "Doanh số dự kiến phải > 0", type: "error" }); return;
    }
    if (!existing) {
      if (!files.cccd_front || !files.cccd_back || !files.selfie) {
        openSnackbar({ text: "Cần đủ ảnh: CCCD 2 mặt + selfie", type: "error" }); return;
      }
    }

    setSubmitting(true);
    try {
      if (!existing) {
        await agentApi.submit({
          ...form,
          expected_monthly_revenue: rev,
          cccd_front: files.cccd_front!,
          cccd_back: files.cccd_back!,
          selfie: files.selfie!,
          business_license: files.business_license || undefined,
          company_name: form.company_name || undefined,
          tax_code: form.tax_code || undefined,
          representative_name: form.representative_name || undefined,
          email: form.email || undefined,
        });
        openSnackbar({ text: "Đã gửi đơn — chờ admin duyệt", type: "success" });
      } else {
        const payload: any = { ...form, expected_monthly_revenue: rev };
        if (files.cccd_front) payload.cccd_front = files.cccd_front;
        if (files.cccd_back) payload.cccd_back = files.cccd_back;
        if (files.selfie) payload.selfie = files.selfie;
        if (files.business_license) payload.business_license = files.business_license;
        await agentApi.update(payload);
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
      <Text.Title>🏪 Đăng ký Đại lý</Text.Title>
      <Text size="small" style={{ color: "#666", marginBottom: 16 }}>
        Nhập hàng giá sỉ, có thể quản lý CTV cấp dưới. Cần KYC nghiêm hơn CTV.
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

      <Select label="Loại đại lý *"
              value={form.agent_type}
              onChange={(v: any) => setForm({ ...form, agent_type: v })}
              disabled={!isEditable}>
        <Select.Option value="INDIVIDUAL" title="Cá nhân" />
        <Select.Option value="BUSINESS" title="Doanh nghiệp" />
      </Select>

      <Input label="Số CCCD *" value={form.cccd_number}
             onChange={e => setForm({ ...form, cccd_number: e.target.value.replace(/\D/g, "") })}
             maxLength={12} disabled={!isEditable} />

      <Input label="Địa chỉ kho/cửa hàng *" value={form.warehouse_address}
             onChange={e => setForm({ ...form, warehouse_address: e.target.value })} />

      <Input label="Doanh số dự kiến/tháng (VND) *" value={form.expected_monthly_revenue}
             onChange={e => setForm({ ...form, expected_monthly_revenue: e.target.value.replace(/\D/g, "") })}
             placeholder="50000000" disabled={!isEditable} />

      <Input label="Tên ngân hàng *" value={form.bank_name}
             onChange={e => setForm({ ...form, bank_name: e.target.value })} />
      <Input label="Số tài khoản *" value={form.bank_account_no}
             onChange={e => setForm({ ...form, bank_account_no: e.target.value.replace(/\D/g, "") })} />
      <Input label="Tên chủ tài khoản *" value={form.bank_account_name}
             onChange={e => setForm({ ...form, bank_account_name: e.target.value.toUpperCase() })} />
      <Input label="Email (tuỳ chọn)" value={form.email}
             onChange={e => setForm({ ...form, email: e.target.value })} />

      {isEditable && (
        <>
          <FileField label="Ảnh CCCD mặt trước" required
                     existingUrl={existing?.cccd_front_url}
                     onChange={f => setFiles({ ...files, cccd_front: f })} />
          <FileField label="Ảnh CCCD mặt sau" required
                     existingUrl={existing?.cccd_back_url}
                     onChange={f => setFiles({ ...files, cccd_back: f })} />
          <FileField label="Selfie cầm CCCD" required
                     existingUrl={existing?.selfie_url}
                     onChange={f => setFiles({ ...files, selfie: f })} />
        </>
      )}

      <Box mt={4}>
        <Text bold>Thông tin doanh nghiệp <span style={{ color: "#999", fontWeight: 400, fontSize: "0.85em" }}>(không bắt buộc — chỉ điền nếu bạn có công ty)</span></Text>
      </Box>
      <Input label="Tên công ty" value={form.company_name}
             onChange={e => setForm({ ...form, company_name: e.target.value })} />
      <Input label="Mã số thuế" value={form.tax_code}
             onChange={e => setForm({ ...form, tax_code: e.target.value })} />
      <Input label="Người đại diện" value={form.representative_name}
             onChange={e => setForm({ ...form, representative_name: e.target.value })} />
      {isEditable && (
        <FileField label="Ảnh Giấy phép KD"
                   existingUrl={existing?.business_license_url}
                   onChange={f => setFiles({ ...files, business_license: f })} />
      )}

      <Box mt={3}>
        <Button fullWidth loading={submitting} onClick={handleSubmit}>
          {existing ? "Cập nhật" : "Nộp đơn"}
        </Button>
      </Box>
    </Box>
  );
};

export default BecomeAgentPage;
