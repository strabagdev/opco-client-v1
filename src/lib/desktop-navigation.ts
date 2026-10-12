import { getHomeExperienceCards, getHomeExperienceSections, type HomeExperienceSectionId } from "./home-experiences";
import type { AppView } from "./opco-api";
import { appViewIdFromPathname } from "./write-feedback";

export function desktopNavigation(views: AppView[], pathname: string, category: unknown) {
  const sections = getHomeExperienceSections(getHomeExperienceCards(views, {}));
  const selectedCategory = sections.find(section => section.id === category)?.id ?? null;
  const visibleId = appViewIdFromPathname(pathname);
  const active = visibleId
    ? sections.find(section => section.cards.some(card => card.appView.id === visibleId))?.id ?? null
    : pathname === "/" ? selectedCategory : null;
  return { sections, selectedCategory, active };
}

export function categoryHref(category: HomeExperienceSectionId) {
  return { pathname: "/" as const, params: { category } };
}

export function scopedDesktopCatalog(catalog: { scope: string; views: AppView[] } | null, ownerKey: string | null, contractId: string | null) {
  return catalog?.scope === JSON.stringify([ownerKey, contractId]) ? catalog.views : [];
}
