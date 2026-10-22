import { useStore } from 'zustand';
import { Icon, type IconName } from '../components/Icon';
import { haptic } from '../components/haptics.ts';
import { shellActions, shellStore, type TabId } from './shellStore.ts';

export const TABS: ReadonlyArray<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'project', label: 'Proje', icon: 'project' },
  { id: 'output', label: 'Özet', icon: 'output' },
  { id: 'library', label: 'Kütüphane', icon: 'library' },
  { id: 'settings', label: 'Ayarlar', icon: 'settings' },
];

export const tabButtonId = (tab: TabId) => `m-tab-${tab}`;
export const tabPanelId = (tab: TabId) => `m-tabpanel-${tab}`;

/**
 * Alt gezinme (başparmak bölgesi). Etkin sekmeye yeniden dokunmak o sekmenin
 * köküne döner (iç içe ekranları kapatır).
 */
export function BottomNav() {
  const activeTab = useStore(shellStore, (state) => state.activeTab);
  return (
    <nav className="m-bottom-nav" aria-label="Ana gezinme">
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={tabButtonId(tab.id)}
            type="button"
            className={`m-bottom-nav__item${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-controls={tabPanelId(tab.id)}
            onClick={() => {
              haptic('tick');
              if (active) shellActions.popToRoot(tab.id);
              else shellActions.setTab(tab.id);
            }}
          >
            <span className="m-bottom-nav__indicator" aria-hidden="true">
              <Icon name={tab.icon} />
            </span>
            <span className="m-bottom-nav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
