// Chat "last seen" checksum (1.21.5+), as the vanilla client computes it:
//   LastSeenMessages.computeChecksum(): i = 1; for each acknowledged signature: i = 31 * i + Arrays.hashCode(bytes);
//   result (byte) i, 0 becomes 1.
// Fixed for the Boys server (17.11.): Java bytes are signed (-128..127), Node buffers are not (0..255), and the
// entries are taken in tracker order starting at the oldest one (offset), not array index 0. With the old version
// every signed player message led to "Checksum mismatch on last seen update" and a kick.
function signatureHash (bytes) {
  let h = 1
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] > 127 ? bytes[i] - 256 : bytes[i]
    h = (Math.imul(31, h) + b) | 0
  }
  return h
}

function computeChatChecksum (lastSeenMessages) {
  if (!lastSeenMessages || lastSeenMessages.length === 0) return 1
  const capacity = lastSeenMessages.capacity || lastSeenMessages.length
  const offset = lastSeenMessages.offset || 0
  let checksum = 1
  for (let i = 0; i < capacity; i++) {
    const message = lastSeenMessages[(offset + i) % capacity]
    if (!message || !message.signature) continue
    checksum = (Math.imul(31, checksum) + signatureHash(message.signature)) | 0
  }
  // (byte) cast; the packet field is u8, so send the same 8 bits unsigned
  const result = checksum & 0xff
  return result === 0 ? 1 : result
}

module.exports = { computeChatChecksum, signatureHash }
