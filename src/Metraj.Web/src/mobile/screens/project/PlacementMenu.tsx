import { useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import type { Placement } from '../../../types';
import { ActionSheet, Icon, SearchableList, haptic, type ActionSheetAction } from '../../components';
import { BottomSheet, EmptyState, notify, notifyError, notifySuccess } from '../../shell';
import {
  actions,
  appStore,
  listOf,
  patch,
  removeWithUndo,
  runOptimistic,
  useAppStore,
  useIsRevisionLocked,
  usePlacements,
  useSelection,
} from '../../store';
import { removalOps } from './entrySave.ts';
import {
  appliedProperties,
  calculatedFromBody,
  checkCalculationLink,
  linkSources,
  moveBody,
  updatePlacementBody,
} from './placementOps.ts';
import type { MenuMode } from './projectController';
import { useProjectController } from './projectController';
import { buildChildIndex, descendantIds, isEnterable, moveTargets, searchEntries } from './treeModel.ts';
import { TypeGlyph } from './TypeGlyph';

/**
 * Kartın uzun basma / "⋮" menüsü ve eylemlerin alt panelleri: yeniden adlandır
 * ve özellikler, taşı (ağaç seçiciyle hedef ebeveyn), alt kart ekle, hesap bağı
 * kur, rapor kapsamı yap ve sil (geri al ile). Onaylı revizyonda yazma eylemleri
 * menüde hiç görünmez (sunucu da reddeder).
 */
export default function PlacementMenu({
  open,
  placementId,
  initialMode,
  onClose,
  onReportScope,
}: {
  open: boolean;
  placementId: string;
  initialMode: MenuMode;
  onClose: () => void;
  onReportScope: (placementId: string) => void;
}) {
  const placement = useAppStore((state) => state.entities.placements.byId.get(placementId) ?? null);
  const { revisionId } = useSelection();
  const placements = usePlacements(revisionId);
  const locked = useIsRevisionLocked();
  const controller = useProjectController();
  const [mode, setMode] = useState<MenuMode>(initialMode);
  // ActionSheet seçimde önce onClose, sonra onSelect çağırır. Alt panel açılacaksa menü bütünüyle kapanmamalı.
  const switching = useRef(false);

  if (!placement) return null;

  const goto = (next: MenuMode) => {
    switching.current = true;
    setMode(next);
  };

  const remove = () => {
    const state = appStore.getState();
    const index = buildChildIndex(placements);
    const ids = [...descendantIds(index, placement.id)];
    removeWithUndo(appStore, {
      ops: removalOps(ids, listOf(state.entities.measurements), listOf(state.entities.summaries)),
      commit: () => api.delete(`/placements/${placement.id}`),
      message:
        ids.length > 1
          ? `“${placement.displayName}” ve altındaki ${ids.length - 1} kart silindi.`
          : `“${placement.displayName}” silindi.`,
      onCommitted: () => {
        void actions.refreshRevision();
        if (revisionId) actions.invalidateResources(`report:${revisionId}`);
      },
    });
  };

  const menuActions: ActionSheetAction[] = [];
  if (isEnterable(placement))
    menuActions.push({
      id: 'entry',
      label: 'Giriş sayfasını aç',
      description: 'Miktar, çap, adet ve geçmiş',
      icon: 'edit',
      onSelect: () => controller.openEntry(placement.id),
    });
  menuActions.push({
    id: 'level',
    label: 'Alt kartları aç',
    description: 'Bu kartın altındaki kartlar',
    icon: 'chevronRight',
    onSelect: () => controller.openLevel(placement.id),
  });
  if (!locked)
    menuActions.push(
      {
        id: 'rename',
        label: 'Yeniden adlandır / özellikler',
        description: 'Görünen ad, satın alma kapsamı, not',
        icon: 'edit',
        onSelect: () => goto('rename'),
      },
      {
        id: 'add',
        label: 'Alt kart ekle',
        description: 'Kütüphaneden bu kartın altına',
        icon: 'plus',
        onSelect: () => controller.addCard(placement.id),
      },
      {
        id: 'move',
        label: 'Taşı',
        description: 'Başka bir kartın altına al',
        icon: 'upload',
        onSelect: () => goto('move'),
      },
      {
        id: 'link',
        label: 'Hesap bağı kur',
        description: 'Miktarı başka bir karttan hesaplanır yap',
        icon: 'refresh',
        onSelect: () => goto('link'),
      },
    );
  menuActions.push({
    id: 'scope',
    label: 'Rapor kapsamı yap',
    description: 'Çıktı sekmesinde yalnız bu dalı raporla',
    icon: 'output',
    onSelect: () => onReportScope(placement.id),
  });
  if (!locked)
    menuActions.push({
      id: 'delete',
      label: 'Sil',
      description: 'Altındakilerle birlikte; birkaç saniye geri alınabilir',
      icon: 'trash',
      tone: 'danger',
      onSelect: remove,
    });

  return (
    <>
      <ActionSheet
        open={open && mode === 'menu'}
        onClose={() => {
          // Aynı tıklamada çalışan onSelect'in `switching` işaretini koyması için bir sonraki mikro göreve ertelenir.
          queueMicrotask(() => {
            if (switching.current) {
              switching.current = false;
              return;
            }
            onClose();
          });
        }}
        title={placement.displayName}
        description={placement.cardCode}
        actions={menuActions}
      />
      {mode === 'rename' && <RenameSheet open={open} placement={placement} locked={locked} onClose={onClose} />}
      {mode === 'move' && <MoveSheet open={open} placement={placement} onClose={onClose} />}
      {mode === 'link' && <LinkSheet open={open} placement={placement} onClose={onClose} />}
    </>
  );
}

/** Kullanıcının düzeltebileceği bir ön koşul hatası: istek gönderilmez, titreşim + hata çubuğu. */
function reject(message: string) {
  haptic('reject');
  notify(message, { tone: 'error' });
}

function RenameSheet({
  open,
  placement,
  locked,
  onClose,
}: {
  open: boolean;
  placement: Placement;
  locked: boolean;
  onClose: () => void;
}) {
  const [values, setValues] = useState({
    displayName: placement.displayName,
    procurementScope: placement.procurementScope ?? '',
    notes: placement.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (locked || saving) return;
    if (!values.displayName.trim()) {
      reject('Görünen ad boş olamaz; “Kart adına dön” ile varsayılana çevirebilirsiniz.');
      return;
    }
    const body = updatePlacementBody(placement, values);
    setSaving(true);
    const outcome = await runOptimistic(appStore, {
      ops: [patch.upsert('placements', [appliedProperties(placement, body)])],
      request: () => api.put(`/placements/${placement.id}`, body),
    });
    setSaving(false);
    if (outcome.ok) {
      notifySuccess('Kart özellikleri kaydedildi.');
      onClose();
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Özellikler"
      description={`${placement.cardCode} · ${placement.cardName}`}
      dismissible={!saving}
      footer={
        locked ? undefined : (
          <>
            <button type="button" className="m-btn m-btn--secondary m-btn--large" disabled={saving} onClick={onClose}>
              Vazgeç
            </button>
            <button
              type="button"
              className="m-btn m-btn--primary m-btn--large"
              style={{ flex: 1 }}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        )
      }
    >
      <form
        className="m-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="m-field">
          <span className="m-field__label">Görünen ad</span>
          <input
            className="m-input"
            value={values.displayName}
            maxLength={256}
            disabled={locked}
            onChange={(event) => set('displayName')(event.target.value)}
          />
          {values.displayName !== placement.cardName && !locked && (
            <button
              type="button"
              className="m-btn m-btn--ghost m-btn--small"
              onClick={() => set('displayName')(placement.cardName)}
            >
              Kart adına dön
            </button>
          )}
        </label>
        <label className="m-field">
          <span className="m-field__label">Satın alma kapsamı</span>
          <input
            className="m-input"
            value={values.procurementScope}
            maxLength={128}
            disabled={locked}
            placeholder="Örn. Yüklenici / İşveren"
            onChange={(event) => set('procurementScope')(event.target.value)}
          />
        </label>
        <label className="m-field">
          <span className="m-field__label">Bu karta özel not</span>
          <textarea
            className="m-input m-proj-textarea"
            value={values.notes}
            rows={3}
            disabled={locked}
            placeholder="Örn. 120 kW, marka/model, pompa basıncı…"
            onChange={(event) => set('notes')(event.target.value)}
          />
        </label>
        {locked && <p className="m-muted">Revizyon onaylı olduğu için değiştirilemez.</p>}
      </form>
    </BottomSheet>
  );
}

/** Ağaç seçiciyle hedef ebeveyn: taşınan kart ve altındakiler listede yoktur. */
function MoveSheet({ open, placement, onClose }: { open: boolean; placement: Placement; onClose: () => void }) {
  const { revisionId } = useSelection();
  const placements = usePlacements(revisionId);
  const targets = useMemo(() => moveTargets(placements, placement.id), [placements, placement.id]);
  const [busy, setBusy] = useState(false);
  const currentParent = placement.parentPlacementId ?? null;

  const move = async (parentId: string | null, name: string) => {
    if (busy) return;
    if (parentId === currentParent) {
      notify('Kart zaten burada.');
      return;
    }
    setBusy(true);
    // Hedef ebeveyn kuralları (tip uyumu, döngü) sunucudadır; reddederse mesajı gösterilir ve satır eski yerine döner.
    const outcome = await runOptimistic(appStore, {
      ops: [patch.upsert('placements', [{ ...placement, parentPlacementId: parentId }])],
      request: () => api.put(`/placements/${placement.id}/parent`, moveBody(parentId)),
    });
    setBusy(false);
    if (outcome.ok) {
      haptic('confirm');
      notifySuccess(`“${placement.displayName}” ${parentId ? `“${name}” altına` : 'kök seviyeye'} taşındı.`);
      onClose();
    }
  };

  type Item = { key: string; placement: Placement | null; depth: number; isCurrent: boolean };
  const items: Item[] = [
    { key: 'root', placement: null, depth: 0, isCurrent: currentParent === null },
    ...targets.map((target) => ({
      key: target.placement.id,
      placement: target.placement,
      depth: target.depth + 1,
      isCurrent: target.isCurrentParent,
    })),
  ];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Nereye taşınsın?"
      description={`“${placement.displayName}” ve altındakiler seçtiğiniz kartın altına geçer.`}
      size="tall"
      dismissible={!busy}
      className="m-proj-listsheet"
    >
      <SearchableList<Item>
        items={items}
        getKey={(item) => item.key}
        ariaLabel="Taşıma hedefleri"
        searchText={(item) =>
          item.placement ? `${item.placement.displayName} ${item.placement.cardCode}` : 'kök en üst düzey'
        }
        searchPlaceholder="Hedefte ara"
        estimateSize={60}
        emptyState={<EmptyState icon="search" title="Hedef yok" />}
        noResultsState={<EmptyState icon="search" title="Eşleşen hedef yok" />}
        renderItem={(item) => (
          <button
            type="button"
            className="m-proj-pick"
            style={{ ['--m-depth' as string]: Math.min(item.depth, 8) }}
            disabled={busy}
            aria-current={item.isCurrent ? 'true' : undefined}
            onClick={() => void move(item.placement?.id ?? null, item.placement?.displayName ?? '')}
          >
            {item.placement ? <TypeGlyph type={item.placement.cardType} /> : <Icon name="project" size={22} />}
            <span className="m-proj-pick__text">
              <strong>{item.placement?.displayName ?? 'Kök (en üst düzey)'}</strong>
              <small>{item.placement?.cardCode ?? 'Hiçbir kartın altında olmasın'}</small>
            </span>
            {item.isCurrent && <span className="m-badge">Şu an burada</span>}
          </button>
        )}
      />
    </BottomSheet>
  );
}

/** `calculated-from` bağı: seçilen kaynaktan bu kartın miktarı hesaplanır. */
function LinkSheet({ open, placement, onClose }: { open: boolean; placement: Placement; onClose: () => void }) {
  const { revisionId } = useSelection();
  const placements = usePlacements(revisionId);
  const entries = useMemo(() => {
    const ids = new Set(linkSources(placements, placement.id).map((item) => item.id));
    return searchEntries(placements).filter((entry) => ids.has(entry.placement.id));
  }, [placements, placement.id]);
  const [busy, setBusy] = useState(false);

  const link = async (sourceId: string, name: string) => {
    const check = checkCalculationLink(placement.id, sourceId);
    if (!check.ok) {
      reject(check.error);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await actions.withBusy(() =>
        api.post(`/placements/${placement.id}/calculated-from`, calculatedFromBody(sourceId)),
      );
      notifySuccess(`Hesap kaynağı bağlandı: “${name}”. Öneriyi Ayarlar › hesap kontrolünde üretebilirsiniz.`);
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Hesap kaynağı seç"
      description={`“${placement.displayName}” hangi kartın miktarından hesaplansın?`}
      size="tall"
      dismissible={!busy}
      className="m-proj-listsheet"
    >
      <SearchableList
        items={entries}
        getKey={(entry) => entry.placement.id}
        ariaLabel="Kaynak kartlar"
        searchText={(entry) => entry.folded}
        searchPlaceholder="Kaynak kartta ara"
        estimateSize={64}
        emptyState={
          <EmptyState icon="search" title="Kaynak olabilecek kart yok" message="Ölçülebilir bir kart ekleyin." />
        }
        noResultsState={<EmptyState icon="search" title="Eşleşen kart yok" />}
        renderItem={(entry) => (
          <button
            type="button"
            className="m-proj-pick"
            disabled={busy}
            onClick={() => void link(entry.placement.id, entry.placement.displayName)}
          >
            <TypeGlyph type={entry.placement.cardType} />
            <span className="m-proj-pick__text">
              <strong>{entry.placement.displayName}</strong>
              <small>{entry.path || entry.placement.cardCode}</small>
            </span>
          </button>
        )}
      />
    </BottomSheet>
  );
}
