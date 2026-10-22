import type { ReactNode } from 'react';
import { BottomSheet } from '../shell/BottomSheet';
import { Icon, type IconName } from './Icon';
import { haptic } from './haptics.ts';

export interface ActionSheetAction {
  id: string;
  label: string;
  description?: string;
  icon?: IconName;
  tone?: 'danger' | 'default';
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Eylem paneli (uzun basma menüsü). Her eylem 56 px yüksekliğinde bir satır.
 * Seçimde önce panel kapanır (odak açan öğeye döner), sonra eylem çalışır.
 * Silme gibi yıkıcı eylemler burada onay İSTEMEZ; çağıran `removeWithUndo`
 * ile "Geri al" çubuğunu gösterir.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  description,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  actions: readonly ActionSheetAction[];
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title} description={description}>
      <div className="m-action-list" role="menu" aria-label={title}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className={`m-action-row${action.tone === 'danger' ? ' m-action-row--danger' : ''}`}
            disabled={action.disabled}
            onClick={() => {
              haptic('tick');
              onClose();
              action.onSelect();
            }}
          >
            {action.icon && <Icon name={action.icon} />}
            <span>
              <strong>{action.label}</strong>
              {action.description && <small>{action.description}</small>}
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
