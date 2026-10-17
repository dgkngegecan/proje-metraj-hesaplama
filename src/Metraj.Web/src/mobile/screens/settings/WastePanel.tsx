import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import { quantity } from '../../../lib/format';
import type { MaterialWasteSetting } from '../../../types';
import { ActionSheet, Icon, SwipeRow, haptic, type SwipeAction } from '../../components';
import { EmptyState, ErrorState, ScreenHeader, SkeletonList } from '../../shell';
import { actions, appStore, listOf, loadKeys, patch, removeWithUndo, useAppStore, useLoad } from '../../store';
import { FormSheet } from '../library/shared/FormSheet';
import { Notice, TextField } from '../library/shared/FormParts';
import { perform } from '../library/shared/perform';
import { refreshAfterCalculationChange } from './settingsData';
import { buildWastePayload, validateWaste, wasteDraftFor } from './settingsModel';

/**
 * Malzeme fire payları: aynı malzeme ailesindeki bütün kartlara uygulanan oran; kartın
 * kendi oranının yerine geçer. Fire politikası özetleri etkilediği için her değişiklikte
 * rapor ve özetler yeniden okunur.
 */
export function WastePanel() {
  const table = useAppStore((state) => state.entities.wasteSettings);
  const load = useLoad(loadKeys.wasteSettings);
  const settings = useMemo(() => listOf(table), [table]);
  const [editing, setEditing] = useState<MaterialWasteSetting | 'new' | null>(null);
  const [menu, setMenu] = useState<MaterialWasteSetting | null>(null);

  useEffect(() => {
    void actions.loadWasteSettings();
  }, []);

  const remove = (setting: MaterialWasteSetting) =>
    removeWithUndo(appStore, {
      ops: [patch.remove('wasteSettings', [setting.id])],
      commit: () => api.delete(`/settings/material-waste/${setting.id}`),
      message: `“${setting.materialType}” fire kuralı kaldırıldı.`,
      errorMessage: 'Fire kuralı kaldırılamadı.',
      onCommitted: () => refreshAfterCalculationChange(),
    });

  const swipeActions = (setting: MaterialWasteSetting): SwipeAction[] => [
    { id: 'edit', label: 'Düzenle', icon: 'edit', onAction: () => setEditing(setting) },
    { id: 'delete', label: 'Kaldır', icon: 'trash', tone: 'danger', onAction: () => remove(setting) },
  ];

  if (!settings.length && (load.status === 'loading' || load.status === 'idle'))
    return (
      <div className="m-detail">
        <ScreenHeader title="Malzeme fire payları" />
        <SkeletonList />
      </div>
    );
  if (!settings.length && load.status === 'error')
    return (
      <div className="m-detail">
        <ScreenHeader title="Malzeme fire payları" />
        <ErrorState message={load.error} onRetry={() => void actions.loadWasteSettings()} />
      </div>
    );

  return (
    <div className="m-detail">
      <ScreenHeader title="Malzeme fire payları" subtitle={`${settings.length} kural`} />
      <div className="m-detail__scroll">
        <div className="m-detail__notice">
          <Notice tone="info">
            Aynı malzeme ailesindeki bütün kartlara uygulanacak oranı tanımlayın. Bu kural kartın varsayılan fire
            oranının yerine geçer; aile kuralı yoksa kartın oranı geçerlidir.
          </Notice>
        </div>
        {settings.length === 0 ? (
          <EmptyState
            icon="library"
            title="Henüz aile bazlı fire kuralı yok"
            message="Kartlar kendi varsayılan fire oranlarıyla hesaplanıyor. İsterseniz bir aile için ortak oran tanımlayın."
          />
        ) : (
          <ul className="m-row-list" aria-label="Fire kuralları">
            {settings.map((setting) => (
              <li key={setting.id}>
                <SwipeRow
                  actions={swipeActions(setting)}
                  onPress={() => setEditing(setting)}
                  onLongPress={() => setMenu(setting)}
                  ariaLabel={`${setting.materialType}, yüzde ${quantity(setting.wasteRatePct)} fire`}
                >
                  <div className="m-card-row">
                    <span className="m-card-row__text">
                      <strong>{setting.materialType}</strong>
                      <small>Aileye uygulanan fire payı</small>
                    </span>
                    <span className="m-badge m-num">%{quantity(setting.wasteRatePct)}</span>
                    <Icon name="chevronRight" size={20} className="m-tree-row__chevron" />
                  </div>
                </SwipeRow>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="m-bottom-actions">
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large m-btn--block"
          onClick={() => setEditing('new')}
        >
          <Icon name="plus" size={20} />
          Fire kuralı ekle
        </button>
      </div>
      <WasteSheet editing={editing} onClose={() => setEditing(null)} />
      <ActionSheet
        open={menu !== null}
        onClose={() => setMenu(null)}
        title={menu?.materialType ?? 'Fire kuralı'}
        actions={
          menu
            ? [
                { id: 'edit', label: 'Düzenle', icon: 'edit', onSelect: () => setEditing(menu) },
                {
                  id: 'delete',
                  label: 'Kaldır',
                  icon: 'trash',
                  tone: 'danger',
                  description: 'Kartların kendi fire oranları geçerli olur.',
                  onSelect: () => remove(menu),
                },
              ]
            : []
        }
      />
    </div>
  );
}

function WasteSheet({ editing, onClose }: { editing: MaterialWasteSetting | 'new' | null; onClose: () => void }) {
  const setting = editing && editing !== 'new' ? editing : undefined;
  const [draft, setDraft] = useState(() => wasteDraftFor(setting));
  const [errors, setErrors] = useState<{ materialType?: string; wasteRatePct?: string }>({});
  const [forKey, setForKey] = useState<string | null>(null);
  const cards = useAppStore((state) => state.entities.cards);
  const key = editing === null ? null : editing === 'new' ? 'new' : editing.id;
  if (key !== forKey) {
    setForKey(key);
    if (key !== null) {
      setDraft(wasteDraftFor(setting));
      setErrors({});
    }
  }
  useEffect(() => {
    // Aile önerileri kütüphane kartlarından gelir; kütüphane henüz açılmadıysa şimdi okunur.
    if (editing === 'new' && !appStore.getState().entities.cards.ids.length) void actions.loadCatalog();
  }, [editing]);
  const families = useMemo(() => {
    const names = new Set<string>();
    for (const card of listOf(cards)) if (card.materialType?.trim()) names.add(card.materialType.trim());
    return [...names].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [cards]);
  const suggestions = draft.materialType.trim()
    ? families.filter(
        (name) =>
          name.toLocaleLowerCase('tr').includes(draft.materialType.trim().toLocaleLowerCase('tr')) &&
          name !== draft.materialType.trim(),
      )
    : families;

  return (
    <FormSheet
      open={editing !== null}
      onClose={onClose}
      title={setting ? 'Fire kuralını düzenle' : 'Fire kuralı ekle'}
      description="Bu aileye ait bütün kartlarda kartın kendi fire oranı yerine bu oran kullanılır."
      submitLabel="Fire kuralını kaydet"
      onSubmit={async () => {
        const found = validateWaste(draft);
        setErrors(found);
        if (found.materialType || found.wasteRatePct) return false;
        const payload = buildWastePayload(draft);
        const result = await perform(() => api.put<MaterialWasteSetting>('/settings/material-waste', payload), {
          success: `${payload.materialType} için %${quantity(payload.wasteRatePct)} fire payı kaydedildi.`,
          error: 'Fire kuralı kaydedilemedi.',
        });
        if (!result.ok) return false;
        actions.patchEntities([patch.upsert('wasteSettings', [result.value], 'start')]);
        void actions.loadWasteSettings();
        refreshAfterCalculationChange();
      }}
    >
      <TextField
        label="Malzeme ailesi"
        value={draft.materialType}
        error={errors.materialType}
        placeholder="Örn. Galvaniz Çelik Boru"
        autoComplete="off"
        disabled={Boolean(setting)}
        hint={setting ? 'Aile adı değiştirilemez; yeni aile için yeni kural ekleyin.' : undefined}
        onChange={(materialType) => setDraft({ ...draft, materialType })}
      />
      {!setting && suggestions.length > 0 && (
        <div className="m-chip-strip m-chip-strip--flush" role="group" aria-label="Kütüphanedeki malzeme aileleri">
          {suggestions.slice(0, 12).map((name) => (
            <button
              key={name}
              type="button"
              className="m-pill"
              onClick={() => {
                haptic('tick');
                setDraft({ ...draft, materialType: name });
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <TextField
        label="Fire payı (%)"
        value={draft.wasteRatePct}
        error={errors.wasteRatePct}
        inputMode="decimal"
        placeholder="5"
        autoComplete="off"
        onChange={(wasteRatePct) => setDraft({ ...draft, wasteRatePct })}
      />
    </FormSheet>
  );
}
