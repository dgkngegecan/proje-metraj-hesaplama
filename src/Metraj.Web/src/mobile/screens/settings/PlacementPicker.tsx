import type { Placement } from '../../../types';
import { Icon, SearchableList, haptic } from '../../components';
import { BottomSheet, EmptyState } from '../../shell';

const TYPE_CLASS: Record<Placement['cardType'], string> = {
  Category: 'category',
  Scope: 'scope',
  System: 'system',
  Material: 'material',
  Accessory: 'accessory',
};

/** Seçici alanı: etiket + seçili değer + açılır panel göstergesi (≥56 dp). */
export function PickerField({
  label,
  value,
  placeholder,
  onClick,
  disabled,
  error,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onClick: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <div className="m-field">
      <span className="m-field__label">{label}</span>
      <button
        type="button"
        className={`m-picker-field${value ? '' : ' is-empty'}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-invalid={error ? true : undefined}
        aria-label={`${label}: ${value ?? placeholder}. Seç`}
        onClick={onClick}
      >
        <span>{value ?? placeholder}</span>
        <Icon name="chevronDown" size={20} />
      </button>
      {error && (
        <small className="m-field__error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/** Revizyondaki kartlardan birini seçtirir (aramalı, sanallaştırılmış). */
export function PlacementPicker({
  open,
  onClose,
  title,
  placements,
  selectedId,
  excludeId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  placements: readonly Placement[];
  selectedId: string;
  excludeId?: string;
  onSelect: (placement: Placement) => void;
}) {
  const items = excludeId ? placements.filter((placement) => placement.id !== excludeId) : placements;
  return (
    <BottomSheet open={open} onClose={onClose} title={title} size="full">
      <div className="m-picker-list">
        <SearchableList<Placement>
          items={items}
          getKey={(placement) => placement.id}
          ariaLabel="Kartlar"
          searchText={(placement) => `${placement.displayName} ${placement.cardName} ${placement.cardCode}`}
          searchPlaceholder="Kartlarda ara"
          estimateSize={64}
          emptyState={
            <EmptyState icon="project" title="Seçilebilir kart yok" message="Önce Proje sekmesinde kart ekleyin." />
          }
          noResultsState={<EmptyState icon="search" title="Eşleşen kart yok" />}
          renderItem={(placement) => (
            <button
              type="button"
              className="m-tree-row"
              aria-pressed={placement.id === selectedId}
              onClick={() => {
                haptic('tick');
                onSelect(placement);
                onClose();
              }}
            >
              <span className={`m-type-dot m-type-dot--${TYPE_CLASS[placement.cardType]}`} aria-hidden="true" />
              <span className="m-tree-row__text">
                <strong>{placement.displayName}</strong>
                <small>{placement.cardCode}</small>
              </span>
              {placement.id === selectedId && <Icon name="check" label="Seçili" />}
            </button>
          )}
        />
      </div>
    </BottomSheet>
  );
}
