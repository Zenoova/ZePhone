import type { CallStatsSample } from "@/types/telephony";

/** Audio blocks reach the filter every 20 ms: a wait longer than this is heard as a cut. */
export const BLOCK_MS = 20;
export const GAP_WARN_MS = 35;
export const JITTER_WARN_MS = 30;
export const RTT_WARN_MS = 300;
export const BUSY_WARN_US = 5000;
/** The first seconds of a call (stream set-up, buffer settling) are not judged. */
export const SETUP_SECS = 4;
/** How far back the findings look. */
export const WINDOW = 60;

export type HintLevel = "ok" | "info" | "warn";

export interface Hint {
  id: string;
  level: HintLevel;
  title: string;
  detail: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Did something go wrong in this second, in the stream we receive or at the audio blocks? */
export function isBadSecond(s: CallStatsSample): boolean {
  return (
    s.jbufLost + s.jbufLate + s.jbufOverflow + s.jbufFlush > 0 ||
    s.rxGapMaxMs > GAP_WARN_MS ||
    s.txGapMaxMs > GAP_WARN_MS
  );
}

/**
 * Reads the last minute of a call and says in plain words what the numbers mean. It never claims more than the
 * measurements show: it tells where the cut is (in what arrives, or in how this computer handles it), and when the
 * measurements are clean it says so and names what they cannot see.
 */
export function diagnose(samples: CallStatsSample[]): Hint[] {
  const recent = samples.slice(-WINDOW).filter((s) => s.elapsedSecs >= SETUP_SECS);
  if (recent.length < 3) {
    return [
      {
        id: "wait",
        level: "info",
        title: "Mesures en cours",
        detail: "Il faut quelques secondes d'appel pour juger la qualité du son.",
      },
    ];
  }
  const hints: Hint[] = [];
  const n = recent.length;
  const lost = sum(recent.map((s) => s.jbufLost));
  const late = sum(recent.map((s) => s.jbufLate));
  const flush = sum(recent.map((s) => s.jbufFlush));
  const overflow = sum(recent.map((s) => s.jbufOverflow));
  const network = lost + late + flush + overflow;

  if (lost + late > 0) {
    const parts = [
      lost > 0 ? `${plural(lost, "paquet perdu", "paquets perdus")}` : "",
      late > 0 ? `${plural(late, "paquet arrivé trop tard", "paquets arrivés trop tard")}` : "",
    ].filter(Boolean);
    hints.push({
      id: "network",
      level: "warn",
      title: "Des paquets de voix se perdent ou arrivent trop tard",
      detail: `${parts.join(" et ")} sur les ${n} dernières secondes. Le trou est dans le flux reçu : réseau (Wi-Fi, VPN, box), ou le serveur du service qui envoie le son à intervalles irréguliers.`,
    });
  }
  if (flush + overflow > 0) {
    hints.push({
      id: "buffer",
      level: "warn",
      title: "La mémoire tampon a dû être vidée",
      detail: `${plural(flush, "vidage", "vidages")} et ${plural(overflow, "débordement", "débordements")} : chaque fois, quelques dizaines de millisecondes de voix sont sautées.`,
    });
  }
  const jitter = max(recent.map((s) => s.rxJitterMs));
  if (jitter > JITTER_WARN_MS) {
    hints.push({
      id: "jitter",
      level: "warn",
      title: "Gigue élevée",
      detail: `Les paquets arrivent avec ${jitter.toFixed(0)} ms d'irrégularité au pire (sain : moins de ${JITTER_WARN_MS} ms). Le Wi-Fi ou une liaison chargée en est la cause habituelle.`,
    });
  }
  const rxGap = max(recent.map((s) => s.rxGapMaxMs));
  if (rxGap > GAP_WARN_MS && network === 0) {
    hints.push({
      id: "rx-blocks",
      level: "warn",
      title: "Le son reçu est livré par à-coups alors que le réseau est propre",
      detail: `Jusqu'à ${rxGap.toFixed(0)} ms entre deux blocs de 20 ms. Rien n'a été perdu en route : c'est ce Mac qui est occupé (processeur, carte graphique) ou la sortie audio qui hoquette (Bluetooth, interface USB).`,
    });
  }
  const txGap = max(recent.map((s) => s.txGapMaxMs));
  if (txGap > GAP_WARN_MS) {
    hints.push({
      id: "tx-blocks",
      level: "warn",
      title: "Le micro livre sa voix en retard",
      detail: `Jusqu'à ${txGap.toFixed(0)} ms entre deux blocs de 20 ms. L'autre côté entend alors des coupures : micro Bluetooth, interface USB ou machine surchargée.`,
    });
  }
  const busy = Math.max(...recent.map((s) => Math.max(s.rxBusyMaxUs, s.txBusyMaxUs)));
  if (busy > BUSY_WARN_US) {
    hints.push({
      id: "filter",
      level: "warn",
      title: "Le traitement audio de ZePhone est lent",
      detail: `Un bloc a pris ${(busy / 1000).toFixed(1)} ms à traiter (il devrait en prendre moins d'un dixième).`,
    });
  }
  if (sum(recent.map((s) => s.recDropped)) > 0) {
    hints.push({
      id: "recording",
      level: "warn",
      title: "L'enregistrement a perdu du son",
      detail: "Le disque n'a pas suivi : l'appel n'est pas touché, mais l'enregistrement a des trous.",
    });
  }
  const bad = recent.slice(-30).filter(isBadSecond).length;
  const span = Math.min(30, n);
  if (bad >= 5 && bad / span >= 0.6) {
    hints.push({
      id: "periodic",
      level: "warn",
      title: "Un incident presque chaque seconde",
      detail: `${bad} secondes sur les ${span} dernières. Une telle régularité signale une cause périodique : ${network > 0 ? "le serveur ou la liaison qui envoie le son par salves" : "une tâche de cet ordinateur qui revient chaque seconde"}.`,
    });
  }
  const rtt = max(recent.map((s) => s.rttMs ?? 0));
  if (rtt > RTT_WARN_MS) {
    hints.push({
      id: "rtt",
      level: "info",
      title: "Délai aller-retour long",
      detail: `${rtt.toFixed(0)} ms jusqu'au correspondant : la conversation se décale, mais cela ne coupe pas le son.`,
    });
  }
  if (!hints.some((h) => h.level === "warn")) {
    hints.unshift({
      id: "clean",
      level: "ok",
      title: `Aucune irrégularité sur les ${n} dernières secondes`,
      detail:
        "Aucun paquet perdu ou en retard, la mémoire tampon n'a pas été vidée et les blocs audio passent toutes les 20 ms. Si vous entendez quand même des coupures, elles viennent d'avant ZePhone (le service ou son serveur : essayez un autre numéro d'écho) ou de la sortie audio de l'ordinateur (haut-parleur, casque).",
    });
  }
  return hints;
}

export interface Summary {
  codec: string;
  clockRate: number;
  rxJitterAvg: number;
  rxJitterMax: number;
  rttMs: number | null;
  jbufDelayAvg: number;
  rxKbps: number;
  txKbps: number;
  lossPct: number;
  incidents: number;
  seconds: number;
}

/** The headline figures of a run of samples. */
export function summarize(samples: CallStatsSample[]): Summary | null {
  const last = samples.at(-1);
  if (!last) return null;
  const jitters = samples.map((s) => s.rxJitterMs);
  const delays = samples.map((s) => s.jbufDelayMs);
  const rtt = [...samples].reverse().find((s) => s.rttMs !== null)?.rttMs ?? null;
  return {
    codec: last.totals.codec,
    clockRate: last.totals.clockRate,
    rxJitterAvg: sum(jitters) / jitters.length,
    rxJitterMax: max(jitters),
    rttMs: rtt,
    jbufDelayAvg: sum(delays) / delays.length,
    rxKbps: last.rxBitrate / 1000,
    txKbps: last.txBitrate / 1000,
    lossPct: last.totals.lossPct,
    incidents: samples.filter((s) => s.elapsedSecs >= SETUP_SECS && isBadSecond(s)).length,
    seconds: samples.length,
  };
}
