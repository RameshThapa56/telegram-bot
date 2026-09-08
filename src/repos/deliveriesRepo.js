const sheets = require('../google/sheetsClient');
const { newDeliveryId } = require('../utils/ids');
const ordersRepo = require('./ordersRepo');

const SHEET = 'Deliveries';

async function listAll() {
  return sheets.getRowsAsObjects(SHEET);
}

async function create({ orderId, method, vehiclePlate, driverPhone, deliveryCharge, createdBy }) {
  const deliveryId = newDeliveryId();
  await sheets.appendRow(SHEET, {
    DeliveryID: deliveryId,
    Timestamp: new Date().toISOString(),
    OrderID: orderId,
    Method: method,
    VehiclePlate: vehiclePlate,
    DriverPhone: driverPhone,
    DeliveryCharge: deliveryCharge,
    Status: 'Out for Delivery',
    CreatedBy: createdBy,
  });
  // Keep the Orders sheet in sync so listPending() stops showing this order.
  await ordersRepo.updateStatus(orderId, 'Out for Delivery');
  return deliveryId;
}

module.exports = { listAll, create };
