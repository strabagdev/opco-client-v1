export type ContractSelectionStore = {
  getSelectedContractId(): Promise<string | null>;
  setSelectedContractId(contractId: string | null): Promise<void>;
};

export async function readPersistedContractId(store: ContractSelectionStore) {
  try {
    return await store.getSelectedContractId();
  } catch {
    return null;
  }
}

export async function persistSelectedContractId(
  store: ContractSelectionStore,
  contractId: string | null,
) {
  try {
    await store.setSelectedContractId(contractId);
  } catch {
    // SQLite persistence must not block auth or navigation state.
  }
}
