// Short, human-readable, sortable IDs — no external ID library needed.
// Format: PREFIX-YYMMDD-XXXX  e.g. ORD-260903-4821
// The date prefix makes IDs skimmable in the sheet; the random suffix avoids collisions.

function generateId(prefix) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(1000 + Math.random() * 9000)); // 4 digits
  return `${prefix}-${yy}${mm}${dd}-${rand}`;
}

module.exports = {
  newItemId: () => generateId('INV'),
  newOrderId: () => generateId('ORD'),
  newDeliveryId: () => generateId('DLV'),
  newCampaignId: () => generateId('MKT'),
};
