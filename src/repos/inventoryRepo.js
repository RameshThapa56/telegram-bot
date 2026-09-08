// All reads/writes to the "Inventory" sheet tab live here. Flow handlers
// never touch sheetsClient directly — they call these named, purpose-built
// functions, so the Sheets column layout can change without touching bot logic.

const sheets = require('../google/sheetsClient');
const { newItemId } = require('../utils/ids');

const SHEET = 'Inventory';

async function listAll() {
  return sheets.getRowsAsObjects(SHEET);
}

/** Distinct brand names currently in stock, for building quick-pick buttons. */
async function listBrands() {
  const rows = await listAll();
  return [...new Set(rows.map((r) => r.Brand).filter(Boolean))].sort();
}

async function listByBrand(brand) {
  const rows = await listAll();
  return rows.filter((r) => r.Brand.toLowerCase() === brand.toLowerCase());
}

/** Exact match on the four attributes that define a distinct stock-keeping unit. */
async function findExact({ brand, name, size, color }) {
  const rows = await listAll();
  return rows.find(
    (r) =>
      r.Brand.toLowerCase() === brand.toLowerCase() &&
      r.Name.toLowerCase() === name.toLowerCase() &&
      String(r.Size).toLowerCase() === String(size).toLowerCase() &&
      r.Color.toLowerCase() === color.toLowerCase()
  );
}

async function findById(itemId) {
  const rows = await listAll();
  return rows.find((r) => r.ItemID === itemId);
}

/** Creates a brand-new SKU row. Use restock() instead if the SKU already exists. */
async function addNewItem({ brand, name, size, color, quantity, costPrice, sellPrice }) {
  const itemId = newItemId();
  await sheets.appendRow(SHEET, {
    ItemID: itemId,
    Brand: brand,
    Name: name,
    Size: size,
    Color: color,
    Quantity: quantity,
    CostPrice: costPrice,
    SellPrice: sellPrice,
    LastRestocked: new Date().toISOString(),
  });
  return itemId;
}

/** Adds to an existing SKU's quantity (does not touch price fields). */
async function restock(itemId, additionalQuantity) {
  const item = await findById(itemId);
  if (!item) throw new Error(`Inventory item ${itemId} not found`);
  const newQty = Number(item.Quantity || 0) + Number(additionalQuantity);
  await sheets.updateCell(SHEET, item._rowNumber, 'Quantity', newQty);
  await sheets.updateCell(SHEET, item._rowNumber, 'LastRestocked', new Date().toISOString());
  return newQty;
}

/** Decrements stock when an order is placed. Never goes below 0. */
async function decrementQuantity(itemId, qty) {
  const item = await findById(itemId);
  if (!item) throw new Error(`Inventory item ${itemId} not found`);
  const newQty = Math.max(0, Number(item.Quantity || 0) - Number(qty));
  await sheets.updateCell(SHEET, item._rowNumber, 'Quantity', newQty);
  return newQty;
}

module.exports = {
  listAll,
  listBrands,
  listByBrand,
  findExact,
  findById,
  addNewItem,
  restock,
  decrementQuantity,
};
