import { lazy, Suspense, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { actions, loadKeys, useLoad, useProjects } from '../store';
import { useBackHandler } from './back.ts';
import { BottomNav, TABS, tabButtonId, tabPanelId } from './BottomNav';
import { LockBanner, TopBar } from './TopBar';
import { shellActions, START_TAB, type TabId } from './shellStore.ts';
import { EmptyState, ErrorState, PreparingState, ScreenErrorBoundary, SkeletonList } from './StatusViews';
import { useActiveTab } from './useShell.ts';
import { notifyError, notifySuccess } from './feedback.ts';

// Sekmeler ayrı parçalara bölünür: açılışta yalnız kabuk ve başlangıç sekmesi
// (Proje) yüklenir. Diğerleri ilk dokunuşta gelir. Dalga 2 ekranları bu
// dosyalara yazılır; varsayılan dışa aktarım bir bileşen olmalı.
const SCREENS: Record<TabId, LazyExoticComponent<ComponentType>> = {
  project: lazy(() => import('../screens/project/ProjectScreen')),
  output: lazy(() => import('../screens/output/OutputScreen')),
  library: lazy(() => import('../screens/library/LibraryScreen')),
  settings: lazy(() => import('../screens/settings/SettingsScreen')),
};

/** Proje gerektiren sekmeler; proje yokken karşılama gösterilir. */
const NEEDS_PROJECT: ReadonlySet<TabId> = new Set(['project', 'output']);

export function AppShell() {
  const activeTab = useActiveTab();
  // Ziyaret edilen sekmeler bağlı kalır (gizli): dönünce kaydırma konumu ve
  // yarım kalmış giriş kaybolmaz. Hiç açılmamış sekme yüklenmez.
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([activeTab]));
  if (!visited.has(activeTab)) setVisited(new Set([...visited, activeTab]));

  // Geri: iç içe ekran → sekme kökü; kökteyken başlangıç sekmesine.
  useBackHandler(() => shellActions.pop(), { layer: 'nested' });
  useBackHandler(
    () => {
      if (activeTab === START_TAB) return false;
      shellActions.setTab(START_TAB);
    },
    { layer: 'tab' },
  );

  return (
    <div className="m-app">
      <TopBar />
      <LockBanner />
      <main className="m-main">
        {TABS.map(({ id }) => {
          if (!visited.has(id)) return null;
          const Screen = SCREENS[id];
          return (
            <section
              key={id}
              id={tabPanelId(id)}
              className="m-tabpanel"
              aria-labelledby={tabButtonId(id)}
              hidden={id !== activeTab}
            >
              <ScreenErrorBoundary name={id}>
                <ProjectGate tab={id}>
                  <Suspense fallback={<SkeletonList />}>
                    <Screen />
                  </Suspense>
                </ProjectGate>
              </ScreenErrorBoundary>
            </section>
          );
        })}
      </main>
      <BottomNav />
    </div>
  );
}

/** Açılış yükleniyor / hata / hiç proje yok durumları; proje gerektirmeyen sekmeler hep açılır. */
function ProjectGate({ tab, children }: { tab: TabId; children: ReactNode }) {
  const projects = useProjects();
  const load = useLoad(loadKeys.projects);
  const [working, setWorking] = useState(false);
  if (!NEEDS_PROJECT.has(tab) || projects.length) return <>{children}</>;
  if (load.status === 'idle' || load.status === 'loading') return <PreparingState />;
  if (load.status === 'error')
    return <ErrorState title="Projeler okunamadı" message={load.error} onRetry={() => void actions.bootstrap()} />;

  const importSample = async () => {
    setWorking(true);
    try {
      await actions.importSampleProject();
      notifySuccess('Örnek Temiz Su projesi hazır.');
    } catch (error) {
      notifyError(error);
    } finally {
      setWorking(false);
    }
  };
  return (
    <EmptyState
      icon="project"
      title="İlk projeni oluşturalım"
      message="Üstteki “Proje seç” ile yeni bir proje aç ya da örnek projeyle uygulamayı tanı."
      action={
        <button type="button" className="m-btn m-btn--secondary" disabled={working} onClick={importSample}>
          {working ? 'Hazırlanıyor…' : 'Örnek projeyi aç'}
        </button>
      }
    />
  );
}
