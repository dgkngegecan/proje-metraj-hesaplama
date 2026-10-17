import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

/** Boş durum: ne olduğunu ve SONRAKİ ADIMI söyler (yalnız "veri yok" demez). */
export function EmptyState({
  icon = 'empty',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="m-state">
      <span className="m-state__icon" aria-hidden="true">
        <Icon name={icon} size={32} />
      </span>
      <h2 className="m-state__title">{title}</h2>
      {message && <p className="m-state__message">{message}</p>}
      {action && <div className="m-state__actions">{action}</div>}
    </div>
  );
}

/** Hata durumu: Türkçe metin + "Tekrar dene". */
export function ErrorState({
  title = 'Yüklenemedi',
  message,
  onRetry,
  retryLabel = 'Tekrar dene',
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="m-state m-state--error" role="alert">
      <span className="m-state__icon" aria-hidden="true">
        <Icon name="warning" size={32} />
      </span>
      <h2 className="m-state__title">{title}</h2>
      {message && <p className="m-state__message">{message}</p>}
      {onRetry && (
        <div className="m-state__actions">
          <button type="button" className="m-btn m-btn--primary" onClick={onRetry}>
            <Icon name="refresh" size={20} />
            {retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** İskelet yükleme: gerçek satırların yerinde, aynı yükseklikte gri bloklar. */
export function SkeletonList({ rows = 8, label = 'Yükleniyor' }: { rows?: number; label?: string }) {
  return (
    <div className="m-skeleton-list" role="status" aria-live="polite" aria-busy="true">
      <span className="m-visually-hidden">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="m-skeleton-row" aria-hidden="true">
          <span className="m-skeleton m-skeleton--dot" />
          <span className="m-skeleton-lines">
            <span className="m-skeleton m-skeleton--line" style={{ width: `${62 + ((index * 17) % 30)}%` }} />
            <span className="m-skeleton m-skeleton--line m-skeleton--short" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Üst çubuğun altındaki ince meşgul çizgisi. */
export function BusyBar({ active }: { active: boolean }) {
  return (
    <div
      className={`m-busy-bar${active ? ' is-active' : ''}`}
      role="progressbar"
      aria-hidden={!active}
      aria-label="İşlem sürüyor"
    >
      <span />
    </div>
  );
}

/** Düğme içi küçük meşgul göstergesi. */
export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span
      className="m-spinner"
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label}
    >
      <span aria-hidden="true" />
    </span>
  );
}

/**
 * Bir sekmenin çökmesi bütün uygulamayı düşürmesin. Sekme yeniden denenebilir;
 * diğer sekmeler ve alt gezinme çalışmaya devam eder.
 */
export class ScreenErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Ekran hatası (${this.props.name})`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState
        title="Bu ekran açılamadı"
        message="Beklenmeyen bir hata oluştu. Verileriniz etkilenmedi."
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
