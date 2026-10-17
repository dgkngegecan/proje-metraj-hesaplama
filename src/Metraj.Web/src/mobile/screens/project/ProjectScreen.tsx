import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { quantity } from '../../../lib/format';
import type { Measurement, Placement } from '../../../types';
import { ActionSheet, Icon, KeypadSheet, SearchableList, SwipeRow, haptic, type KeypadResult } from '../../components';
import { EmptyState, ErrorState, ScreenHeader, SkeletonList, shellActions, useTopRoute } from '../../shell';
import {
  actions,
  appStore,
  draftKey,
  loadKeys,
  patch,
  removeWithUndo,
  runOptimistic,
  temporaryId,
  useAppStore,
  useDraft,
  useIsRevisionLocked,
  useLoad,
  useMeasurementsOf,
  usePlacementTree,
  useRevisionSummaries,
  useSelection,
  useSummariesOf,
  type PlacementTreeRow,
  type SummaryEntity,
} from '../../store';

/*
 * YER TUTUCU — Dalga 2'de Ajan 5 bu klasörü doldurur (proje ağacı, kart
 * ekleme, boru/fitting/radyatör girişleri, bağlam notları, hesap bağı).
 * Buradaki sürüm temelin uçtan uca çalıştığını gösterir: depodan ağaç,
 * iç içe gezinme + geri tuşu, tuş takımıyla iyimser ölçüm kaydı, kaydırarak
 * silme + "Geri al", uzun basma menüsü.
 */

export default function ProjectScreen() {
  const route = useTopRoute('project');
  const placementId = route?.screen === 'placement' ? (route.params?.id ?? null) : null;
  return (
    <div className="m-screen m-stack">
      {/* Kök bağlı kalır (gizli): iç ekrandan dönünce kaydırma konumu yerinde. */}
      <div className="m-stack__layer" hidden={placementId !== null}>
        <PlacementTree />
      </div>
      {placementId && (
        <div className="m-stack__layer">
          <PlacementDetail key={placementId} placementId={placementId} />
        </div>
      )}
    </div>
  );
}

const TYPE_CLASS: Record<Placement['cardType'], string> = {
  Category: 'category',
  Scope: 'scope',
  System: 'system',
  Material: 'material',
  Accessory: 'accessory',
};

interface Totals {
  net: number;
  unit: string;
  entries: number;
}

/** Ağaç rozetleri için yerleşim başına toplam (birden çok varyant satırı toplanır). */
function totalsByPlacement(summaries: readonly SummaryEntity[]) {
  const totals = new Map<string, Totals>();
  for (const summary of summaries) {
    const current = totals.get(summary.placementId);
    if (current) {
      current.net += summary.netQuantity;
      current.entries += summary.measurementCount;
    } else
      totals.set(summary.placementId, {
        net: summary.netQuantity,
        unit: summary.unit,
        entries: summary.measurementCount,
      });
  }
  return totals;
}

function PlacementTree() {
  const { revisionId } = useSelection();
  const rows = usePlacementTree(revisionId);
  const load = useLoad(revisionId ? loadKeys.revision(revisionId) : 'revision:none');
  const summaries = useRevisionSummaries(revisionId);
  const totals = useMemo(() => totalsByPlacement(summaries), [summaries]);

  if (!revisionId) return <SkeletonList />;
  if (!rows.length && (load.status === 'loading' || load.status === 'idle')) return <SkeletonList />;
  if (!rows.length && load.status === 'error')
    return <ErrorState message={load.error} onRetry={() => void actions.refreshRevision()} />;

  return (
    <SearchableList<PlacementTreeRow>
      items={rows}
      getKey={(row) => row.placement.id}
      ariaLabel="Proje ağacı"
      searchText={(row) => `${row.placement.displayName} ${row.placement.cardName} ${row.placement.cardCode}`}
      searchPlaceholder="Kartlarda ara"
      estimateSize={64}
      emptyState={
        <EmptyState
          icon="project"
          title="Bu revizyonda henüz kart yok"
          message="Kartlar eklendiğinde burada ağaç olarak görünür."
        />
      }
      noResultsState={<EmptyState icon="search" title="Eşleşen kart yok" message="Başka bir sözcükle deneyin." />}
      renderItem={(row) => {
        const total = totals.get(row.placement.id);
        return (
          <button
            type="button"
            className="m-tree-row"
            style={{ ['--m-depth' as string]: Math.min(row.depth, 8) }}
            onClick={() => {
              haptic('tick');
              shellActions.push({ screen: 'placement', params: { id: row.placement.id } }, 'project');
            }}
          >
            <span className={`m-type-dot m-type-dot--${TYPE_CLASS[row.placement.cardType]}`} aria-hidden="true" />
            <span className="m-tree-row__text">
              <strong>{row.placement.displayName}</strong>
              <small>
                {row.placement.cardCode}
                {row.childCount ? ` · ${row.childCount} alt kart` : ''}
                {total ? ` · ${total.entries} giriş` : ''}
              </small>
            </span>
            {total && (
              <span className="m-badge m-num">
                {quantity(total.net)} {total.unit}
              </span>
            )}
            <Icon name="chevronRight" size={20} className="m-tree-row__chevron" />
          </button>
        );
      }}
    />
  );
}

