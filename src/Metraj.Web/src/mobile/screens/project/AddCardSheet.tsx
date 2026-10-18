import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import type { CardType, CatalogCard, Placement } from '../../../types';
import { Icon, SearchableList, haptic } from '../../components';
import { BottomSheet, EmptyState, ErrorState, SkeletonList, notify, notifyError } from '../../shell';
import {
  actions,
  draftKey,
  listOf,
  loadKeys,
  patch,
  useAppStore,
  useDraft,
  useLoad,
  usePlacements,
  useResource,
  useSelection,
} from '../../store';
import {
  buildCardList,
  CARD_TYPE_ORDER,
  cardSubtitle,
  cardTypeLabel,
  indexCard,
  parseRecentCodes,
  pushRecent,
  selectableCards,
  type CardListItem,
} from './cardSearch.ts';
import { ChipStrip } from './ChipStrip';
import { addPlacementBody } from './placementOps.ts';
import { useProjectController } from './projectController';
import { isEnterable, nearestPipe } from './treeModel.ts';
import { TypeGlyph } from './TypeGlyph';

type TypeFilter = CardType | 'all';

/**
 * Kart ekleme paneli ("+"). Kütüphane araması Türkçe harf/aksan duyarsızdır,
 * son kullanılanlar önde gelir, tip çipleriyle daraltılır. Eklenecek kart boru
 * (veya boruya bağlı bir kart) altındaysa önce o boruyla uyumlu parçalar
 * gösterilir (`/placements/{id}/compatible-fittings`). Bir satıra dokunmak kartı
 * ekler (tek dokunuş); "Birden çok ekle" açıksa panel açık kalır — bir boruya
 * dirsek, te, vana eklerken her seferinde yeniden açmak gerekmez.
 */
