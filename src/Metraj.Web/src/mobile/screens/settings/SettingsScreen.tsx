import { useEffect, type ReactNode } from 'react';
import { ChipGrid, Icon, setHapticsEnabled, type IconName } from '../../components';
import {
  applyTheme,
  HAPTICS_KEY,
  shellActions,
  THEME_KEY,
  useShell,
  type NestedRoute,
  type ThemePreference,
} from '../../shell';
import {
  listOf,
  useAppStore,
  useDraft,
  useIsRevisionLocked,
  useRevisionsOf,
  useSelectedProject,
  useSelectedRevision,
} from '../../store';
import { Section } from '../library/shared/FormParts';
import { AboutPanel } from './AboutPanel';
import { BackupsPanel } from './BackupsPanel';
import { CalculationsPanel } from './CalculationsPanel';
import { ResponsibilitiesPanel } from './ResponsibilitiesPanel';
import { RevisionsPanel } from './RevisionsPanel';
import { useCalculationResults, useIntegrity } from './settingsData';
import { INTEGRITY_TEXT, REVISION_STATUS_TEXT, integrityState, pendingResults } from './settingsModel';
import { WastePanel } from './WastePanel';
import { WorkspacePanel } from './WorkspacePanel';
import './settings.css';

const THEME_OPTIONS = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
] as const;

const HAPTIC_OPTIONS = [
  { value: 'on', label: 'Açık' },
  { value: 'off', label: 'Kapalı' },
] as const;

/**
 * Ayarlar sekmesi: kök menü ve iç ekranlar. Kök liste bağlı kalır (gizli) ki geri dönünce
 * kaydırma konumu korunsun.
 *
 *   revisions · calculations · responsibilities · waste · backups · workspace · about
 */
export default function SettingsScreen() {
  const stack = useShell((state) => state.stacks.settings);
  return (
    <div className="m-screen m-stack">
      <div className="m-stack__layer" hidden={stack.length > 0}>
        <SettingsHome />
      </div>
      {stack.map((route, index) => (
        <div key={`${index}:${route.screen}`} className="m-stack__layer" hidden={index !== stack.length - 1}>
          <RouteView route={route} />
        </div>
      ))}
    </div>
  );
}

function RouteView({ route }: { route: NestedRoute }) {
  switch (route.screen) {
    case 'revisions':
      return <RevisionsPanel />;
    case 'calculations':
      return <CalculationsPanel />;
    case 'responsibilities':
      return <ResponsibilitiesPanel />;
    case 'waste':
      return <WastePanel />;
    case 'backups':
      return <BackupsPanel />;
    case 'workspace':
      return <WorkspacePanel />;
    case 'about':
      return <AboutPanel />;
    default:
      return null;
  }
}

function MenuRow({
  icon,
  title,
  subtitle,
  badge,
  tone,
  disabled,
  onClick,
}: {
  icon: IconName;
  title: string;
  subtitle: ReactNode;
  badge?: string | null;
  tone?: 'warning' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" className="m-set-menu" disabled={disabled} onClick={onClick}>
        <span className="m-set-menu__icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        <span className="m-set-menu__text">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        {badge && <span className={`m-status${tone ? ` m-status--${tone}` : ''}`}>{badge}</span>}
        <Icon name="chevronRight" size={20} className="m-tree-row__chevron" />
      </button>
    </li>
  );
}

function SettingsHome() {
  const [theme, setTheme] = useDraft<ThemePreference>(THEME_KEY, 'system');
  const [haptics, setHaptics] = useDraft<'on' | 'off'>(HAPTICS_KEY, 'on');
  const project = useSelectedProject();
  const revision = useSelectedRevision();
  const revisions = useRevisionsOf(project?.id ?? null);
  const locked = useIsRevisionLocked();
  const results = useCalculationResults(revision?.id ?? null);
  const integrity = useIntegrity();
  const wasteTable = useAppStore((state) => state.entities.wasteSettings);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => setHapticsEnabled(haptics !== 'off'), [haptics]);

  const pending = pendingResults(results.data ?? []).length;
  const state = integrityState(integrity.data);
  const open = (screen: string) => shellActions.push({ screen }, 'settings');
  const needsProject = 'Önce bir proje seçin';

  return (
    <div className="m-screen m-settings">
      <div className="m-detail__scroll">
        <section className="m-section" aria-label="Proje ayarları">
          <h2 className="m-section__title">Proje{project ? ` · ${project.name}` : ''}</h2>
          <ul className="m-set-menu-list">
            <MenuRow
              icon="lock"
              title="Revizyonlar"
              subtitle={
                revision
                  ? `${revision.code} · ${REVISION_STATUS_TEXT[revision.status]} · ${revisions.length} revizyon`
                  : needsProject
              }
              disabled={!project}
              onClick={() => open('revisions')}
            />
            <MenuRow
              icon="check"
              title="Hesap kuralları ve sonuçları"
              subtitle={
                !revision
                  ? needsProject
                  : pending
                    ? `${pending} öneri onayınızı bekliyor`
                    : locked
                      ? 'Kilitli revizyon · yalnız görüntülenir'
                      : 'Kural, öneri, onay ve ezme'
              }
              badge={pending ? 'Kontrol bekliyor' : null}
              tone="warning"
              disabled={!revision}
              onClick={() => open('calculations')}
            />
            <MenuRow
              icon="project"
              title="Sorumluluklar"
              subtitle={revision ? 'Boyutlar, taraflar ve atamalar' : needsProject}
              disabled={!revision}
              onClick={() => open('responsibilities')}
            />
          </ul>
        </section>

        <section className="m-section" aria-label="Genel ayarlar">
          <h2 className="m-section__title">Genel</h2>
          <ul className="m-set-menu-list">
            <MenuRow
              icon="library"
              title="Malzeme fire payları"
              subtitle={
                wasteTable.ids.length ? `${listOf(wasteTable).length} aile kuralı` : 'Aile bazlı ortak fire oranları'
              }
              onClick={() => open('waste')}
            />
            <MenuRow
              icon="download"
              title="Yedekler ve güvenlik"
              subtitle={`${INTEGRITY_TEXT[state]} · yedek, geri yükleme, temizleme`}
              badge={state === 'warning' ? 'Uyarı' : null}
              tone="danger"
              onClick={() => open('backups')}
            />
            <MenuRow
              icon="share"
              title="Çalışma alanı"
              subtitle="Dışa aktar, içe aktar, örnek proje"
              onClick={() => open('workspace')}
            />
            <MenuRow
              icon="settings"
              title="Uygulama hakkında"
              subtitle="Sürüm, veri konumu, gizlilik"
              onClick={() => open('about')}
            />
          </ul>
        </section>

        <Section title="Görünüm">
          <ChipGrid mode="single" label="Tema" options={THEME_OPTIONS} value={theme} onChange={setTheme} columns={3} />
          <h3 className="m-section__subtitle">Titreşim</h3>
          <ChipGrid
            mode="single"
            label="Titreşim"
            options={HAPTIC_OPTIONS}
            value={haptics}
            onChange={setHaptics}
            columns={2}
          />
        </Section>
      </div>
    </div>
  );
}
