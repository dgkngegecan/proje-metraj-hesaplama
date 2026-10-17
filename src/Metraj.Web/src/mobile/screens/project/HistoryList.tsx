import { memo, useMemo, useState } from 'react';
import { measurementLabel, quantity } from '../../../lib/format';
import type { Measurement } from '../../../types';
import { ActionSheet, SwipeRow, type KeypadResult, KeypadSheet } from '../../components';
import { isTemporaryId } from '../../store';
import { measurementContextSummary } from './context.ts';
import { newestFirst, parseUtc, quantityToExpression } from './measurementRows.ts';

const PAGE = 20;

const timeFormat = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTime(value: string) {
  const time = parseUtc(value);
  return Number.isNaN(time) ? '' : timeFormat.format(new Date(time));
}

const exactPositive = (result: KeypadResult) =>
  result.number <= 0
    ? 'Miktar sıfırdan büyük olmalı.'
    : result.exact
      ? null
      : 'Bu kadar çok ondalık basamak kaydedilemez; sonucu kısaltın.';

/**
 * Giriş geçmişi: en yeni önce. Satıra dokunmak miktarı düzeltir (tuş takımı),
 * sola kaydırmak veya uzun basmak çoğalt/sil verir; silme onay istemez,
 * "Geri al" çubuğu çıkar. Çok satır olduğunda ilk 20 satır görünür, kalanı
 * "Daha fazla göster" ile gelir (her satırı çizmek 500 girişli kartta takılırdı).
 */
export function HistoryList({
  measurements,
  locked,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  measurements: readonly Measurement[];
  locked: boolean;
  onEdit: (measurement: Measurement, quantity: number) => Promise<boolean>;
  onDuplicate: (measurement: Measurement) => void;
  onDelete: (measurement: Measurement) => void;
}) {
  const sorted = useMemo(() => newestFirst(measurements), [measurements]);
  const [shown, setShown] = useState(PAGE);
  const [menuFor, setMenuFor] = useState<Measurement | null>(null);
  const [editing, setEditing] = useState<Measurement | null>(null);
  const [expression, setExpression] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = (measurement: Measurement) => {
    setExpression(quantityToExpression(measurement.inputQuantity));
    setEditing(measurement);
  };

  const commit = async (result: KeypadResult) => {
    if (!editing) return;
    setSaving(true);
    const saved = await onEdit(editing, result.number);
    setSaving(false);
    if (saved) setEditing(null);
  };

  if (!sorted.length) return <p className="m-muted m-proj-empty-line">Henüz giriş yok.</p>;
  return (
    <>
      <ul className="m-row-list" aria-label="Giriş geçmişi">
        {sorted.slice(0, shown).map((measurement) => (
          <li key={measurement.id}>
            <HistoryRow
              measurement={measurement}
              locked={locked}
              onEdit={startEdit}
              onMenu={setMenuFor}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </li>
        ))}
      </ul>
      {sorted.length > shown && (
        <button
          type="button"
          className="m-btn m-btn--secondary m-btn--block"
          onClick={() => setShown((count) => count + PAGE)}
        >
          Daha fazla göster ({sorted.length - shown})
        </button>
      )}
      <ActionSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor ? `${quantity(menuFor.inputQuantity)} ${menuFor.inputUnit}` : ''}
        actions={
          menuFor
            ? [
                {
                  id: 'edit',
                  label: 'Miktarı düzelt',
                  icon: 'edit',
                  onSelect: () => startEdit(menuFor),
                },
                {
                  id: 'duplicate',
                  label: 'Çoğalt',
                  description: 'Aynı miktar ve konumla yeni bir giriş ekler',
                  icon: 'plus',
                  onSelect: () => onDuplicate(menuFor),
                },
                {
                  id: 'delete',
                  label: 'Sil',
                  description: 'Birkaç saniye içinde geri alınabilir',
                  icon: 'trash',
                  tone: 'danger',
                  onSelect: () => onDelete(menuFor),
                },
              ]
            : []
        }
      />
      <KeypadSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Girişi düzelt"
        description={editing ? [editing.placementName, editing.variant].filter(Boolean).join(' · ') : undefined}
        label="Miktar"
        unit={editing?.inputUnit}
        value={expression}
        onChange={setExpression}
        validate={exactPositive}
        busy={saving}
        saveLabel="Düzeltmeyi kaydet"
        onSave={(result) => void commit(result)}
      />
    </>
  );
}

const HistoryRow = memo(function HistoryRow({
  measurement,
  locked,
  onEdit,
  onMenu,
  onDuplicate,
  onDelete,
}: {
  measurement: Measurement;
  locked: boolean;
  onEdit: (measurement: Measurement) => void;
  onMenu: (measurement: Measurement) => void;
  onDuplicate: (measurement: Measurement) => void;
  onDelete: (measurement: Measurement) => void;
}) {
  const provisional = isTemporaryId(measurement.id);
  const label =
    [measurement.variant, measurement.secondaryVariant].filter(Boolean).join(' · ') ||
    measurementLabel(measurement.notes);
  const where = measurementContextSummary(measurement);
  return (
    <SwipeRow
      actions={
        locked || provisional
          ? []
          : [
              { id: 'duplicate', label: 'Çoğalt', icon: 'plus', onAction: () => onDuplicate(measurement) },
              { id: 'delete', label: 'Sil', icon: 'trash', tone: 'danger', onAction: () => onDelete(measurement) },
            ]
      }
      fullSwipeActionId="delete"
      onPress={locked || provisional ? undefined : () => onEdit(measurement)}
      onLongPress={locked || provisional ? undefined : () => onMenu(measurement)}
      ariaLabel={`${quantity(measurement.inputQuantity)} ${measurement.inputUnit}, ${label}${locked ? '' : '. Düzeltmek için dokunun'}`}
    >
      <div className="m-proj-history">
        <span className="m-proj-history__qty m-num">
          {quantity(measurement.inputQuantity)} <small>{measurement.inputUnit}</small>
        </span>
        <span className="m-proj-history__text">
          <strong>{label}</strong>
          {where && <small>{where}</small>}
        </span>
        <span className="m-proj-history__time">
          {provisional ? 'Kaydediliyor…' : formatTime(measurement.createdAtUtc)}
          {measurement.updatedAtUtc && !provisional && <small>düzeltildi</small>}
        </span>
      </div>
    </SwipeRow>
  );
});
