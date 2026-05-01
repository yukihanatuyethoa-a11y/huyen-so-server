# Deploy Server lên Railway

## Bước 1: Tạo Google Service Account

**Tạo Google Cloud Project:**
1. Vào [console.cloud.google.com](https://console.cloud.google.com)
2. Tạo project mới (tên: "Huyền Số")
3. Enable **Google Sheets API**:
   - Vào APIs & Services → Library
   - Tìm "Google Sheets API" → Enable

**Tạo Service Account:**
1. Vào APIs & Services → Credentials
2. Create Credentials → Service Account
   - Name: "huyen-so-server"
   - Grant role: "Editor" (hoặc "Sheets Editor")
3. Tạo key (JSON):
   - Click service account vừa tạo → Keys tab
   - Add key → Create new key → JSON
   - Download file JSON

**Copy nội dung JSON file — dùng sau**

---

## Bước 2: Share Sheet với Service Account

1. Mở file JSON vừa download
2. Copy giá trị `client_email` (dạng `xxx@yyy.iam.gserviceaccount.com`)
3. Mở sheet "Đơn Hàng"
4. Click Share → Paste email service account → Give Editor access

---

## Bước 3: Lấy Sheet ID

1. Mở sheet
2. URL dạng: `https://docs.google.com/spreadsheets/d/1abc2def3ghi4jkl5mno6pqr7stu8vwx/edit`
3. Copy phần **1abc2def3ghi4jkl5mno6pqr7stu8vwx** (sau `/d/`)

---

## Bước 4: Push Code lên GitHub

1. Mở Terminal / CMD → folder `output`
2. Chạy lệnh:
```bash
git init
git add .
git commit -m "Add Huyền Số server"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/huyen-so-server.git
git push -u origin main
```

(Thay `YOUR_USERNAME` bằng GitHub username của bạn)

---

## Bước 5: Deploy lên Railway

1. Vào [railway.app](https://railway.app)
2. Login bằng GitHub
3. Click **Create Project** → **Deploy from GitHub repo**
4. Chọn repo `huyen-so-server` vừa push
5. Railway tự detect `package.json` → tạo Node.js service

**Cài đặt Environment Variables:**
1. Vào tab **Variables** trong Railway
2. Thêm 3 biến:

```
TELEGRAM_BOT_TOKEN = (token bot của bạn)
TELEGRAM_GROUP_ID = -5001844130
GOOGLE_SHEET_ID = (ID sheet của bạn)
GOOGLE_SERVICE_ACCOUNT = (copy toàn bộ JSON file)
```

3. Click **Deploy**

---

## Bước 6: Lấy Webhook URL từ Railway

1. Sau khi deploy xong, vào tab **Deployments**
2. Copy domain được tạo (dạng `https://huyen-so-server-production.up.railway.app`)
3. Webhook URL: `https://huyen-so-server-production.up.railway.app/webhook`

---

## Bước 7: Update Webhook trong SePay

1. Vào SePay Dashboard
2. Cài đặt → Webhook → Webhook URL
3. Paste: `https://huyen-so-server-production.up.railway.app/webhook`
4. Save

---

## Bước 8: Test

1. Chuyển khoản test (1.000đ hoặc 109.000đ) với nội dung: `TKPHS109000`
2. Chờ ~5 giây
3. Check:
   - Sheet: cột "Trạng thái TT" có chuyển thành "Đã thanh toán" không?
   - Telegram Group: có noti thanh toán thành công không?

---

## Nếu có lỗi

**Check Railway logs:**
1. Vào Railway → Logs tab
2. Xem error message
3. Fix code → commit → push → Railway tự redeploy

**Common errors:**
- `GOOGLE_SHEET_ID not set` → quên cài environment variable
- `Unauthorized: invalid_grant` → JSON file sai hoặc hết hạn
- `Chat not found` → Telegram Group ID sai

---

## Đỡ chi phí

- **Railway:** 5$ credit/tháng miễn phí, sau đó $0.50/giờ chạy
- **Google Sheets API:** Miễn phí (quota: 300 requests/phút)
- **Telegram:** Miễn phí

Tổng chi phí: **$0** (trong 5$ credit miễn phí)
