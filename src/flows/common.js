// Shared helpers for every wizard flow, so "Cancel works everywhere" and
// "leaving a scene always returns to the main menu" are guaranteed in one
// place instead of re-implemented (and inevitably forgotten) in each flow.

const keyboards = require('../keyboards');
const { getMainMenuActions } = require('../mainMenuActions');

const CANCEL_TEXTS = new Set(['❌ Cancel', '❌ No, cancel', '/cancel']);
const CLEAR_TEXTS = new Set(['/clear', 'clear']);

function isCancel(ctx) {
  const text = ctx.message && ctx.message.text;
  return CANCEL_TEXTS.has(text);
}

/**
 * "clear" is a stronger reset than "❌ Cancel": it's for a staff member who
 * feels the bot is stuck (e.g. repeating the same question) and just wants
 * to wipe the slate and start over, whatever state it's in. It force-leaves
 * any active wizard, drops the whole session, and shows a fresh main menu —
 * same effect as a brand new /start.
 */
function isClear(ctx) {
  const text = ctx.message && ctx.message.text;
  return !!text && CLEAR_TEXTS.has(text.trim().toLowerCase());
}

async function leaveToMenu(ctx, message = '🚫 Cancelled. Back to the main menu.') {
  await ctx.reply(message, keyboards.mainMenuFor(ctx.state.role));
  return ctx.scene.leave();
}

async function clearToMenu(ctx) {
  if (ctx.scene && ctx.scene.current) await ctx.scene.leave();
  ctx.session = {};
  await ctx.reply('🔄 *Cleared.* Starting from the beginning.', keyboards.mainMenuFor(ctx.state.role));
}

/**
 * A staff member mid-wizard who taps a main-menu button (e.g. "🚚 Log
 * Delivery") almost always means "get me out of here, do this instead" —
 * not "here's my answer to whatever this step asked". Without this, an
 * abandoned wizard (never hit Cancel, just walked away) stays parked on its
 * current step forever, and *every* future tap — including the menu button
 * that's supposed to start something fresh — gets swallowed as invalid
 * input for that stale step. Detecting menu taps here means one tap always
 * escapes and does what it says, no matter what the bot was waiting for.
 */
async function tryMenuEscape(ctx) {
  // Re-entrancy guard: the menu action we run below may itself enter a new
  // scene (e.g. "🚚 Log Delivery" → ctx.scene.enter('LOG_DELIVERY')), whose
  // first step runs through this same step() wrapper on this same update —
  // without this flag it would see the same "🚚 Log Delivery" text, decide
  // it's *another* menu tap to escape, and recurse forever.
  if (ctx.__menuEscapeHandled) return false;
  const text = ctx.message && ctx.message.text;
  if (!text) return false;
  const action = getMainMenuActions().find(([label]) => label === text);
  if (!action) return false;
  ctx.__menuEscapeHandled = true;
  await ctx.scene.leave();
  await action[1](ctx);
  return true;
}

/**
 * Wraps a wizard step so every step gets "❌ Cancel" and "menu button"
 * handling for free — write the step's real logic and this takes care of
 * bailing out cleanly.
 */
function step(fn) {
  return async (ctx) => {
    if (isClear(ctx)) return clearToMenu(ctx);
    if (isCancel(ctx)) return leaveToMenu(ctx);
    if (await tryMenuEscape(ctx)) return;
    try {
      return await fn(ctx);
    } catch (err) {
      console.error('Wizard step error:', err);
      await ctx.reply('⚠️ Something went wrong saving that. Please try again from the menu.', keyboards.mainMenuFor(ctx.state.role));
      return ctx.scene.leave();
    }
  };
}

/** Reads plain text input, trimmed; returns null if the update wasn't a text message. */
function textInput(ctx) {
  const text = ctx.message && ctx.message.text;
  return text ? text.trim() : null;
}

/** Reads a callback button press with a given "prefix:value" shape; answers the callback either way. */
async function callbackValue(ctx, prefix) {
  const data = ctx.callbackQuery && ctx.callbackQuery.data;
  if (!data) return null;
  await ctx.answerCbQuery();
  if (data === 'cancel') return { cancelled: true };
  if (!data.startsWith(`${prefix}:`)) return null;
  return { value: data.slice(prefix.length + 1) };
}

module.exports = { isCancel, isClear, leaveToMenu, clearToMenu, step, textInput, callbackValue, tryMenuEscape };
