import { useMemo } from 'react';
import { api } from '../../../api';
import type { CatalogCard, CatalogCardAttributeDescriptor, CatalogCardType, CatalogCardVersion } from '../../../types';
import { listOf, loadKeys, useAppStore, useLoad, useResource } from '../../store';

/** Depodaki katalog (kartlar + özel türler) ve yükleme durumu. Kartlar açılışta değil, ekran açılınca yüklenir. */
export function useCatalog() {
  const cardsTable = useAppStore((state) => state.entities.cards);
  const typesTable = useAppStore((state) => state.entities.catalogTypes);
  const load = useLoad(loadKeys.catalog);
  const cards: readonly CatalogCard[] = useMemo(() => listOf(cardsTable), [cardsTable]);
  const types: readonly CatalogCardType[] = useMemo(() => listOf(typesTable), [typesTable]);
  return { cards, types, load, cardsTable };
}

/** `GET /catalog/attributes`: sabit liste, bir kez yüklenir ve önbellekte kalır. */
export function useCatalogAttributes() {
  return useResource('catalog-attributes', () => api.get<CatalogCardAttributeDescriptor[]>('/catalog/attributes'));
}

/**
 * `GET /catalog/cards/{id}/versions`: kartın sürüm geçmişi, en yeni önce. Anahtarda güncel
 * sürüm numarası var: düzenleme yeni sürüm oluşturunca geçmiş kendiliğinden yeniden istenir.
 */
export function useCardVersions(card: Pick<CatalogCard, 'id' | 'latestVersion'> | undefined) {
  return useResource(card && `catalog-card-versions:${card.id}:v${card.latestVersion}`, () =>
    api.get<CatalogCardVersion[]>(`/catalog/cards/${card!.id}/versions`),
  );
}

/** Tek kart; silinmiş/bulunamayan için `undefined`. */
export function useCatalogCard(id: string | null | undefined) {
  return useAppStore((state) => (id ? state.entities.cards.byId.get(id) : undefined));
}