export default function AddCardSheet({
  open,
  parentId,
  onClose,
}: {
  open: boolean;
  parentId: string | null;
  onClose: () => void;
}) {
  const { revisionId } = useSelection();
  const placements = usePlacements(revisionId);
  const controller = useProjectController();
  const table = useAppStore((state) => state.entities.cards);
  const catalogLoad = useLoad(loadKeys.catalog);
  const dataVersion = useAppStore((state) => state.dataVersion);
  const parent = parentId ? (placements.find((item) => item.id === parentId) ?? null) : null;
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [type, setType] = useState<TypeFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const [multi, setMulti] = useDraft<boolean>(draftKey('mobile-add-multi', 'all'), false);
  const [rawRecent, setRecent] = useDraft<unknown>(draftKey('recent-cards', 'all'), []);
  const recentCodes = useMemo(() => parseRecentCodes(rawRecent), [rawRecent]);
  const [adding, setAdding] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  // Katalog ilk açılışta yüklenir (açılışta ek istek yok); sonraki açılışlarda önbellek kullanılır.
  useEffect(() => {
    if (open && !table.ids.length && catalogLoad.status !== 'loading') void actions.loadCatalog();
    if (open) setAddedCount(0);
    // yalnız panel her açıldığında
  }, [open]);

  const cards = useMemo(() => selectableCards(listOf(table)), [table]);
  const pipe = useMemo(() => nearestPipe(placements, parentId), [placements, parentId]);
  // Uyumluluk, borunun girilmiş çaplarına bağlıdır; ölçüm kaydı sonrası (dataVersion) yeniden istenir.
  const compatible = useResource<CatalogCard[]>(open && pipe ? `compat:${pipe.id}:${dataVersion}` : null, () =>
    api.get<CatalogCard[]>(`/placements/${pipe!.id}/compatible-fittings`),
  );
  const compatibleCards = pipe && compatible.status === 'ready' ? (compatible.data ?? []) : null;
  const compatibleMode = Boolean(pipe) && !showAll && compatibleCards !== null;

  const items = useMemo(
    () =>
      buildCardList({
        cards,
        filter: { query: deferredQuery, type: type === 'all' ? '' : type },
        recentCodes,
        compatible: compatibleMode ? compatibleCards : null,
        showAll: !compatibleMode,
      }),
    [cards, deferredQuery, type, recentCodes, compatibleMode, compatibleCards],
  );

  const presentTypes = useMemo(
    () => CARD_TYPE_ORDER.filter((item) => cards.some((card) => card.cardType === item)),
    [cards],
  );

  const add = async (card: CatalogCard) => {
    if (adding || !revisionId) return;
    setAdding(card.id);
    try {
      const created = await actions.withBusy(() =>
        api.post<Placement>(`/revisions/${revisionId}/placements`, addPlacementBody(card, parentId)),
      );
      actions.patchEntities([patch.upsert('placements', [created])]);
      setRecent(pushRecent(recentCodes, card.code));
      setAddedCount((count) => count + 1);
      haptic('confirm');
      if (!multi) onClose();
      // Eklenen kalemin giriş sayfasına tek dokunuşla geçilir.
      notify(`“${created.displayName}” eklendi.`, {
        tone: 'success',
        action: isEnterable(created)
          ? { label: 'Miktar gir', onAction: () => controller.openEntry(created.id) }
          : { label: 'Aç', onAction: () => controller.openLevel(created.id) },
      });
    } catch (error) {
      notifyError(error);
    } finally {
      setAdding(null);
    }
  };

  const typeOptions = [
    { value: 'all' as TypeFilter, label: 'Tümü' },
    ...presentTypes.map((item) => ({ value: item as TypeFilter, label: cardTypeLabel(item) })),
  ];

  const loading = !cards.length && (catalogLoad.status === 'loading' || catalogLoad.status === 'idle');
  const failed = !cards.length && catalogLoad.status === 'error';

  const header = (
    <div className="m-proj-add__header">
      <div className="m-search" role="search">
        <Icon name="search" size={20} />
        <input
          className="m-search__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Kütüphanede ara"
          placeholder="Ad, kod, çap, malzeme…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" className="m-icon-button" aria-label="Aramayı temizle" onClick={() => setQuery('')}>
            <Icon name="close" size={20} />
          </button>
        )}
      </div>
      <ChipStrip<TypeFilter> label="Kart türü" value={type} onChange={setType} options={typeOptions} />
      {pipe && compatibleCards !== null && (
        <ChipStrip<'compatible' | 'all'>
          label="Gösterim"
          value={compatibleMode ? 'compatible' : 'all'}
          onChange={(value) => setShowAll(value === 'all')}
          options={[
            { value: 'compatible', label: `“${pipe.displayName}” ile uyumlu` },
            { value: 'all', label: 'Tüm kartlar' },
          ]}
        />
      )}
      {pipe && compatible.status === 'error' && (
        <p className="m-proj-note" role="status">
          Uyumlu parçalar yüklenemedi; tüm kartlar gösteriliyor.
        </p>
      )}
      <p className="m-visually-hidden" aria-live="polite">
        {items.filter((item) => item.kind === 'card').length} kart
      </p>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Kart ekle"
      description={parent ? `“${parent.displayName}” altına` : 'En üst seviyeye'}
      size="full"
      className="m-proj-add"
      footer={
        <>
          <button
            type="button"
            className={`m-btn ${multi ? 'm-btn--primary' : 'm-btn--secondary'}`}
            aria-pressed={multi}
            onClick={() => setMulti(!multi)}
          >
            Birden çok ekle: {multi ? 'Açık' : 'Kapalı'}
          </button>
          {multi && (
            <button type="button" className="m-btn m-btn--secondary" style={{ flex: 1 }} onClick={onClose}>
              Bitti{addedCount ? ` (${addedCount})` : ''}
            </button>
          )}
        </>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : failed ? (
        <ErrorState message={catalogLoad.error} onRetry={() => void actions.loadCatalog()} />
      ) : (
        <SearchableList<CardListItem>
          items={items}
          getKey={(item) => item.key}
          ariaLabel="Kütüphane kartları"
          estimateSize={68}
          header={header}
          emptyState={
            <EmptyState
              icon="search"
              title={cards.length ? 'Eşleşen kart yok' : 'Kütüphanede kart yok'}
              message={
                cards.length ? 'Aramayı ya da tür filtresini değiştirin.' : 'Kütüphane sekmesinden kart ekleyin.'
              }
            />
          }
          renderItem={(item) =>
            item.kind === 'heading' ? (
              <h3 className="m-proj-add__heading">
                {item.label}
                {item.count !== undefined && <span className="m-muted m-num"> · {item.count}</span>}
              </h3>
            ) : (
              <CardRow card={item.card} busy={adding === item.card.id} disabled={adding !== null} onAdd={add} />
            )
          }
        />
      )}
    </BottomSheet>
  );
}

const CardRow = memo(function CardRow({
  card,
  busy,
  disabled,
  onAdd,
}: {
  card: CatalogCard;
  busy: boolean;
  disabled: boolean;
  onAdd: (card: CatalogCard) => void;
}) {
  const { deckName } = indexCard(card);
  return (
    <button
      type="button"
      className="m-proj-pick"
      disabled={disabled}
      aria-label={`${card.name} ekle`}
      onClick={() => onAdd(card)}
    >
      <TypeGlyph type={card.cardType} />
      <span className="m-proj-pick__text">
        <strong>{card.name}</strong>
        <small>{cardSubtitle(card)}</small>
        <small className="m-proj-row__path">{deckName}</small>
      </span>
      <span className="m-proj-pick__add" aria-hidden="true">
        <Icon name={busy ? 'refresh' : 'plus'} size={22} />
      </span>
    </button>
  );
});
