import { MarkerType, type Edge } from '@xyflow/react';

import type { Placement } from '../types';
import type { PlacementNode } from './uiTypes';

export function buildFlow(placements: Placement[]): { nodes: PlacementNode[]; edges: Edge[] } {
  const children = new Map<string | null, Placement[]>();
  for (const item of placements) {
    const key = item.parentPlacementId ?? null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }
  const nodes: PlacementNode[] = [];
  let leaf = 0;
  // Bozuk bir ebeveyn zinciri (A'nın çocuğu B, B'nin çocuğu A) bu özyinelemeyi
  // sonsuza sokar ve sayfa stack overflow ile çöker. Bu kod tabanındaki diğer
  // her ağaç yürüyüşünde koruma var; burada yoktu.
  const visited = new Set<string>();
  const visit = (placement: Placement, depth: number): number => {
    if (visited.has(placement.id) || depth > 64) return leaf++ * 172;
    visited.add(placement.id);
    const ownChildren = children.get(placement.id) ?? [];
    const childY = ownChildren.map((child) => visit(child, depth + 1));
    const y = childY.length ? childY.reduce((sum, value) => sum + value, 0) / childY.length : leaf++ * 172;
    nodes.push({ id: placement.id, type: 'placement', position: { x: depth * 300, y }, data: placement });
    return y;
  };
  (children.get(null) ?? []).forEach((root) => visit(root, 0));
  // Bir döngü yüzünden hiçbir köke bağlanamayan kartlar da haritada görünmeli;
  // aksi hâlde kullanıcı var olan bir kartı bulamaz ve düzeltemez.
  placements.filter((item) => !visited.has(item.id)).forEach((orphan) => visit(orphan, 0));
  const edges: Edge[] = placements
    .filter((item) => item.parentPlacementId)
    .map((item) => ({
      id: `${item.parentPlacementId}-${item.id}`,
      source: item.parentPlacementId!,
      target: item.id,
      type: 'smoothstep',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#7787a7' },
      style: { stroke: '#7787a7', strokeWidth: 2 },
    }));
  return { nodes, edges };
}