const exactPositive = (result: KeypadResult) =>
  result.number <= 0
    ? 'Miktar sıfırdan büyük olmalı.'
    : result.exact
      ? null
      : 'Bu kadar çok ondalık basamak kaydedilemez; sonucu kısaltın.';

const timeFormat = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function PlacementDetail({ placementId }: { placementId: string }) {
  const placement = useAppStore((state) => state.entities.placements.byId.get(placementId) ?? null);
  const { revisionId } = useSelection();
  const locked = useIsRevisionLocked();
  const summaries = useSummariesOf(placementId);
  const measurements = useMeasurementsOf(placementId);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [expression, setExpression] = useDraft(draftKey('mobile-keypad', placementId), '');
  const [saving, setSaving] = useState(false);
  const [menuFor, setMenuFor] = useState<Measurement | null>(null);

  const sorted = useMemo(
    () =>
      [...measurements].sort(
        (a, b) => Date.parse(b.createdAtUtc) - Date.parse(a.createdAtUtc) || b.id.localeCompare(a.id),
      ),
    [measurements],
  );

  if (!placement || !revisionId)
    return (
      <>
        <ScreenHeader title="Kart" />
        <EmptyState title="Kart bulunamadı" message="Bu kart silinmiş ya da başka bir revizyona ait olabilir." />
      </>
    );

  const canMeasure = placement.isMeasurable && placement.inputBehavior !== 'Derived' && !locked;
  const afterChange = () => {
    void actions.refreshSummaries(revisionId);
    actions.invalidateResources(`report:${revisionId}`);
  };

  const save = async (result: KeypadResult, keepOpen: boolean) => {
    const draft: Measurement = {
      id: temporaryId(),
      revisionId,
      placementId,
      placementCode: placement.cardCode,
      placementName: placement.displayName,
      sourceKind: 'USER',
      inputQuantity: result.number,
      inputUnit: placement.unit,
      createdAtUtc: new Date().toISOString(),
    };
    setExpression(null);
    if (!keepOpen) setKeypadOpen(false);
    setSaving(true);
    const outcome = await runOptimistic(appStore, {
      ops: [patch.upsert('measurements', [draft], 'start')],
      request: () =>
        api.post<Measurement>(`/revisions/${revisionId}/measurements`, {
          placementId,
          inputQuantity: result.number,
          inputUnit: placement.unit,
          block: null,
          floor: null,
          room: null,
          zone: null,
          sheet: null,
          drawingRevision: null,
          notes: null,
          sourceKind: 'USER',
          variant: null,
          secondaryVariant: null,
        }),
      reconcile: (saved) => [patch.remove('measurements', [draft.id]), patch.upsert('measurements', [saved], 'start')],
    });
    setSaving(false);
    if (outcome.ok) {
      haptic('confirm');
      afterChange();
    } else {
      // Kayıt reddedildi: yazılan ifade kaybolmasın, düzeltip yeniden denenebilsin.
      setExpression(result.value.replace('.', ','));
    }
  };

  const remove = (measurement: Measurement) =>
    removeWithUndo(appStore, {
      ops: [patch.remove('measurements', [measurement.id])],
      commit: () => api.delete(`/measurements/${measurement.id}`),
      message: `${quantity(measurement.inputQuantity)} ${measurement.inputUnit} silindi.`,
      onCommitted: afterChange,
    });

  const duplicate = async (measurement: Measurement) => {
    const copy: Measurement = { ...measurement, id: temporaryId(), createdAtUtc: new Date().toISOString() };
    const outcome = await runOptimistic(appStore, {
      ops: [patch.upsert('measurements', [copy], 'start')],
      request: () => api.post<Measurement>(`/measurements/${measurement.id}/duplicate`),
      reconcile: (saved) => [patch.remove('measurements', [copy.id]), patch.upsert('measurements', [saved], 'start')],
    });
    if (outcome.ok) afterChange();
  };

  return (
    <div className="m-detail">
      <ScreenHeader title={placement.displayName} subtitle={`${placement.cardCode} · ${placement.unit}`} />
      <div className="m-detail__scroll">
        <section className="m-section" aria-label="Toplamlar">
          {summaries.length ? (
            <ul className="m-summary-list">
              {summaries.map((summary) => (
                <li key={`${summary.variant ?? ''}|${summary.secondaryVariant ?? ''}`} className="m-summary-card">
                  <span className="m-summary-card__title">
                    {[summary.variant, summary.secondaryVariant].filter(Boolean).join(' · ') || 'Standart'}
                  </span>
                  <dl className="m-summary-card__values">
                    <div>
                      <dt>Net</dt>
                      <dd className="m-num">{quantity(summary.netQuantity)}</dd>
                    </div>
                    <div>
                      <dt>Fireli</dt>
                      <dd className="m-num">{quantity(summary.withWasteQuantity)}</dd>
                    </div>
                    <div>
                      <dt>Satın alma</dt>
                      <dd className="m-num">
                        {quantity(summary.purchaseQuantity)} {summary.purchaseUnit || summary.unit}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-muted m-section__empty">Henüz giriş yok.</p>
          )}
        </section>
        <section className="m-section" aria-labelledby="m-history-title">
          <h2 id="m-history-title" className="m-section__title">
            Girişler <span className="m-muted">({sorted.length})</span>
          </h2>
          <ul className="m-row-list">
            {sorted.map((measurement) => (
              <li key={measurement.id}>
                <SwipeRow
                  actions={
                    locked
                      ? []
                      : [
                          {
                            id: 'duplicate',
                            label: 'Çoğalt',
                            icon: 'plus',
                            onAction: () => void duplicate(measurement),
                          },
                          {
                            id: 'delete',
                            label: 'Sil',
                            icon: 'trash',
                            tone: 'danger',
                            onAction: () => remove(measurement),
                          },
                        ]
                  }
                  fullSwipeActionId="delete"
                  onLongPress={locked ? undefined : () => setMenuFor(measurement)}
                  ariaLabel={`${quantity(measurement.inputQuantity)} ${measurement.inputUnit}`}
                >
                  <div className="m-row">
                    <span className="m-row__main m-num">
                      {quantity(measurement.inputQuantity)} <small>{measurement.inputUnit}</small>
                    </span>
                    <span className="m-row__meta">
                      {measurement.id.startsWith('tmp-')
                        ? 'Kaydediliyor…'
                        : timeFormat.format(new Date(measurement.createdAtUtc))}
                    </span>
                  </div>
                </SwipeRow>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {canMeasure && (
        <div className="m-bottom-actions">
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large m-btn--block"
            onClick={() => setKeypadOpen(true)}
          >
            <Icon name="plus" />
            Ölçüm ekle
          </button>
        </div>
      )}
      <KeypadSheet
        open={keypadOpen}
        onClose={() => setKeypadOpen(false)}
        title={placement.displayName}
        label="Miktar"
        unit={placement.unit}
        value={expression}
        onChange={setExpression}
        validate={exactPositive}
        busy={saving}
        onSave={(result) => void save(result, false)}
        onSaveNext={(result) => void save(result, true)}
      />
      <ActionSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor ? `${quantity(menuFor.inputQuantity)} ${menuFor.inputUnit}` : ''}
        actions={
          menuFor
            ? [
                {
                  id: 'duplicate',
                  label: 'Çoğalt',
                  description: 'Aynı miktarla yeni bir giriş ekler',
                  icon: 'plus',
                  onSelect: () => void duplicate(menuFor),
                },
                {
                  id: 'delete',
                  label: 'Sil',
                  description: 'Birkaç saniye içinde geri alınabilir',
                  icon: 'trash',
                  tone: 'danger',
                  onSelect: () => remove(menuFor),
                },
              ]
            : []
        }
      />
    </div>
  );
}
