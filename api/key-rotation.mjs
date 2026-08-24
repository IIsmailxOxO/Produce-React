// API Key Rotation — two (or more) keys that rotate as limits are met
// Tracks RPM (requests per minute) and daily usage per key
// Auto-rotates on 429 rate-limit responses

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = path.join(__dirname, 'keys.json');
const KEYS_EXAMPLE_PATH = path.join(__dirname, 'keys.example.json');

// If keys.json doesn't exist, create it from the example
if (!fs.existsSync(KEYS_PATH)) {
  if (fs.existsSync(KEYS_EXAMPLE_PATH)) {
    fs.copyFileSync(KEYS_EXAMPLE_PATH, KEYS_PATH);
    console.log('[key-rotation] Created api/keys.json from example — add your real keys there.');
  } else {
    // Write a minimal template
    fs.writeFileSync(KEYS_PATH, JSON.stringify([
      { name: "key-1", provider: "openrouter", apiKey: "PUT_YOUR_KEY_HERE", model: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1", rpmLimit: 20, dailyLimit: 1000, enabled: true }
    ], null, 2));
    console.log('[key-rotation] Created api/keys.json template — add your real keys there.');
  }
}

const keyState = new Map();

function loadKeys() {
  try {
    const raw = fs.readFileSync(KEYS_PATH, 'utf8');
    const keys = JSON.parse(raw);
    if (!Array.isArray(keys)) throw new Error('keys.json must be an array');
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
    // Filter out keys that still have placeholder values
    return keys.filter(k => k.enabled !== false && k.apiKey && !k.apiKey.startsWith('PUT_') && !k.apiKey.startsWith('PASTE_') && !k.apiKey.startsWith('sk-or-v1-YOUR'));
  } catch (err) {
    console.error('[key-rotation] Failed to load keys.json:', err.message);
    return [];
  }
}

function getState(name) {
  if (!keyState.has(name)) {
    keyState.set(name, { callsThisMinute: 0, minuteStart: Math.floor(Date.now() / 60000), callsToday: 0, dayStart: new Date().setHours(0, 0, 0, 0), cooldownUntil: 0, consecutive429s: 0 });
  }
  return keyState.get(name);
}

function resetMinuteIfNeeded(state) {
  const currentMinute = Math.floor(Date.now() / 60000);
  if (currentMinute > state.minuteStart) { state.callsThisMinute = 0; state.minuteStart = currentMinute; }
}

function resetDayIfNeeded(state) {
  const todayStart = new Date().setHours(0, 0, 0, 0);
  if (todayStart > state.dayStart) { state.callsToday = 0; state.dayStart = todayStart; }
}

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
    if (now < state.cooldownUntil) continue;
    if (key.rpmLimit && state.callsThisMinute >= key.rpmLimit) continue;
    if (key.dailyLimit && state.callsToday >= key.dailyLimit) continue;
    const rpmUsage = key.rpmLimit ? state.callsThisMinute / key.rpmLimit : 0;
    const dailyUsage = key.dailyLimit ? state.callsToday / key.dailyLimit : 0;
    const score = (rpmUsage * 2) + dailyUsage + (state.consecutive429s * 10);
    if (score < bestScore) { bestScore = score; bestKey = key; }
  }
  if (!bestKey) {
    let shortestCooldown = Infinity;
    for (const key of keys) {
      const state = getState(key.name);
      const remaining = state.cooldownUntil - now;
      if (remaining < shortestCooldown) { shortestCooldown = remaining; bestKey = key; }
    }
    if (bestKey && shortestCooldown > 0) console.log(`[key-rotation] All keys rate-limited. Shortest cooldown: ${Math.ceil(shortestCooldown / 1000)}s on ${bestKey.name}`);
  }
  return bestKey;
}

export function recordSuccess(keyName) {
  const state = getState(keyName);
  resetMinuteIfNeeded(state); resetDayIfNeeded(state);
  state.callsThisMinute++; state.callsToday++; state.consecutive429s = 0;
}

export function recordRateLimit(keyName) {
  const state = getState(keyName);
  state.consecutive429s++;
  const cooldownMs = Math.min(30000 * Math.pow(2, state.consecutive429s - 1), 300000);
  state.cooldownUntil = Date.now() + cooldownMs;
  console.log(`[key-rotation] ${keyName} rate-limited (429 #${state.consecutive429s}). Cooldown: ${cooldownMs / 1000}s. Rotating.`);
}

export function recordError(keyName) {
  const state = getState(keyName);
  state.cooldownUntil = Date.now() + 10000;
}

export function getStatus() {
  const keys = loadKeys();
  const now = Date.now();
  return keys.map(key => {
    const state = getState(key.name);
    resetMinuteIfNeeded(state); resetDayIfNeeded(state);
    return { name: key.name, provider: key.provider, model: key.model, rpmUsed: state.callsThisMinute, rpmLimit: key.rpmLimit || null, dailyUsed: state.callsToday, dailyLimit: key.dailyLimit || null, onCooldown: now < state.cooldownUntil, cooldownRemaining: now < state.cooldownUntil ? Math.ceil((state.cooldownUntil - now) / 1000) : 0, consecutive429s: state.consecutive429s };
  });
}

export function configuredCount() { return loadKeys().length; }
