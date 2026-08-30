import { buildAppViewHref, getAppViewCardMetadata } from "./app-views";
import { getOfflineAvailabilityText } from "./app-view-offline-readiness";
import { OfflineAvailability } from "./app-view-definitions-cache";
import { AppView } from "./opco-api";

export function getHomeExperienceCards(
  views: AppView[],
  offlineAvailabilityByViewId: Record<string, OfflineAvailability>,
) {
  return views.map((appView) => ({
    appView,
    availabilityLabel: getHomeExperienceAvailabilityLabel(
      offlineAvailabilityByViewId[appView.id] ?? "definition-missing",
    ),
    href: buildAppViewHref(appView.id),
    metadata: getAppViewCardMetadata(appView),
  }));
}

export function getHomeExperienceAvailabilityLabel(availability: OfflineAvailability) {
  if (availability === "ready") {
    return null;
  }

  return getOfflineAvailabilityText(availability);
}
