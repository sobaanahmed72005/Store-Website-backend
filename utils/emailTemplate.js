const PRIMARY = '#102b53';
const GOLD = '#d4af37';
const GOLD_LIGHT = '#fbf3dc';
const TEXT = '#333333';
const MUTED = '#666666';
const BG = '#f2f2f2';

// Customer/order-supplied values (names, addresses, references, product titles) get interpolated
// into these HTML email templates — escape them so a value like `<img onerror=...>` can't inject
// markup into the rendered email.
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function wrapEmail(bodyHtml, { storeName = 'YourITstore', preheader = '', unsubscribeUrl = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${storeName}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;color:${TEXT};">

  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>` : ''}

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${PRIMARY};border-radius:10px 10px 0 0;padding:28px 40px;text-align:center;">
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">${storeName}</h1>
              <p style="margin:6px 0 0;font-size:12px;color:${GOLD};letter-spacing:1.5px;text-transform:uppercase;">Official Store Email</p>
            </td>
          </tr>

          <!-- Gold accent bar -->
          <tr>
            <td style="background:${GOLD};height:4px;"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;border-left:1px solid #e8e8e8;border-right:1px solid #e8e8e8;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${GOLD_LIGHT};border:1px solid #e8e8e8;border-top:none;border-radius:0 0 10px 10px;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 10px;font-size:13px;color:${PRIMARY};font-weight:700;">Can't find this email in your inbox?</p>
              <p style="margin:0 0 12px;font-size:12px;color:${MUTED};">Please check your <strong>Spam</strong> or <strong>Junk</strong> folder. If it's there, mark it as <strong>"Not Spam"</strong> so future emails reach you directly.</p>
              <p style="margin:0 0 6px;font-size:12px;color:${MUTED};">You received this email because you have an account or placed an order with us.</p>
              ${unsubscribeUrl ? `<p style="margin:0 0 10px;font-size:12px;color:${MUTED};">Don't want emails like this? <a href="${unsubscribeUrl}" style="color:${PRIMARY};">Unsubscribe</a></p>` : ''}
              <p style="margin:0;font-size:12px;color:${MUTED};">&copy; ${new Date().getFullYear()} ${storeName}. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// Reusable HTML building blocks for email body content
export function emailGreeting(name) {
  return `<p style="margin:0 0 20px;font-size:16px;color:${TEXT};">Hi <strong>${escapeHtml(name) || 'there'}</strong>,</p>`;
}

export function emailButton(text, url) {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
      <tr>
        <td style="background:${PRIMARY};border-radius:6px;">
          <a href="${url}" target="_blank"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
            ${text}
          </a>
        </td>
      </tr>
    </table>`;
}

export function emailOrderTable(rows) {
  const rowsHtml = rows.map(({ label, value, bold }) => `
    <tr>
      <td style="padding:10px 0;font-size:14px;color:${MUTED};border-bottom:1px solid #f0f0f0;">${escapeHtml(label)}</td>
      <td style="padding:10px 0;font-size:14px;color:${TEXT};text-align:right;border-bottom:1px solid #f0f0f0;${bold ? 'font-weight:700;' : ''}">${escapeHtml(value)}</td>
    </tr>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin:24px 0;">
      <tr>
        <td colspan="2" style="background:${GOLD_LIGHT};padding:12px 20px;font-size:13px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.5px;">
          Order Summary
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>`;
}

export function emailStatusBadge(label, color = PRIMARY) {
  return `<span style="display:inline-block;background:${color};color:#fff;font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;text-transform:uppercase;letter-spacing:0.5px;">${label}</span>`;
}

export function emailDivider() {
  return `<hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;" />`;
}

export function emailParagraph(text) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT};">${text}</p>`;
}

const PAYMENT_LABEL_MAP = {
  bank_transfer: 'Bank / Wallet Transfer',
  jazzcash:      'JazzCash',
  easypaisa:     'EasyPaisa',
  cod:           'Cash on Delivery',
};

