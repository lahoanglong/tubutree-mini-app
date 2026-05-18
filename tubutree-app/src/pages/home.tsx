// Home Page — Trang chủ
import React, { useEffect, useState } from "react";
import { Box, Text, Spinner } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { productApi, bannerApi } from "services/api";
import { formatPrice, getMinPrice, getProductImage } from "utils/format";
import type { Product, Banner, Category } from "types";

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [prodRes, catRes, bannerRes] = await Promise.all([
        productApi.getAll(1, 50),
        productApi.getCategories().catch(() => ({ data: [] })),
        bannerApi.getActive().catch(() => []),
      ]);
      setProducts(prodRes.data || []);
      setCategories(catRes.data || []);
      setBanners(Array.isArray(bannerRes) ? bannerRes : []);
    } catch (err) {
      console.error("Lỗi tải dữ liệu:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = activeCategory
    ? products.filter(p => p.categories?.some(c => c.id === activeCategory))
    : products;

  if (loading) {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60 }}>
        <Spinner visible />
        <Text style={{ marginTop: 12, color: "#888" }}>Đang tải...</Text>
      </Box>
    );
  }

  return (
    <Box>
      {/* Search Bar */}
      <div className="search-bar">
        <input placeholder="🔍 Tìm sản phẩm..." readOnly onClick={() => {}} />
      </div>

      {/* Banner Slider */}
      {banners.length > 0 && (
        <div className="banner-slider">
          <Swiper spaceBetween={10} slidesPerView={1.05} centeredSlides>
            {banners.map(b => (
              <SwiperSlide key={b.id} className="banner-slider__slide">
                <img src={b.image_url} alt="Banner" />
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <>
          <div className="section-header">
            <span className="section-header__title">Danh mục</span>
          </div>
          <div className="category-tabs">
            <div
              className={`category-tabs__item ${!activeCategory ? 'category-tabs__item--active' : ''}`}
              onClick={() => setActiveCategory(null)}
            >
              Tất cả
            </div>
            {categories.map(cat => (
              <div
                key={cat.id}
                className={`category-tabs__item ${activeCategory === cat.id ? 'category-tabs__item--active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.text}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Products Grid */}
      <div className="section-header">
        <span className="section-header__title">
          {activeCategory ? categories.find(c => c.id === activeCategory)?.text : "Sản phẩm"}
        </span>
        <span className="section-header__more">{filteredProducts.length} sản phẩm</span>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📦</div>
          <div className="empty-state__title">Không có sản phẩm</div>
          <div className="empty-state__desc">Danh mục này chưa có sản phẩm nào</div>
        </div>
      ) : (
        <div className="product-grid">
          {filteredProducts.map(product => (
            <div
              key={product.id}
              className="product-card"
              onClick={() => navigate(`/product/${product.id}`)}
            >
              <img
                className="product-card__image"
                src={getProductImage(product)}
                alt={product.name}
                loading="lazy"
              />
              <div className="product-card__info">
                <div className="product-card__name">{product.name}</div>
                <div className="product-card__price">
                  {formatPrice(getMinPrice(product.variations))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Box>
  );
};

export default HomePage;
