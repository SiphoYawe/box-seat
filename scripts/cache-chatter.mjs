// Manual chatter cache fill for the demo video: pulls REAL posts via the
// local twitter CLI, runs the exact server-side moderation rules (copied
// verbatim from server/src/chatter/xChatter.ts), and writes the kv cache
// entry the backend serves on subscribe. No server code touched; the serve
// path reads kv per subscribe, so it goes live immediately.
//
// Usage: node scripts/cache-chatter.mjs [fixtureId] [query...]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require2 = createRequire(join(ROOT, "server/package.json"));
const Database = require2("better-sqlite3");

const FIXTURE_ID = Number(process.argv[2] ?? 18257865);
const QUERIES = process.argv.slice(3);
if (QUERIES.length === 0) {
  QUERIES.push("France England", "France vs England", "England France football");
}

// --- moderation rules, verbatim from server/src/chatter/xChatter.ts ---
const BLOCKLIST = [
  "fuck", "shit", "bitch", "bastard", "asshole", "dickhead", "crap", "slut",
  "whore", "douchebag", "twat", "wanker", "bollocks", "arsehole", "goddamn",
  "motherfucker", "cocksucker", "dipshit", "bullshit", "prick", "cunt",
  "piss off",
  "nigger", "nigga", "faggot", "retard", "retarded", "spic", "chink", "kike",
  "wetback", "gook", "coon", "tranny", "beaner", "raghead", "cracker", "paki",
  "towelhead", "gypsy",
];

function moderate(post) {
  const lower = (post.text ?? "").toLowerCase();
  if (lower.includes("http") || lower.includes("t.co")) return false;
  if (post.hasMedia) return false;
  if (post.lang !== "en") return false;
  for (const word of BLOCKLIST) if (lower.includes(word)) return false;
  return true;
}

async function search(query) {
  try {
    const { stdout } = await execFileP(
      "twitter",
      ["search", query, "-n", "25", "--lang", "en", "-t", "latest", "--json", "--exclude", "retweets"],
      { timeout: 25000, maxBuffer: 8 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout);
    return parsed.data ?? [];
  } catch (err) {
    console.log(`query "${query}" failed: ${String(err.message).slice(0, 120)}`);
    return [];
  }
}

async function main() {
  const seen = new Set();
  const candidates = [];
  for (const q of QUERIES) {
    const posts = await search(q);
    console.log(`"${q}": ${posts.length} raw`);
    for (const p of posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      candidates.push({
        id: String(p.id),
        text: String(p.text ?? "").slice(0, 280),
        lang: p.lang,
        createdAtMs: Date.parse(p.createdAtISO ?? p.createdAt ?? "") || 0,
        likes: p.metrics?.likes ?? 0,
        hasMedia: Array.isArray(p.media) && p.media.length > 0,
        authorName: p.author?.name ?? "Unknown",
        authorHandle: p.author?.screenName ?? "unknown",
      });
    }
  }

  const accepted = candidates
    .filter(moderate)
    .filter((p) => p.createdAtMs > 0)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 10);
  console.log(`moderated: ${accepted.length} accepted of ${candidates.length} unique posts`);
  if (accepted.length === 0) {
    console.log("nothing passed moderation - cache left untouched");
    process.exit(1);
  }

  const entry = {
    posts: accepted.map((p) => ({
      id: p.id,
      author: p.authorName,
      handle: p.authorHandle,
      text: p.text,
      ts: p.createdAtMs,
      likes: p.likes,
    })),
    fetchedAt: Date.now(),
  };

  const db = new Database(join(ROOT, "server/box-seat.db"));
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(`chatter:${FIXTURE_ID}`, JSON.stringify(entry));
  const back = db.prepare("SELECT length(value) AS n FROM kv WHERE key = ?").get(`chatter:${FIXTURE_ID}`);
  console.log(`kv written: chatter:${FIXTURE_ID} (${back.n} bytes, ${entry.posts.length} posts)`);
  for (const p of entry.posts.slice(0, 3)) console.log(`  - @${p.handle}: ${p.text.slice(0, 80)}`);
  db.close();
}

main().catch((e) => {
  console.error("cache fill failed:", e.message);
  process.exit(1);
});
