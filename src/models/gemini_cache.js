// Explicit Gemini context caching for the fixed request prefix (system instruction + tool declarations).
// Implicit caching is best-effort and hit only ~20% of requests; an explicit cache is billed at the cached
// price on every request that uses it. Any cache error falls back to the normal request, so this can only
// make requests cheaper, never break them.
import { createHash } from 'crypto';
import settings from '../agent/settings.js';

const MIN_CHARS = 4400;          // ~1100 tokens: below Gemini's minimum cache size nothing is cached
const TTL_SECONDS = 900;
const REFRESH_BELOW_MS = 300000; // extend the TTL when less than 5 min are left
const FAIL_PAUSE_MS = 600000;    // after an error, do not try this prefix again for 10 min
const MAX_ENTRIES = 12;

const entries = new Map(); // key -> {name, expires, failedUntil, pending}

export function cacheEnabled() {
    return settings.gemini_explicit_cache === true;
}

export function prefixKey(model, systemInstruction, tools) {
    return createHash('sha256').update(JSON.stringify([model, systemInstruction || '', tools || null])).digest('hex').slice(0, 24);
}

export function prefixLarge(systemInstruction, tools) {
    return (systemInstruction || '').length + JSON.stringify(tools || []).length >= MIN_CHARS;
}

function prune(now) {
    for (const [key, e] of entries) if (!e.pending && e.expires < now && (e.failedUntil || 0) < now) entries.delete(key);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

/** Name of a usable cache for this prefix, or null (then the caller sends the prefix itself). */
export async function cachedPrefix(genAI, model, systemInstruction, tools, now = Date.now()) {
    if (!cacheEnabled() || !genAI?.caches || !prefixLarge(systemInstruction, tools)) return null;
    prune(now);
    const key = prefixKey(model, systemInstruction, tools);
    let e = entries.get(key);
    if (e?.failedUntil > now) return null;
    if (e?.pending) return await e.pending;
    if (e?.name && e.expires > now) {
        if (e.expires - now < REFRESH_BELOW_MS) {
            const name = e.name;
            e.expires = now + TTL_SECONDS * 1000; // optimistic: one refresh at a time
            genAI.caches.update({ name, config: { ttl: `${TTL_SECONDS}s` } }).catch(() => { if (entries.get(key)?.name === name) entries.delete(key); });
        }
        return e.name;
    }
    e = { pending: null };
    entries.set(key, e);
    e.pending = genAI.caches.create({ model, config: {
        ttl: `${TTL_SECONDS}s`, displayName: `npc-${key.slice(0, 8)}`,
        ...(systemInstruction ? { systemInstruction } : {}), ...(tools ? { tools } : {}),
    } }).then(c => {
        Object.assign(e, { name: c.name, expires: now + TTL_SECONDS * 1000, pending: null });
        return c.name;
    }).catch(err => {
        Object.assign(e, { name: null, expires: 0, pending: null, failedUntil: now + FAIL_PAUSE_MS });
        console.warn(`Gemini cache not created (${String(err?.message || err).slice(0, 160)}); sending the prompt normally.`);
        return null;
    });
    return await e.pending;
}

/** Forget a cache that the server rejected (expired or deleted), so the next request creates a new one. */
export function dropCache(name, now = Date.now()) {
    for (const [key, e] of entries) if (e.name === name) entries.set(key, { failedUntil: now + 60000 });
}

export function isCacheError(err) {
    return /cache|cachedContent|not found|NOT_FOUND|PERMISSION_DENIED|expired/i.test(String(err?.message || err));
}

export function _resetForTests() { entries.clear(); }
