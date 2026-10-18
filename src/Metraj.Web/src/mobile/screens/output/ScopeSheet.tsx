import type { Placement } from '../../../types';
import { Icon, SearchableList, haptic } from '../../components';
import { BottomSheet, EmptyState } from '../../shell';
import { usePlacementTree, type PlacementTreeRow } from '../../store';

const TYPE_CLASS: Record<Placement['cardType'], string> = {
  Category: 'category',
  Scope: 'scope',
  System: 'system',
  Material: 'material',
  Accessory: 'accessory',
};

/**
 * Rapor kapsamı seçici: proje ağacından bir kart seçilir, rapor o kart ve altındakilerle
 * sınırlanır (masaüstündeki "Bu kartın metrajı"). Ağaç aramalı ve sanallaştırılmıştır.
 */
export function ScopeSheet({
  open,
  onClose,
  revisionId,
  currentId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  revisionId: string | null;
  currentId: string | null;
  onSelect: (placementId: string | null) => void;
}) {
  const rows = usePlacementTree(revisionId);
  const choose = (id: string | null) => {
    haptic('tick');
    onSelect(id);
    onClose();
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Rapor kapsamı"
      size="full"
      description="Raporu bir kart ve altındakilerle sınırlayın."
    >
      <div className="m-out-scope">
        <SearchableList<PlacementTreeRow>
          items={rows}
          getKey={(row) => row.placement.id}
          ariaLabel="Proje ağacı"
          searchText={(row) => `${row.placement.displayName} ${row.placement.cardName} ${row.placement.cardCode}`}
          searchPlaceholder="Kartlarda ara"
          estimateSize={64}
          header={
            <button
              type="button"
              className="m-tree-row m-out-scope__all"
              aria-pressed={currentId === null}
              onClick={() => choose(null)}
            >
              <Icon name="project" size={20} />
              <span className="m-tree-row__text">
                <strong>Bütün proje</strong>
                <small>Bütün kartlar</small>
              </span>
              {currentId === null && <Icon name="check" label="Seçili" />}
            </button>
          }
          emptyState={<EmptyState icon="project" title="Bu revizyonda kart yok" />}
          noResultsState={<EmptyState icon="search" title="Eşleşen kart yok" message="Başka bir sözcükle deneyin." />}
          renderItem={(row) => (
            <button
              type="button"
              className="m-tree-row"
              style={{ ['--m-depth' as string]: Math.min(row.depth, 8) }}
              aria-pressed={currentId === row.placement.id}
              onClick={() => choose(row.placement.id)}
            >
              <span className={`m-type-dot m-type-dot--${TYPE_CLASS[row.placement.cardType]}`} aria-hidden="true" />
              <span className="m-tree-row__text">
                <strong>{row.placement.displayName}</strong>
                <small>
                  {row.placement.cardCode}
                  {row.childCount ? ` · ${row.childCount} alt kart` : ''}
                </small>
              </span>
              {currentId === row.placement.id && <Icon name="check" label="Seçili" />}
            </button>
          )}
        />
      </div>
    </BottomSheet>
  );
}
