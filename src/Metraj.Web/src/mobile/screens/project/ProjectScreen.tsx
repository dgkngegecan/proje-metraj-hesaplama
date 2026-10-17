import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { SkeletonList, shellActions, shellStore, useShell, type NestedRoute } from '../../shell';
import { appStore, loadKeys, useAppStore } from '../../store';
import { selectPlacementsOf } from '../../store/selectors.ts';
import { ProjectControllerContext, type MenuMode, type ProjectController } from './projectController';
import { TreeLevel } from './TreeLevel';
import { buildChildIndex, levelPath, planLevelNavigation } from './treeModel.ts';
import { REPORT_SCOPE_ROUTE } from './placementOps.ts';
import './project.css';

// Ağır ve ilk açılışta gerekmeyen parçalar tembel yüklenir: başlangıç sekmesinin
// (bu dosya) JS'i ağaç listesinden ibaret kalır; giriş sayfası, kart ekleme ve
// uzun basma menüsü ilk kullanıldığında gelir (bütçe: npm run check:mobile).
const EntryScreen = lazy(() => import('./EntryScreen'));
const AddCardSheet = lazy(() => import('./AddCardSheet'));
const PlacementMenu = lazy(() => import('./PlacementMenu'));

/**
 * Proje sekmesi. İç içe rotalar (`shellActions.push`) üç çeşittir:
 *   { screen: 'level',     params: { id } }  alt seviye (klasör gibi)
 *   { screen: 'placement', params: { id } }  kartın giriş sayfası
 * Kök katman hep bağlı kalır (`hidden`), her rota kendi katmanında çizilir: geri
 * dönünce kaydırma konumu, arama ve yarım kalmış giriş yerinde durur.
 */
export default function ProjectScreen() {
  const stack = useShell((state) => state.stacks.project);
  const [add, setAdd] = useState<{ parentId: string | null; open: boolean } | null>(null);
  const [menu, setMenu] = useState<{ seq: number; id: string; mode: MenuMode; open: boolean } | null>(null);

  const controller = useMemo<ProjectController>(() => {
    const placementsNow = () => {
      const state = appStore.getState();
      return selectPlacementsOf(state, state.selection.revisionId);
    };
    const push = (route: NestedRoute) => {
      const top = shellStore.getState().stacks.project.at(-1);
      // Aynı rotayı art arda iki kez açan çift dokunuş yığını şişirmesin.
      if (top && top.screen === route.screen && top.params?.id === route.params?.id) return;
      shellActions.push(route, 'project');
    };
    return {
      openEntry: (id) => push({ screen: 'placement', params: { id } }),
      openLevel: (id) => push({ screen: 'level', params: { id } }),
      jumpToLevel: (id) => {
        const target = levelPath(buildChildIndex(placementsNow()), id);
        const ids = shellStore
          .getState()
          .stacks.project.map((route) => (route.screen === 'level' ? (route.params?.id ?? null) : null));
        const plan = planLevelNavigation(ids, target);
        for (let step = 0; step < plan.pops; step += 1) shellActions.pop('project');
        for (const levelId of plan.pushes) shellActions.push({ screen: 'level', params: { id: levelId } }, 'project');
      },
      addCard: (parentId) => setAdd({ parentId, open: true }),
      openMenu: (id, mode = 'menu') => setMenu((current) => ({ seq: (current?.seq ?? 0) + 1, id, mode, open: true })),
    };
  }, []);

  // Silinen (ve geri alınmayan) karta ait rota artık anlamsızdır: üstteki rota
  // yok olmuş bir karta bakıyorsa bir seviye geri dönülür.
  const topId = stack.at(-1)?.params?.id ?? null;
  const topMissing = useAppStore((state) => {
    if (!topId) return false;
    const { revisionId } = state.selection;
    if (!revisionId || state.loads[loadKeys.revision(revisionId)]?.status !== 'ready') return false;
    return !state.entities.placements.byId.has(topId);
  });
  useEffect(() => {
    if (topMissing) shellActions.pop('project');
  }, [topMissing, topId]);

  return (
    <ProjectControllerContext.Provider value={controller}>
      <div className="m-screen m-stack">
        <div className="m-stack__layer" hidden={stack.length > 0}>
          <TreeLevel levelId={null} />
        </div>
        {stack.map((route, position) => (
          <div
            key={`${position}:${route.screen}:${route.params?.id ?? ''}`}
            className="m-stack__layer"
            hidden={position !== stack.length - 1}
          >
            {route.screen === 'level' ? (
              <TreeLevel levelId={route.params?.id ?? null} />
            ) : route.screen === 'placement' && route.params?.id ? (
              <Suspense fallback={<SkeletonList />}>
                <EntryScreen placementId={route.params.id} />
              </Suspense>
            ) : null}
          </div>
        ))}
      </div>
      {add && (
        <Suspense fallback={null}>
          <AddCardSheet open={add.open} parentId={add.parentId} onClose={() => setAdd({ ...add, open: false })} />
        </Suspense>
      )}
      {menu && (
        <Suspense fallback={null}>
          <PlacementMenu
            key={menu.seq}
            open={menu.open}
            placementId={menu.id}
            initialMode={menu.mode}
            onClose={() => setMenu({ ...menu, open: false })}
            onReportScope={(id) => {
              // Çıktı sekmesinin üst rotası olarak bırakılır; kapsam okuma Çıktı ekranının işidir.
              shellActions.popToRoot('output');
              shellActions.push({ screen: REPORT_SCOPE_ROUTE, params: { placementId: id } }, 'output');
              shellActions.setTab('output');
            }}
          />
        </Suspense>
      )}
    </ProjectControllerContext.Provider>
  );
}
