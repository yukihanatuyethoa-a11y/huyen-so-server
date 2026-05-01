// ============================================================
// HUYỀN SỐ — Order Management System
// Google Apps Script — dán vào Extensions > Apps Script
// ============================================================
//
// LUỒNG HOẠT ĐỘNG:
//   1. Khách điền form trên web → data tự động vào sheet
//   2. Khách chuyển khoản → bạn nhận Telegram noti → cập nhật "Đã thanh toán" trên sheet
//   3. Bạn tạo file lá số cá nhân, upload lên Google Drive
//   4. Dán link Drive vào cột "Link File" → cột "Trạng thái giao" tự chuyển "Sẵn sàng giao"
//   5. Chọn hàng đó → menu ✦ Huyền Số → Giao hàng → email tự động gửi cho khách
//
// ============================================================

// ===== ⚙️  CẤU HÌNH — SỬA TẠI ĐÂY =====
const CONFIG = {
  SHEET_NAME:        'Đơn Hàng',
  ADMIN_EMAIL:       '',           // email của bạn để nhận bản sao (tuỳ chọn)
  EMAIL_SENDER_NAME: 'Huyền Số',
  SUPPORT_EMAIL:     '',           // email hỗ trợ (nếu khác email đăng nhập)
};
// ==========================================

// Cột trong sheet (1-based)
const COL = {
  STT:            1,
  TIMESTAMP:      2,
  TEN:            3,
  GIOI_TINH:      4,
  NGAY_SINH:      5,
  GIO_SINH:       6,
  EMAIL:          7,
  GOI:            8,
  SO_TIEN:        9,
  MA_CK:          10,
  GHI_CHU:        11,
  TRANG_THAI_TT:  12,
  LINK_FILE:      13,
  TRANG_THAI_GIAO:14,
  GHI_CHU_GIAO:   15,
};

const PACKAGE_MAP = {
  '109k': { name: 'Gói Nhập Môn',  price: '109,000đ', code: 'TKPHS109000' },
  '299k': { name: 'Gói Đầy Đủ',    price: '299,000đ', code: 'TKPHS299000' },
  '449k': { name: 'Gói Cải Mệnh',  price: '449,000đ', code: 'TKPHS449000' },
};


// ============================================================
// SETUP — Chạy 1 lần để tạo sheet
// ============================================================
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  // Header
  const headers = [
    'STT', 'Thời gian đặt', 'Tên khách', 'Giới tính', 'Ngày sinh', 'Giờ sinh',
    'Email', 'Gói', 'Số tiền', 'Mã CK', 'Ghi chú khách',
    'Trạng thái TT', 'Link File (Drive)', 'Trạng thái giao', 'Ghi chú giao',
  ];

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setBackground('#1C1440')
    .setFontColor('#FCD34D')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 36);

  // Column widths
  sheet.setColumnWidth(COL.STT,            50);
  sheet.setColumnWidth(COL.TIMESTAMP,      155);
  sheet.setColumnWidth(COL.TEN,            120);
  sheet.setColumnWidth(COL.GIOI_TINH,      80);
  sheet.setColumnWidth(COL.NGAY_SINH,      110);
  sheet.setColumnWidth(COL.GIO_SINH,       120);
  sheet.setColumnWidth(COL.EMAIL,          210);
  sheet.setColumnWidth(COL.GOI,            140);
  sheet.setColumnWidth(COL.SO_TIEN,        100);
  sheet.setColumnWidth(COL.MA_CK,          130);
  sheet.setColumnWidth(COL.GHI_CHU,        200);
  sheet.setColumnWidth(COL.TRANG_THAI_TT,  140);
  sheet.setColumnWidth(COL.LINK_FILE,      320);
  sheet.setColumnWidth(COL.TRANG_THAI_GIAO,140);
  sheet.setColumnWidth(COL.GHI_CHU_GIAO,  200);

  sheet.setFrozenRows(1);

  // Data validation cho cột Trạng thái TT
  const ttRange = sheet.getRange(2, COL.TRANG_THAI_TT, 500, 1);
  const ttRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Chờ thanh toán', 'Đã thanh toán', 'Hoàn tiền'], true)
    .build();
  ttRange.setDataValidation(ttRule);

  // Data validation cho cột Trạng thái giao
  const sgRange = sheet.getRange(2, COL.TRANG_THAI_GIAO, 500, 1);
  const sgRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Chưa giao', 'Đang làm file', 'Sẵn sàng giao', 'Đã giao'], true)
    .build();
  sgRange.setDataValidation(sgRule);

  SpreadsheetApp.getUi().alert(
    '✅ Xong!\n\nSheet "Đơn Hàng" đã được tạo.\n\n' +
    'Tiếp theo: Triển khai Web App để nhận form từ website.\n' +
    'Extensions > Apps Script > Deploy > New Deployment'
  );
}


