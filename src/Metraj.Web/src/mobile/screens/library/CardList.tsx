import { useMemo, useState } from 'react';
import { api } from '../../../api';
import type { CardType, CatalogCard, StarterCatalogSeedResult } from '../../../types';
import {
  ActionSheet,
  ChipGrid,
  createSearchIndex,
  Icon,
  SearchableList,
  SwipeRow,
  haptic,
  type SwipeAction,
} from '../../components';
import { BottomSheet, EmptyState, ErrorState, notify, shellActions, SkeletonList } from '../../shell';
import { actions } from '../../store';
import { DeleteCardSheet, deactivateCard } from './cardActions';
import {
  buildLibraryItems,
  cardSubtitle,
  countActiveFilters,
  DEFAULT_FILTERS,
  describeFilters,
  domainFacets,
  filterItems,
  statusFacets,
  typeFacets,
  type LibraryFilters,
  type LibraryItem,
  type StatusFilter,
  type TypeFilter,
} from './libraryModel';
import { perform } from './shared/perform';
import { useCatalog } from './useCatalog';

const TYPE_CLASS: Record<CardType, string> = {
  Category: 'category',
  Scope: 'scope',
  System: 'system',
  Material: 'material',
  Accessory: 'accessory',
};

export function CardList() {
  const { cards, types, load } = useCatalog();
  const items = useMemo(() => buildLibraryItems(cards), [cards]);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<'filters' | 'more' | null>(null);
  const [menuCard, setMenuCard] = useState<CatalogCard | null>(null);
  const [deleting, setDeleting] = useState<CatalogCard | null>(null);
  const [seedResult, setSeedResult] = useState<StarterCatalogSeedResult | null>(null);

  const visible = useMemo(() => filterItems(items, filters), [items, filters]);
  const searchIndex = useMemo(() => createSearchIndex<LibraryItem>((item) => item.searchText), []);
  const shownCount = useMemo(() => searchIndex(visible, query).length, [searchIndex, visible, query]);
  const typeOptions = useMemo(() => typeFacets(items, filters, types), [items, filters, types]);
  const domainOptions = useMemo(() => domainFacets(items, filters), [items, filters]);
  const statusOptions = useMemo(() => statusFacets(items), [items]);
  const activeFilterCount = countActiveFilters(filters);

  if (!cards.length && (load.status === 'loading' || load.status === 'idle')) return <SkeletonList />;
  if (!cards.length && load.status === 'error')
    return <ErrorState message={load.error} onRetry={() => void actions.loadCatalog()} />;

  const openCard = (card: CatalogCard) => {
    haptic('tick');
    shellActions.push({ screen: 'card', params: { id: card.id } }, 'library');
  };
  const editCard = (card: CatalogCard) =>
    shellActions.push({ screen: 'card-form', params: { id: card.id } }, 'library');
  const newCard = () => shellActions.push({ screen: 'card-form' }, 'library');

  const seedStarterPack = async () => {
    const result = await perform(() => api.post<StarterCatalogSeedResult>('/catalog/starter-pack'), {
      error: 'Standart kartlar tamamlanamadı.',
    });
    if (!result.ok) return;
    void actions.loadCatalog();
    if (result.value.addedCount) setSeedResult(result.value);
    else notify('Standart kütüphane zaten tam; eklenecek kart yok.');
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setQuery('');
  };

  const actionsFor = (card: CatalogCard): SwipeAction[] => [
    ...(card.isActive
      ? [{ id: 'deactivate', label: 'Pasife al', icon: 'close' as const, onAction: () => deactivateCard(card) }]
      : []),
    { id: 'delete', label: 'Sil', icon: 'trash' as const, tone: 'danger' as const, onAction: () => setDeleting(card) },
  ];

  const typeLabel = typeOptions.find((option) => option.value === filters.type)?.label ?? null;
  const domainLabel = domainOptions.find((option) => option.value === filters.domain)?.label ?? null;

  return (
    <div className="m-screen m-lib">
      <SearchableList<LibraryItem>
        items={visible}
        getKey={(item) => item.card.id}
        ariaLabel="Kart kütüphanesi"
        searchText={(item) => item.searchText}
        searchPlaceholder="Kütüphanede ara (ör. dirsek ppr 25)"
        query={query}
        onQueryChange={setQuery}
        estimateSize={72}
        header={
          <div className="m-lib-head">
            <div className="m-chip-strip" role="group" aria-label="Kart türüne göre süz">
              <button
                type="button"
                className="m-pill m-pill--filter"
                onClick={() => setSheet('filters')}
                aria-haspopup="dialog"
                aria-label={
                  activeFilterCount ? `Süzgeçler, ${activeFilterCount} etkin` : 'Süzgeçler: durum ve tesisat alanı'
                }
              >
                <Icon name="search" size={18} />
                Süzgeçler
                {activeFilterCount > 0 && <span className="m-pill__count m-num">{activeFilterCount}</span>}
              </button>
              {typeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="m-pill"
                  aria-pressed={filters.type === option.value}
                  onClick={() => {
                    haptic('tick');
                    setFilters({ ...filters, type: option.value as TypeFilter });
                  }}
                >
                  {option.label}
                  <span className="m-pill__count m-num">{option.count}</span>
                </button>
              ))}
            </div>
            <p className="m-list-caption" role="status" aria-live="polite">
              {shownCount === items.length ? `${items.length} kart` : `${shownCount} / ${items.length} kart`}
              {filters.status === 'all'
                ? ' · pasifler dahil'
                : filters.status === 'inactive'
                  ? ' · yalnız pasifler'
                  : ''}
            </p>
          </div>
        }
        bottomPadding={16}
        emptyState={
          // Süzgeç sonucu boşsa "kütüphane boş" denmez; o durumu `noResultsState` karşılar.
          items.length ? undefined : (
            <EmptyState
              icon="library"
              title="Kütüphane boş"
              message="Standart kartları yükleyin ya da kendi kartınızı oluşturun."
              action={
                <>
                  <button type="button" className="m-btn m-btn--primary" onClick={() => void seedStarterPack()}>
                    Standart kartları yükle
                  </button>
                  <button type="button" className="m-btn m-btn--secondary" onClick={newCard}>
                    Yeni kart
                  </button>
                </>
              }
            />
          )
        }
        noResultsState={
          <EmptyState
            icon="search"
            title="Eşleşen kart yok"
            message={describeFilters(filters, typeLabel, domainLabel, query) || 'Başka bir sözcükle deneyin.'}
            action={
              <button type="button" className="m-btn m-btn--secondary" onClick={clearFilters}>
                Aramayı ve süzgeçleri temizle
              </button>
            }
          />
        }
        renderItem={(item) => (
          <SwipeRow
            actions={actionsFor(item.card)}
            onPress={() => openCard(item.card)}
            onLongPress={() => setMenuCard(item.card)}
            ariaLabel={`${item.card.name}, ${cardSubtitle(item)}`}
          >
            <div className={`m-card-row${item.card.isActive ? '' : ' is-inactive'}`}>
              <span className={`m-type-dot m-type-dot--${TYPE_CLASS[item.card.cardType]}`} aria-hidden="true" />
              <span className="m-card-row__text">
                <strong>{item.card.name}</strong>
                <small>{cardSubtitle(item)}</small>
              </span>
              <Icon name="chevronRight" size={20} className="m-tree-row__chevron" />
            </div>
          </SwipeRow>
        )}
      />
      <div className="m-bottom-actions m-bottom-actions--row">
        <button type="button" className="m-btn m-btn--primary m-btn--large" onClick={newCard}>
          <Icon name="plus" size={20} />
          Yeni kart
        </button>
        <button
          type="button"
          className="m-btn m-btn--secondary m-btn--large"
          onClick={() => setSheet('more')}
          aria-haspopup="dialog"
        >
          <Icon name="more" size={20} />
          Diğer
        </button>
      </div>

      <FilterSheet
        open={sheet === 'filters'}
        onClose={() => setSheet(null)}
        filters={filters}
        onChange={setFilters}
        statusOptions={statusOptions}
        domainOptions={domainOptions}
      />
      <ActionSheet
        open={sheet === 'more'}
        onClose={() => setSheet(null)}
        title="Kütüphane"
        actions={[
          {
            id: 'starter',
            label: 'Eksik standartları tamamla',
            description: 'Standart kartlardan kütüphanede olmayanları ekler; sizin kartlarınıza dokunmaz.',
            icon: 'download',
            onSelect: () => void seedStarterPack(),
          },
          {
            id: 'types',
            label: 'Özel kart türleri',
            description: 'Kendi kart şablonlarınızı görün, ekleyin ya da kaldırın.',
            icon: 'library',
            onSelect: () => shellActions.push({ screen: 'types' }, 'library'),
          },
          {
            id: 'new-type',
            label: 'Yeni kart türü',
            icon: 'plus',
            onSelect: () => shellActions.push({ screen: 'type-form' }, 'library'),
          },
        ]}
      />
      <ActionSheet
        open={menuCard !== null}
        onClose={() => setMenuCard(null)}
        title={menuCard?.name ?? 'Kart'}
        description={menuCard?.code}
        actions={
          menuCard
            ? [
                { id: 'open', label: 'Ayrıntıları aç', icon: 'chevronRight', onSelect: () => openCard(menuCard) },
                {
                  id: 'edit',
                  label: 'Düzenle (yeni sürüm)',
                  icon: 'edit',
                  disabled: !menuCard.isActive,
                  description: menuCard.isActive ? undefined : 'Pasif karta yeni sürüm eklenemez.',
                  onSelect: () => editCard(menuCard),
                },
                ...(menuCard.isActive
                  ? [
                      {
                        id: 'deactivate',
                        label: 'Pasife al',
                        icon: 'close' as const,
                        description: 'Yeni projelerde seçilemez; mevcut kullanımlar korunur.',
                        onSelect: () => deactivateCard(menuCard),
                      },
                    ]
                  : []),
                {
                  id: 'delete',
                  label: 'Sil',
                  icon: 'trash',
                  tone: 'danger' as const,
                  onSelect: () => setDeleting(menuCard),
                },
              ]
            : []
        }
      />
      <DeleteCardSheet card={deleting} onClose={() => setDeleting(null)} />
      <SeedResultSheet result={seedResult} onClose={() => setSeedResult(null)} />
    </div>
  );
}

