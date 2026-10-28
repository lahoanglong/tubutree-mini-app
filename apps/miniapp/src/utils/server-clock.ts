// Một đồng hồ cho cả Mini App và app-core: giá thẻ (flash-price) đọc `serverNow` của app-core, nên bản riêng ở đây sẽ không bao giờ được đo.
export { serverNow, syncServerClock } from '@tubutree/app-core/server-clock';
