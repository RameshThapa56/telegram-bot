const config = require('../config');
const usersRepo = require('../repos/usersRepo');
const { ROLES } = require('../permissions');

/**
 * The bot's login system. Two layers:
 *
 * 1. ADMIN_CHAT_IDS (env var) — a bootstrap allowlist, always treated as
 *    Owner. This exists so the shop owner can never lock themselves out by
 *    mistyping/deleting the wrong row in the Users sheet: it works even if
 *    the sheet is empty, missing, or unreachable.
 * 2. The "Users" sheet tab — everyone else. Add a row there (TelegramID,
 *    Name, Role) via "👤 Add User" in the bot, or by typing directly into
 *    the sheet, and that person can message the bot immediately (within the
 *    ~30s cache in usersRepo).
 *
 * Either way, ctx.state.role ends up set to one of ROLES for the rest of
 * the update's middleware chain — that's what every menu button and scene
 * checks before doing anything.
 */
function authGuard() {
  return async (ctx, next) => {
    const chatId = ctx.chat && ctx.chat.id;
    if (!chatId) return; // no chat context to reply into — nothing to do

    if (config.adminChatIds.includes(chatId)) {
      ctx.state.role = ROLES.OWNER;
      return next();
    }

    const user = await usersRepo.findByTelegramId(chatId);
    if (!user || !user.Role) {
      await ctx.reply(
        `🚫 This bot is private to ${config.businessName} staff.\n` +
          `Your Telegram ID is ${chatId} — ask the shop owner to add it (via "👤 Add User" in the bot, or the Users sheet) if you should have access.`
      );
      return; // stop the update here — do not call next()
    }

    ctx.state.role = user.Role;
    return next();
  };
}

module.exports = { authGuard };
