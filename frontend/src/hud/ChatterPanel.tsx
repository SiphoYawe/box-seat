import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown, CaretUp, Heart, XLogo } from "@phosphor-icons/react";
import { useAppStore, type ChatterPost } from "../state/store.js";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Match chatter: moderated X posts about the fixture, proxied and moderated
 * server-side. GRACEFUL ABSENCE: if no chatter message ever arrives, the
 * panel simply doesn't exist - no loading or error state.
 */
export function ChatterPanel() {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const posts = useAppStore((s) => (fixtureId != null ? s.chatter[fixtureId] : undefined));
  const [open, setOpen] = useState(true);

  if (!posts || posts.length === 0) return null;

  return (
    <div className="glass rounded-md overflow-hidden pointer-events-auto w-[21rem]">
      <button
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <XLogo size={13} className="text-muted" />
          <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
            Match chatter
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="tnum text-[10px] text-muted/70">{posts.length}</span>
          {open ? <CaretUp size={13} className="text-muted" /> : <CaretDown size={13} className="text-muted" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-col gap-2 max-h-64 overflow-y-auto">
          <AnimatePresence initial={false}>
            {posts.map((post: ChatterPost) => (
              <motion.div
                key={post.id}
                className="border-t border-edge/50 pt-2 first:border-t-0 first:pt-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-condensed font-semibold text-[13px] text-text truncate">
                    {post.author}
                  </span>
                  <span className="text-[11px] text-muted truncate">@{post.handle}</span>
                  <span className="tnum text-[10px] text-muted/70 shrink-0 ml-auto">
                    {timeAgo(post.ts)}
                  </span>
                </div>
                <p className="text-[12.5px] leading-snug text-text/85 mt-0.5 break-words">
                  {post.text}
                </p>
                {post.likes != null && post.likes > 0 && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-muted/80">
                    <Heart size={10} weight="fill" className="text-[#F91880]" />
                    <span className="tnum">{post.likes.toLocaleString()}</span>
                  </span>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="text-[9px] text-muted/60 uppercase tracking-widest">Posts from X, moderated</div>
        </div>
      )}
    </div>
  );
}
