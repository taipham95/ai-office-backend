# AI Tech Office: backend

Chạy nền các AI agent, tự ghi sổ sau mỗi bước, tự chuyển AI khi hết token, tự gửi email.
Không cần cài thêm gói npm. Yêu cầu Node.js 20.6 trở lên.

## Chạy
1. `cp .env.example .env` rồi điền khóa API (ít nhất ANTHROPIC_API_KEY hoặc một AI khác).
2. Đặt `ADMIN_TOKEN` là một chuỗi bí mật dài. Bắt buộc nếu mở ra Internet.
3. `npm start`, mở http://localhost:3000 (giao diện văn phòng 3D nằm ở `public/index.html`).

## Chạy qua đêm / khi đóng trình duyệt
Server là tiến trình độc lập nên công việc vẫn chạy khi bạn đóng trình duyệt. Hãy đặt server trên VPS, Railway, Render hoặc Fly.io
(trên VPS dùng `pm2 start server.js --node-args="--env-file=.env"`), và gắn volume cho thư mục `data/` để sổ tiến độ không mất.

## Email
Dùng Resend (resend.com): tạo API key, điền `RESEND_API_KEY`. Địa chỉ gửi mặc định `onboarding@resend.dev` chỉ gửi được tới email
chủ tài khoản Resend; muốn gửi tới email khác, hãy xác minh tên miền của bạn rồi đổi `MAIL_FROM`.
Email được gửi khi: hoàn tất, tạm dừng vì hết token, cần duyệt AI, hoặc lỗi. Thử bằng `POST /api/test-email`.

## Router nhiều AI
Thứ tự mặc định: Claude, ChatGPT, Gemini, OpenRouter (free), Groq (free), 9Router (local). Mỗi AI có 3 chế độ trong tab Router AI:
`auto` (dùng luôn), `ask` (dừng chờ bạn duyệt, gửi email báo, duyệt xong job tự chạy tiếp), `deny` (bỏ qua).
Hết token hoặc lỗi thì AI đó nghỉ `COOLDOWN_MIN` phút. Nếu mọi AI đều hết, job tạm dừng và tự thử lại mỗi `retryMin` phút.
Tên model free thay đổi thường xuyên: chỉnh bằng `OPENROUTER_MODEL`, `GROQ_MODEL`, `GEMINI_MODEL`...

### Dùng 9Router
9Router (github.com/decolua/9router) là proxy chạy local tại `http://localhost:20128/v1`, tương thích OpenAI.
`npm install -g 9router && 9router`, tạo combo trong dashboard, rồi đặt `NINEROUTER_MODEL` là tên combo đó.
Lưu ý: nếu 9Router nối bằng đăng nhập gói thuê bao (không phải API key chính thức), hãy tự kiểm tra điều khoản của nhà cung cấp.

## API
GET/PUT `/api/settings` · GET/POST `/api/jobs` · GET `/api/jobs/:id` · POST `/api/jobs/:id/resume` · POST `/api/approve` · POST `/api/test-email`
Gửi kèm header `Authorization: Bearer <ADMIN_TOKEN>`.

## Sidebar & Router AI
- Sidebar mở bằng nút ☰ và mặc định chỉ hiển thị 3 dòng rút gọn: Tiến độ & Token, Thông báo email, Router AI khi hết token. Bấm từng dòng để bung chi tiết.
- Router AI có 3 mục rút gọn: thứ tự AI, cập nhật model mới nhất, và lựa chọn ưu tiên miễn phí/trả phí.
- Nút “Cập nhật AI mới nhất” lấy danh sách model trực tiếp từ API của provider khi đã cấu hình API key. OpenRouter được phân loại miễn phí/trả phí theo pricing mà provider trả về; các provider khác hiển thị trạng thái billing theo tài khoản/quota, không tự đoán giá.
- Có thể bấm “Dùng model này” để lưu model được chọn làm model hiện tại của provider.
