// Renders a branded, one-page PDF invoice — pdfkit is pure JS (no headless
// browser needed), so it works fine in Vercel's serverless functions.
// A real PDF opens cleanly as a document preview in WhatsApp (unlike a wall
// of plain text), and staff can forward it straight from Telegram.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../config');
const { formatForDisplay } = require('./phone');

const GOLD = '#C9A227';
const DARK = '#1A1A1A';
const GREY = '#6B6B6B';
const LINE = '#E0E0E0';
const PANEL_BG = '#FAF8F3'; // warm off-white for the boxed panels, distinct from pure white
const ROW_ALT = '#FCFAF5'; // faint zebra tint on item rows

// Drop the logo file here (see README) and it's picked up automatically;
// if it's missing, the header just falls back to text-only branding.
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo.png');

const money = (n) => `Nu. ${Number(n).toFixed(2)}`;

/** A light rounded panel with a thin gold left accent bar — used for the Order/Bill/Payment/Delivery boxes. */
function panel(doc, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 6).fill(PANEL_BG);
  doc.rect(x, y, 3, h).fill(GOLD);
}

/**
 * Builds the invoice PDF for one order + its delivery, resolving to a
 * Buffer ready to send as a Telegram document.
 */
function buildInvoicePdf(order, delivery) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const marginX = 50;
    const contentW = pageW - marginX * 2;
    const col = { idx: marginX + 14, item: marginX + 40, qty: marginX + 260, price: marginX + 315, total: marginX + 395 };
    const colWidth = { idx: 18, item: 215, qty: 45, price: 70, total: contentW - (col.total - marginX) };

    // ---- Header band ----
    doc.rect(0, 0, pageW, 130).fill(DARK);
    doc.rect(0, 130, pageW, 4).fill(GOLD); // accent stripe closing off the header

    const hasLogo = fs.existsSync(LOGO_PATH);
    const brandX = hasLogo ? marginX + 78 : marginX;
    if (hasLogo) {
      // Circular badge behind the logo — a plain square logo dropped on a
      // dark band looks like a debug asset; clipping it into a white-backed
      // circle reads as an actual brand mark.
      const cx = marginX + 34;
      const cy = 65;
      const r = 34;
      doc.save();
      doc.circle(cx, cy, r).fill('#FFFFFF');
      doc.circle(cx, cy, r).clip();
      doc.image(LOGO_PATH, cx - r, cy - r, { width: r * 2, height: r * 2 });
      doc.restore();
      doc.circle(cx, cy, r).lineWidth(1.5).strokeColor(GOLD).stroke();
    }

    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(23).text(config.businessName.toUpperCase(), brandX, 40, { characterSpacing: 0.5 });
    doc.fillColor('#CCCCCC').font('Helvetica').fontSize(9).text('SNEAKERS  ·  STYLE  ·  YOU', brandX, 66, { characterSpacing: 1.5 });
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(20).text('INVOICE', marginX, 38, { width: contentW, align: 'right', characterSpacing: 1 });
    doc
      .fillColor('#CCCCCC')
      .font('Helvetica')
      .fontSize(9)
      .text(`#${order.OrderID}`, marginX, 62, { width: contentW, align: 'right' });

    let y = 158;

    // ---- Order meta / Bill To — two boxed panels instead of bare text ----
    const panelH = 56;
    const panelW = (contentW - 16) / 2;
    panel(doc, marginX, y, panelW, panelH);
    panel(doc, marginX + panelW + 16, y, panelW, panelH);

    doc
      .fillColor(GOLD)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('ORDER DETAILS', marginX + 16, y + 12, { characterSpacing: 0.5 });
    doc
      .fillColor(DARK)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(order.OrderID, marginX + 16, y + 26);
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(9)
      .text(new Date(order.Timestamp).toLocaleDateString(), marginX + 16, y + 40);

    const billX = marginX + panelW + 16;
    doc
      .fillColor(GOLD)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('BILL TO', billX + 16, y + 12, { characterSpacing: 0.5 });
    doc
      .fillColor(DARK)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(order.CustomerName, billX + 16, y + 26, { width: panelW - 32 });
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(9)
      .text(formatForDisplay(order.CustomerPhone), billX + 16, y + 40);

    y += panelH + 26;

    // ---- Item table ----
    doc.roundedRect(marginX, y, contentW, 22, 4).fill(DARK);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9);
    doc.text('#', col.idx, y + 6, { width: colWidth.idx });
    doc.text('ITEM', col.item, y + 6, { width: colWidth.item, characterSpacing: 0.5 });
    doc.text('QTY', col.qty, y + 6, { width: colWidth.qty, align: 'right' });
    doc.text('PRICE', col.price, y + 6, { width: colWidth.price, align: 'right' });
    doc.text('TOTAL', col.total, y + 6, { width: colWidth.total, align: 'right' });
    y += 22;

    doc.font('Helvetica').fontSize(10);
    order.Items.forEach((item, i) => {
      const itemLineHeight = doc.heightOfString(item.ItemDesc, { width: colWidth.item });
      const rowH = Math.max(itemLineHeight, 14) + 16;

      if (i % 2 === 1) doc.rect(marginX, y, contentW, rowH).fill(ROW_ALT); // zebra striping — every other row

      doc.fillColor(GREY).font('Helvetica').fontSize(9).text(String(i + 1), col.idx, y + 8, { width: colWidth.idx });
      doc.fillColor(DARK).font('Helvetica').fontSize(10).text(item.ItemDesc, col.item, y + 8, { width: colWidth.item });
      doc.fillColor(DARK).text(String(item.Qty), col.qty, y + 8, { width: colWidth.qty, align: 'right' });
      doc.fillColor(DARK).text(money(item.Price), col.price, y + 8, { width: colWidth.price, align: 'right' });
      doc.fillColor(DARK).font('Helvetica-Bold').text(money(item.Total), col.total, y + 8, { width: colWidth.total, align: 'right' });

      y += rowH;
      doc.moveTo(marginX, y).lineTo(pageW - marginX, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });
    y += 16;

    // ---- Total — a bordered gold box instead of a bare number, so it
    // reads as the one figure that matters on the page ----
    const totalBoxW = 200;
    const totalBoxX = pageW - marginX - totalBoxW;
    doc.roundedRect(totalBoxX, y, totalBoxW, 40, 6).fill(DARK);
    doc.fillColor('#CCCCCC').font('Helvetica-Bold').fontSize(10).text('TOTAL', totalBoxX + 16, y + 13, { characterSpacing: 0.5 });
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(16).text(money(order.Total), totalBoxX, y + 10, { width: totalBoxW - 16, align: 'right' });
    y += 60;

    // ---- Payment & Delivery — matching boxed panels ----
    const infoPanelH = 50;
    panel(doc, marginX, y, panelW, infoPanelH);
    panel(doc, marginX + panelW + 16, y, panelW, infoPanelH);

    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text('PAYMENT', marginX + 16, y + 10, { characterSpacing: 0.5 });
    const paymentText =
      order.PaymentMethod === 'Bank Transfer'
        ? `${order.BankName} — Journal #${order.JournalNumber}`
        : order.PaymentMethod || 'Cash';
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5).text(paymentText, marginX + 16, y + 24, { width: panelW - 32 });

    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text('DELIVERY', billX + 16, y + 10, { characterSpacing: 0.5 });
    const deliveryText = `${delivery.method}${delivery.vehiclePlate ? ` (${delivery.vehiclePlate})` : ''} to ${order.DeliveryLocation}`;
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5).text(deliveryText, billX + 16, y + 24, { width: panelW - 32 });

    y += infoPanelH + 30;

    // ---- Footer ----
    doc.moveTo(marginX, y).lineTo(pageW - marginX, y).lineWidth(1).strokeColor(GOLD).stroke();
    y += 20;
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(DARK)
      .text('Thank you for shopping with us!', marginX, y, { width: contentW, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(GREY)
      .text(config.businessName, marginX, doc.y + 6, { width: contentW, align: 'center', characterSpacing: 0.5 });

    doc.end();
  });
}

module.exports = { buildInvoicePdf };
