import { getTeam, flagUrl } from "./teams.js";
import { stageOf, type FixtureMeta } from "./meta.js";

/**
 * Share card: freeze the current scene into a postable 1600x900 PNG - the
 * WebGL canvas plus a broadcast frame (teams, score, competition, wordmark).
 */

const W = 1600;
const H = 900;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundel(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, r: number, ring: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();
}

export interface ShareCardData {
  meta: FixtureMeta;
  score1: number;
  score2: number;
  clockText: string;
}

export async function exportShareCard(data: ShareCardData): Promise<void> {
  const webgl = document.querySelector("canvas");
  if (!webgl) return;

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;

  // scene snapshot, cover-fit
  ctx.fillStyle = "#05070C";
  ctx.fillRect(0, 0, W, H);
  const scale = Math.max(W / webgl.width, H / webgl.height);
  const sw = webgl.width * scale;
  const sh = webgl.height * scale;
  ctx.drawImage(webgl, (W - sw) / 2, (H - sh) / 2, sw, sh);

  // vignette so the frame reads over the scene
  const topFade = ctx.createLinearGradient(0, 0, 0, 150);
  topFade.addColorStop(0, "rgba(5,7,12,0.88)");
  topFade.addColorStop(1, "rgba(5,7,12,0)");
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, W, 150);
  const botFade = ctx.createLinearGradient(0, H - 130, 0, H);
  botFade.addColorStop(0, "rgba(5,7,12,0)");
  botFade.addColorStop(1, "rgba(5,7,12,0.88)");
  ctx.fillStyle = botFade;
  ctx.fillRect(0, H - 130, W, 130);

  const team1 = getTeam(data.meta.participant1);
  const team2 = getTeam(data.meta.participant2);
  const [flag1, flag2] = await Promise.all(
    [team1, team2].map((t) => {
      const url = flagUrl(t);
      return url ? loadImage(url).catch(() => null) : Promise.resolve(null);
    })
  );

  // header: badges, names, scoreline, clock
  const cy = 78;
  ctx.textBaseline = "middle";
  if (flag1) roundel(ctx, flag1, 90, cy, 34, team1.primary);
  if (flag2) roundel(ctx, flag2, W - 90, cy, 34, team2.primary);

  ctx.font = "600 44px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#E6EAF2";
  ctx.textAlign = "left";
  ctx.fillText(data.meta.participant1.toUpperCase(), 145, cy);
  ctx.textAlign = "right";
  ctx.fillText(data.meta.participant2.toUpperCase(), W - 145, cy);

  ctx.textAlign = "center";
  ctx.font = "700 84px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${data.score1} - ${data.score2}`, W / 2, cy - 6);
  ctx.font = "600 30px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#8A93A6";
  ctx.fillText(data.clockText, W / 2, cy + 42);

  // competition line under the header
  ctx.font = "600 22px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#8A93A6";
  const stage = stageOf(data.meta.fixtureId);
  ctx.fillText(
    `${data.meta.competition.toUpperCase()}${stage ? ` · ${stage.toUpperCase()}` : ""}`,
    W / 2,
    148
  );

  // footer: wordmark + data credit
  ctx.textAlign = "left";
  ctx.font = "700 40px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#E6EAF2";
  ctx.fillText("BOX SEAT", 60, H - 62);
  ctx.textAlign = "right";
  ctx.font = "500 20px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#8A93A6";
  ctx.fillText("Data: TxLINE by TxODDS · finality attested on Solana", W - 60, H - 60);

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `boxseat-${data.meta.fixtureId}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
