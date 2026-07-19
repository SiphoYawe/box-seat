import photosJson from "../data/player-photos.json";

const PHOTOS = photosJson as Record<string, string>;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const BY_NORM = new Map<string, string>();
for (const [name, path] of Object.entries(PHOTOS)) BY_NORM.set(norm(name), path);

/** "Last, First" (TxLINE preferredName) -> "First Last"; passthrough otherwise. */
export function flipName(n: string): string {
  const i = n.indexOf(", ");
  return i === -1 ? n : `${n.slice(i + 2)} ${n.slice(0, i)}`;
}

/**
 * Photo path for a player name in either "First Last" (ESPN) or
 * "Last, First" (TxLINE) form; accent- and case-insensitive.
 */
export function photoFor(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return PHOTOS[name] ?? BY_NORM.get(norm(name)) ?? BY_NORM.get(norm(flipName(name)));
}
