// ============================================================
// HUYỀN SỐ — SePay Webhook Server
// Node.js + Express — Deploy trên Railway
// ============================================================
//
// Luồng thanh toán:
//   1. Khách điền form → Apps Script lưu vào Sheet (mã CK dạng PHS1234567)
//   2. Khách chuyển khoản với nội dung = mã CK
//   3. SePay gửi webhook POST /webhook → server này nhận
//   4. Server tìm mã CK trong Sheet → cập nhật "Đã thanh toán"
//   5. Gửi Telegram noti cho admin
//
// Polling từ frontend:
//   Frontend gọi GET /check-payment?code=PHS1234567
//   Server đọc Sheet, trả về { paid: true/false }
// ============================================================

const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(express.json());

// ── CORS: cho phép Vercel frontend gọi API ──────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Cấu hình ────────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 3000,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '5310615235',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8095135618:AAEQ_76D-SfpFG4n3qW-XaJrjdlPO4DEVYc',
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  GOOGLE_SERVICE_ACCOUNT: (() => {
    try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}'); }
    catch { return {}; }
  })(),
  SEPAY_WEBHOOK_SECRET: process.env.SEPAY_WEBHOOK_SECRET || '',
};

// ── Google Sheets auth ───────────────────────────────────────
const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
  credentials: CONFIG.GOOGLE_SERVICE_ACCOUNT,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ── WEBHOOK: SePay gọi vào đây khi có tiền vào ──────────────
