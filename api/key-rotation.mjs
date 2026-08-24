// API Key Rotation — two (or more) keys that rotate as limits are met
// Tracks RPM (requests per minute) and daily usage per key
// Auto-rotates on 429 rate-limit responses

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = path.join(__dirname, 'keys.json');

// Runtime state — not persisted (resets on server restart, which is fine for RPM tracking)
const keyState = new Map(); // name -> { callsThisMinute, minuteStart, callsToday, dayStart, cooldownUntil, consecutive429s }

function loadKeys() {
  try {
    const raw = fs.readFileSync(KEYS_PATH, 'utf8');
    const keys = JSON.parse(raw);
    if (!Array.isArray(keys)) throw new Error('keys.json must be an array');
    // Initialize state for each key
    for (const key of keys) {
      if (!keyState.has(key.name)) {
        keyState.set(key.name, {
          callsThisMinute: 0,
          minuteStart: Math.floor(Date.now() / 60000),
          callsToday: 0,
          dayStart: new Date().setHours(0, 0, 0, 0),
          cooldownUntil: 0,
          consecutive429s: 0,
        });
      }
    }
    return keys.filter(k => k.enabled !== false && k.apiKey && k.apiKey !== 'PASTE_YOUR_FIRST_KEY_HERE' && k.apiKey !== 'PASTE_YOUR_SECOND_KEY_HERE');
  } catch (err) {
    console.error('[key-rotation] Failed to load keys.json:', err.message);
    return [];
  }
}

function getState(name) {
  if (!keyState.has(name)) {
    keyState.set(name, {
      callsThisMinute: 0,
      minuteStart: Math.floor(Date.now() / 60000),
      callsToday: 0,
      dayStart: new Date().setHours(0, 0, 0, 0),
      cooldownUntil: 0,
      consecutive429s: 0,
    });
  }
  return keyState.get(name);
}

function resetMinuteIfNeeded(state) {
  const currentMinute = Math.floor(Date.now() / 60000);
  if (currentMinute > state.minuteStart) {
    state.callsThisMinute = 0;
    state.minuteStart = currentMinute;
  }
}

function resetDayIfNeeded(state) {
  const todayStart = new Date().setHours(0, 0, 0, 0);
  if (todayStart > state.dayStart) {
    state.callsToday = 0;
    state.dayStart = todayStart;
  }
}

// Pick the best available key — lowest usage, not on cooldown, under limits
export function pickKey() {
  const keys = loadKeys();
  if (keys.length === 0) return null;

  const now = Date.now();
  let bestKey = null;
  let bestScore = Infinity;

  for (const key of keys) {
    const state = getState(key.name);
    resetMinuteIfNeeded(state);
    resetDayIfNeeded(state);

    // Skip if on cooldown
    if (now < state.cooldownUntil) continue;

    // Skip if RPM limit reached
    if (key.rpmLimit && state.callsThisMinute >= key.rpmLimit) continue;

    // Skip if daily limit reached
    if (key.dailyLimit && state.callsToday >= key.dailyLimit) continue;

    // Score: prefer key with lowest current usage (most headroom)
    const rpmUsage = key.rpmLimit ? state.callsThisMinute / key.rpmLimit : 0;
    const dailyUsage = key.dailyLimit ? state.callsToday / key.dailyLimit : 0;
    const score = (rpmUsage * 2) + dailyUsage + (state.consecutive429s * 10);

    if (score < bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (!bestKey) {
    // All keys exhausted — pick the one with shortest cooldown
    let shortestCooldown = Infinity;
    for (const key of keys) {
      const state = getState(key.name);
      const remaining = state.cooldownUntil - now;
      if (remaining < shortestCooldown) {
        shortestCooldown = remaining;
        bestKey = key;
      }
    }
    if (bestKey && shortestCooldown > 0) {
      console.log(`[key-rotation] All keys rate-limited. Shortest cooldown: ${Math.ceil(shortestCooldown / 1000)}s on ${bestKey.name}`);
    }
  }

  return bestKey;
}

// Record a successful call
export function recordSuccess(keyName) {
  const state = getState(keyName);
  resetMinuteIfNeeded(state);
  resetDayIfNeeded(state);
  state.callsThisMinute++;
  state.callsToday++;
  state.consecutive429s = 0;
}

// Record a 429 (rate limit) — put this key on cooldown and rotate
export function recordRateLimit(keyName) {
  const state = getState(keyName);
  state.consecutive429s++;
  // Exponential backoff: 30s, 60s, 120s...
  const cooldownMs = Math.min(30000 * Math.pow(2, state.consecutive429s - 1), 300000); // max 5 min
  state.cooldownUntil = Date.now() + cooldownMs;
  console.log(`[key-rotation] ${keyName} rate-limited (429 #${state.consecutive429s}). Cooldown: ${cooldownMs / 1000}s. Rotating to next key.`);
}

// Record any other error
export function recordError(keyName) {
  const state = getState(keyName);
  // Short cooldown to give the key a break
  state.cooldownUntil = Date.now() + 10000; // 10s
}

// Get status of all keys (for the UI)
export function getStatus() {
  const keys = loadKeys();
  const now = Date.now();
  return keys.map(key => {
    const state = getState(key.name);
    resetMinuteIfNeeded(state);
    resetDayIfNeeded(state);
    return {
      name: key.name,
      provider: key.provider,
      model: key.model,
      rpmUsed: state.callsThisMinute,
      rpmLimit: key.rpmLimit || null,
      dailyUsed: state.callsToday,
      dailyLimit: key.dailyLimit || null,
      onCooldown: now < state.cooldownUntil,
      cooldownRemaining: now < state.cooldownUntil ? Math.ceil((state.cooldownUntil - now) / 1000) : 0,
      consecutive429s: state.consecutive429s,
    };
  });
}

// Count of configured keys
export function configuredCount() {
  return loadKeys().length;
}
