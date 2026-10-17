import type { Node } from '@xyflow/react';

import type { Placement } from '../types';

/** Uygulamanın dört ana ekranı. */
export type View = 'flow' | 'catalog' | 'settings' | 'control';

/** Proje haritasındaki bir kart düğümü. */
export type PlacementNode = Node<Placement, 'placement'>;

/** Kart üzerinde gösterilen tek bir ölçüm satırı. */
export type FlowBreakdownEntry = { id: string; quantity: number; createdAtUtc: string; notes?: string | null };

/** Kart üzerinde aynı etiket altında toplanan ölçümler. */
export type FlowBreakdown = { label: string; quantity: number; entries: FlowBreakdownEntry[] };

/** Kart tipinin görünen adı, rengi ve simgesi (bkz. `cardTypes.ts`). */
export { TYPE_META } from './cardTypes';
