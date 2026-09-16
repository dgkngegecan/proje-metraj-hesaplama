import { useEffect, useRef, useState } from 'react';
import type { Measurement, Placement } from '../types';
import { readUiState, writeUiState, type UiStateMap } from '../uiState';
import {
  activeRadiatorDraft, canonicalRadiatorType, clearActiveRadiatorCounts, initialRadiatorGroups,
  isPanelRadiator, isSectionalRadiator, legacyRadiatorCounts, mergeRadiatorGroups, PANEL_HEIGHTS, PANEL_LENGTHS, PANEL_TYPES, radiatorDimension,
  radiatorGroupKey, radiatorMeasurementRows, radiatorSizeKey, radiatorTypeLabel, readRadiatorDraft,
  type RadiatorDraft,
} from '../lib/radiatorChoices';
import './radiator-input.css';

// Saving continues across inspector unmounts; a returning inspector stays locked until it completes.
const saves = new Set<string>();
const listeners = new Set<() => void>();
const announce = () => listeners.forEach((listener) => listener());

export function RadiatorInput({ placement, measurements, canEdit, busy, uiState, onSubmitRows }: {
  placement: Placement;
  measurements: Measurement[];
  canEdit: boolean;
  busy: boolean;
  uiState: UiStateMap;
  onSubmitRows: (rows: ReturnType<typeof radiatorMeasurementRows>) => Promise<boolean>;
}) {
  const draftKey = `radiator-draft.v1.${placement.id}`;
  const preferenceKey = `radiator-options.v1.${placement.cardCode}`;
  const [draft, setDraft] = useState<RadiatorDraft>(() => {
    const saved = readRadiatorDraft(readUiState(uiState, draftKey));
    const preferences = readRadiatorDraft(readUiState(uiState, preferenceKey));
    const groups = mergeRadiatorGroups(initialRadiatorGroups(placement, measurements), preferences?.groups ?? [], saved?.groups ?? []);
    const active = saved?.active || preferences?.active || radiatorGroupKey(groups.find((group) => group.type === 'Tip 22' && group.height === '600') ?? groups[0]!);
    return { groups, active, counts: saved?.counts ?? legacyRadiatorCounts(readUiState(uiState, `fitting-draft.v1.${placement.id}`)) };
  });
  const [saving, setSaving] = useState(saves.has(placement.id));
  const [length, setLength] = useState('');
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [customType, setCustomType] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  const [groupMode, setGroupMode] = useState<'type' | 'height'>('type');
  const [error, setError] = useState('');
  const lengthInput = useRef<HTMLInputElement>(null);
  const locked = !canEdit || busy || saving;
  const sectional = isSectionalRadiator(placement);
  const active = draft.groups.find((group) => radiatorGroupKey(group) === draft.active) ?? draft.groups[0]!;
  const heights = [...new Set(draft.groups.filter((group) => group.type === active.type).map((group) => group.height))].sort((a, b) => Number(a) - Number(b));
  const types = [...new Set(draft.groups.map((group) => group.type))];
  const rows = radiatorMeasurementRows(activeRadiatorDraft({ ...draft, active: radiatorGroupKey(active) }), placement, measurements);
  const pending = rows.reduce((total, row) => total + row.quantity, 0);
  const allPending = Object.values(draft.counts).reduce((total, count) => total + count, 0);
  const countUnit = sectional ? 'dilim' : 'adet';
  const groupCount = (type: string, height?: string) => draft.groups.filter((group) => group.type === type && (!height || group.height === height)).reduce((total, group) =>
    total + (sectional ? [''] : group.lengths).reduce((sum, value) => sum + (draft.counts[radiatorSizeKey({ ...group, length: value })] ?? 0), 0), 0);

  const update = (next: RadiatorDraft) => {
    setDraft(next);
    const serialized = JSON.stringify(next);
    if (readUiState(uiState, draftKey) !== serialized) writeUiState(uiState, draftKey, serialized);
    // Reusable choices are global to this catalog card; quantities remain placement-specific.
    const preferences = JSON.stringify({ ...next, counts: {} });
    if (readUiState(uiState, preferenceKey) !== preferences) writeUiState(uiState, preferenceKey, preferences);
  };
  useEffect(() => {
    // Persist the initial snapshot too, marking legacy draft migration as completed.
    if (!readUiState(uiState, draftKey)) writeUiState(uiState, draftKey, JSON.stringify(draft));
    const refresh = () => {
      setSaving(saves.has(placement.id));
      const saved = readRadiatorDraft(readUiState(uiState, draftKey));
      if (saved) setDraft(saved);
    };
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, [placement.id, draftKey, uiState]);

  const setCount = (itemLength: string, value: number) => {
    if (locked || !Number.isSafeInteger(value) || value < 0 || value > 1000000) return;
    update({ ...draft, counts: { ...draft.counts, [radiatorSizeKey({ ...active, length: itemLength })]: value } });
  };
  const addLength = () => {
    if (locked) return;
    const normalized = radiatorDimension(length);
    if (!normalized) { setError('Uzunluğu mm olarak, sıfırdan büyük bir sayı ile yazın.'); return; }
    const key = radiatorSizeKey({ ...active, length: normalized });
    update({ ...draft,
      groups: mergeRadiatorGroups(draft.groups, [{ ...active, lengths: [normalized] }]),
      counts: { ...draft.counts, [key]: Math.min(1000000, (draft.counts[key] ?? 0) + 1) },
    });
    setLength('');
    setError('');
    lengthInput.current?.focus();
  };
  const addGroup = () => {
    const height = radiatorDimension(customHeight);
    const type = canonicalRadiatorType(customType);
    if (!height || !type || type.length > 40 || type.includes(' · ')) {
      setError('Bir tip adı (en çok 40 karakter) ve sıfırdan büyük yükseklik yazın.'); return;
    }
    const templateLengths = isPanelRadiator(placement) ? [...PANEL_LENGTHS] : [...active.lengths];
    const group = { type, height, lengths: templateLengths };
    const added = groupMode === 'type' && isPanelRadiator(placement)
      ? [...new Set([...PANEL_HEIGHTS, height])].map((value) => ({ ...group, height: value })) : [group];
    update({ ...draft, groups: mergeRadiatorGroups(draft.groups, added), active: radiatorGroupKey(group) });
    setShowGroupForm(false);
    setError('');
    setLength('');
    lengthInput.current?.focus();
  };
  const submit = async () => {
    if (locked || saves.has(placement.id) || !rows.length) return;
    saves.add(placement.id);
    announce();
    try {
      if (await onSubmitRows(rows)) {
        // No edits are allowed during the save, including after leaving and reopening this card.
        writeUiState(uiState, draftKey, JSON.stringify(clearActiveRadiatorCounts({ ...draft, active: radiatorGroupKey(active) })));
      }
    } catch {
      setError('Kayıt tamamlanamadı. Bekleyen adetler korunuyor; tekrar deneyin.');
    } finally {
      saves.delete(placement.id);
      announce();
    }
  };
  return (
    <fieldset className="quick-measure variant-input-panel radiator-input-panel" disabled={locked}>
      <div className="radiator-heading">
        <strong>{sectional ? 'Dilim' : 'Radyatör'} sayımı</strong>
        <small>{sectional ? 'Bu kartta 1 adet = 1 dilim.' : 'Tipi ve yüksekliği seç; saydıkça adetleri artır.'}</small>
      </div>
      <div className="radiator-choice-label">1. Petek tipi</div>
      <div className="radiator-types" role="group" aria-label="Petek tipi">
        {types.map((type) => {
          const option = PANEL_TYPES.find((item) => item.type === type);
          const count = groupCount(type);
          return <button type="button" key={type} aria-pressed={active.type === type} aria-label={radiatorTypeLabel(type)}
            title={option?.description} onClick={() => {
              const group = draft.groups.find((item) => item.type === type && item.height === active.height) ?? draft.groups.find((item) => item.type === type)!;
              update({ ...draft, active: radiatorGroupKey(group) }); setLength(''); setError('');
            }}>
            <strong>{option?.code ?? type}</strong>{option && <small>{option.type}</small>}
            {count > 0 && <span className="radiator-count-badge">{count}</span>}
          </button>;
        })}
      </div>
      <button type="button" className="text-button" aria-expanded={showGroupForm && groupMode === 'type'} onClick={() => {
        setShowGroupForm(!showGroupForm || groupMode !== 'type'); setGroupMode('type'); setCustomHeight(active.height); setCustomType(''); setError('');
      }}>+ Tip ekle</button>
      <div className="radiator-choice-label">2. Yükseklik (mm)</div>
      <div className="radiator-heights" role="group" aria-label="Radyatör yüksekliği">
        {heights.map((height) => {
          const heightCount = groupCount(active.type, height);
          return <button type="button" key={height} aria-label={`${height} mm yükseklik`} aria-pressed={active.height === height}
            onClick={() => {
              const group = draft.groups.find((item) => item.height === height && item.type === active.type) ?? draft.groups.find((item) => item.height === height)!;
              update({ ...draft, active: radiatorGroupKey(group) });
              setLength('');
              setError('');
            }}>
            {height}{heightCount > 0 && <span aria-label={`${heightCount} ${countUnit} bekliyor`}>{heightCount}</span>}
          </button>;
        })}
      </div>
      <button type="button" className="text-button" aria-expanded={showGroupForm && groupMode === 'height'} onClick={() => {
        setShowGroupForm(!showGroupForm || groupMode !== 'height'); setGroupMode('height'); setCustomHeight(''); setCustomType(active.type); setError('');
      }}>+ Yükseklik ekle</button>
      {showGroupForm && <div className="radiator-group-form">
        {groupMode === 'type' && <label>Yeni tip adı<input value={customType} maxLength={40} placeholder="Örn. Dekoratif" onChange={(event) => setCustomType(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGroup(); } }} /></label>}
        {groupMode === 'height' && <label>Yeni yükseklik (mm)<input inputMode="decimal" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGroup(); } }} /></label>
        }
        <button type="button" onClick={addGroup}>Seçeneklere ekle</button>
      </div>}
      <div className="radiator-lengths">
        <div className="radiator-table-heading"><strong>{radiatorTypeLabel(active.type)} · H{active.height}</strong><span>{sectional ? 'Dilim' : 'Adet'}</span></div>
        <div className="radiator-counter-list" role="group" aria-label={`${radiatorTypeLabel(active.type)}, ${active.height} mm sayımı`}
          onKeyDownCapture={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void submit(); } }}>
        {(sectional ? [''] : active.lengths).map((value) => {
          const count = draft.counts[radiatorSizeKey({ ...active, length: value })] ?? 0;
          const label = sectional ? 'Dilim' : `${value} mm`;
          return <div className="radiator-counter-row" key={value}>
            <strong>{label}</strong>
            <button type="button" aria-label={`${label} azalt`} disabled={count === 0} onClick={() => setCount(value, count - 1)}>−</button>
            <input type="number" min="0" max="1000000" step="1" inputMode="numeric" aria-label={`${label} adedi`} value={count || ''} placeholder="0"
              onChange={(event) => setCount(value, Number(event.target.value))} />
            <button type="button" aria-label={`${label} artır`} onClick={() => setCount(value, count + 1)}>+</button>
          </div>;
        })}
        </div>
        {!sectional && <details className="radiator-custom-length"><summary>+ Özel uzunluk ekle</summary><div className="radiator-add-length">
          <label>Özel uzunluk (mm)<input ref={lengthInput} inputMode="decimal" placeholder="Örn. 1250" value={length}
            onChange={(event) => { setLength(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLength(); } }} /></label>
          <button type="button" onClick={addLength} disabled={!length.trim()}>+ Uzunluk</button>
          <small>Yeni uzunluk 1 adetle başlar.</small>
        </div></details>}
      </div>
      {error && <p className="radiator-error" role="alert">{error}</p>}
      <div className="radiator-save-bar">
        <small>{radiatorTypeLabel(active.type)} · {active.height} mm · {rows.length} uzunluk</small>
        <button type="button" className="primary full" disabled={!pending || locked} onClick={() => void submit()}>
          {saving ? 'Kaydediliyor…' : pending ? `${pending} ${countUnit} kaydet ↵` : 'Adetleri gir'}
        </button>
        <small>Enter yalnızca bu tip ve yüksekliği kaydeder.</small>
      </div>
      {allPending > pending && <details className="radiator-pending">
        <summary>Diğer tip / yüksekliklerde {allPending - pending} {countUnit} bekliyor</summary>
        {draft.groups.map((group) => {
          if (radiatorGroupKey(group) === radiatorGroupKey(active)) return null;
          const values = (sectional ? [''] : group.lengths).filter((value) => (draft.counts[radiatorSizeKey({ ...group, length: value })] ?? 0) > 0);
          if (!values.length) return null;
          return <button type="button" key={radiatorGroupKey(group)} onClick={() => update({ ...draft, active: radiatorGroupKey(group) })}>
            {radiatorTypeLabel(group.type)} · H{group.height}: {values.map((value) => `${value ? `${value} mm × ` : ''}${draft.counts[radiatorSizeKey({ ...group, length: value })]} ${countUnit}`).join(', ')}
          </button>;
        })}
      </details>}
      <small>Eklediğin tip ve ölçüler diğer projelerde de hazır kalır. Adetler bu karta özeldir.</small>
    </fieldset>
  );
}
