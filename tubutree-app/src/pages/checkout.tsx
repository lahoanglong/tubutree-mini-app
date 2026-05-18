// Checkout Page — Xác nhận đơn hàng
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Spinner, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { cartItemsState } from "state/cart";
import { addressApi, orderApi, cartApi } from "services/api";
import type { Address } from "types";

const CheckoutPage: React.FC = () => {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const cartItems = useRecoilValue(cartItemsState);
  const setCart = useSetRecoilState(cartItemsState);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAddresses();
  }, []);

  const loadAddresses = async () => {
    try {
      const addrs = await addressApi.getAll();
      setAddresses(addrs);
      const defaultAddr = addrs.find(a => a.is_default) || addrs[0];
      if (defaultAddr) setSelectedAddress(defaultAddr);
    } catch {
      // Not logged in
    } finally {
      setLoading(false);
    }
  };

  const handleOrder = async () => {
    if (!selectedAddress) {
      openSnackbar({ text: "Vui lòng chọn địa chỉ giao hàng", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const items = cartItems.map(item => ({
        pos_product_id: item.pos_product_id,
        variant_id: item.variant_id,
        qty: item.qty,
      }));

      await orderApi.create({
        items,
        addressId: selectedAddress.id,
        paymentMethod,
        notes,
      });

      // Clear cart
      setCart([]);
      openSnackbar({ text: "🎉 Đặt hàng thành công!", type: "success" });
      navigate("/orders");
    } catch (err: any) {
      openSnackbar({ text: err.response?.data?.error || "Đặt hàng thất bại", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60 }}>
        <Spinner visible />
      </Box>
    );
  }

  const paymentOptions = [
    { value: "COD", label: "💵 Thanh toán khi nhận hàng (COD)" },
    { value: "VIETQR", label: "🏦 Chuyển khoản ngân hàng (VietQR)" },
  ];

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Xác nhận đơn hàng</span>
      </div>

      {/* Address */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>📍 Địa chỉ giao hàng</Text>
        {selectedAddress ? (
          <Box>
            <Text bold>{selectedAddress.name} • {selectedAddress.phone}</Text>
            <Text size="small" style={{ color: "#888", marginTop: 4 }}>
              {selectedAddress.detail}, {selectedAddress.ward}, {selectedAddress.district}, {selectedAddress.province}
            </Text>
          </Box>
        ) : (
          <Text size="small" style={{ color: "#F44336" }}>
            Chưa có địa chỉ. <span onClick={() => navigate("/addresses")} style={{ color: "#2E7D32", fontWeight: 600 }}>Thêm ngay →</span>
          </Text>
        )}
      </Box>

      {/* Items Summary */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>🛒 Sản phẩm ({cartItems.length})</Text>
        {cartItems.map(item => (
          <Box key={item.id} flex justifyContent="space-between" style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
            <Text size="small">#{item.pos_product_id} {item.variant_id ? `(${item.variant_id})` : ''}</Text>
            <Text size="small" bold>x{item.qty}</Text>
          </Box>
        ))}
      </Box>

      {/* Payment Method */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 10 }}>💳 Phương thức thanh toán</Text>
        {paymentOptions.map(opt => (
          <div
            key={opt.value}
            onClick={() => setPaymentMethod(opt.value)}
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: `2px solid ${paymentMethod === opt.value ? '#2E7D32' : '#e8e8e8'}`,
              background: paymentMethod === opt.value ? '#E8F5E9' : '#fff',
              marginBottom: 8,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {opt.label}
          </div>
        ))}
      </Box>

      {/* Notes */}
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Text bold size="normal" style={{ marginBottom: 8 }}>📝 Ghi chú</Text>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Ghi chú cho shop (tùy chọn)"
          style={{
            width: "100%", padding: 12, borderRadius: 10, border: "1px solid #e8e8e8",
            fontSize: 14, resize: "none", minHeight: 60, fontFamily: "inherit",
          }}
        />
      </Box>

      {/* Submit */}
      <div className="sticky-bottom">
        <div className="sticky-bottom__total">
          {cartItems.reduce((s, i) => s + i.qty, 0)} sản phẩm
        </div>
        <button
          className="sticky-bottom__btn"
          onClick={handleOrder}
          disabled={submitting || !selectedAddress}
        >
          {submitting ? "Đang đặt..." : "✅ Xác nhận đặt hàng"}
        </button>
      </div>
    </Box>
  );
};

export default CheckoutPage;
