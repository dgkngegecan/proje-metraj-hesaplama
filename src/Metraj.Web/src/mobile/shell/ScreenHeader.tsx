import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { requestBack } from './back.ts';

/**
 * İç içe ekranların başlığı. "←" düğmesi donanım geri tuşuyla aynı yolu izler
 * (`requestBack`), yani açık bir panel varsa önce o kapanır.
 */
export function ScreenHeader({
  title,
  subtitle,
  actions,
  showBack = true,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  showBack?: boolean;
}) {
  return (
    <header className="m-screen-header">
      {showBack && (
        <button type="button" className="m-icon-button" onClick={requestBack} aria-label="Geri">
          <Icon name="back" />
        </button>
      )}
      <div className="m-screen-header__text">
        <h1 className="m-screen-header__title">{title}</h1>
        {subtitle && <p className="m-screen-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="m-screen-header__actions">{actions}</div>}
    </header>
  );
}
