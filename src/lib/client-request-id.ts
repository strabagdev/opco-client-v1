export function createClientRequestId() {
  const cryptoLike = globalThis.crypto;

  if (typeof cryptoLike?.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof cryptoLike?.getRandomValues === "function") {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
