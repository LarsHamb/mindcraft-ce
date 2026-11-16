import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { computeChatChecksum } = require('../npc/checksums.cjs');

// Reference: vanilla LastSeenMessages.computeChecksum over the tracker window from the oldest entry (tail).
function vanilla(window, tail) {
    let i = 1;
    for (let k = 0; k < window.length; k++) {
        const e = window[(tail + k) % window.length];
        if (!e) continue;
        let h = 1;
        for (const byte of e.signature) h = (Math.imul(31, h) + (byte > 127 ? byte - 256 : byte)) | 0;
        i = (Math.imul(31, i) + h) | 0;
    }
    const b = i & 0xff;
    return b === 0 ? 1 : b;
}

function ring(count) {
    const r = Object.assign([], {capacity: 20, offset: 0});
    for (let n = 0; n < count; n++) {
        const sig = Buffer.alloc(256);
        for (let j = 0; j < 256; j++) sig[j] = (n * 37 + j * 11) & 0xff;
        r[r.offset] = {pending: true, signature: sig};
        r.offset = (r.offset + 1) % 20;
    }
    return r;
}

test('chat checksum matches vanilla before and after the 20-message window wraps', () => {
    for (const count of [0, 1, 5, 19, 20, 21, 33, 57]) {
        const r = ring(count);
        assert.equal(computeChatChecksum(r), count ? vanilla(r, r.offset) : 1, `after ${count} messages`);
    }
});
