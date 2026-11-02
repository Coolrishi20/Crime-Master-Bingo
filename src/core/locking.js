'use strict';
/**
 * Printed-card locking (DRAFT → LOCKED/ISSUED). Pure functions on a game object.
 * Once locked, card layouts, numbers, song IDs and printed labels are fixed.
 */
const SCHEMA_VERSION = 2;

function printLabel(s) { return { title: s.printTitle || s.displayTitle || s.title, artist: s.artist }; }

function isLocked(game) { return !!game.cardsLocked; }

/** Lock the game's cards and mark the given card numbers as issued. Idempotent. */
function lockGame(game, numbers, source = 'laptop', now = new Date()) {
  const at = now.toISOString();
  if (!game.cardsLocked) {
    game.cardsLocked = true;
    game.lockedAt = at;
    game.lockedLabels = {};
    Object.values(game.songs).forEach(s => { game.lockedLabels[s.id] = printLabel(s); });
    game.lockedSongIds = Object.keys(game.songs).sort();
    game.lockedOrder = game.order.slice();
  }
  const set = new Set(numbers || []);
  let issued = 0;
  game.cards.forEach(c => { if (set.has(c.no)) { if (!c.printed) issued++; c.printed = true; c.printedAt = c.printedAt || at; c.locked = true; } });
  // every existing card is locked once the game is locked (even if not yet printed)
  game.cards.forEach(c => { c.locked = true; });
  game.lockLog = game.lockLog || [];
  game.lockLog.push({ at, source, action: 'issue', cards: numbers ? numbers.length : 0, newlyIssued: issued });
  return { locked: true, issued };
}

/** Check a game snapshot still matches what was locked. Returns a list of problems. */
function verifyLock(game) {
  if (!game.cardsLocked) return [];
  const problems = [];
  const ids = Object.keys(game.songs).sort();
  if (game.lockedSongIds && ids.join('|') !== game.lockedSongIds.join('|')) problems.push('The game song pool differs from the locked pool.');
  if (game.lockedLabels) Object.keys(game.lockedLabels).forEach(id => {
    const s = game.songs[id]; if (!s) return;
    const l = printLabel(s);
    if (l.title !== game.lockedLabels[id].title || l.artist !== game.lockedLabels[id].artist) problems.push(`Printed label changed for ${game.lockedLabels[id].title}.`);
  });
  return problems;
}

/** Labels to print — locked games always use the labels captured at lock time. */
function labelsFor(game) {
  const out = {};
  Object.values(game.songs).forEach(s => { out[s.id] = (game.cardsLocked && game.lockedLabels && game.lockedLabels[s.id]) || printLabel(s); });
  return out;
}

/** Migrate older saved games to the current schema without altering cards. */
function migrate(game) {
  if (!game.schemaVersion || game.schemaVersion < 2) {
    (game.played || []).forEach(p => { if (!p.kind) p.kind = 'played'; });
    if (game.cardsLocked == null) {
      const anyPrinted = (game.cards || []).some(c => c.printed);
      game.cardsLocked = false;
      if (anyPrinted) lockGame(game, [], 'migration');
    }
    game.schemaVersion = SCHEMA_VERSION;
  }
  return game;
}

module.exports = { SCHEMA_VERSION, lockGame, isLocked, verifyLock, labelsFor, migrate, printLabel };
