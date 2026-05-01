// ============================================================
// HUYỀN SỐ — SePay Webhook Server
// Node.js + Express — Deploy lên Railway
// ============================================================
//
// Luồng:
//   1. Khách chuyển khoản với mã CK (TKPHS109000, etc.)
//   2. SePay gửi webhook → server nhận
//   3. Server parse mã CK → tìm hàng trên sheet
//   4. Tự động update "Trạng thái TT" → "Đã thanh toán"
//   5. Gửi Telegram noti cho admin
//
// ============================================================

const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(express.json());

// ===== CẤU HÌNH =====
const CONFIG = {
  PORT: process.env.PORT || 3000,
  TELEGRAM_GROUP_ID: process.env.TELEGRAM_GROUP_ID || '-5001844130',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

  // Google Sheets
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  GOOGLE_SERVICE_ACCOUNT: process.env.GOOGLE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
    : {},
};

// Mã CK → Gói mapping
const PACKAGE_MAP = {
  'TKPHS109000': { goi: 'Gói Nhập Môn', gia: '109.000đ' },
  'TKPHS299000': { goi: 'Gói Đầy Đủ', gia: '299.000đ' },
  'TKPHS449000': { goi: 'Gói Cải Mệnh', gia: '449.000đ' },
};

// ===== GOOGLE SHEETS AUTH =====
const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
  credentials: CONFIG.GOOGLE_SERVICE_ACCOUNT,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getSheetAuth() {
  return await auth.getClient();
}

// ===== WEBHOOK ENDPOINT =====
app.post('/webhook', async (req, res) => {
  try {
    console.log('📥 Webhook received:', new Date().toISOString());
    console.log('Payload:', JSON.stringify(req.body, null, 2));

    // Respond immediately (don't make SePay wait)
    res.status(200).json({ status: 'received' });

    // Process async
    processPayment(req.body).catch(err => {
      console.error('❌ Payment processing error:', err.message);
      sendTelegramMessage(
        `🚨 Lỗi xử lí webhook:\n${err.message}`,
        CONFIG.TELEGRAM_GROUP_ID
      ).catch(() => {});
    });

  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== PROCESS PAYMENT =====
async function processPayment(payload) {
  // Parse SePay webhook payload
  // SePay structure: { transferAmount, description, content, transactionDate, ... }

  const description = payload.description || '';
  const content = payload.content || '';
  const amount = parseInt(payload.transferAmount) || 0;
  const transferDate = payload.transactionDate || new Date().toISOString();

  console.log('Parsing payment:');
  console.log('  Description:', description);
  console.log('  Content:', content);
  console.log('  Amount:', amount);

  // Find order code (TKPHS109000, TKPHS299000, TKPHS449000)
  const orderCodeMatch = description.match(/(TKPHS\d+)/);
  if (!orderCodeMatch) {
    console.warn('⚠️ Order code not found in description');
    return;
  }

  const orderCode = orderCodeMatch[1];
  const packageInfo = PACKAGE_MAP[orderCode];

  if (!packageInfo) {
    console.warn('⚠️ Unknown package code:', orderCode);
    return;
  }

  console.log('✅ Found order code:', orderCode, packageInfo);

  // Find & update row in sheet
  const result = await findAndUpdateOrder(orderCode, amount, transferDate);

  if (result) {
    console.log('✅ Order updated:', result);

    // Send Telegram notification
    const message = formatTelegramMessage(result, packageInfo, orderCode);
    await sendTelegramMessage(message, CONFIG.TELEGRAM_GROUP_ID);

    console.log('✅ Telegram notification sent');
  } else {
    console.warn('⚠️ Order not found on sheet');
  }
}

// ===== FIND & UPDATE ORDER ON SHEET =====
async function findAndUpdateOrder(orderCode, amount, transferDate) {
  try {
    const authClient = await getSheetAuth();

    // Get all values from sheet
    const response = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: CONFIG.GOOGLE_SHEET_ID,
      range: 'Đơn Hàng!A:O', // All columns
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      console.warn('Sheet is empty');
      return null;
    }

    // Header = row 0
    // Data starts from row 1

    // Find row with matching Mã CK (column J = 10)
    let targetRow = null;
    let orderData = null;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const maCK = row[9] || ''; // Column J (0-indexed = 9)

      if (maCK.includes(orderCode)) {
        targetRow = i + 1; // 1-based for API
        orderData = {
          stt: row[0],
          name: row[2],
          email: row[6],
          goi: row[7],
          maCK: maCK,
        };
        break;
      }
    }

    if (!targetRow) {
      console.warn(`Order code ${orderCode} not found on sheet`);
      return null;
    }

    console.log(`Found order at row ${targetRow}:`, orderData);

    // Update Trạng thái TT (column L = 11) to "Đã thanh toán"
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId: CONFIG.GOOGLE_SHEET_ID,
      range: `Đơn Hàng!L${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Đã thanh toán']],
      },
    });

    console.log(`✅ Updated row ${targetRow}: Trạng thái TT = "Đã thanh toán"`);

    return {
      row: targetRow,
      ...orderData,
      amount: amount,
      transferDate: transferDate,
    };

  } catch (err) {
    console.error('❌ Sheet update error:', err.message);
    throw err;
  }
}

// ===== FORMAT TELEGRAM MESSAGE =====
function formatTelegramMessage(order, packageInfo, orderCode) {
  const transferDateStr = new Date(order.transferDate).toLocaleString('vi-VN');

  return `✅ *THANH TOÁN THÀNH CÔNG*

🎯 *Đơn hàng:* HS-${String(order.stt).padStart(3, '0')}
👤 *Khách:* ${order.name}
📦 *Gói:* ${packageInfo.goi}
💰 *Số tiền:* ${order.amount.toLocaleString('vi-VN')} VND
💾 *Mã CK:* \`${orderCode}\`
⏰ *Thời gian:* ${transferDateStr}
📧 *Email:* ${order.email}

✅ Sheet đã cập nhật: Trạng thái TT = "Đã thanh toán"

🔔 *Hành động tiếp theo:*
1. Tạo file lá số cá nhân cho ${order.name}
2. Upload lên Google Drive
3. Dán link vào cột "Link File" trên sheet
4. Bấm menu ✦ Huyền Số → Giao hàng
`;
}

// ===== SEND TELEGRAM MESSAGE =====
async function sendTelegramMessage(message, chatId) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not set, skipping message');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;

    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });

    console.log('✅ Telegram message sent to', chatId);

  } catch (err) {
    console.error('❌ Telegram send error:', err.message);
    throw err;
  }
}

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({
    status: 'Huyền Số Server is running ✅',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ===== START SERVER =====
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Huyền Số Server listening on port ${CONFIG.PORT}`);
  console.log(`📥 Webhook endpoint: POST /webhook`);
  console.log(`📊 Sheet ID: ${CONFIG.GOOGLE_SHEET_ID}`);
  console.log(`💬 Telegram Group: ${CONFIG.TELEGRAM_GROUP_ID}`);
});
