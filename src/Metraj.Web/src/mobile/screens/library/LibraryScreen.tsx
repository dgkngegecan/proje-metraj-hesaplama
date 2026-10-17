import { useEffect, useMemo } from 'react';
import { TYPE_META } from '../../../lib/cardTypes.ts';
import type { CatalogCard } from '../../../types';
import { SearchableList } from '../../components';
import { EmptyState, ErrorState, SkeletonList } from '../../shell';
import { actions, appStore, listOf, loadKeys, useAppStore, useLoad } from '../../store';

/*
 * YER TUTUCU — Dalga 2'de Ajan 6 bu klasörü doldurur (desteler, kart
 * düzenleyici, tipler, eksik standartları tamamla, pasife al / sil + geri al).
 * `lib/catalogDecks.ts` artık React Flow'a bağlı değil; deste gruplaması
 * buradan doğrudan kullanılabilir. Buradaki sürüm: depodaki katalog, Türkçe
 * duyarlı aramalı sanallaştırılmış liste.
 */

const TYPE_CLASS: Record<CatalogCard['cardType'], string> = {
  Category: 'category',
  Scope: 'scope',
  System: 'system',
  Material: 'material',
  Accessory: 'accessory',
};

export default function LibraryScreen() {
  const cardsTable = useAppStore((state) => state.entities.cards);
  const load = useLoad(loadKeys.catalog);
  const cards = useMemo(
    () =>
      [...listOf(cardsTable)].sort(
        (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'tr'),
      ),
    [cardsTable],
  );

  useEffect(() => {
    // Katalog açılışta yüklenmez (açılış bütçesi); kütüphane ilk açıldığında gelir.
    const status = appStore.getState().loads[loadKeys.catalog]?.status;
    if (!status || status === 'idle') void actions.loadCatalog();
  }, []);

  if (!cards.length && (load.status === 'loading' || load.status === 'idle')) return <SkeletonList />;
  if (!cards.length && load.status === 'error')
    return <ErrorState message={load.error} onRetry={() => void actions.loadCatalog()} />;

  return (
    <div className="m-screen">
      <SearchableList<CatalogCard>
        items={cards}
        getKey={(card) => card.id}
        ariaLabel="Kart kütüphanesi"
        searchText={(card) => `${card.name} ${card.code} ${card.materialType ?? ''} ${TYPE_META[card.cardType].label}`}
        searchPlaceholder="Kütüphanede ara (ör. dirsek ppr 25)"
        header={<p className="m-list-caption">{cards.length} kart</p>}
        emptyState={
          <EmptyState
            icon="library"
            title="Kütüphane boş"
            message="Standart kartlar yüklendiğinde burada listelenir."
          />
        }
        noResultsState={<EmptyState icon="search" title="Eşleşen kart yok" message="Başka bir sözcükle deneyin." />}
        renderItem={(card) => (
          <div className={`m-card-row${card.isActive ? '' : ' is-inactive'}`}>
            <span className={`m-type-dot m-type-dot--${TYPE_CLASS[card.cardType]}`} aria-hidden="true" />
            <span className="m-card-row__text">
              <strong>{card.name}</strong>
              <small>
                {TYPE_META[card.cardType].label} · {card.code} · {card.unit}
                {card.isActive ? '' : ' · pasif'}
              </small>
            </span>
          </div>
        )}
      />
    </div>
  );
}
