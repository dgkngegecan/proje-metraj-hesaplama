import { createContext, useContext } from 'react';

export type MenuMode = 'menu' | 'rename' | 'move' | 'link';

/**
 * Proje sekmesinin gezinme ve ortak panel denetçisi. Ağaç satırı, giriş sayfası ve
 * paneller birbirini doğrudan bilmez; ortak bir denetçi üzerinden konuşur, böylece
 * "kart ekle" ve "uzun basma menüsü" panelleri sekmede TEK kez durur.
 */
export interface ProjectController {
  /** Kartın giriş sayfasını açar (iç içe rota). */
  openEntry(placementId: string): void;
  /** Kartın alt seviyesini (çocuk listesini) açar. */
  openLevel(placementId: string): void;
  /** Yol göstergesinden bir seviyeye atlar; `null` = proje kökü. */
  jumpToLevel(placementId: string | null): void;
  /** Kart ekleme panelini açar; `null` = kök. */
  addCard(parentId: string | null): void;
  /** Uzun basma menüsü (veya doğrudan bir alt paneli) açar. */
  openMenu(placementId: string, mode?: MenuMode): void;
}

export const ProjectControllerContext = createContext<ProjectController | null>(null);

export function useProjectController(): ProjectController {
  const controller = useContext(ProjectControllerContext);
  if (!controller) throw new Error('ProjectController yok: bileşen ProjectScreen içinde çizilmeli.');
  return controller;
}
