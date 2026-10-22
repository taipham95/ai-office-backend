#!/bin/bash
cd "$(dirname "$0")"

echo "========================================================"
echo "        AI TECH OFFICE - KHỞI ĐỘNG HỆ THỐNG LOCAL"
echo "========================================================"
echo ""

# 1. Kiểm tra và tạo .env
if [ ! -f ".env" ]; then
    echo "[*] Đang tạo file .env từ .env.example..."
    cp ".env.example" ".env"
    echo "[*] Đã khởi tạo .env thành công!"
fi

# 2. Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "[!] Không tìm thấy Node.js trên máy của bạn."
    echo "[*] Vui lòng tải và cài đặt Node.js từ https://nodejs.org"
    echo "Nhấn phím bất kỳ để thoát..."
    read -n 1
    exit 1
fi

# 3. Tự động mở trình duyệt
echo "[*] Đang mở trình duyệt tại http://localhost:3000 ..."
(sleep 1 && open "http://localhost:3000") &

# 4. Khởi động Backend Server
echo "[*] AI Tech Office đang chạy trên cổng 3000."
echo "[*] Đóng cửa sổ Terminal này nếu muốn tắt hệ thống."
echo "========================================================"
echo ""
node server.js
