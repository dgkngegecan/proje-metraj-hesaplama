import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { variantName } from '../../../lib/catalogData';
import { isRadiatorPlacement, quantity } from '../../../lib/format';
import type { Measurement, Placement } from '../../../types';
import { ChipGrid, Icon, KeypadSheet, haptic, type KeypadResult } from '../../components';
import { EmptyState, ScreenHeader } from '../../shell';
import {
  actions,
  appStore,
  draftKey,
  drafts,
  patch,
  removeWithUndo,
  useAppStore,
  useDraft,
  useDraftsReady,
  useIsRevisionLocked,
  useMeasurementsOf,
  usePlacements,
  useSelection,
  useSummariesOf,
} from '../../store';
import { ChipStrip } from './ChipStrip';
import { ContextBar } from './ContextBar';
import { ContextNotesSection } from './ContextNotesSection';
import { saveDeps } from './deps';
import { duplicateMeasurement, saveMeasurementRows, updateMeasurement } from './entrySave.ts';
import { FittingEntry } from './FittingEntry';
import { HistoryList } from './HistoryList';
import { contextSummary } from './context.ts';
import {
  orderByRecentUse,
  pipeBoxesDraft,
  pipeRow,
  pipeVariants,
  readSelectedDiameter,
  sourceGroupKey,
  sourceGroups,
  stockInfo,
  summaryForVariant,
  switchGroup,
  variantsInGroup,
} from './pipeModel.ts';
import { useProjectController } from './projectController';
import { RadiatorEntry } from './RadiatorEntry';
import { buildChildIndex, childrenOf, isEnterable } from './treeModel.ts';
import { totalsOf } from './totals.ts';
import { TypeGlyph } from './TypeGlyph';
import { useMeasureContext } from './useMeasureContext';

const exactPositive = (result: KeypadResult) =>
  result.number <= 0
    ? 'Miktar sıfırdan büyük olmalı.'
    : result.exact
      ? null
      : 'Bu kadar çok ondalık basamak kaydedilemez; sonucu kısaltın.';

/**
 * Ölçülebilir kartın giriş sayfası. Üstte toplamlar, altında kartın türüne göre
 * giriş yüzeyi: düz miktar (tuş takımı), boru çapı (çip ızgarası + tuş takımı),
 * fitting adetleri (çap başına artırıcılar), radyatör (tip/yükseklik/boy). Sonra
 * giriş geçmişi, bağlam notları ve alt kartlar. Onaylı revizyonda yazma
 * yüzeylerinin hepsi gizlenir; okuma tam kalır.
 */
export default function EntryScreen({ placementId }: { placementId: string }) {
  const placement = useAppStore((state) => state.entities.placements.byId.get(placementId) ?? null);
  const { revisionId } = useSelection();
  if (!placement || !revisionId)
    return (
      <>
        <ScreenHeader title="Kart" />
        <EmptyState title="Kart bulunamadı" message="Bu kart silinmiş ya da başka bir revizyona ait olabilir." />
      </>
    );
  return <Entry placement={placement} revisionId={revisionId} />;
}