export function emailInvoiceBlock(order, items) {
  const subtotal  = items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const shipping  = Number(order.shipping_fee)    || 0;
  const discount  = Number(order.discount_amount) || 0;
  const total     = Number(order.total_amount);
  const pmLabel   = PAYMENT_LABEL_MAP[order.payment_method] || order.payment_method || '';
  const addrParts = [order.shipping_address, order.shipping_city].filter(Boolean);

  const itemRows = items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : GOLD_LIGHT};">
      <td style="padding:10px 14px;font-size:14px;color:${TEXT};border-bottom:1px solid #f0f0f0;">${escapeHtml(item.product_name)}</td>
      <td style="padding:10px 14px;font-size:14px;color:${MUTED};text-align:center;border-bottom:1px solid #f0f0f0;">${item.quantity}</td>
      <td style="padding:10px 14px;font-size:14px;color:${TEXT};text-align:right;border-bottom:1px solid #f0f0f0;">Rs.&nbsp;${Number(item.price).toLocaleString()}</td>
      <td style="padding:10px 14px;font-size:14px;color:${TEXT};font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">Rs.&nbsp;${(Number(item.price) * item.quantity).toLocaleString()}</td>
    </tr>`).join('');

  const discountRow = discount > 0 ? `
    <tr>
      <td colspan="3" style="padding:8px 14px;font-size:14px;color:#2e7d32;text-align:right;">
        Discount${order.discount_code ? ` (${escapeHtml(order.discount_code)})` : ''}
      </td>
      <td style="padding:8px 14px;font-size:14px;color:#2e7d32;font-weight:600;text-align:right;">-Rs.&nbsp;${discount.toLocaleString()}</td>
    </tr>` : '';

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin:0 0 24px;">
      <tr>
        <td style="background:${GOLD_LIGHT};padding:12px 20px;font-size:13px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.5px;">
          Shipping Details
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 5px;font-size:14px;font-weight:700;color:${TEXT};">${escapeHtml(order.shipping_name)}</p>
          ${order.phone ? `<p style="margin:0 0 4px;font-size:14px;color:${MUTED};">${escapeHtml(order.phone)}</p>` : ''}
          ${addrParts.length ? `<p style="margin:0 0 4px;font-size:14px;color:${MUTED};">${escapeHtml(addrParts.join(', '))}</p>` : ''}
          ${pmLabel ? `<p style="margin:10px 0 0;font-size:13px;color:${MUTED};">Payment: <strong style="color:${TEXT};">${escapeHtml(pmLabel)}</strong></p>` : ''}
          ${order.payment_reference ? `<p style="margin:4px 0 0;font-size:13px;color:${MUTED};">Ref: <strong style="color:${TEXT};">${escapeHtml(order.payment_reference)}</strong></p>` : ''}
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin:0 0 8px;">
      <tr>
        <td colspan="4" style="background:${GOLD_LIGHT};padding:12px 14px;font-size:13px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.5px;">
          Order Items
        </td>
      </tr>
      <tr style="background:#f8f8f8;">
        <td style="padding:8px 14px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;">Item</td>
        <td style="padding:8px 14px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;text-align:center;">Qty</td>
        <td style="padding:8px 14px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;text-align:right;">Unit Price</td>
        <td style="padding:8px 14px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;text-align:right;">Total</td>
      </tr>
      ${itemRows}
      <tr><td colspan="3" style="padding:8px 14px;font-size:14px;color:${MUTED};text-align:right;">Subtotal</td>
          <td style="padding:8px 14px;font-size:14px;color:${TEXT};text-align:right;">Rs.&nbsp;${subtotal.toLocaleString()}</td></tr>
      <tr><td colspan="3" style="padding:8px 14px;font-size:14px;color:${MUTED};text-align:right;">Shipping Fee</td>
          <td style="padding:8px 14px;font-size:14px;color:${TEXT};text-align:right;">Rs.&nbsp;${shipping.toLocaleString()}</td></tr>
      ${discountRow}
      <tr style="background:${GOLD_LIGHT};">
        <td colspan="3" style="padding:12px 14px;font-size:15px;font-weight:700;color:${PRIMARY};text-align:right;">Grand Total</td>
        <td style="padding:12px 14px;font-size:15px;font-weight:700;color:${PRIMARY};text-align:right;">Rs.&nbsp;${total.toLocaleString()}</td>
      </tr>
    </table>`;
}