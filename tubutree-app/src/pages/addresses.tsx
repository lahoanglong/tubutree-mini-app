// Addresses Page — Quản lý địa chỉ
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Input, Spinner, useSnackbar } from "zmp-ui";
import { addressApi } from "services/api";
import type { Address } from "types";

const AddressesPage: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", province: "", district: "", ward: "", detail: "", is_default: false });

  useEffect(() => { loadAddresses(); }, []);

  const loadAddresses = async () => {
    try { setAddresses(await addressApi.getAll()); } catch { }
    finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.phone || !form.detail) {
      openSnackbar({ text: "Vui lòng điền đầy đủ thông tin", type: "error" });
      return;
    }
    try {
      await addressApi.create(form);
      openSnackbar({ text: "Đã thêm địa chỉ!", type: "success" });
      setShowForm(false);
      setForm({ name: "", phone: "", province: "", district: "", ward: "", detail: "", is_default: false });
      loadAddresses();
    } catch {
      openSnackbar({ text: "Có lỗi xảy ra", type: "error" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await addressApi.remove(id);
      openSnackbar({ text: "Đã xóa địa chỉ", type: "success" });
      loadAddresses();
    } catch {
      openSnackbar({ text: "Có lỗi xảy ra", type: "error" });
    }
  };

  if (loading) return <Box flex alignItems="center" justifyContent="center" style={{ padding: 60 }}><Spinner visible /></Box>;

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Địa chỉ giao hàng</span>
        <span className="section-header__more" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Hủy" : "+ Thêm mới"}
        </span>
      </div>

      {showForm && (
        <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
          <Input label="Tên người nhận" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Input label="Số điện thoại" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={{ marginTop: 8 }} />
          <Input label="Tỉnh/Thành phố" value={form.province} onChange={e => setForm({ ...form, province: e.target.value })} style={{ marginTop: 8 }} />
          <Input label="Quận/Huyện" value={form.district} onChange={e => setForm({ ...form, district: e.target.value })} style={{ marginTop: 8 }} />
          <Input label="Phường/Xã" value={form.ward} onChange={e => setForm({ ...form, ward: e.target.value })} style={{ marginTop: 8 }} />
          <Input label="Địa chỉ chi tiết" value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} style={{ marginTop: 8 }} />
          <Button fullWidth style={{ marginTop: 12, background: "#2E7D32" }} onClick={handleSubmit}>Lưu địa chỉ</Button>
        </Box>
      )}

      {addresses.length === 0 && !showForm ? (
        <div className="empty-state">
          <div className="empty-state__icon">📍</div>
          <div className="empty-state__title">Chưa có địa chỉ</div>
          <div className="empty-state__desc">Thêm địa chỉ giao hàng để đặt hàng</div>
        </div>
      ) : (
        addresses.map(addr => (
          <Box key={addr.id} p={4} style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
            <Box flex justifyContent="space-between">
              <Text bold>{addr.name} • {addr.phone}</Text>
              {addr.is_default && <span style={{ fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>Mặc định</span>}
            </Box>
            <Text size="small" style={{ color: "#888", marginTop: 4 }}>
              {addr.detail}, {addr.ward}, {addr.district}, {addr.province}
            </Text>
            <Text size="xxSmall" style={{ color: "#F44336", marginTop: 8, cursor: "pointer" }} onClick={() => handleDelete(addr.id)}>
              Xóa
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
};

export default AddressesPage;
