import { MarkerType, type Edge } from '@xyflow/react';
import type { Placement } from '../types';
import type { PlacementNode } from './uiTypes';

type Point = { x: number; y: number };
const ROW_GAP = 36;
const COLUMN_GAP = 88;

/** React Flow reports actual DOM bounds after each expansion/content change. */
export function nodeSize(node: PlacementNode) {
  return {
    width: node.measured?.width ?? (node.data.expanded ? (node.data.variantMode === 'Fitting' ? 410 : 300) : 240),
    height: node.measured?.height ?? (node.data.expanded ? 320 : 156),
  };
}

/** Reserve both the measured width and height of every card and its entire subtree. */
export function arrangeFlowNodes(nodes: PlacementNode[], preferred: ReadonlyMap<string, Point> = new Map()): PlacementNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, PlacementNode[]>();
  const roots: PlacementNode[] = [];
  for (const node of nodes) {
    const parent = node.data.parentPlacementId;
    if (!parent || !byId.has(parent)) roots.push(node);
    else children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const visited = new Set<string>();
  const depths = new Map<string, number>();
  const spans = new Map<string, number>();
  const treeChildren = new Map<string, PlacementNode[]>();
  const columnWidths: number[] = [];
  const measure = (node: PlacementNode, depth: number): number => {
    visited.add(node.id);
    depths.set(node.id, depth);
    const size = nodeSize(node);
    columnWidths[depth] = Math.max(columnWidths[depth] ?? 0, size.width);
    const branch: PlacementNode[] = [];
    let childHeight = 0;
    for (const child of children.get(node.id) ?? []) {
      if (visited.has(child.id) || depth >= 64) continue;
      branch.push(child);
      childHeight += measure(child, depth + 1);
    }
    treeChildren.set(node.id, branch);
    const span = Math.max(size.height, childHeight + Math.max(0, branch.length - 1) * ROW_GAP);
    spans.set(node.id, span);
    return span;
  };
  const forest: PlacementNode[] = [];
  for (const node of [...roots, ...nodes]) {
    if (visited.has(node.id)) continue;
    forest.push(node);
    measure(node, 0);
  }
  const columns = [0];
  columnWidths.forEach((width, depth) => { columns[depth + 1] = columns[depth]! + width + COLUMN_GAP; });
  const positions = new Map<string, Point>();
  const place = (node: PlacementNode, top: number) => {
    const span = spans.get(node.id)!;
    positions.set(node.id, preferred.get(node.id) ?? { x: columns[depths.get(node.id)!]!, y: top + (span - nodeSize(node).height) / 2 });
    const branch = treeChildren.get(node.id) ?? [];
    const total = branch.reduce((sum, child) => sum + spans.get(child.id)!, 0) + Math.max(0, branch.length - 1) * ROW_GAP;
    let childTop = top + (span - total) / 2;
    for (const child of branch) {
      place(child, childTop);
      childTop += spans.get(child.id)! + ROW_GAP;
    }
  };
  let top = 0;
  for (const root of forest) {
    place(root, top);
    top += spans.get(root.id)! + ROW_GAP * 2;
  }
  // Keep manually dragged positions unless a changed size actually causes a collision.
  const settled: Array<{ position: Point; width: number; height: number }> = [];
  for (const node of [...nodes].sort((a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y || a.id.localeCompare(b.id))) {
    const position = { ...positions.get(node.id)! };
    const size = nodeSize(node);
    let collision = true;
    while (collision) {
      collision = false;
      for (const other of settled) {
        if (position.x < other.position.x + other.width + 20 && position.x + size.width + 20 > other.position.x &&
            position.y < other.position.y + other.height + ROW_GAP && position.y + size.height + ROW_GAP > other.position.y) {
          position.y = other.position.y + other.height + ROW_GAP;
          collision = true;
        }
      }
    }
    positions.set(node.id, position);
    settled.push({ position, ...size });
  }
  return nodes.map((node) => {
    const position = positions.get(node.id)!;
    return node.position.x === position.x && node.position.y === position.y ? node : { ...node, position };
  });
}

export function buildFlow(placements: Placement[]): { nodes: PlacementNode[]; edges: Edge[] } {
  const nodes = arrangeFlowNodes(placements.map((data) => ({ id: data.id, type: 'placement', position: { x: 0, y: 0 }, data })));
  const ids = new Set(placements.map((item) => item.id));
  const edges: Edge[] = placements
    .filter((item) => item.parentPlacementId && ids.has(item.parentPlacementId))
    .map((item) => ({
      id: `${item.parentPlacementId}-${item.id}`, source: item.parentPlacementId!, target: item.id,
      type: 'smoothstep', animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#7787a7' },
      style: { stroke: '#7787a7', strokeWidth: 2 },
    }));
  return { nodes, edges };
}
