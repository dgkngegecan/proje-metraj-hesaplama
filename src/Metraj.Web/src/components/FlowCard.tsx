import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { TYPE_META, type FlowBreakdown, type PlacementNode } from '../lib/uiTypes';
import { quantity } from '../lib/format';
import type { MeasurementSummary } from '../types';

function BreakdownRow({
  item,
  unit,
  active,
  displayLabel,
}: {
  item: FlowBreakdown;
  unit: string;
  active: boolean;
  displayLabel?: string;
}) {
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();

  const cancelTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const scheduleTooltip = () => {
    if (!active) return;
    cancelTimer();
    hoverTimer.current = window.setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 248;
      const panelHeightLimit = 280;
      const gap = 10;
      const left =
        rect.right + gap + panelWidth <= window.innerWidth - 12
          ? rect.right + gap
          : Math.max(12, rect.left - panelWidth - gap);
      const top = Math.min(Math.max(12, rect.top - 12), Math.max(12, window.innerHeight - panelHeightLimit - 12));
      setTooltipPosition({ left, top });
      hoverTimer.current = null;
    }, 900);
  };
  const closeTooltip = () => {
    cancelTimer();
    setTooltipPosition(null);
  };

  useEffect(() => {
    if (!active) closeTooltip();
    return () => cancelTimer();
  }, [active]);

  return (
    <>
      <div
        ref={rowRef}
        className="breakdown-summary-row nodrag"
        tabIndex={active ? 0 : -1}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        onMouseEnter={scheduleTooltip}
        onMouseLeave={closeTooltip}
        onFocus={scheduleTooltip}
        onBlur={closeTooltip}
      >
        <span>{displayLabel ?? item.label}</span>
        <b>
          {quantity(item.quantity)} {unit}
        </b>
      </div>
      {tooltipPosition &&
        createPortal(
          <aside
            id={tooltipId}
            role="tooltip"
            className="measurement-hover-card"
            style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
          >
            <div className="measurement-hover-heading">
              <span>GİRİŞ GEÇMİŞİ</span>
              <strong>{item.label}</strong>
              <small>{item.entries.length} ayrı giriş · kronolojik</small>
            </div>
            <div className="measurement-hover-list">
              {item.entries.map((entry, index) => {
                const createdAt = Date.parse(entry.createdAtUtc);
                return (
                  <div key={entry.id}>
                    <i>{index + 1}</i>
                    <b>
                      {quantity(entry.quantity)} {unit}
                    </b>
                    <time>
                      {Number.isFinite(createdAt)
                        ? new Date(createdAt).toLocaleString('tr-TR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </time>
                    {entry.notes && <small>{entry.notes}</small>}
                  </div>
                );
              })}
            </div>
            <footer>
              Toplam{' '}
              <b>
                {quantity(item.quantity)} {unit}
              </b>
            </footer>
          </aside>,
          document.body,
        )}
    </>
  );
}

export function FlowCard({ data, selected }: NodeProps<PlacementNode>) {
  const meta = TYPE_META[data.cardType];
  const expanded = Boolean(data.expanded);
  const nodeSummary = data.uiSummary as MeasurementSummary | undefined;
  const breakdown = data.uiBreakdown as FlowBreakdown[] | undefined;
  const placementNote = typeof data.notes === 'string' ? data.notes.trim() : '';
  // Varyantlı kartlarda (boru, fitting ve radyatör) toplamı kaynak kırılımından
  // üret. Böylece aynı kartta birden fazla yükseklik/genişlik veya çap varsa
  // genişletilmiş karttaki toplam bütün girişleri kapsar.
  const aggregateQuantity = breakdown?.length
    ? breakdown.reduce((total, item) => total + item.quantity, 0)
    : nodeSummary?.netQuantity;
  return (
    <div
      className={`flow-card ${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''} ${expanded && data.variantMode === 'Fitting' ? 'fitting-expanded' : ''}`}
      style={{ '--node-accent': meta.color } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" aria-label="Bu karta bağla" />
      <div className="flow-card-top">
        <span className="node-kind">
          {meta.icon} {meta.label}
        </span>
        {data.positionNumber && <span className="node-poz">{data.positionNumber}</span>}
      </div>
      <strong>{data.displayName}</strong>
      <span className="node-code">{data.cardCode}</span>
      <span className="node-work">{data.isMeasurable ? `Metraj gir · ${data.unit}` : 'Düzenleme kartı'}</span>
      <div className={`node-summary-shell ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="node-summary">
          {placementNote && (
            <div className="node-card-note">
              <span>KARTA ÖZEL NOT</span>
              <p>{placementNote}</p>
            </div>
          )}
          {aggregateQuantity !== undefined ? (
            <b className="node-summary-total">
              {quantity(aggregateQuantity)} {nodeSummary?.unit ?? data.unit}
            </b>
          ) : data.isMeasurable ? (
            <b className="node-summary-total">Henüz giriş yok</b>
          ) : (
            !placementNote && <small>Bu kartta ölçüm girişi bulunmuyor.</small>
          )}
          {data.variantMode === 'Fitting' && breakdown?.length ? (
            <div className="fitting-summary-grid">
              {[...new Set(breakdown.map((item) => item.label.split(' · ')[0]))].map((diameter) => (
                <div className="fitting-summary-tile" key={diameter}>
                  <strong>{diameter}</strong>
                  {breakdown
                    .filter((item) => item.label === diameter || item.label.startsWith(`${diameter} · `))
                    .map((item) => (
                      <BreakdownRow
                        key={item.label}
                        item={item}
                        displayLabel={item.label.split(' · ').slice(1).join(' · ') || item.label}
                        unit={data.unit}
                        active={expanded}
                      />
                    ))}
                </div>
              ))}
            </div>
          ) : data.variantMode === 'Pipe' && breakdown?.length ? (
            <div className="pipe-summary-list">
              {breakdown.map((item) => (
                <BreakdownRow key={item.label} item={item} unit={data.unit} active={expanded} />
              ))}
            </div>
          ) : breakdown?.length ? (
            <div className="generic-summary-list">
              {breakdown.map((item) => (
                <BreakdownRow key={item.label} item={item} unit={data.unit} active={expanded} />
              ))}
            </div>
          ) : null}
          <em>
            {breakdown?.length
              ? 'Bir satırda bekleyerek tarihli girişleri gör · daraltmak için çift tıkla'
              : 'Daraltmak için çift tıkla'}
          </em>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" aria-label="Bu karttan bağla" />
    </div>
  );
}
