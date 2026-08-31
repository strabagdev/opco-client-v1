import { buildAppViewHref, getAppViewCardMetadata } from "./app-views";
import { getOfflineAvailabilityText } from "./app-view-offline-readiness";
import { OfflineAvailability } from "./app-view-definitions-cache";
import { AppView, AppViewType } from "./opco-api";

export type HomeExperienceCard = ReturnType<typeof buildHomeExperienceCard>;

export type HomeExperienceSection = {
  id: HomeExperienceSectionId;
  title: string;
};

export type HomeExperienceSectionGroup = HomeExperienceSection & {
  cards: HomeExperienceCard[];
};

export type HomeExperienceSectionId = "records" | "workflows" | "analytics";

const HOME_EXPERIENCE_SECTIONS: HomeExperienceSection[] = [
  { id: "records", title: "Registros" },
  { id: "workflows", title: "Flujos" },
  { id: "analytics", title: "Análisis" },
];

export function getHomeExperienceCards(
  views: AppView[],
  offlineAvailabilityByViewId: Record<string, OfflineAvailability>,
) {
  return views.map((appView) => buildHomeExperienceCard(appView, offlineAvailabilityByViewId));
}

export function getHomeExperienceSections(cards: HomeExperienceCard[]): HomeExperienceSectionGroup[] {
  const cardsBySection = new Map<HomeExperienceSectionId, HomeExperienceCard[]>(
    HOME_EXPERIENCE_SECTIONS.map((section) => [section.id, []]),
  );

  for (const card of cards) {
    const section = getHomeExperienceSection(card.appView.type);
    cardsBySection.get(section.id)?.push(card);
  }

  return HOME_EXPERIENCE_SECTIONS
    .map((section) => ({
      ...section,
      cards: cardsBySection.get(section.id) ?? [],
    }))
    .filter((section) => section.cards.length > 0);
}

export function getHomeExperienceSection(type: AppViewType | string): HomeExperienceSection {
  if (type === "RECORDS") {
    return HOME_EXPERIENCE_SECTIONS[0];
  }

  if (type === "WORKFLOW") {
    return HOME_EXPERIENCE_SECTIONS[1];
  }

  return HOME_EXPERIENCE_SECTIONS[2];
}

function buildHomeExperienceCard(
  appView: AppView,
  offlineAvailabilityByViewId: Record<string, OfflineAvailability>,
) {
  return {
    appView,
    availabilityLabel: getHomeExperienceAvailabilityLabel(
      offlineAvailabilityByViewId[appView.id] ?? "definition-missing",
    ),
    href: buildAppViewHref(appView.id),
    metadata: getAppViewCardMetadata(appView),
  };
}

export function getHomeExperienceAvailabilityLabel(availability: OfflineAvailability) {
  if (availability === "ready") {
    return null;
  }

  return getOfflineAvailabilityText(availability);
}
