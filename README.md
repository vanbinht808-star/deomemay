# PRISON LIFE 3D

Game nhà tù 3D chạy trên trình duyệt, dùng Three.js để dựng cảnh và Rapier để xử lý va chạm.

## Chạy game

```bash
npm install
npm start
```

Mở `http://localhost:3000`. Lệnh `npm start` build frontend trước rồi khởi chạy Node.js backend. API dữ liệu hiện có vẫn được phục vụ tại `/api/site`.

Khi phát triển giao diện, chạy backend bằng `npm start` và chạy Vite ở terminal khác bằng `npm run dev`; Vite phục vụ tại cổng `5173` và chuyển tiếp API cùng Socket.IO đến backend cổng `3000`.

## Deploy lên Render

Đẩy project lên GitHub, sau đó trên Render chọn **New > Blueprint** và kết nối repository này. Render sẽ dùng `render.yaml` để cài dependencies, build frontend và chạy server web. Sau khi deploy hoàn tất, mở URL Render cấp để truy cập game.

Server sử dụng biến `PORT` do Render cung cấp và phục vụ cả frontend, API cùng kết nối Socket.IO trên cùng một dịch vụ.

## Điều khiển

- `W`, `A`, `S`, `D`: di chuyển
- `Shift`: chạy
- `Space`: nhảy
- `C`: cúi
- Chuột: xoay camera góc nhìn thứ ba
- Con lăn: điều chỉnh khoảng cách camera
- `Esc`: tạm dừng

Game hiển thị form tiếp nhận nhập vai trước khi kết nối: tên nhân vật, tuổi nhân vật, vi phạm hư cấu (có lựa chọn tự nhập) và lý do. Sau khi xác nhận, server cấp Player ID/mã tù riêng; dữ liệu profile được giữ trong phiên RAM của server và sessionStorage của tab, chưa có tài khoản hoặc database bền vững. Trong game, tên/mã tù xuất hiện trên đầu nhân vật; nhắm tâm camera vào người chơi khác rồi nhấp chuột để xem hồ sơ.

Multiplayer Socket.IO hiện hỗ trợ tối đa 20 slot trong một phiên. Trạng thái vị trí/hướng/animation được kiểm tra ở server, chia sẻ theo khu vực và remote avatar nội suy độc lập. Đã kiểm tra 20 Socket.IO client Node đồng thời, relay di chuyển và từ chối client thứ 21; đây chưa phải kiểm thử tải 20 trình duyệt.

Tùy chỉnh ngoại hình, tài khoản/lưu trữ bền vững, chat, nhiệm vụ, NPC và voice chat chưa được triển khai.