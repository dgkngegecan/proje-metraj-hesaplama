import { createStore } from 'zustand/vanilla';

/**
 * Kabuğun gezinme durumu: etkin sekme ve her sekmenin iç içe gezinme yığını.
 *
 * Sekmeler: Proje · Özet/Çıktı · Kütüphane · Ayarlar. Her sekme kendi
 * yığınını tutar; sekme değiştirip dönünce kullanıcı kaldığı yerde olur.
 * Yığının üstündeki rota sekmenin gösterdiği iç ekrandır; boş yığın = sekme kökü.
 *
 *   shellActions.push({ screen: 'placement', params: { id } });   // iç ekran aç
 *   const route = useShell((s) => topRoute(s, 'project'));         // sekme bunu çizer
 *
 * Geri tuşu önce yığından çıkarır (AppShell bunu bağlar).
 */

export type TabId = 'project' | 'output' | 'library' | 'settings';

export const TAB_IDS: readonly TabId[] = ['project', 'output', 'library', 'settings'];
export const START_TAB: TabId = 'project';

export interface NestedRoute {
  /** Sekme içinde benzersiz ekran adı, ör. 'placement', 'card-editor'. */
  screen: string;
  params?: Readonly<Record<string, string>>;
}

export interface ShellState {
  activeTab: TabId;
  stacks: Readonly<Record<TabId, readonly NestedRoute[]>>;
}

const emptyStacks = (): Record<TabId, readonly NestedRoute[]> => ({
  project: [],
  output: [],
  library: [],
  settings: [],
});

export const shellStore = createStore<ShellState>()(() => ({ activeTab: START_TAB, stacks: emptyStacks() }));

export function topRoute(state: ShellState, tab: TabId): NestedRoute | null {
  return state.stacks[tab].at(-1) ?? null;
}

export const shellActions = {
  setTab(tab: TabId) {
    if (shellStore.getState().activeTab !== tab) shellStore.setState({ activeTab: tab });
  },
  push(route: NestedRoute, tab: TabId = shellStore.getState().activeTab) {
    shellStore.setState((state) => ({ stacks: { ...state.stacks, [tab]: [...state.stacks[tab], route] } }));
  },
  /** Üst rotayı yenisiyle değiştirir (geri tuşu eskisine dönmez). */
  replace(route: NestedRoute, tab: TabId = shellStore.getState().activeTab) {
    shellStore.setState((state) => ({
      stacks: { ...state.stacks, [tab]: [...state.stacks[tab].slice(0, -1), route] },
    }));
  },
  /** Bir seviye geri. Yığın zaten boşsa `false` (geri tuşu bir alt katmana geçer). */
  pop(tab: TabId = shellStore.getState().activeTab): boolean {
    const stack = shellStore.getState().stacks[tab];
    if (!stack.length) return false;
    shellStore.setState((state) => ({ stacks: { ...state.stacks, [tab]: state.stacks[tab].slice(0, -1) } }));
    return true;
  },
  popToRoot(tab: TabId = shellStore.getState().activeTab) {
    if (!shellStore.getState().stacks[tab].length) return;
    shellStore.setState((state) => ({ stacks: { ...state.stacks, [tab]: [] } }));
  },
  /** Proje/revizyon değişince eski projenin iç ekranları anlamsızlaşır. */
  resetStacks() {
    shellStore.setState({ stacks: emptyStacks() });
  },
};