// ============================================================
// WEB APP — Nhận form submission từ landing page
// Cài đặt: Deploy > New Deployment > Web App
//   Execute as: Me | Who has access: Anyone
// ============================================================
function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : null;
    if (!raw) return jsonResponse({ success: false, error: 'No data' });

    const data = JSON.parse(raw);
    const result = addOrderToSheet(data);
    return jsonResponse({ success: true, orderId: result.orderId });

  } catch (err) {
    console.error('doPost error:', err.toString());
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet() {
  return ContentService
    .createTextOutput('Huyền Số Order API — OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// THÊM ĐƠN HÀNG VÀO SHEET
// ============================================================
function addOrderToSheet(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Sheet "Đơn Hàng" chưa được tạo. Chạy setupSheet() trước.');

  const lastRow = sheet.getLastRow();
  const newRow  = lastRow + 1;
  const stt     = Math.max(lastRow, 1); // STT bắt đầu từ 1

  const pkg = PACKAGE_MAP[data.package] || { name: data.package, price: '', code: '' };

  const rowData = [
    stt,                                                    // STT
    new Date(),                                             // Timestamp
    (data.name || '').trim(),                               // Tên
    data.gender === 'nam' ? 'Nam' : (data.gender === 'nu' ? 'Nữ' : data.gender || ''), // Giới tính
    data.dob || '',                                         // Ngày sinh
    data.birth_hour || 'Không rõ',                         // Giờ sinh
    (data.email || '').toLowerCase().trim(),               // Email
    pkg.name,                                               // Gói
    pkg.price,                                              // Số tiền
    pkg.code,                                               // Mã CK
    (data.note || '').trim(),                               // Ghi chú
    'Chờ thanh toán',                                      // Trạng thái TT
    '',                                                     // Link file
    'Chưa giao',                                           // Trạng thái giao
    '',                                                     // Ghi chú giao
  ];

  sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);

  // Format
  sheet.getRange(newRow, COL.TIMESTAMP).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(newRow, COL.TRANG_THAI_TT)
    .setBackground('#FEF9C3').setFontWeight('bold');
  sheet.getRange(newRow, COL.TRANG_THAI_GIAO)
    .setBackground('#F3F4F6');

  // Border toàn hàng
  sheet.getRange(newRow, 1, 1, rowData.length)
    .setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);

  const orderId = `HS-${String(stt).padStart(3, '0')}`;
  console.log(`✅ Order added: ${orderId} | ${data.email}`);
  return { orderId, row: newRow };
}


// ============================================================
// onEdit — Tự động đổi trạng thái khi paste link Drive
// ============================================================
function onEdit(e) {
  try {
    const sheet = e.source.getActiveSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();
    if (row <= 1) return;

    // Khi thêm link vào cột Link File
    if (col === COL.LINK_FILE) {
      const link = (e.value || '').trim();
      if (link && (link.includes('drive.google.com') || link.includes('docs.google.com') || link.startsWith('http'))) {
        // Tự động chuyển trạng thái sang Sẵn sàng giao
        sheet.getRange(row, COL.TRANG_THAI_GIAO)
          .setValue('Sẵn sàng giao')
          .setBackground('#FEF3C7')
          .setFontWeight('bold');

        e.range.setNote('Link đã thêm ✅\nVào menu ✦ Huyền Số → Giao hàng để gửi email.');
      }
    }

    // Khi thay đổi Trạng thái TT → tô màu tương ứng
    if (col === COL.TRANG_THAI_TT) {
      const colorMap = {
        'Chờ thanh toán': '#FEF9C3',
        'Đã thanh toán':  '#DCFCE7',
        'Hoàn tiền':      '#FEE2E2',
      };
      const bg = colorMap[e.value] || '#FFFFFF';
      e.range.setBackground(bg).setFontWeight('bold');
    }

    // Khi thay đổi Trạng thái giao → tô màu
    if (col === COL.TRANG_THAI_GIAO) {
      const colorMap = {
        'Chưa giao':      '#F3F4F6',
        'Đang làm file':  '#DBEAFE',
        'Sẵn sàng giao':  '#FEF3C7',
        'Đã giao':        '#DCFCE7',
      };
      const bg = colorMap[e.value] || '#FFFFFF';
      e.range.setBackground(bg).setFontWeight('bold');
    }

  } catch (err) {
    console.error('onEdit error:', err.toString());
  }
}


// ============================================================
// GỬI EMAIL GIAO HÀNG
// ============================================================
function sendDeliveryEmail(row) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const ui    = SpreadsheetApp.getUi();

  const vals = sheet.getRange(row, 1, 1, 15).getValues()[0];
  const order = {
    stt:        vals[COL.STT - 1],
    name:       vals[COL.TEN - 1],
    gender:     vals[COL.GIOI_TINH - 1],
    dob:        vals[COL.NGAY_SINH - 1],
    email:      vals[COL.EMAIL - 1],
    package:    vals[COL.GOI - 1],
    amount:     vals[COL.SO_TIEN - 1],
    fileLink:   vals[COL.LINK_FILE - 1],
    status:     vals[COL.TRANG_THAI_GIAO - 1],
  };

  // Validation
  if (!order.email) {
    ui.alert('❌ Không có email ở hàng ' + row);
    return;
  }
  if (!order.fileLink) {
    ui.alert('❌ Chưa có link file ở hàng ' + row + '.\n\nVui lòng upload file lên Google Drive và dán link vào cột "Link File (Drive)" trước.');
    return;
  }
  if (order.status === 'Đã giao') {
    const confirm = ui.alert(
      '⚠️ Đơn này đã giao rồi!',
      'Gửi lại email cho ' + order.email + '?',
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;
  }

  const subject  = `[Huyền Số] Lá số của ${order.name} đã sẵn sàng ✦`;
  const htmlBody = buildEmailHtml(order);

  try {
    GmailApp.sendEmail(order.email, subject, '', {
      htmlBody: htmlBody,
      name:     CONFIG.EMAIL_SENDER_NAME,
      replyTo:  CONFIG.SUPPORT_EMAIL || Session.getActiveUser().getEmail(),
    });

    // Bản sao cho admin
    if (CONFIG.ADMIN_EMAIL) {
      GmailApp.sendEmail(CONFIG.ADMIN_EMAIL, '[BẢN SAO] ' + subject, '', {
        htmlBody: '<p style="color:#999;font-size:12px;border-bottom:1px solid #eee;padding-bottom:8px;margin-bottom:16px;">Bản sao gửi cho admin.</p>' + htmlBody,
        name: 'Huyền Số (Bản sao)',
      });
    }

    // Cập nhật sheet
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    sheet.getRange(row, COL.TRANG_THAI_GIAO).setValue('Đã giao').setBackground('#DCFCE7').setFontWeight('bold');
    sheet.getRange(row, COL.GHI_CHU_GIAO).setValue('Giao lúc ' + now);

    const ttVal = sheet.getRange(row, COL.TRANG_THAI_TT).getValue();
    if (ttVal !== 'Đã thanh toán') {
      sheet.getRange(row, COL.TRANG_THAI_TT).setValue('Đã thanh toán').setBackground('#DCFCE7').setFontWeight('bold');
    }

    ui.alert(`✅ Đã giao hàng thành công!\n\nEmail: ${order.email}\nGói: ${order.package}`);

  } catch (err) {
    ui.alert('❌ Lỗi gửi email:\n' + err.message);
  }
}


// ============================================================
// BUILD EMAIL HTML
// ============================================================
function buildEmailHtml(order) {
  const dobStr = order.dob instanceof Date
    ? Utilities.formatDate(order.dob, Session.getScriptTimeZone(), 'dd/MM/yyyy')
    : (order.dob || '');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F3FF;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3FF;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#1C1440 0%,#2D1F6E 100%);border-radius:16px 16px 0 0;padding:40px 32px;text-align:center;">
    <p style="color:#FCD34D;font-size:11px;letter-spacing:5px;text-transform:uppercase;margin:0 0 14px;font-weight:600;">✦ Huyền Số ✦</p>
    <h1 style="color:#ffffff;font-size:24px;margin:0 0 10px;font-weight:700;line-height:1.3;">Lá số của bạn đã sẵn sàng</h1>
    <p style="color:#A78BFA;font-size:14px;margin:0;">Cảm ơn bạn đã tin tưởng Huyền Số</p>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#ffffff;padding:36px 32px;">
    <p style="color:#374151;font-size:15px;line-height:1.8;margin:0 0 20px;">
      Xin chào <strong>${order.name}</strong>,
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.8;margin:0 0 28px;">
      Lá số cá nhân của bạn đã được luận giải xong và sẵn sàng để đọc. Nhấn vào nút bên dưới để mở file.
    </p>

    <!-- Order info -->
    <table width="100%" cellpadding="12" cellspacing="0" style="background:#F5F3FF;border-radius:12px;margin-bottom:28px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:11px;text-transform:uppercase;letter-spacing:3px;margin:0 0 14px;font-weight:700;">Chi tiết đơn hàng</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#6B7280;font-size:13px;padding:5px 0;width:50%;">Tên:</td>
          <td style="color:#111827;font-size:13px;font-weight:600;padding:5px 0;text-align:right;">${order.name} (${order.gender})</td>
        </tr>
        <tr>
          <td style="color:#6B7280;font-size:13px;padding:5px 0;">Ngày sinh:</td>
          <td style="color:#111827;font-size:13px;font-weight:600;padding:5px 0;text-align:right;">${dobStr}</td>
        </tr>
        <tr>
          <td style="color:#6B7280;font-size:13px;padding:5px 0;">Gói:</td>
          <td style="color:#7C3AED;font-size:13px;font-weight:700;padding:5px 0;text-align:right;">${order.package}</td>
        </tr>
        <tr>
          <td style="color:#6B7280;font-size:13px;padding:5px 0;">Số tiền:</td>
          <td style="color:#111827;font-size:13px;font-weight:600;padding:5px 0;text-align:right;">${order.amount}</td>
        </tr>
      </table>
    </td></tr>
    </table>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr><td align="center">
      <a href="${order.fileLink}"
         style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#4C1D95);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:18px 48px;border-radius:12px;letter-spacing:0.5px;">
        ✦ Mở File Lá Số Của Bạn
      </a>
    </td></tr>
    </table>

    <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0 0 28px;word-break:break-all;">
      Nếu nút không mở được, copy link:<br>
      <a href="${order.fileLink}" style="color:#7C3AED;">${order.fileLink}</a>
    </p>

    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:8px 0;vertical-align:top;width:24px;">📖</td>
        <td style="color:#374151;font-size:14px;line-height:1.7;padding:8px 0;">
          <strong>Hướng dẫn đọc:</strong> File được viết theo trình tự — đọc từ đầu đến cuối. Không cần nền kiến thức về tử vi. Những chỗ nào chưa rõ, ghi chú lại để hỏi.
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;vertical-align:top;">💬</td>
        <td style="color:#374151;font-size:14px;line-height:1.7;padding:8px 0;">
          <strong>Cần hỗ trợ?</strong> Trả lời thẳng email này — tôi sẽ phản hồi trong 24h.
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#F9FAFB;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="color:#9CA3AF;font-size:11px;margin:0;line-height:1.7;">
      © Huyền Số · Email này được gửi tự động sau khi hoàn tất đơn hàng.<br>
      Thông tin cá nhân chỉ dùng để tạo lá số · Không chia sẻ với bên thứ ba.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}


// ============================================================
// MENU — ✦ Huyền Số (hiện khi mở sheet)
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('✦ Huyền Số')
    .addItem('📦 Giao hàng (hàng đang chọn)', 'deliverSelectedRow')
    .addSeparator()
    .addItem('✅ Đánh dấu Đã thanh toán', 'markAsPaid')
    .addItem('🔄 Đánh dấu Đang làm file', 'markInProgress')
    .addSeparator()
    .addItem('⚙️ Tạo / Reset sheet', 'setupSheet')
    .addToUi();
}

function deliverSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveRange().getRow();
  if (row <= 1) {
    SpreadsheetApp.getUi().alert('Vui lòng click vào một hàng đơn hàng (không phải dòng tiêu đề).');
    return;
  }
  sendDeliveryEmail(row);
}

function markAsPaid() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveRange().getRow();
  if (row <= 1) return;
  sheet.getRange(row, COL.TRANG_THAI_TT)
    .setValue('Đã thanh toán').setBackground('#DCFCE7').setFontWeight('bold');
  SpreadsheetApp.getUi().alert('✅ Đã cập nhật: Đã thanh toán');
}

function markInProgress() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveRange().getRow();
  if (row <= 1) return;
  sheet.getRange(row, COL.TRANG_THAI_GIAO)
    .setValue('Đang làm file').setBackground('#DBEAFE').setFontWeight('bold');
  SpreadsheetApp.getUi().alert('🔄 Đã cập nhật: Đang làm file');
}
