export type RecordsRendererScope = {
  appViewId: string;
  entityTypeId: string;
};

export type RecordsSearchState = {
  debouncedSearch: string;
  searchText: string;
};

export function resolveRecordsSearchForScopeChange({
  currentSearch,
  nextScope,
  previousScope,
}: {
  currentSearch: RecordsSearchState;
  nextScope: RecordsRendererScope;
  previousScope: RecordsRendererScope;
}): RecordsSearchState {
  if (
    previousScope.appViewId === nextScope.appViewId &&
    previousScope.entityTypeId === nextScope.entityTypeId
  ) {
    return currentSearch;
  }

  return {
    debouncedSearch: "",
    searchText: "",
  };
}
