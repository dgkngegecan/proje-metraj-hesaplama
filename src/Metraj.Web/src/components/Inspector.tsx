import type { MeasurementDraft } from '../lib/draftTypes';
import { ContextNotes } from './ContextNotes';
import { FITTING_PRESETS, STEEL_DIAMETERS, variantName } from '../lib/catalogData';
import { useEffect, useRef, useState } from 'react';
import { clearUiState, readUiState, writeUiState, type UiStateMap } from '../uiState';
import { TYPE_META } from '../lib/uiTypes';
import {
  isRadiatorPlacement,
  measurementLabel,
  measurementVariantOf,
  parseDecimal,
  purchaseUnit,
  quantity,
} from '../lib/format';
import type { CatalogCardVariant, CatalogVariantMode, Measurement, MeasurementSummary, Placement } from '../types';

export function Inspector({
  placement,
  placements,
  summaries,
  measurements,
  allMeasurements,
  canEdit,
  busy,
  draft,
  onDraft,
  onSubmit,
  onSubmitRows,
  placementNotes,
  onPlacementNotes,
  onSavePlacementNotes,
  onUpdateMeasurement,
  onDeleteMeasurement,
  uiState,
  uiStateReady,
  onAdd,
  onDelete,
  onScope,
}: {
  placement: Placement | null;
  placements: Placement[];
  summaries: MeasurementSummary[];
  measurements: Measurement[];
  allMeasurements: Measurement[];
  canEdit: boolean;
  busy: boolean;
  draft: MeasurementDraft;
  onDraft: (value: MeasurementDraft) => void;
  onSubmit: () => void;
  onSubmitRows: (
    rows: Array<{ quantity: number; notes?: string | null; variant?: string | null; secondaryVariant?: string | null }>,
  ) => Promise<boolean>;
  placementNotes: string;
  onPlacementNotes: (value: string) => void;
  onSavePlacementNotes: () => void;
  onUpdateMeasurement: (measurement: Measurement, inputQuantity: number) => Promise<void>;
  onDeleteMeasurement: (measurement: Measurement) => Promise<void>;
  uiState: UiStateMap;
  uiStateReady: boolean;
  onAdd: () => void;
  onDelete: () => void;
  onScope: () => void;
}) {
  type PipeBox = { id: string; diameter: string; pending: string };
  type FittingBox = { id: string; diameter: string; countsByDiameter: Record<string, Record<string, number>> };
  const [diameter, setDiameter] = useState('DN25');
  const [radiatorType, setRadiatorType] = useState('Panel');
  const [radiatorHeight, setRadiatorHeight] = useState('600');
  const [radiatorWidth, setRadiatorWidth] = useState('');
  const [fittingCounts, setFittingCounts] = useState<Record<string, number>>({ Dirsek: 0, Muşon: 0, Te: 0, Vana: 0 });
  const [pipeBoxes, setPipeBoxes] = useState<PipeBox[]>([]);
  const [fittingBoxes, setFittingBoxes] = useState<FittingBox[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Satır içi düzenleme/silme onayı. window.prompt / window.confirm yerine
  // arayüzün kendi kontrolleri kullanılır: kopyalanabilir, tema uyumlu ve
  // uygulamayı bloklamaz.
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const pipeHydratedPlacementId = useRef<string | null>(null);
  const fittingHydratedPlacementId = useRef<string | null>(null);

  // Bu efekt, seçili kart değiştiği anda eski kartın kutularını yeni kartın
  // anahtarına yazmayı önler. Yapısal değişiklikler bir sonraki render'da
  // yerleşim kimliği altında kalıcılaştırılır.
  useEffect(() => {
    if (
      !placement ||
      placement.variantMode !== 'Pipe' ||
      pipeHydratedPlacementId.current !== placement.id ||
      !pipeBoxes.length
    )
      return;
    writeUiState(
      uiState,
      `pipe-boxes.v1.${placement.id}`,
      JSON.stringify(pipeBoxes.map(({ id, diameter }) => ({ id, diameter }))),
    );
  }, [placement?.id, placement?.variantMode, pipeBoxes]);

  useEffect(() => {
    if (
      !placement ||
      placement.variantMode !== 'Fitting' ||
      fittingHydratedPlacementId.current !== placement.id ||
      !fittingBoxes.length
    )
      return;
    writeUiState(uiState, `fitting-draft.v1.${placement.id}`, JSON.stringify(fittingBoxes));
  }, [placement?.id, placement?.variantMode, fittingBoxes]);

  // `placement.variants` her yüklemede YENİ bir dizi kimliği taşır; bağımlılık
  // olarak kullanıldığında aşağıdaki hidrasyon efekti her ölçüm kaydından sonra
  // yeniden çalışıyor, saklanan taslakları baştan ayrıştırıyordu. Varyant
  // KÜMESİ gerçekten değiştiğinde değişen kararlı bir anahtar kullanılıyor.
  const variantKey = (placement?.variants ?? []).map((item) => item.code).join('\u001f');

  useEffect(() => {
    // Sunucudan gelen kalıcı durum hazır olmadan hidrasyon yapılmaz; aksi hâlde
    // boş haritadan okunur ve kullanıcının bekleyen adetleri yok sayılırdı.
    if (!placement || !uiStateReady) return;
    let ancestor = placements.find((item) => item.id === placement.parentPlacementId);
    let guard = 0;
    while (ancestor && guard++ < 24 && ancestor.variantMode !== 'Pipe')
      ancestor = placements.find((item) => item.id === ancestor?.parentPlacementId);
    const enteredParent = ancestor ? allMeasurements.filter((item) => item.placementId === ancestor?.id) : [];
    const preferredParentDiameter = ancestor?.variants?.find((variant) =>
      enteredParent.some((measurement) => {
        const value = measurementVariantOf(measurement).trim().toLowerCase();
        return value === variant.code.toLowerCase() || value === variant.label.toLowerCase();
      }),
    )?.code;
    const first =
      placement.variantMode === 'Fitting'
        ? (preferredParentDiameter ?? ancestor?.variants?.[0]?.code ?? 'DN25')
        : (placement.variants?.[0]?.code ?? 'DN25');
    let savedPipeBoxes: Array<{ id?: string; diameter?: string }> = [];
    let savedFittingBoxes: Array<{ id?: string; diameter?: string; counts?: unknown; countsByDiameter?: unknown }> = [];
    if (placement.variantMode === 'Pipe') {
      try {
        const raw = readUiState(uiState, `pipe-boxes.v1.${placement.id}`);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          savedPipeBoxes = parsed.filter((item): item is { id?: string; diameter?: string } =>
            Boolean(item && typeof item === 'object' && typeof (item as { diameter?: unknown }).diameter === 'string'),
          );
        }
      } catch {
        savedPipeBoxes = [];
      }
    }
    if (placement.variantMode === 'Fitting') {
      try {
        const raw = readUiState(uiState, `fitting-draft.v1.${placement.id}`);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          savedFittingBoxes = parsed.filter(
            (item): item is { id?: string; diameter?: string; counts?: unknown; countsByDiameter?: unknown } =>
              Boolean(item && typeof item === 'object'),
          );
        }
      } catch {
        savedFittingBoxes = [];
      }
    }
    const validDiameters = placement.variants?.length
      ? new Set(placement.variants.map((item) => item.code.toLowerCase()))
      : null;
    const normalizedPipeBoxes = savedPipeBoxes.reduce<Array<{ id: string; diameter: string }>>((items, item, index) => {
      const diameter = item.diameter?.trim();
      if (
        !diameter ||
        (validDiameters && !validDiameters.has(diameter.toLowerCase())) ||
        items.some((current) => current.diameter.toLowerCase() === diameter.toLowerCase())
      )
        return items;
      items.push({ id: item.id || `${placement.id}-pipe-${index}`, diameter });
      return items;
    }, []);
    if (placement.variantMode === 'Pipe' && !normalizedPipeBoxes.length)
      normalizedPipeBoxes.push({ id: `${placement.id}-pipe-0`, diameter: first });
    const validFittingDiameters = ancestor?.variants?.length
      ? new Set(ancestor.variants.map((item) => item.code.toLowerCase()))
      : null;
    const normalizeCounts = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, number>;
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
        (result, [kind, count]) => {
          if (typeof count === 'number' && Number.isFinite(count) && count > 0) result[kind] = Math.floor(count);
          return result;
        },
        {},
      );
    };
    const normalizedFittingBoxes = savedFittingBoxes.reduce<FittingBox[]>((items, item, index) => {
      const diameter = item.diameter?.trim() || first;
      if (validFittingDiameters && !validFittingDiameters.has(diameter.toLowerCase())) return items;
      const rawByDiameter =
        item.countsByDiameter && typeof item.countsByDiameter === 'object' && !Array.isArray(item.countsByDiameter)
          ? (item.countsByDiameter as Record<string, unknown>)
          : item.counts && typeof item.counts === 'object'
            ? { [diameter]: item.counts }
            : {};
      const countsByDiameter = Object.entries(rawByDiameter).reduce<Record<string, Record<string, number>>>(
        (result, [savedDiameter, counts]) => {
          if (!validFittingDiameters || validFittingDiameters.has(savedDiameter.toLowerCase()))
            result[savedDiameter] = normalizeCounts(counts);
          return result;
        },
        {},
      );
      items.push({ id: item.id || `${placement.id}-fit-${index}`, diameter, countsByDiameter });
      return items;
    }, []);
    if (placement.variantMode === 'Fitting' && !normalizedFittingBoxes.length)
      normalizedFittingBoxes.push({ id: `${placement.id}-fit-0`, diameter: first, countsByDiameter: {} });
    pipeHydratedPlacementId.current = placement.variantMode === 'Pipe' ? placement.id : null;
    fittingHydratedPlacementId.current = placement.variantMode === 'Fitting' ? placement.id : null;
    setPipeBoxes(
      (placement.variantMode === 'Pipe'
        ? normalizedPipeBoxes
        : [{ id: `${placement.id}-pipe-0`, diameter: first }]
      ).map((item) => ({ ...item, pending: '' })),
    );
    setFittingBoxes(
      placement.variantMode === 'Fitting'
        ? normalizedFittingBoxes
        : [{ id: `${placement.id}-fit-0`, diameter: first, countsByDiameter: {} }],
    );
    setDiameter(first);
    setFittingCounts({ Dirsek: 0, Muşon: 0, Te: 0, Vana: 0 });
  }, [placement?.id, placement?.variantMode, placement?.parentPlacementId, variantKey, uiStateReady]);
  useEffect(() => {
    setShowHistory(false);
    setEditingMeasurementId(null);
    setConfirmingDeleteId(null);
  }, [placement?.id]);
  if (!placement)
    return (
      <aside className="inspector empty-inspector">
        <span>←</span>
        <h3>Bir kart seç</h3>
        <p>Kartın ne yaptığını ve sonraki en kolay adımı burada göstereceğim.</p>
      </aside>
    );
  const meta = TYPE_META[placement.cardType];
  // Yerleşimin toplamı, varyantların TAMAMINDAN gelir. Tek satır göstermek,
  // dört çap girilmiş bir boru kartında "Şu ana kadar" başlığı altında yalnızca
  // ilk çapın rakamını toplam gibi sunuyordu.
  const placementTotals = summaries.length
    ? {
        net: summaries.reduce((sum, item) => sum + item.netQuantity, 0),
        purchase: summaries.reduce((sum, item) => sum + item.purchaseQuantity, 0),
        unit: summaries[0]?.unit ?? '',
        purchaseUnit: summaries[0] ? purchaseUnit(summaries[0]) : '',
        variantCount: summaries.length,
      }
    : null;
  const summaryForVariant = (code: string, label?: string) =>
    summaries.find((item) => {
      const variant = (item.variant ?? '').toLowerCase();
      return variant === code.toLowerCase() || (label !== undefined && variant === label.toLowerCase());
    });
  const isPipe = placement.variantMode === 'Pipe';
  const isFitting = placement.variantMode === 'Fitting';
  // Hangi giriş panelinin açılacağı, önce kartın AÇIK özelliklerinden çıkarılır.
  // Ad regex'i yalnızca bu ipuçlarının hiçbiri yoksa devreye giren geriye dönük
  // bir çaredir: "Panel Radyatör" kartını "PR-600 Panel" olarak yeniden
  // adlandırmak, tür/yükseklik/genişlik panelini sessizce kaybettiriyordu.
  const isRadiator = !isPipe && !isFitting && isRadiatorPlacement(placement);
  const isCount = !isFitting && !isRadiator && (placement.cardType === 'Accessory' || /adet/i.test(placement.unit));
  const knownDiameters = [
    ...new Set(measurements.map((item) => measurementVariantOf(item)).filter(Boolean) as string[]),
  ];
  const fallbackDiameters: CatalogCardVariant[] = knownDiameters.length
    ? knownDiameters.map((item) => ({ code: item, label: item }))
    : STEEL_DIAMETERS;
  const variantDiameters = placement.variants?.length ? placement.variants : fallbackDiameters;
  const findAncestor = (mode: CatalogVariantMode) => {
    let current = placements.find((item) => item.id === placement.parentPlacementId);
    let guard = 0;
    while (current && guard++ < 24) {
      if (current.variantMode === mode) return current;
      current = placements.find((item) => item.id === current?.parentPlacementId);
    }
    return undefined;
  };
  const parentPipe = isFitting ? findAncestor('Pipe') : undefined;
  const parentDiameterMeasurements = parentPipe
    ? allMeasurements.filter((item) => item.placementId === parentPipe.id && measurementVariantOf(item))
    : [];
  const parentDiameterBase = parentPipe?.variants?.length ? parentPipe.variants : fallbackDiameters;
  const parentEnteredDiameters =
    parentPipe && parentDiameterMeasurements.length
      ? parentDiameterBase.filter((item) =>
          parentDiameterMeasurements.some((measurement) => {
            const entered = measurementVariantOf(measurement).trim().toLowerCase();
            return entered === item.code.toLowerCase() || entered === item.label.toLowerCase();
          }),
        )
      : [];
  const parentDiameters = parentEnteredDiameters.length ? parentEnteredDiameters : parentDiameterBase;
  const parentDiameterFiltered = Boolean(
    parentPipe && parentEnteredDiameters.length && parentEnteredDiameters.length < parentDiameterBase.length,
  );
  const fittingVariants = placement.variants?.length ? placement.variants : FITTING_PRESETS;
  const compatibleFittings = (diameterCode: string) =>
    fittingVariants.filter((item) => {
      const compatible = item.compatibleDiameters ?? [];
      return (
        compatible.length === 0 ||
        compatible.some(
          (itemDiameter) =>
            itemDiameter.toLowerCase() === diameterCode.toLowerCase() ||
            itemDiameter.toLowerCase() ===
              variantDiameters.find((item) => item.code === diameterCode)?.label.toLowerCase(),
        )
      );
    });
  // Girilen değer, kayıt BAŞARILI olmadan temizlenmez. Aksi hâlde bir doğrulama
  // veya yazma hatasında kutu boşalıyor, kısa bir toast geçiyor ve kullanıcının
  // sahadan okuyup yazdığı sayı hiçbir yerde kalmıyordu.
  const submitPipeBox = async (box: PipeBox) => {
    const parsed = parseDecimal(box.pending);
    if (parsed <= 0 || !Number.isFinite(parsed)) return;
    const profile = variantDiameters.find((item) => item.code === box.diameter);
    const saved = await onSubmitRows([
      { quantity: parsed, variant: box.diameter, notes: `Çap: ${profile?.label ?? box.diameter}` },
    ]);
    if (!saved) return;
    // Kayıt sürerken kullanıcı yeni bir değer yazmış olabilir; onu ezme.
    setPipeBoxes((current) =>
      current.map((item) => (item.id === box.id && item.pending === box.pending ? { ...item, pending: '' } : item)),
    );
    onDraft({ ...draft, quantity: '' });
  };
  const submitRadiator = async () => {
    const width = parseDecimal(radiatorWidth);
    if (!Number.isFinite(width) || width <= 0) return;
    const saved = await onSubmitRows([
      {
        quantity: 1,
        variant: `${radiatorType} · H${radiatorHeight}`,
        secondaryVariant: `W${width}`,
        notes: `Radyatör: ${radiatorType} · Yükseklik: ${radiatorHeight} · Genişlik: ${width}`,
      },
    ]);
    if (saved) setRadiatorWidth('');
  };
  const hasPendingFittings = fittingBoxes.some((box) =>
    Object.values(box.countsByDiameter).some((counts) => Object.values(counts).some((count) => count > 0)),
  );
  const submitFittings = async () => {
    const totals = new Map<string, { diameter: string; kind: string; count: number }>();
    fittingBoxes.forEach((box) =>
      Object.entries(box.countsByDiameter).forEach(([diameter, counts]) => {
        Object.entries(counts)
          .filter(([, count]) => count > 0)
          .forEach(([kind, count]) => {
            const key = `${diameter}\u0000${kind}`;
            const current = totals.get(key);
            totals.set(key, { diameter, kind, count: (current?.count ?? 0) + count });
          });
      }),
    );
    const rows = [...totals.values()].map(({ diameter, kind, count }) => ({
      quantity: count,
      variant: diameter,
      secondaryVariant: kind,
      notes: `${kind} · Çap: ${diameter}`,
    }));
    if (!rows.length) return;
    const saved = await onSubmitRows(rows);
    if (saved) {
      setFittingBoxes((current) => current.map((box) => ({ ...box, countsByDiameter: {} })));
      clearUiState(uiState, `fitting-draft.v1.${placement.id}`);
    }
  };
  const updateFittingCount = (boxId: string, diameterCode: string, code: string, delta: number) =>
    setFittingBoxes((current) =>
      current.map((box) => {
        if (box.id !== boxId) return box;
        const diameterCounts = box.countsByDiameter[diameterCode] ?? {};
        return {
          ...box,
          countsByDiameter: {
            ...box.countsByDiameter,
            [diameterCode]: { ...diameterCounts, [code]: Math.max(0, (diameterCounts[code] ?? 0) + delta) },
          },
        };
      }),
    );
  const setFittingCount = (boxId: string, diameterCode: string, code: string, value: string) => {
    const parsed = parseDecimal(value);
    const normalized = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setFittingBoxes((current) =>
      current.map((box) => {
        if (box.id !== boxId) return box;
        const diameterCounts = box.countsByDiameter[diameterCode] ?? {};
        return {
          ...box,
          countsByDiameter: { ...box.countsByDiameter, [diameterCode]: { ...diameterCounts, [code]: normalized } },
        };
      }),
    );
  };
  const submitSimpleCounts = async () => {
    const rows = Object.entries(fittingCounts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => ({
        quantity: count,
        variant: diameter,
        secondaryVariant: kind,
        notes: `${kind} · Çap: ${diameter}`,
      }));
    if (!rows.length) return;
    const saved = await onSubmitRows(rows);
    // Sayaçlar yalnızca kayıt gerçekten başarılı olduğunda sıfırlanır.
    if (saved) setFittingCounts({ Dirsek: 0, Muşon: 0, Te: 0, Vana: 0 });
  };
  const setSimpleCount = (kind: string, value: string) => {
    const parsed = parseDecimal(value);
    setFittingCounts((current) => ({
      ...current,
      [kind]: Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0,
    }));
  };
  const addFittingBox = () =>
    setFittingBoxes((current) => [
      ...current,
      { id: `${placement.id}-fit-${Date.now()}`, diameter: parentDiameters[0]?.code ?? 'DN25', countsByDiameter: {} },
    ]);
  const history = [...measurements].sort((a, b) => {
    const left = Date.parse(a.createdAtUtc);
    const right = Date.parse(b.createdAtUtc);
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0) || a.id.localeCompare(b.id);
  });
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <div className="inspector-kind" style={{ color: meta.color }}>
            {meta.icon} {meta.label}
          </div>
          <h3>{placement.displayName}</h3>
        </div>
        <button className="scope-button" onClick={onScope}>
          Bu daldan metraj →
        </button>
      </div>
      <p className="muted">
        {placement.isMeasurable ? `${placement.unit} ile ölçülür` : 'Alt kartları düzenleyen başlık'}
      </p>
      <div className="placement-note-panel">
        <div className="placement-note-heading">
          <strong>Bu karta özel not</strong>
          <small>Yalnızca bu proje yerleşiminde saklanır.</small>
        </div>
        <textarea
          rows={3}
          value={placementNotes}
          disabled={!canEdit || busy}
          placeholder="Örn. 120 kW, marka/model, pompa basıncı…"
          onChange={(event) => onPlacementNotes(event.target.value)}
        />
        <button className="full" disabled={!canEdit || busy} onClick={onSavePlacementNotes}>
          Notu kaydet
        </button>
      </div>
      {placementTotals && (
        <div className="quantity-card">
          <span>Şu ana kadar</span>
          <strong>
            {quantity(placementTotals.net)} {placementTotals.unit}
          </strong>
          <small>
            Satın alma: {quantity(placementTotals.purchase)} {placementTotals.purchaseUnit}
            {placementTotals.variantCount > 1 ? ` · ${placementTotals.variantCount} çap/çeşit toplamı` : ''}
          </small>
        </div>
      )}
      {placement.isMeasurable && (
        <div className="history-panel">
          <button
            type="button"
            className="history-toggle"
            disabled={!history.length}
            aria-expanded={showHistory}
            onClick={() => setShowHistory((current) => !current)}
          >
            <span aria-hidden="true">◷</span>
            <span>Giriş geçmişi</span>
            <b>{history.length}</b>
          </button>
          <div className={`panel-collapse history-collapse ${showHistory ? 'open' : ''}`} aria-hidden={!showHistory}>
            <div className="panel-collapse-inner">
              <div className="history-list">
                {history.map((item, index) => {
                  const isEditing = editingMeasurementId === item.id;
                  const isConfirmingDelete = confirmingDeleteId === item.id;
                  const commitEdit = async () => {
                    const parsed = parseDecimal(editingQuantity);
                    if (!Number.isFinite(parsed) || parsed <= 0) return;
                    await onUpdateMeasurement(item, parsed);
                    setEditingMeasurementId(null);
                  };
                  return (
                    <article
                      className={`history-row${isEditing || isConfirmingDelete ? ' history-row-active' : ''}`}
                      key={item.id}
                    >
                      <div>
                        {isEditing ? (
                          <label className="history-edit">
                            <span className="sr-only">Miktar</span>
                            <input
                              autoFocus
                              inputMode="decimal"
                              aria-label={`${index + 1}. satırın miktarı`}
                              value={editingQuantity}
                              onChange={(event) => setEditingQuantity(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !busy) {
                                  event.preventDefault();
                                  void commitEdit();
                                }
                                if (event.key === 'Escape') setEditingMeasurementId(null);
                              }}
                            />
                            <b>{item.inputUnit}</b>
                          </label>
                        ) : (
                          <strong>
                            {index + 1}. {quantity(item.inputQuantity)} {item.inputUnit}
                          </strong>
                        )}
                        <small>
                          {new Date(item.createdAtUtc).toLocaleString('tr-TR')}
                          {item.updatedAtUtc ? ' · düzeltildi' : ''}
                        </small>
                      </div>
                      {isConfirmingDelete ? (
                        <div className="history-actions">
                          <span className="history-confirm">Silinsin mi?</span>
                          <button
                            type="button"
                            className="danger-link"
                            disabled={busy}
                            onClick={() => {
                              void onDeleteMeasurement(item).then(() => setConfirmingDeleteId(null));
                            }}
                          >
                            Evet, sil
                          </button>
                          <button type="button" disabled={busy} onClick={() => setConfirmingDeleteId(null)}>
                            Vazgeç
                          </button>
                        </div>
                      ) : isEditing ? (
                        <div className="history-actions">
                          <button type="button" className="primary" disabled={busy} onClick={() => void commitEdit()}>
                            Kaydet
                          </button>
                          <button type="button" disabled={busy} onClick={() => setEditingMeasurementId(null)}>
                            Vazgeç
                          </button>
                        </div>
                      ) : (
                        <div className="history-actions">
                          <span className="history-variant">
                            {[item.variant, item.secondaryVariant].filter(Boolean).join(' · ') ||
                              measurementLabel(item.notes)}
                          </span>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                title="Miktarı düzelt"
                                aria-label={`${index + 1}. satırın miktarını düzelt`}
                                disabled={busy}
                                onClick={() => {
                                  setConfirmingDeleteId(null);
                                  setEditingMeasurementId(item.id);
                                  setEditingQuantity(String(item.inputQuantity));
                                }}
                              >
                                Düzelt
                              </button>
                              <button
                                type="button"
                                className="danger-link"
                                title="Satırı sil"
                                aria-label={`${index + 1}. satırı sil`}
                                disabled={busy}
                                onClick={() => {
                                  setEditingMeasurementId(null);
                                  setConfirmingDeleteId(item.id);
                                }}
                              >
                                Sil
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {placement.isMeasurable && placement.inputBehavior !== 'Derived' && isPipe && (
        <div className="quick-measure variant-input-panel">
          <div className="variant-panel-heading">
            <div>
              <strong>Boru çapları</strong>
              <small>Bir çap kutusunu seç, metreyi yazıp Enter'a bas.</small>
            </div>
            <button
              type="button"
              onClick={() =>
                setPipeBoxes((current) => [
                  ...current,
                  {
                    id: `${placement.id}-pipe-${Date.now()}`,
                    diameter: variantDiameters[0]?.code ?? 'DN25',
                    pending: '',
                  },
                ])
              }
            >
              + Çap kutusu
            </button>
          </div>
          {pipeBoxes.map((box) => {
            const profile = variantDiameters.find((item) => item.code === box.diameter);
            /* Toplam ve satin alma adedi backend'in decimal sonucundan okunur. Panelde JavaScript kayan noktasiyla yeniden hesaplamak, 40 adet 0,1 girisinde 4 m boy icin 1 yerine 2 boy gosteriyordu; ekran ile rapor celisiyordu. */ const variantSummary =
              summaryForVariant(box.diameter, profile?.label);
            const entered = variantSummary?.netQuantity ?? 0;
            const stockLength = profile?.standardLength ?? 0;
            const barsPurchase = (variantSummary?.purchaseUnit ?? '') === 'boy';
            const bars = barsPurchase ? (variantSummary?.purchaseQuantity ?? 0) : 0;
            return (
              <div className="pipe-variant-box" key={box.id}>
                <div className="variant-box-head">
                  <label>
                    Çap / boyut
                    <select
                      value={box.diameter}
                      onChange={(event) =>
                        setPipeBoxes((current) =>
                          current.map((item) =>
                            item.id === box.id ? { ...item, diameter: event.target.value } : item,
                          ),
                        )
                      }
                    >
                      {variantDiameters.map((item) => (
                        <option key={item.code} value={item.code}>
                          {variantName(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pipeBoxes.length > 1 && (
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => setPipeBoxes((current) => current.filter((item) => item.id !== box.id))}
                    >
                      Kaldır
                    </button>
                  )}
                </div>
                <label className="large-input-label">
                  Metre yaz, Enter'a bas
                  <input
                    autoFocus={pipeBoxes[0]?.id === box.id}
                    className="large-measure-input"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={box.pending}
                    onChange={(event) =>
                      setPipeBoxes((current) =>
                        current.map((item) => (item.id === box.id ? { ...item, pending: event.target.value } : item)),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !busy) {
                        event.preventDefault();
                        void submitPipeBox(box);
                      }
                    }}
                  />
                </label>
                <div className="variant-box-summary">
                  <span>
                    Toplam{' '}
                    <b>
                      {quantity(entered)} {variantSummary?.unit ?? placement.unit}
                    </b>
                  </span>
                  <span>
                    {stockLength > 0 ? `${stockLength} m boy` : 'Boy girilmemiş'} ·{' '}
                    <b>{barsPurchase && bars > 0 ? `${quantity(bars)} boy` : '—'}</b>
                  </span>
                </div>
              </div>
            );
          })}
          <small>
            Her Enter ayrı kaynak satırı olarak kaydolur; aynı çapın toplamı ve satın alınacak boy otomatik hesaplanır.
          </small>
        </div>
      )}
      {placement.isMeasurable && placement.inputBehavior !== 'Derived' && isFitting && (
        <div className="quick-measure variant-input-panel fitting-input-panel">
          <div className="variant-panel-heading">
            <div>
              <strong>Fitting çap grupları</strong>
              <small>Çaplar arasında geçiş yapabilirsin; gönderilmeyen adetler kaybolmaz.</small>
            </div>
            <button type="button" onClick={addFittingBox}>
              + Çap kutusu
            </button>
          </div>
          {parentDiameterFiltered && (
            <div className="diameter-filter-note">
              Bağlı boruda ölçümü girilen çaplar gösteriliyor. <span>{parentDiameters.length} çap hazır</span>
            </div>
          )}
          {!parentDiameterFiltered && parentPipe && (
            <div className="diameter-filter-note muted-filter">
              Bağlı boruda henüz ölçüm yok; kartta tanımlı tüm çaplar gösteriliyor.
            </div>
          )}
          {fittingBoxes.map((box) => {
            const activeDiameter = parentDiameters.some((item) => item.code === box.diameter)
              ? box.diameter
              : (parentDiameters[0]?.code ?? box.diameter);
            const activeCounts = box.countsByDiameter[activeDiameter] ?? {};
            return (
              <div className="fitting-variant-box" key={box.id}>
                <div className="diameter-chip-row">
                  {parentDiameters.map((item) => {
                    const entered = parentDiameterMeasurements.some((measurement) => {
                      const value = measurementVariantOf(measurement).trim().toLowerCase();
                      return value === item.code.toLowerCase() || value === item.label.toLowerCase();
                    });
                    const pending = Object.values(box.countsByDiameter[item.code] ?? {}).reduce(
                      (sum, count) => sum + count,
                      0,
                    );
                    return (
                      <button
                        type="button"
                        key={item.code}
                        className={`${activeDiameter === item.code ? 'selected ' : ''}${entered ? 'entered' : ''}${pending > 0 ? ' pending' : ''}`}
                        onClick={() =>
                          setFittingBoxes((current) =>
                            current.map((entry) => (entry.id === box.id ? { ...entry, diameter: item.code } : entry)),
                          )
                        }
                      >
                        {variantName(item)}
                        {pending > 0 && <b>{pending}</b>}
                      </button>
                    );
                  })}
                </div>
                <strong className="fitting-box-title">
                  {variantName(
                    parentDiameters.find((item) => item.code === activeDiameter) ?? {
                      code: activeDiameter,
                      label: activeDiameter,
                    },
                  )}
                </strong>
                <div className="counter-list">
                  {compatibleFittings(activeDiameter).map((item) => (
                    <div className="counter-row" key={item.code}>
                      <strong>{variantName(item)}</strong>
                      <button type="button" onClick={() => updateFittingCount(box.id, activeDiameter, item.code, -1)}>
                        −
                      </button>
                      <input
                        className="counter-input"
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        aria-label={`${variantName(item)} adedi`}
                        value={activeCounts[item.code] ?? 0}
                        onChange={(event) => setFittingCount(box.id, activeDiameter, item.code, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void submitFittings();
                          }
                        }}
                      />
                      <button type="button" onClick={() => updateFittingCount(box.id, activeDiameter, item.code, 1)}>
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <button
            className="primary full"
            disabled={!canEdit || busy || !hasPendingFittings}
            onClick={() => void submitFittings()}
          >
            Hepsini ekle ↵
          </button>
          <small>
            Bekleyen adetler bu kart, diğer kartlar ve ekranlar arasında saklanır; yalnız başarıyla eklenince
            temizlenir.
          </small>
        </div>
      )}
      {placement.isMeasurable && isRadiator && (
        <div className="quick-measure">
          <div className="variant-grid">
            <label>
              Tür
              <select value={radiatorType} onChange={(event) => setRadiatorType(event.target.value)}>
                <option>Panel</option>
                <option>Döküm</option>
                <option>Havlupan</option>
              </select>
            </label>
            <label>
              Yükseklik
              <select value={radiatorHeight} onChange={(event) => setRadiatorHeight(event.target.value)}>
                <option>300</option>
                <option>400</option>
                <option>500</option>
                <option>600</option>
                <option>900</option>
              </select>
            </label>
          </div>
          <label className="large-input-label">
            Genişlik yaz, Enter'a bas
            <input
              autoFocus
              className="large-measure-input"
              inputMode="decimal"
              value={radiatorWidth}
              onChange={(event) => setRadiatorWidth(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) {
                  event.preventDefault();
                  void submitRadiator();
                }
              }}
              placeholder="1000"
            />
          </label>
          <button className="primary full" disabled={!canEdit || busy} onClick={() => void submitRadiator()}>
            Radyatörü ekle
          </button>
        </div>
      )}
      {placement.isMeasurable && !isPipe && !isFitting && !isRadiator && !isCount && (
        <div className="quick-measure">
          <label>
            Çap / boyut
            <select value={diameter} onChange={(event) => setDiameter(event.target.value)}>
              {fallbackDiameters.map((item) => (
                <option key={item.code}>{item.code}</option>
              ))}
            </select>
          </label>
          <label className="large-input-label">
            Metre yaz, Enter'a bas
            <input
              autoFocus
              className="large-measure-input"
              inputMode="decimal"
              placeholder="0,00"
              value={draft.quantity}
              onChange={(event) => onDraft({ ...draft, quantity: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const parsed = parseDecimal(draft.quantity);
                  if (parsed > 0) onSubmitRows([{ quantity: parsed, variant: diameter, notes: `Çap: ${diameter}` }]);
                }
              }}
            />
          </label>
          <button
            className="primary full"
            disabled={!canEdit || busy}
            onClick={() => {
              const parsed = parseDecimal(draft.quantity);
              if (parsed > 0) onSubmitRows([{ quantity: parsed, variant: diameter, notes: `Çap: ${diameter}` }]);
              else onSubmit();
            }}
          >
            Metreyi ekle
          </button>
          <small>Her Enter ayrı bir ölçüm olarak kaydolur; toplam otomatik güncellenir.</small>
        </div>
      )}
      {placement.isMeasurable && isCount && (
        <div className="quick-measure">
          <label>
            Çap / boyut
            <select value={diameter} onChange={(event) => setDiameter(event.target.value)}>
              {fallbackDiameters.map((item) => (
                <option key={item.code}>{item.code}</option>
              ))}
            </select>
          </label>
          <div className="counter-list">
            {Object.entries(fittingCounts).map(([kind, count]) => (
              <div className="counter-row" key={kind}>
                <strong>{kind}</strong>
                <button
                  type="button"
                  onClick={() => setFittingCounts({ ...fittingCounts, [kind]: Math.max(0, count - 1) })}
                >
                  −
                </button>
                <input
                  className="counter-input"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-label={`${kind} adedi`}
                  value={count}
                  onChange={(event) => setSimpleCount(kind, event.target.value)}
                />
                <button type="button" onClick={() => setFittingCounts({ ...fittingCounts, [kind]: count + 1 })}>
                  +
                </button>
              </div>
            ))}
          </div>
          <button
            className="primary full"
            disabled={!canEdit || busy || !Object.values(fittingCounts).some(Boolean)}
            onClick={() => void submitSimpleCounts()}
          >
            Hepsini ekle ↵
          </button>
        </div>
      )}
      <ContextNotes key={placement.id} placementId={placement.id} canEdit={canEdit && !busy} />
      <div className="inspector-actions">
        <button className="full add-child" disabled={!canEdit || busy} onClick={onAdd}>
          + Bunun altına kart ekle
        </button>
        <button className="full danger-link delete-placement" disabled={!canEdit || busy} onClick={onDelete}>
          Seçili kartı ve altını sil
        </button>
      </div>
      <p className="tip">Kartı büyütüp giriş özetini görmek için çift tıkla.</p>
    </aside>
  );
}