function FilterSheet({
  open,
  onClose,
  filters,
  onChange,
  statusOptions,
  domainOptions,
}: {
  open: boolean;
  onClose: () => void;
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
  statusOptions: ReturnType<typeof statusFacets>;
  domainOptions: ReturnType<typeof domainFacets>;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Süzgeçler"
      size="tall"
      footer={
        <>
          <button
            type="button"
            className="m-btn m-btn--secondary m-btn--large"
            onClick={() => onChange({ ...DEFAULT_FILTERS, type: filters.type })}
          >
            Temizle
          </button>
          <button type="button" className="m-btn m-btn--primary m-btn--large" onClick={onClose}>
            Tamam
          </button>
        </>
      }
    >
      <div className="m-lib-filter-sheet">
        <h3 className="m-section__subtitle">Durum</h3>
        <ChipGrid
          mode="single"
          label="Kart durumu"
          columns={3}
          value={filters.status}
          onChange={(value) => onChange({ ...filters, status: value as StatusFilter })}
          options={statusOptions.map((option) => ({
            value: option.value,
            label: option.label,
            hint: `${option.count} kart`,
          }))}
        />
        <h3 className="m-section__subtitle">Tesisat alanı</h3>
        <ChipGrid
          mode="single"
          label="Tesisat alanı"
          value={filters.domain || 'all'}
          onChange={(value) => onChange({ ...filters, domain: value === 'all' ? '' : value })}
          options={[
            { value: 'all', label: 'Tüm alanlar' },
            ...domainOptions.map((option) => ({
              value: option.value,
              label: option.label,
              hint: `${option.count} kart`,
            })),
          ]}
        />
      </div>
    </BottomSheet>
  );
}

function SeedResultSheet({ result, onClose }: { result: StarterCatalogSeedResult | null; onClose: () => void }) {
  const shown = result?.addedCodes.slice(0, 30) ?? [];
  const rest = result ? result.addedCodes.length - shown.length : 0;
  return (
    <BottomSheet
      open={result !== null}
      onClose={onClose}
      title="Standart kartlar tamamlandı"
      size="tall"
      footer={
        <button type="button" className="m-btn m-btn--primary m-btn--large m-btn--block" onClick={onClose}>
          Tamam
        </button>
      }
    >
      {result && (
        <div className="m-confirm" role="status">
          <p>
            <strong className="m-num">{result.addedCount}</strong> standart kart kütüphaneye eklendi;{' '}
            <strong className="m-num">{result.existingCount}</strong> kart zaten vardı.
          </p>
          {shown.length > 0 && (
            <>
              <h3 className="m-section__subtitle">Eklenen kodlar</h3>
              <ul className="m-code-list">
                {shown.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              {rest > 0 && <p className="m-muted">… ve {rest} kart daha.</p>}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
