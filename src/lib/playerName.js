// Soccer Manager gives names in capitals ("M.SILVETTI", "I.HANSEN-AARÖEN"); show "M. Silvetti".
// Names that already have lower-case letters are left as they are.
export function playerName(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text !== text.toUpperCase()) return text;
  return text.toLowerCase()
    .replace(/(^|[\s.\-'’])(\p{L})/gu, (whole, before, letter) => before + letter.toUpperCase())
    .replace(/\.(?=\S)/g, '. ');
}
