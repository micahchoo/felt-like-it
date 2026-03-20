/**
 * Effect cycle diagnostic tracker.
 *
 * Instruments Svelte 5 $effect blocks and store mutations to trace
 * the reactive dependency chain that causes effect_update_depth_exceeded.
 *
 * HOW TO READ THE OUTPUT:
 * - Each EFFECT line shows which effect ran, its depth in the current chain, and what deps it saw.
 * - Each MUTATION line shows which store field was written, from which effect.
 * - When depth exceeds WARN_DEPTH, a full chain dump is logged.
 * - The CYCLE DETECTED message shows the exact chain of effects that looped.
 *
 * DISABLE: set window.__EFFECT_DEBUG = false in browser console.
 */

const WARN_DEPTH = 20;
const DUMP_DEPTH = 50;
const MAX_TICKS_PER_FLUSH = 200;

let _tick = 0;
let _flushId = 0;
let _ticksThisFlush = 0;
let _effectStack: string[] = [];
let _chainLog: string[] = [];
let _lastFlushTime = 0;
let _dumped = false;

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as Record<string, unknown>).__EFFECT_DEBUG !== false;
}

function resetFlush() {
  const now = Date.now();
  // If >50ms since last effect, this is a new flush cycle
  if (now - _lastFlushTime > 50) {
    _flushId++;
    _ticksThisFlush = 0;
    _chainLog = [];
    _dumped = false;
  }
  _lastFlushTime = now;
}

export function effectEnter(label: string, deps?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  resetFlush();

  _tick++;
  _ticksThisFlush++;
  _effectStack.push(label);
  const depth = _effectStack.length;

  const depsStr = deps
    ? Object.entries(deps)
        .map(([k, v]) => `${k}=${JSON.stringify(v, truncateReplacer)}`)
        .join(', ')
    : '';

  const entry = `[F${_flushId}:#${_ticksThisFlush} d=${depth}] EFFECT ${label}${depsStr ? ` | ${depsStr}` : ''}`;
  _chainLog.push(entry);

  if (depth <= WARN_DEPTH) {
    console.log(`%c${entry}`, 'color: #6b9bff');
  } else {
    console.warn(entry);
  }

  if (_ticksThisFlush === WARN_DEPTH) {
    console.warn(
      `%c[EFFECT_DEBUG] WARNING: ${WARN_DEPTH} effects in flush F${_flushId} — possible cycle forming`,
      'color: #ff6b6b; font-weight: bold'
    );
    console.warn('[EFFECT_DEBUG] Chain so far:', _chainLog.join('\n'));
  }

  if (_ticksThisFlush >= DUMP_DEPTH && !_dumped) {
    _dumped = true;
    console.error(
      `%c[EFFECT_DEBUG] CYCLE DETECTED — ${_ticksThisFlush} effects in flush F${_flushId}`,
      'color: #ff0000; font-weight: bold; font-size: 14px'
    );
    console.error('[EFFECT_DEBUG] Full chain:\n' + _chainLog.join('\n'));
    console.error('[EFFECT_DEBUG] Current stack:', [..._effectStack]);

    // Find the cycle: look for repeated effect names
    const seen = new Map<string, number[]>();
    _chainLog.forEach((entry, i) => {
      const match = entry.match(/EFFECT (\S+)/);
      if (match) {
        const name = match[1];
        if (!seen.has(name)) seen.set(name, []);
        seen.get(name)!.push(i);
      }
    });

    const repeated = [...seen.entries()].filter(([, idxs]) => idxs.length > 2);
    if (repeated.length > 0) {
      console.error(
        '[EFFECT_DEBUG] Repeated effects (likely cycle participants):',
        repeated.map(([name, idxs]) => `${name} (${idxs.length}x at positions ${idxs.join(',')})`),
      );

      // Extract the cycle: from first repeat to second repeat
      const [cycleName, cycleIdxs] = repeated[0]!;
      const cycleStart = cycleIdxs[0]!;
      const cycleEnd = cycleIdxs[1]!;
      console.error(
        `[EFFECT_DEBUG] Cycle "${cycleName}" path (positions ${cycleStart}→${cycleEnd}):\n` +
        _chainLog.slice(cycleStart, cycleEnd + 1).join('\n')
      );
    }
  }

  if (_ticksThisFlush >= MAX_TICKS_PER_FLUSH) {
    // Stop logging to avoid console flooding
    (window as unknown as Record<string, unknown>).__EFFECT_DEBUG = false;
    console.error(
      `[EFFECT_DEBUG] Disabled after ${MAX_TICKS_PER_FLUSH} ticks. Re-enable: window.__EFFECT_DEBUG = true`
    );
  }
}

export function effectExit(label: string): void {
  if (!isEnabled()) return;
  const idx = _effectStack.lastIndexOf(label);
  if (idx >= 0) _effectStack.splice(idx, 1);
}

export function mutation(store: string, field: string, value?: unknown): void {
  if (!isEnabled()) return;
  resetFlush();

  const caller = _effectStack.length > 0 ? _effectStack[_effectStack.length - 1] : '(none)';
  const valStr = value !== undefined ? ` = ${JSON.stringify(value, truncateReplacer)}` : '';
  const entry = `[F${_flushId}:#${_ticksThisFlush}] MUTATION ${store}.${field}${valStr} ← from ${caller}`;
  _chainLog.push(entry);
  console.log(`%c${entry}`, 'color: #ffb86b');
}

export function storeRead(store: string, field: string): void {
  // Only log reads during deep chains to reduce noise
  if (!isEnabled() || _ticksThisFlush < WARN_DEPTH) return;
  const caller = _effectStack.length > 0 ? _effectStack[_effectStack.length - 1] : '(none)';
  console.log(`%c[F${_flushId}] READ ${store}.${field} ← by ${caller}`, 'color: #8b8b8b');
}

/** Dump current state on demand — call from browser console: window.__dumpEffectChain() */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__dumpEffectChain = () => {
    console.log('[EFFECT_DEBUG] Manual dump:');
    console.log('Flush ID:', _flushId);
    console.log('Ticks this flush:', _ticksThisFlush);
    console.log('Total ticks:', _tick);
    console.log('Current stack:', [..._effectStack]);
    console.log('Chain log:\n' + _chainLog.join('\n'));
  };
  (window as unknown as Record<string, unknown>).__EFFECT_DEBUG = true;
}

function truncateReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > 80) return value.slice(0, 77) + '...';
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length > 5) return `{${keys.slice(0, 5).join(', ')}... +${keys.length - 5}}`;
  }
  return value;
}
