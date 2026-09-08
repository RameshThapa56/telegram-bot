// Single source of truth for "which role can use which part of the bot".
// Kept dependency-free (no require of keyboards.js or mainMenuActions.js) so
// both of those can import it without creating a require cycle.

const ROLES = {
  OWNER: 'Owner',
  STAFF: 'Staff',
  MARKETING: 'Marketing',
};

// permission key -> roles allowed to use it. A key with no entry here is
// treated as a universal utility (e.g. "Cancel", "Back to Menu") that every
// authenticated user can use.
const PERMISSIONS = {
  inventory: [ROLES.OWNER, ROLES.STAFF], // Inventory sheet: add/restock items
  orders: [ROLES.OWNER, ROLES.STAFF], // Orders sheet: new orders
  deliveries: [ROLES.OWNER, ROLES.STAFF], // Deliveries sheet
  feedback: [ROLES.OWNER, ROLES.STAFF], // Send/resend a feedback request for any Delivered order
  marketing: [ROLES.OWNER, ROLES.MARKETING], // Marketing sheet: spend log
  dashboard: [ROLES.OWNER, ROLES.STAFF, ROLES.MARKETING], // everyone gets visibility
  users: [ROLES.OWNER], // Users sheet: who's allowed to use the bot at all
};

function can(role, permission) {
  const allowedRoles = PERMISSIONS[permission];
  return !allowedRoles || allowedRoles.includes(role);
}

module.exports = { ROLES, PERMISSIONS, can };
