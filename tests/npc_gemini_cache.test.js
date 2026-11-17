import test from 'node:test';
import assert from 'node:assert/strict';
import settings from '../src/agent/settings.js';
import { cachedPrefix, dropCache, _resetForTests } from '../src/models/gemini_cache.js';
import { sendToolRequest } from '../src/models/_tool_request.js';

const BIG = 'x'.repeat(5000);
const tools = [{ type: 'function', function: { name: 'stay', description: 'wait', parameters: { type: 'object', properties: {}, required: [] } } }];

function fakeGenAI({ createFails = false, cachedRejected = false } = {}) {
    const calls = { create: 0, update: 0, generate: [] };
    return {
        calls,
        caches: {
            create: async () => { calls.create++; if (createFails) throw new Error('model does not support caching'); return { name: `cachedContents/c${calls.create}` }; },
            update: async () => { calls.update++; return {}; },
        },
        models: {
            generateContent: async (req) => {
                calls.generate.push(req.config);
                if (cachedRejected && req.config.cachedContent) throw new Error('CachedContent not found (NOT_FOUND)');
                return { text: 'ok', functionCalls: [], candidates: [{ finishReason: 'STOP' }] };
            },
        },
    };
}

test('off by default: no cache is created', async () => {
    _resetForTests(); settings.gemini_explicit_cache = false;
    const g = fakeGenAI();
    assert.equal(await cachedPrefix(g, 'm', BIG, null), null);
    assert.equal(g.calls.create, 0);
});

test('one cache per fixed prefix, reused, small prefixes skipped', async () => {
    _resetForTests(); settings.gemini_explicit_cache = true;
    const g = fakeGenAI();
    const a = await cachedPrefix(g, 'm', BIG, null, 1000);
    const b = await cachedPrefix(g, 'm', BIG, null, 2000);
    assert.equal(a, b); assert.equal(g.calls.create, 1);
    assert.notEqual(await cachedPrefix(g, 'm', BIG + 'y', null, 2000), a);
    assert.equal(await cachedPrefix(g, 'm', 'short', null, 2000), null);
    // close to expiry the TTL is extended instead of creating a new cache
    assert.equal(await cachedPrefix(g, 'm', BIG, null, 1000 + 700000), a);
    assert.equal(g.calls.update, 1);
});

test('create failure falls back and pauses retries', async () => {
    _resetForTests(); settings.gemini_explicit_cache = true;
    const g = fakeGenAI({ createFails: true });
    assert.equal(await cachedPrefix(g, 'm', BIG, null, 1000), null);
    assert.equal(await cachedPrefix(g, 'm', BIG, null, 5000), null);
    assert.equal(g.calls.create, 1);
});

test('request uses cachedContent without repeating prefix, retries plainly if the cache is gone', async () => {
    _resetForTests(); settings.gemini_explicit_cache = true;
    const g = fakeGenAI();
    const provider = { genAI: g, model_name: 'gemini-x', constructor: { prefix: 'google' } };
    await sendToolRequest(provider, [{ role: 'user', content: 'hi' }], BIG, tools);
    const cfg = g.calls.generate.at(-1);
    assert.ok(cfg.cachedContent); assert.equal(cfg.systemInstruction, undefined); assert.equal(cfg.tools, undefined);

    _resetForTests();
    const g2 = fakeGenAI({ cachedRejected: true });
    const p2 = { genAI: g2, model_name: 'gemini-x', constructor: { prefix: 'google' } };
    await sendToolRequest(p2, [{ role: 'user', content: 'hi' }], BIG, tools);
    assert.equal(g2.calls.generate.length, 2);
    assert.ok(g2.calls.generate[1].systemInstruction && g2.calls.generate[1].tools);
    dropCache('none');
    settings.gemini_explicit_cache = false;
});
