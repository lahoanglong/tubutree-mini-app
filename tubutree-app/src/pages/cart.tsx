// Cart Page — Giỏ hàng
import React, { useEffect, useState } from "react";
import { Box, Text, Spinner, useSnackbar } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { useRecoilState } from "recoil";
import { cartItemsState } from "state/cart";
import { cartApi } from "services/api";
import { formatPrice } from "utils/format";

const CartPage: React.FC = () => {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [cartItems, setCartItems] = useRecoilState(cartItemsState);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCart();
  }, []);

  const loadCart = async () => {
    try {
      const items = await cartApi.getAll();
      setCartItems(items);
    } catch {
      // Not logged in — empty cart
      setCartItems([]);
    } finally {
      setLoading(false);
    }
  };

  const updateQty = async (id: number, newQty: number) => {
    try {
      if (newQty <= 0) {
        await cartApi.remove(id);
        openSnackbar({ text: "Đã xóa khỏi giỏ", type: "success" });
      } else {
        await cartApi.update(id, newQty);
      }
      const items = await cartApi.getAll();
      setCartItems(items);
    } catch (err) {
      openSnackbar({ text: "Có lỗi xảy ra", type: "error" });
    }
  };

  const removeItem = async (id: number) => {
    try {
      await cartApi.remove(id);
      const items = await cartApi.getAll();
      setCartItems(items);
      openSnackbar({ text: "Đã xóa khỏi giỏ", type: "success" });
    } catch (err) {
      openSnackbar({ text: "Có lỗi xảy ra", type: "error" });
    }
  };

  // TODO: Enrich cart items with product info from POS for accurate pricing
  const totalEstimate = cartItems.reduce((sum, item) => sum + item.qty * 0, 0);

  if (loading) {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60 }}>
        <Spinner visible />
      </Box>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🛒</div>
        <div className="empty-state__title">Giỏ hàng trống</div>
        <div className="empty-state__desc">Hãy thêm sản phẩm vào giỏ hàng nhé!</div>
        <button className="sticky-bottom__btn" onClick={() => navigate("/")}>
          Mua sắm ngay
        </button>
      </div>
    );
  }

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Giỏ hàng ({cartItems.length})</span>
      </div>

      {cartItems.map(item => (
        <div key={item.id} className="cart-item">
          <img className="cart-item__image" src="https://via.placeholder.com/80?text=SP" alt="" />
          <div className="cart-item__info">
            <div className="cart-item__name">
              Sản phẩm #{item.pos_product_id}
              {item.variant_id && <Text size="xxSmall" style={{ color: "#888" }}> • {item.variant_id}</Text>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="cart-item__qty">
                <button onClick={() => updateQty(item.id, item.qty - 1)}>−</button>
                <span>{item.qty}</span>
                <button onClick={() => updateQty(item.id, item.qty + 1)}>+</button>
              </div>
              <span
                onClick={() => removeItem(item.id)}
                style={{ color: "#F44336", fontSize: 13, cursor: "pointer" }}
              >
                Xóa
              </span>
            </div>
          </div>
        </div>
      ))}

      {/* Bottom bar */}
      <div className="sticky-bottom">
        <div className="sticky-bottom__total">
          {cartItems.length} sản phẩm
          <span>{cartItems.reduce((s, i) => s + i.qty, 0)} items</span>
        </div>
        <button className="sticky-bottom__btn" onClick={() => navigate("/checkout")}>
          Đặt hàng →
        </button>
      </div>
    </Box>
  );
};

export default CartPage;
