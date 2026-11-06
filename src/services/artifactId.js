// A single normalisation rule shared by every reader path — RFID, QR, NFC and
// the artifact registry itself. Keeping it in one place prevents the classic
// bug where a card registered as "A1:B2:C3:D4" never matches a firmware line
// that reports "a1 b2 c3 d4".
export function normalizeIdentifier(identifier) {
  return typeof identifier === "string"
    ? identifier.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    : "";
}

// Collapse the reverse byte order of a 4-byte (or 3/7-byte) UID. Some RC522
// libraries print the UID in the order the bytes arrive on the air, others
// print the ISO 14443 number reversed. Rather than making the operator guess,
// the registry also accepts the reversed form of every configured UID.
export function reverseBytePair(normalized) {
  if (!/^[0-9A-F]+$/.test(normalized) || normalized.length % 2 !== 0) return "";
  const bytes = normalized.match(/.{2}/g);
  return bytes.reverse().join("");
}
