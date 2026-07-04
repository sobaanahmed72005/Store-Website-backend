import PDFDocument from 'pdfkit'
import pool from '../config/db.js'

// Matches the site's teal/gold theme (src/index.css --color-cz-*)
const HEADER_BG = '#2b6580' // cz-header — same shade the live site header uses behind the logo
const PRIMARY   = '#35708f' // cz-primary
const INK       = '#1f3a44' // cz-ink
const GOLD      = '#d4af37' // cz-accent
const GOLD_BG   = '#f7ecd9' // cz-gold-light
const SEA_GREEN = '#4fae8a' // cz-lavender (sea-green accent, used for discounts)
const TEXT      = '#1f3a44'
const MUTED     = '#5c7a86'
const LINE      = '#d7e2e6'
const TOTAL_BG  = '#eaf2ef'

const PAYMENT_LABEL = {
  bank_transfer: 'Bank Transfer',
  jazzcash:      'JazzCash',
  easypaisa:     'EasyPaisa',
  cod:           'Cash on Delivery',
}

async function fetchImageBuffer(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

export async function generateInvoicePdf(orderId, businessId) {
  // ── Fetch everything in parallel ─────────────────────────────────────────
  const [[orderRows], [items], [contentRows]] = await Promise.all([
    pool.query(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email
       FROM orders o JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.business_id = ?`,
      [orderId, businessId],
    ),
    pool.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]),
    pool.query(
      `SELECT content_key, value FROM site_content
       WHERE business_id = ? AND content_key IN ('site-settings','footer-brand')`,
      [businessId],
    ),
  ])

  if (!orderRows.length) throw new Error('Order not found')
  const order = { ...orderRows[0], items }

  let siteName = '', storeAddress = '', storePhone = '', storeEmail = '', logoUrl = ''
  for (const row of contentRows) {
    const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    if (row.content_key === 'site-settings') { siteName = v.siteName || ''; logoUrl = v.logo || '' }
    if (row.content_key === 'footer-brand')  { storeAddress = v.address || ''; storePhone = v.phone || ''; storeEmail = v.email || '' }
  }

  const backendUrl  = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`
  const websiteUrl  = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/^https?:\/\//, '')
  const logoAbsUrl  = logoUrl ? (logoUrl.startsWith('http') ? logoUrl : `${backendUrl}${logoUrl}`) : ''
  const logoBuf     = logoAbsUrl ? await fetchImageBuffer(logoAbsUrl) : null

  // ── Build PDF ─────────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end',  () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const W  = doc.page.width   // 595
    const M  = 50               // margin
    const UW = W - M * 2        // 495 usable width

    // ── Header (site teal background) ────────────────────────────────────
    doc.rect(0, 0, W, 112).fill(HEADER_BG)

    let logoEndX = M
    if (logoBuf) {
      try {
        doc.image(logoBuf, M, 18, { height: 48, fit: [72, 48] })
        logoEndX = M + 82
      } catch { /* bad image — skip */ }
    }

    doc.font('Helvetica-Bold').fontSize(19).fillColor('#ffffff')
       .text(siteName || 'Invoice', logoEndX, 22, { width: 230 })

    let sY = 48
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD)
       .text(websiteUrl, logoEndX, sY, { width: 230 })
    sY += 12

    doc.font('Helvetica').fontSize(8.5).fillColor('#bcd8de')
    if (storeAddress) {
      doc.text(storeAddress, logoEndX, sY, { width: 230 })
      sY += doc.heightOfString(storeAddress, { width: 230 }) + 2
    }
    if (storePhone)   { doc.text(storePhone,   logoEndX, sY); sY += 12 }
    if (storeEmail)   { doc.text(storeEmail,   logoEndX, sY) }

    doc.font('Helvetica-Bold').fontSize(26).fillColor(GOLD)
       .text('INVOICE', M, 34, { width: UW, align: 'right' })

    // Gold accent bar
    doc.rect(0, 112, W, 4).fill(GOLD)

    // ── Bill To / Invoice Details ─────────────────────────────────────────
    let y = 134

    const invoiceNum = `INV-${new Date(order.created_at).getFullYear()}-${String(orderId).padStart(5, '0')}`

    // Left column — Bill To
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD).text('BILL TO', M, y)
    y += 14
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT)
       .text(order.shipping_name || order.customer_name || '', M, y)
    y += 16
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
    if (order.phone) { doc.text(order.phone, M, y); y += 13 }
    const custEmail = order.email || order.customer_email
    if (custEmail) { doc.text(custEmail, M, y); y += 13 }
    const addrStr = [order.shipping_address, order.shipping_city].filter(Boolean).join(', ')
    if (addrStr) { doc.text(addrStr, M, y, { width: 230 }); y += 13 }

    // Right column — Invoice Details
    const rX = M + UW / 2 + 20
    const rW = UW / 2 - 20
    let ry = 134
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD)
       .text('INVOICE DETAILS', rX, ry, { width: rW, align: 'right' })
    ry += 14

    const details = [
      ['Invoice #',   invoiceNum],
      ['Order #',     `${orderId}`],
      ['Order Date',  fmtDate(order.created_at)],
      ['Invoice Date', fmtDate(new Date())],
    ]
    for (const [label, val] of details) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
         .text(label, rX, ry, { width: rW * 0.44 })
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT)
         .text(val, rX + rW * 0.44, ry, { width: rW * 0.56, align: 'right' })
      ry += 14
    }

    y = Math.max(y, ry) + 16
    doc.rect(M, y, UW, 0.5).fill(LINE)
    y += 14

    // ── Items Table ───────────────────────────────────────────────────────
    const ROW_H  = 22
    // Right-edge positions for each column (text right-aligns to these points)
    const QTY_RE   = M + UW - 170   // qty column right edge  (375)
    const PRICE_RE = M + UW - 82    // unit price right edge  (463)
    const TOTAL_RE = M + UW         // total right edge       (545)

    // Header
    doc.rect(M, y, UW, ROW_H).fill(PRIMARY)
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
    doc.text('ITEM',       M + 6, y + 7, { width: QTY_RE - M - 70 })
    doc.text('QTY',        M + 6, y + 7, { width: QTY_RE - M - 6,   align: 'right' })
    doc.text('UNIT PRICE', M + 6, y + 7, { width: PRICE_RE - M - 6, align: 'right' })
    doc.text('TOTAL',      M + 6, y + 7, { width: UW - 6,           align: 'right' })
    y += ROW_H

    for (let i = 0; i < order.items.length; i++) {
      const item      = order.items[i]
      const lineTotal = Number(item.price) * item.quantity
      if (i % 2 === 1) doc.rect(M, y, UW, ROW_H).fill(GOLD_BG)
      doc.font('Helvetica').fontSize(9.5).fillColor(TEXT)
      doc.text(item.product_name,                              M + 6, y + 6, { width: QTY_RE - M - 70 })
      doc.text(String(item.quantity),                          M + 6, y + 6, { width: QTY_RE - M - 6,   align: 'right' })
      doc.text(`Rs. ${Number(item.price).toLocaleString()}`,   M + 6, y + 6, { width: PRICE_RE - M - 6, align: 'right' })
      doc.text(`Rs. ${lineTotal.toLocaleString()}`,            M + 6, y + 6, { width: UW - 6,           align: 'right' })
      y += ROW_H
    }

    doc.rect(M, y, UW, 0.5).fill(LINE)
    y += 14

    // ── Totals ────────────────────────────────────────────────────────────
    const subtotal = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0)
    const shipping  = Number(order.shipping_fee)    || 0
    const discount  = Number(order.discount_amount) || 0
    const total     = Number(order.total_amount)

    const tX = M + UW * 0.54   // label column start
    const tLW = UW * 0.26      // label column width
    const tVW = UW * 0.20      // value column width

    const totRow = (label, val, bold = false, valColor = TEXT) => {
      if (bold) {
        doc.rect(tX - 8, y - 4, tLW + tVW + 8, 26).fill(TOTAL_BG)
      }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 10)
         .fillColor(bold ? INK : MUTED).text(label, tX, y, { width: tLW })
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 10)
         .fillColor(bold ? INK : valColor).text(val, tX + tLW, y, { width: tVW, align: 'right' })
      y += bold ? 22 : 16
    }

    totRow('Subtotal',    `Rs. ${subtotal.toLocaleString()}`)
    totRow('Shipping Fee', `Rs. ${shipping.toLocaleString()}`)
    if (discount > 0) {
      totRow(
        order.discount_code ? `Discount (${order.discount_code})` : 'Discount',
        `-Rs. ${discount.toLocaleString()}`,
        false, SEA_GREEN,
      )
    }
    totRow('GRAND TOTAL', `Rs. ${total.toLocaleString()}`, true)

    y += 10

    // Payment method + reference
    const pmLabel = PAYMENT_LABEL[order.payment_method] || order.payment_method || ''
    if (pmLabel) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Payment Method: ', M, y, { continued: true })
      doc.font('Helvetica-Bold').fillColor(TEXT).text(pmLabel)
      y += 14
    }
    if (order.payment_reference) {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Transaction Ref: ', M, y, { continued: true })
      doc.font('Helvetica-Bold').fillColor(TEXT).text(order.payment_reference)
      y += 14
    }
    if (order.notes) {
      y += 4
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Order Notes: ', M, y, { continued: true })
      doc.font('Helvetica').fillColor(TEXT).text(order.notes, { width: UW * 0.6 })
      y += 14
    }

    // ── Footer ────────────────────────────────────────────────────────────
    y += 22
    doc.rect(M, y, UW, 0.5).fill(GOLD)
    y += 14
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
       .text('Thank you for your business!', M, y, { width: UW, align: 'center' })
    y += 18
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
       .text('This is a computer-generated invoice and does not require a physical signature.', M, y, { width: UW, align: 'center' })
    y += 12
    doc.text(`${siteName || 'Store'} · ${new Date().getFullYear()}`, M, y, { width: UW, align: 'center' })

    doc.end()
  })
}