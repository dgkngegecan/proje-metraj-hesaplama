import { useStore } from 'zustand';
import { shellStore, topRoute, type NestedRoute, type ShellState, type TabId } from './shellStore.ts';

/** Kabuk durumundan seçici ile okur (yalnız seçilen dilim değişince yeniden çizer). */
export function useShell<T>(selector: (state: ShellState) => T): T {
  return useStore(shellStore, selector);
}

/** Sekmenin üstteki iç ekranı; `null` = sekme kökü. */
export function useTopRoute(tab: TabId): NestedRoute | null {
  return useShell((state) => topRoute(state, tab));
}

export function useActiveTab(): TabId {
  return useShell((state) => state.activeTab);
}