function Entry({ placement, revisionId }: { placement: Placement; revisionId: string }) {
  const locked = useIsRevisionLocked();
  const controller = useProjectController();
  const placements = usePlacements(revisionId);
  const summaries = useSummariesOf(placement.id);
  const measurements = useMeasurementsOf(placement.id);
  const measureContext = useMeasureContext();
  const draftsReady = useDraftsReady();
  const totals = useMemo(() => totalsOf(summaries), [summaries]);
  const children = useMemo(() => childrenOf(buildChildIndex(placements), placement.id), [placements, placement.id]);

  const derived = placement.inputBehavior === 'Derived';
  const canMeasure = isEnterable(placement);
  const isPipe = placement.variantMode === 'Pipe';
  // Radyatör katalogları Fitting varyantları taşısa da yükseklik seçicisini kullanır (masaüstüyle aynı).
  const isRadiator = !isPipe && isRadiatorPlacement(placement);
  const isFitting = !isRadiator && placement.variantMode === 'Fitting';
  const quantityMode = canMeasure && !isFitting && !isRadiator; // düz miktar veya boru çapı

  const afterChange = () => {
    void actions.refreshSummaries(revisionId);
    actions.invalidateResources(`report:${revisionId}`);
  };

  // ---- Tuş takımı (düz miktar ve boru) ----
  const [expression, setExpression] = useDraft(draftKey('mobile-keypad', placement.id), '');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const variants = useMemo(
    () => (isPipe ? pipeVariants(placement, measurements) : []),
    [isPipe, placement, measurements],
  );
  const ordered = useMemo(() => orderByRecentUse(variants, measurements), [variants, measurements]);
  const [rawBoxes, setRawBoxes] = useDraft<unknown>(draftKey('pipe-boxes', placement.id), null);
  const selectedCode = useMemo(
    () => readSelectedDiameter(rawBoxes, variants) ?? ordered[0]?.code ?? '',
    [rawBoxes, variants, ordered],
  );
  const selectCode = (code: string) => setRawBoxes(pipeBoxesDraft(placement.id, code));
  const groups = useMemo(() => (isPipe ? sourceGroups(placement, variants) : []), [isPipe, placement, variants]);
  const shown = useMemo(
    () => (isPipe ? variantsInGroup(placement, ordered, selectedCode) : []),
    [isPipe, placement, ordered, selectedCode],
  );
  const profile = variants.find((item) => item.code === selectedCode);
  const profileSummary = profile ? summaryForVariant(summaries, profile) : undefined;
  const stock = stockInfo(profile, profileSummary);

  const save = async (result: KeypadResult, keepOpen: boolean) => {
    const row = isPipe ? pipeRow(result.number, selectedCode, variants) : { quantity: result.number };
    setExpression(null);
    if (!keepOpen) setKeypadOpen(false);
    setSaving(true);
    const outcome = await saveMeasurementRows(saveDeps, {
      revisionId,
      placement,
      rows: [row],
      context: measureContext.context,
    });
    setSaving(false);
    if (outcome.ok) {
      // Taslak silme tamponda bekliyordu (en fazla 2 sn). Süreç bu arada ölürse
      // kaydedilmiş ifade yeniden açılışta tuş takımına geri gelir ve ikinci kez
      // kaydedilebilirdi; başarılı kayıttan sonra silme hemen gönderilir.
      drafts.flush();
      haptic('confirm');
      afterChange();
    } else {
      // Kayıt reddedildi: yazılan ifade kaybolmasın, düzeltip yeniden denenebilsin.
      setExpression(result.value.replace('.', ','));
      setKeypadOpen(true);
    }
  };

  // ---- Geçmiş ----
  const editMeasurement = async (measurement: Measurement, next: number) => {
    const outcome = await updateMeasurement(saveDeps, measurement, { quantity: next });
    if (outcome.ok) {
      haptic('confirm');
      afterChange();
    }
    return outcome.ok;
  };
  const copyMeasurement = async (measurement: Measurement) => {
    const outcome = await duplicateMeasurement(saveDeps, measurement);
    if (outcome.ok) {
      haptic('confirm');
      afterChange();
    }
  };
  const deleteMeasurement = (measurement: Measurement) =>
    removeWithUndo(appStore, {
      ops: [patch.remove('measurements', [measurement.id])],
      commit: () => api.delete(`/measurements/${measurement.id}`),
      message: `${quantity(measurement.inputQuantity)} ${measurement.inputUnit} silindi.`,
      onCommitted: afterChange,
    });

  const keypadTitle = isPipe && profile ? `${placement.displayName} · ${variantName(profile)}` : placement.displayName;

  return (
    <div className="m-detail">
      <ScreenHeader
        title={placement.displayName}
        subtitle={`${placement.cardCode} · ${placement.isMeasurable ? placement.unit : 'başlık'}`}
        actions={
          <button
            type="button"
            className="m-icon-button"
            aria-label="Kart eylemleri"
            onClick={() => controller.openMenu(placement.id)}
          >
            <Icon name="more" />
          </button>
        }
      />
      <div className="m-detail__scroll">
        {placement.notes && (
          <p className="m-proj-cardnote">
            <Icon name="edit" size={18} /> {placement.notes}
          </p>
        )}

        {placement.isMeasurable && <TotalsCard totals={totals} summaries={summaries} showVariants={!isPipe} />}

        {canMeasure && !locked && <ContextBar api={measureContext} />}

        {derived && (
          <section className="m-section">
            <p className="m-proj-note">
              Bu kalem başka bir kartın miktarından hesaplanır; buraya miktar girilmez.
              {locked ? '' : ' Kaynağı seçmek için hesap bağı kurun.'}
            </p>
            {!locked && (
              <button
                type="button"
                className="m-btn m-btn--secondary"
                onClick={() => controller.openMenu(placement.id, 'link')}
              >
                Hesap bağı kur
              </button>
            )}
          </section>
        )}

        {isPipe && canMeasure && (
          <section className="m-section" aria-labelledby="m-pipe-title">
            <h2 id="m-pipe-title" className="m-section__title">
              Çap / boyut
            </h2>
            {groups.length > 1 && (
              <ChipStrip
                label="Boru çeşidi / basınç sınıfı"
                value={profile ? sourceGroupKey(profile) : null}
                options={groups.map(([key, name]) => ({ value: key, label: name }))}
                onChange={(key) => {
                  const next = switchGroup(variants, selectedCode, key);
                  if (next) selectCode(next);
                }}
              />
            )}
            <ChipGrid
              mode="single"
              label="Çap"
              columns={3}
              value={selectedCode || null}
              onChange={selectCode}
              options={shown.map((item) => {
                const summary = summaryForVariant(summaries, item);
                return {
                  value: item.code,
                  label: variantName(item),
                  hint: summary ? `${quantity(summary.netQuantity)} ${summary.unit}` : undefined,
                };
              })}
            />
            {profile && (
              <p className="m-proj-note m-num" aria-live="polite">
                {variantName(profile)}: toplam{' '}
                <strong>
                  {quantity(profileSummary?.netQuantity ?? 0)} {profileSummary?.unit ?? placement.unit}
                </strong>{' '}
                · {stock.stockLength > 0 ? `${stock.stockLength} m boy` : 'boy girilmemiş'} ·{' '}
                <strong>{stock.bars && stock.barCount > 0 ? `${quantity(stock.barCount)} boy` : '—'}</strong>
              </p>
            )}
          </section>
        )}

        {isFitting && canMeasure && draftsReady && !locked && (
          <FittingEntry
            placement={placement}
            placements={placements}
            revisionId={revisionId}
            locked={locked}
            context={measureContext.context}
          />
        )}
        {isRadiator && canMeasure && draftsReady && !locked && (
          <RadiatorEntry
            placement={placement}
            revisionId={revisionId}
            locked={locked}
            context={measureContext.context}
          />
        )}

        {placement.isMeasurable && (
          <section className="m-section" aria-labelledby="m-history-title">
            <h2 id="m-history-title" className="m-section__title">
              Giriş geçmişi <span className="m-muted">({measurements.length})</span>
            </h2>
            <HistoryList
              measurements={measurements}
              locked={locked}
              onEdit={editMeasurement}
              onDuplicate={(measurement) => void copyMeasurement(measurement)}
              onDelete={deleteMeasurement}
            />
          </section>
        )}

        <ContextNotesSection placementId={placement.id} locked={locked} context={measureContext.context} />

        <section className="m-section" aria-labelledby="m-children-title">
          <div className="m-proj-sectionhead">
            <h2 id="m-children-title" className="m-section__title">
              Alt kartlar {children.length > 0 && <span className="m-muted">({children.length})</span>}
            </h2>
            {!locked && (
              <button
                type="button"
                className="m-btn m-btn--secondary m-btn--small"
                onClick={() => controller.addCard(placement.id)}
              >
                <Icon name="plus" size={18} />
                Alt kart ekle
              </button>
            )}
          </div>
          {children.length ? (
            <ul className="m-row-list">
              {children.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className="m-proj-child"
                    onClick={() =>
                      child.isMeasurable ? controller.openEntry(child.id) : controller.openLevel(child.id)
                    }
                  >
                    <TypeGlyph type={child.cardType} />
                    <span className="m-proj-child__text">
                      <strong>{child.displayName}</strong>
                      <small>{child.cardCode}</small>
                    </span>
                    <Icon name="chevronRight" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-muted m-proj-empty-line">Bu kartın altında kart yok.</p>
          )}
        </section>
      </div>

      {quantityMode && !locked && (
        <div className="m-bottom-actions">
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large m-btn--block"
            onClick={() => setKeypadOpen(true)}
          >
            <Icon name="plus" />
            {isPipe && profile ? `Metre gir · ${variantName(profile)}` : `Miktar gir (${placement.unit})`}
            {expression ? ` · ${expression}` : ''}
          </button>
        </div>
      )}

      {quantityMode && !locked && (
        <KeypadSheet
          open={keypadOpen}
          onClose={() => setKeypadOpen(false)}
          title={keypadTitle}
          description={contextSummary(measureContext.context) || undefined}
          label={isPipe ? 'Uzunluk' : 'Miktar'}
          unit={placement.unit}
          value={expression}
          onChange={setExpression}
          validate={exactPositive}
          busy={saving}
          onSave={(result) => void save(result, false)}
          onSaveNext={(result) => void save(result, true)}
        >
          {isPipe && shown.length > 1 && (
            <ChipStrip
              label="Çap"
              value={selectedCode || null}
              onChange={selectCode}
              options={shown.map((item) => ({ value: item.code, label: variantName(item) }))}
            />
          )}
        </KeypadSheet>
      )}
    </div>
  );
}

function TotalsCard({
  totals,
  summaries,
  showVariants,
}: {
  totals: ReturnType<typeof totalsOf>;
  summaries: ReturnType<typeof useSummariesOf>;
  showVariants: boolean;
}) {
  if (!totals)
    return (
      <section className="m-proj-totals m-proj-totals--empty" aria-label="Toplam">
        <p className="m-muted">Henüz giriş yok.</p>
      </section>
    );
  return (
    <section className="m-proj-totals" aria-label="Toplam">
      <div className="m-proj-totals__main">
        <span>Net toplam</span>
        <strong className="m-num">
          {quantity(totals.net)} {totals.unit}
        </strong>
      </div>
      <dl className="m-proj-totals__grid m-num">
        <div>
          <dt>Fireli</dt>
          <dd>
            {quantity(totals.withWaste)} {totals.unit}
          </dd>
        </div>
        <div>
          <dt>Satın alma</dt>
          <dd>
            {quantity(totals.purchase)} {totals.purchaseUnit}
          </dd>
        </div>
        <div>
          <dt>Giriş</dt>
          <dd>{totals.entries}</dd>
        </div>
      </dl>
      {showVariants && summaries.length > 1 && (
        <ul className="m-proj-totals__variants m-num">
          {summaries.map((summary) => (
            <li key={`${summary.variant ?? ''}|${summary.secondaryVariant ?? ''}`}>
              <span>{[summary.variant, summary.secondaryVariant].filter(Boolean).join(' · ') || 'Standart'}</span>
              <span>
                {quantity(summary.netQuantity)} {summary.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
