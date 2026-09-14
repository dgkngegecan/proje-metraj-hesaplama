import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
type Point = { x: number; y: number };
type Size = { width: number; height: number };

interface FloatingProjectMapProps {
  active: boolean;
  children: ReactNode;
}

const MIN_WIDTH = 300;
const MIN_HEIGHT = 230;
const EDGE_MARGIN = 10;

export function FloatingProjectMap({ active, children }: FloatingProjectMapProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<Point>({ x: 18, y: 18 });
  const [size, setSize] = useState<Size>({ width: 520, height: 390 });
  const [moving, setMoving] = useState(false);

  const bounds = useCallback(() => {
    const parent = windowRef.current?.parentElement?.getBoundingClientRect();
    return parent ? { width: parent.width, height: parent.height } : { width: innerWidth, height: innerHeight };
  }, []);

  const clamp = useCallback((next: Point, nextSize = size) => {
    const area = bounds();
    return {
      x: Math.min(Math.max(EDGE_MARGIN, next.x), Math.max(EDGE_MARGIN, area.width - nextSize.width - EDGE_MARGIN)),
      y: Math.min(Math.max(EDGE_MARGIN, next.y), Math.max(EDGE_MARGIN, area.height - nextSize.height - EDGE_MARGIN)),
    };
  }, [bounds, size]);

  const stopMomentum = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => stopMomentum, [stopMomentum]);

  useLayoutEffect(() => {
    if (!active) return;
    const area = bounds();
    const nextSize = {
      width: Math.max(MIN_WIDTH, Math.min(560, area.width * 0.43)),
      height: Math.max(MIN_HEIGHT, Math.min(430, area.height * 0.48)),
    };
    setSize(nextSize);
    setPosition({ x: EDGE_MARGIN, y: Math.max(EDGE_MARGIN, area.height - nextSize.height - EDGE_MARGIN) });
  }, [active, bounds]);

  useEffect(() => {
    if (!active) return;
    const keepInside = () => {
      const area = bounds();
      setSize((current) => {
        const next = {
          width: Math.min(current.width, Math.max(MIN_WIDTH, area.width - EDGE_MARGIN * 2)),
          height: Math.min(current.height, Math.max(MIN_HEIGHT, area.height - EDGE_MARGIN * 2)),
        };
        setPosition((point) => clamp(point, next));
        return next;
      });
    };
    addEventListener('resize', keepInside);
    return () => removeEventListener('resize', keepInside);
  }, [active, bounds, clamp]);

  const beginDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    stopMomentum();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMoving(true);
    const start = { x: event.clientX, y: event.clientY, position, time: performance.now() };
    let latest = { x: event.clientX, y: event.clientY, time: start.time };
    let velocity = { x: 0, y: 0 };

    const move = (moveEvent: globalThis.PointerEvent) => {
      const now = performance.now();
      const elapsed = Math.max(1, now - latest.time);
      velocity = {
        x: Math.max(-0.55, Math.min(0.55, (moveEvent.clientX - latest.x) / elapsed)),
        y: Math.max(-0.55, Math.min(0.55, (moveEvent.clientY - latest.y) / elapsed)),
      };
      latest = { x: moveEvent.clientX, y: moveEvent.clientY, time: now };
      setPosition(clamp({
        x: start.position.x + moveEvent.clientX - start.x,
        y: start.position.y + moveEvent.clientY - start.y,
      }));
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      setMoving(false);
      let previous = performance.now();
      const coast = (now: number) => {
        const elapsed = Math.min(32, now - previous);
        previous = now;
        velocity.x *= 0.9;
        velocity.y *= 0.9;
        if (Math.hypot(velocity.x, velocity.y) < 0.025) {
          frameRef.current = null;
          return;
        }
        setPosition((current) => {
          const wanted = { x: current.x + velocity.x * elapsed, y: current.y + velocity.y * elapsed };
          const next = clamp(wanted);
          if (next.x !== wanted.x) velocity.x = 0;
          if (next.y !== wanted.y) velocity.y = 0;
          return next;
        });
        frameRef.current = requestAnimationFrame(coast);
      };
      frameRef.current = requestAnimationFrame(coast);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end, { once: true });
    addEventListener('pointercancel', end, { once: true });
  };

  const beginResize = (event: PointerEvent<HTMLSpanElement>, edge: Edge) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopMomentum();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMoving(true);
    const start = { x: event.clientX, y: event.clientY, position, size };
    const move = (moveEvent: globalThis.PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      const area = bounds();
      let nextPosition = { ...start.position };
      let nextSize = { ...start.size };
      if (edge.includes('e')) nextSize.width = Math.max(MIN_WIDTH, Math.min(area.width - start.position.x - EDGE_MARGIN, start.size.width + dx));
      if (edge.includes('s')) nextSize.height = Math.max(MIN_HEIGHT, Math.min(area.height - start.position.y - EDGE_MARGIN, start.size.height + dy));
      if (edge.includes('w')) {
        const right = start.position.x + start.size.width;
        nextPosition.x = Math.max(EDGE_MARGIN, Math.min(right - MIN_WIDTH, start.position.x + dx));
        nextSize.width = right - nextPosition.x;
      }
      if (edge.includes('n')) {
        const bottom = start.position.y + start.size.height;
        nextPosition.y = Math.max(EDGE_MARGIN, Math.min(bottom - MIN_HEIGHT, start.position.y + dy));
        nextSize.height = bottom - nextPosition.y;
      }
      setSize(nextSize);
      setPosition(clamp(nextPosition, nextSize));
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      setMoving(false);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end, { once: true });
    addEventListener('pointercancel', end, { once: true });
  };

  return (
    <div
      ref={windowRef}
      className={`project-map-window ${active ? 'is-floating' : ''} ${moving ? 'is-moving' : ''}`}
      style={active ? { left: position.x, top: position.y, width: size.width, height: size.height } : undefined}
    >
      {active && <button className="project-map-drag" onPointerDown={beginDrag} aria-label="Proje haritası penceresini sürükle" title="Tut ve proje haritasını taşı">✥</button>}
      {children}
      {active && (['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as Edge[]).map((edge) => (
        <span key={edge} className={`project-map-resize resize-${edge}`} onPointerDown={(event) => beginResize(event, edge)} aria-hidden="true" />
      ))}
    </div>
  );
}