app.post('/webhook', async (req, res) => {
  try {
    console.log('📥 Webhook received:', new Date().toISOString());
    console.log('Body:', JSON.stringify(req.body));

    // Xác minh webhook secret (nếu đã cấu hình trong SePay)
    if (CONFIG.SEPAY_WEBHOOK_SECRET) {
      const token = req.headers['authorization'] || req.headers['x-sepay-token'] || '';
      const clean = token.replace(/^Bearer\s+/i, '');
      if (clean !== CONFIG.SEPAY_WEBHOOK_SECRET) {
        console.warn('⚠️ Webhook secret không khớp');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // Chỉ xử lý tiền vào
    if (req.body.transferType && req.body.transferType !== 'in') {
      return res.status(200).json({ status: 'ignored' });
    }

    // Trả về 200 ngay để SePay không retry
    res.status(200).json({ status: 'received' });

    // Xử lý bất đồng bộ
    processPayment(req.body).catch(err => {
      console.error('❌ Lỗi xử lý payment:', err.message);
      sendTelegram(`🚨 <b>Lỗi webhook</b>\n${err.message}`).catch(() => {});
    });

  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CHECK PAYMENT: frontend poll vào đây ────────────────────
app.get('/check-payment', async (req, res) => {
  const code = (req.query.code || '').toUpperCase().trim();
  if (!code) return res.json({ paid: false, error: 'Missing code' });

  try {
    const result = await findOrderByCode(code);
    if (!result) return res.json({ paid: false, found: false });
    return res.json({
      paid: result.trangThaiTT === 'Đã thanh toán',
      status: result.trangThaiTT,
      found: true,
    });
  } catch (err) {
    console.error('check-payment error:', err.message);
    return res.json({ paid: false, error: err.message });
  }
});

// ── XỬ LÝ THANH TOÁN ────────────────────────────────────────
async function processPayment(payload) {
  // SePay gửi nội dung CK trong trường "content"
  // Một số trường hợp còn có "description" — kiểm tra cả hai
  const content = (payload.content || payload.description || '').toUpperCase().trim();
  const amount  = parseInt(payload.transferAmount) || 0;
  const txDate  = payload.transactionDate || new Date().toISOString();

  console.log('Processing:', { content, amount, txDate });

  if (!content) {
    await sendTelegram(
      `💰 <b>TIỀN VÀO — Không có nội dung CK!</b>\n` +
      `💵 ${amount.toLocaleString('vi-VN')}đ\n` +
      `⚠️ Kiểm tra thủ công trong app ngân hàng!`
    );
    return;
  }

  // Tìm và cập nhật đơn hàng
  const order = await findAndUpdateOrder(content, amount, txDate);

  if (order) {
    await sendTelegram(
      `✅ <b>THANH TOÁN XÁC NHẬN</b>\n\n` +
      `🎯 Đơn: <b>HS-${String(order.stt).padStart(3, '0')}</b>\n` +
      `👤 ${order.name}\n` +
      `📧 ${order.email}\n` +
      `📦 ${order.goi}\n` +
      `💰 ${amount.toLocaleString('vi-VN')}đ\n` +
      `🔑 Mã CK: <code>${order.maCK}</code>\n` +
      `⏰ ${txDate}\n\n` +
      `✅ Sheet đã cập nhật\n\n` +
      `📋 <b>Việc cần làm:</b>\n` +
      `1. Tạo file lá số cho ${order.name}\n` +
      `2. Upload lên Google Drive\n` +
      `3. Dán link vào cột L trên Sheet\n` +
      `→ <b>Email tự động gửi ngay!</b>`
    );
  } else {
    await sendTelegram(
      `💰 <b>TIỀN VÀO — Không khớp đơn nào!</b>\n` +
      `💵 ${amount.toLocaleString('vi-VN')}đ\n` +
      `📝 Nội dung: <code>${content}</code>\n` +
      `⚠️ Kiểm tra thủ công trong Sheet!`
    );
  }
}

// ── TÌM ĐƠN THEO MÃ CK (dùng cho /check-payment) ───────────
async function findOrderByCode(code) {
  if (!CONFIG.GOOGLE_SHEET_ID) return null;
  const authClient = await auth.getClient();
  const res = await sheets.spreadsheets.values.get({
    auth: authClient,
    spreadsheetId: CONFIG.GOOGLE_SHEET_ID,
    range: 'Đơn Hàng!A:O',
  });

  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const maCK = (row[9] || '').toUpperCase().trim(); // Cột J
    if (maCK && maCK === code) {
      return {
        stt:         row[0],
        name:        row[2],
        email:       row[6],
        goi:         row[7],
        maCK:        row[9],
        trangThaiTT: row[11] || 'Chờ thanh toán',
      };
    }
  }
  return null;
}

// ── TÌM VÀ CẬP NHẬT ĐƠN (dùng khi xử lý webhook) ──────────
async function findAndUpdateOrder(content, amount, txDate) {
  if (!CONFIG.GOOGLE_SHEET_ID) {
    console.error('GOOGLE_SHEET_ID chưa được cấu hình!');
    return null;
  }

  const authClient = await auth.getClient();
  const res = await sheets.spreadsheets.values.get({
    auth: authClient,
    spreadsheetId: CONFIG.GOOGLE_SHEET_ID,
    range: 'Đơn Hàng!A:O',
  });

  const rows = res.data.values || [];
  let targetRow = null;
  let orderData = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const maCK       = (row[9]  || '').toUpperCase().trim(); // Cột J — Mã CK
    const trangThai  = (row[11] || '').trim();               // Cột L — Trạng thái TT

    // Tìm mã CK trong nội dung chuyển khoản, bỏ qua đơn đã thanh toán
    if (maCK && content.includes(maCK) && trangThai !== 'Đã thanh toán') {
      targetRow = i + 1; // Google Sheets API dùng 1-based
      orderData = {
        stt:   row[0],
        name:  row[2],
        email: row[6],
        goi:   row[7],
        maCK:  row[9],
      };
      break;
    }
  }

  if (!targetRow) {
    console.warn('Không tìm thấy đơn khớp với nội dung:', content);
    return null;
  }

  console.log(`✅ Tìm thấy đơn tại hàng ${targetRow}:`, orderData);

  // Cập nhật trạng thái thanh toán → "Đã thanh toán"
  await sheets.spreadsheets.values.update({
    auth: authClient,
    spreadsheetId: CONFIG.GOOGLE_SHEET_ID,
    range: `Đơn Hàng!L${targetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Đã thanh toán']] },
  });

  console.log(`✅ Cập nhật hàng ${targetRow}: Đã thanh toán`);
  return orderData;
}

// ── GỬI TELEGRAM ────────────────────────────────────────────
async function sendTelegram(text) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN chưa cấu hình');
    return;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: CONFIG.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: '✅ Huyền Số Server đang chạy',
    time: new Date().toISOString(),
    sheetConfigured: !!CONFIG.GOOGLE_SHEET_ID,
    telegramConfigured: !!CONFIG.TELEGRAM_BOT_TOKEN,
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ── START ────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Server chạy trên port ${CONFIG.PORT}`);
  console.log(`📥 Webhook: POST /webhook`);
  console.log(`🔍 Check payment: GET /check-payment?code=PHS...`);
  console.log(`📊 Sheet ID: ${CONFIG.GOOGLE_SHEET_ID || '⚠️ CHƯA CẤU HÌNH'}`);
  console.log(`💬 Telegram Chat: ${CONFIG.TELEGRAM_CHAT_ID}`);
});
