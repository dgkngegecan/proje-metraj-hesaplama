/**
 * Kaydırarak eylem gösteren satırın jest kararları (saf).
 *
 * Sola kaydırma sağdaki eylemleri açar; yeterince uzun ya da hızlı bir
 * kaydırma birincil eylemi (ör. sil) doğrudan çalıştırır. Dikey kaydırma
 * listeye bırakılır: ilk 8 px'te hangi eksen baskınsa jest ona kilitlenir.
 */

export type SwipeAxis = 'x' | 'y' | null;
export type SwipeOutcome = 'closed' | 'open' | 'full';

export const AXIS_LOCK_DISTANCE = 8;

export function lockAxis(dx: number, dy: number, threshold = AXIS_LOCK_DISTANCE): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  return ax > ay * 1.2 ? 'x' : 'y';
}

export interface SwipeGeometry {
  /** Açık eylemlerin toplam genişliği (px). */
  actionsWidth: number;
  rowWidth: number;
  /** Tam kaydırmada birincil eylem çalışsın mı? */
  fullSwipe: boolean;
}

/** Parmak hareketine göre satırın konumu: sağa açılmaz, eylem genişliğinin ötesinde direnç vardır. */
export function swipeOffset(dx: number, startOffset: number, geometry: SwipeGeometry): number {
  const raw = Math.min(0, startOffset + dx);
  const limit = geometry.actionsWidth;
  if (-raw <= limit || geometry.fullSwipe) return Math.max(raw, -geometry.rowWidth);
  return -(limit + (-raw - limit) * 0.25);
}

/** Bırakınca: kapan, açık kal ya da birincil eylemi çalıştır. `velocity` px/ms, sola negatif. */
export function resolveSwipe(offset: number, velocity: number, geometry: SwipeGeometry): SwipeOutcome {
  const distance = -offset;
  if (
    geometry.fullSwipe &&
    (distance > geometry.rowWidth * 0.6 || (velocity < -1.1 && distance > geometry.actionsWidth))
  )
    return 'full';
  if (velocity > 0.35) return 'closed';
  if (distance > geometry.actionsWidth / 2 || velocity < -0.35) return 'open';
  return 'closed';
}
