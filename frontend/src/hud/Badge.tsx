import { flagUrl, type TeamMeta } from "../lib/teams.js";

/**
 * Team badge: country flag in a circular roundel, 2px ring in the team's
 * primary color. Unknown teams fall back to a flat primary roundel with the
 * 3-letter code - nothing ever breaks on an unexpected name.
 */
export function Badge({ team, size, ringWidth = 2 }: { team: TeamMeta; size: number; ringWidth?: number }) {
  const url = flagUrl(team);
  return (
    <div
      className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
      style={{
        width: size,
        height: size,
        border: `${ringWidth}px solid ${team.primary}`,
        background: url ? "#0A0E14" : team.primary,
      }}
      aria-label={team.name}
      role="img"
    >
      {url ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <span
          className="font-condensed font-semibold"
          style={{ color: team.secondary, fontSize: size * 0.38, letterSpacing: "0.04em" }}
        >
          {team.code}
        </span>
      )}
    </div>
  );
}
