/**
 * Static team metadata lookup. The WebSocket contract carries no team names,
 * badges, or colors - the frontend owns this table. National teams, so badges
 * are country flags (flag-icons package, MIT, self-hosted SVGs) clipped in a
 * circular roundel; unknown teams resolve to a neutral fallback roundel so
 * nothing ever breaks on an unexpected name.
 */

export interface TeamMeta {
  name: string; // canonical display name, matches fixtures.json strings
  code: string; // 3-letter code, e.g. "FRA"
  primary: string; // hex - dominates badge block / scorebug
  secondary: string; // hex - accents, badge text
  iso?: string; // flag-icons 1x1 svg id (gb-eng for England etc.)
  glow?: string; // override for terrain/ribbon glow when primary is white/dark
  aliases?: string[];
}

const FALLBACK_PRIMARY = "#8A93A6";
const FALLBACK_SECONDARY = "#E6EAF2";

const TEAMS: TeamMeta[] = [
  { name: "France", code: "FRA", primary: "#1B3B8B", secondary: "#E30613", iso: "fr" },
  { name: "Brazil", code: "BRA", primary: "#FFDC02", secondary: "#009B3A", iso: "br" },
  { name: "Argentina", code: "ARG", primary: "#6CACE4", secondary: "#FFFFFF", iso: "ar" },
  { name: "England", code: "ENG", primary: "#FFFFFF", secondary: "#C8102E", iso: "gb-eng", glow: "#C8102E" },
  { name: "Spain", code: "ESP", primary: "#C60B1E", secondary: "#FFC400", iso: "es" },
  { name: "Germany", code: "GER", primary: "#FFFFFF", secondary: "#000000", iso: "de", glow: "#FFCE00" },
  { name: "Portugal", code: "POR", primary: "#046A38", secondary: "#DA291C", iso: "pt" },
  { name: "Netherlands", code: "NED", primary: "#F36C21", secondary: "#21468B", iso: "nl" },
  { name: "United States", code: "USA", primary: "#0A3161", secondary: "#B31942", iso: "us", aliases: ["USA", "United States of America", "USMNT"] },
  { name: "Mexico", code: "MEX", primary: "#006847", secondary: "#CE1126", iso: "mx" },
  { name: "Canada", code: "CAN", primary: "#D80621", secondary: "#FFFFFF", iso: "ca" },
  { name: "Japan", code: "JPN", primary: "#000555", secondary: "#FFFFFF", iso: "jp", glow: "#2E6BE6" },
  { name: "South Korea", code: "KOR", primary: "#CD2E3A", secondary: "#0047A0", iso: "kr", aliases: ["Korea Republic", "Korea"] },
  { name: "Iran", code: "IRN", primary: "#239F40", secondary: "#DA0000", iso: "ir", aliases: ["IR Iran"] },
  { name: "Australia", code: "AUS", primary: "#FFCD00", secondary: "#00843D", iso: "au" },
  { name: "Saudi Arabia", code: "KSA", primary: "#006C35", secondary: "#FFFFFF", iso: "sa", glow: "#00A550" },
  { name: "Uzbekistan", code: "UZB", primary: "#0099B5", secondary: "#FFFFFF", iso: "uz" },
  { name: "Jordan", code: "JOR", primary: "#CE1126", secondary: "#007A3D", iso: "jo" },
  { name: "Qatar", code: "QAT", primary: "#8A1538", secondary: "#FFFFFF", iso: "qa" },
  { name: "Morocco", code: "MAR", primary: "#C1272D", secondary: "#006233", iso: "ma" },
  { name: "Senegal", code: "SEN", primary: "#00853F", secondary: "#FDEF42", iso: "sn" },
  { name: "Egypt", code: "EGY", primary: "#CE1126", secondary: "#000000", iso: "eg" },
  { name: "Algeria", code: "ALG", primary: "#006233", secondary: "#D21034", iso: "dz" },
  { name: "Tunisia", code: "TUN", primary: "#E70013", secondary: "#FFFFFF", iso: "tn" },
  { name: "Ghana", code: "GHA", primary: "#CE1126", secondary: "#FCD116", iso: "gh" },
  { name: "Ivory Coast", code: "CIV", primary: "#F77F00", secondary: "#009E60", iso: "ci", aliases: ["Côte d'Ivoire", "Cote d'Ivoire"] },
  { name: "South Africa", code: "RSA", primary: "#007A4D", secondary: "#FFB612", iso: "za" },
  { name: "Cape Verde", code: "CPV", primary: "#003893", secondary: "#CF2027", iso: "cv", aliases: ["Cabo Verde"] },
  { name: "Croatia", code: "CRO", primary: "#E8112D", secondary: "#FFFFFF", iso: "hr" },
  { name: "Belgium", code: "BEL", primary: "#E30613", secondary: "#000000", iso: "be" },
  { name: "Switzerland", code: "SUI", primary: "#DA291C", secondary: "#FFFFFF", iso: "ch" },
  { name: "Austria", code: "AUT", primary: "#ED2939", secondary: "#FFFFFF", iso: "at" },
  { name: "Norway", code: "NOR", primary: "#BA0C2F", secondary: "#00205B", iso: "no" },
  { name: "Scotland", code: "SCO", primary: "#0065BF", secondary: "#FFFFFF", iso: "gb-sct" },
  { name: "Denmark", code: "DEN", primary: "#C60C30", secondary: "#FFFFFF", iso: "dk" },
  { name: "Serbia", code: "SRB", primary: "#C6363C", secondary: "#0C4076", iso: "rs" },
  { name: "Poland", code: "POL", primary: "#DC143C", secondary: "#FFFFFF", iso: "pl" },
  { name: "Turkey", code: "TUR", primary: "#E30A17", secondary: "#FFFFFF", iso: "tr", aliases: ["Türkiye", "Turkiye"] },
  { name: "Ukraine", code: "UKR", primary: "#FFD700", secondary: "#005BBB", iso: "ua" },
  { name: "Italy", code: "ITA", primary: "#0064AA", secondary: "#FFFFFF", iso: "it" },
  { name: "Uruguay", code: "URU", primary: "#5CBFEB", secondary: "#FFFFFF", iso: "uy" },
  { name: "Colombia", code: "COL", primary: "#FCD116", secondary: "#003893", iso: "co" },
  { name: "Ecuador", code: "ECU", primary: "#FFDD00", secondary: "#034EA2", iso: "ec" },
  { name: "Paraguay", code: "PAR", primary: "#D52B1E", secondary: "#0038A8", iso: "py" },
  { name: "Panama", code: "PAN", primary: "#DA121A", secondary: "#072357", iso: "pa" },
  { name: "Haiti", code: "HAI", primary: "#00209F", secondary: "#D21034", iso: "ht" },
  { name: "Curaçao", code: "CUW", primary: "#002B7F", secondary: "#F9E814", iso: "cw", aliases: ["Curacao"] },
  { name: "New Zealand", code: "NZL", primary: "#FFFFFF", secondary: "#000000", iso: "nz", glow: "#9AA6BC" },
];

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const BY_NAME = new Map<string, TeamMeta>();
for (const team of TEAMS) {
  BY_NAME.set(normalize(team.name), team);
  for (const alias of team.aliases ?? []) {
    BY_NAME.set(normalize(alias), team);
  }
}

/** Resolve any team string to metadata; unknown names get a neutral fallback. */
export function getTeam(name: string): TeamMeta {
  const hit = BY_NAME.get(normalize(name));
  if (hit) return hit;
  return {
    name,
    code: name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TBD",
    primary: FALLBACK_PRIMARY,
    secondary: FALLBACK_SECONDARY,
  };
}

/** Saturated scene-glow color for a team (terrain / ribbon / markers). */
export function getTeamGlow(team: TeamMeta): string {
  return team.glow ?? team.primary;
}

// flag-icons 1x1 SVGs, bundled at build time (no remote requests).
const FLAG_MODULES = import.meta.glob("../../node_modules/flag-icons/flags/1x1/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function flagUrl(team: TeamMeta): string | undefined {
  if (!team.iso) return undefined;
  return FLAG_MODULES[`../../node_modules/flag-icons/flags/1x1/${team.iso}.svg`];
}
