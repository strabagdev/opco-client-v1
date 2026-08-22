export type ContractSelectionStore = {
  getSelectedContractId(ownerKey?: string | null): Promise<string | null>;
  setSelectedContractId(contractId: string | null, ownerKey?: string | null): Promise<void>;
};

export async function readPersistedContractId(store: ContractSelectionStore, ownerKey?: string | null) {
  try {
    return await store.getSelectedContractId(ownerKey);
  } catch {
    return null;
  }
}

export async function persistSelectedContractId(
  store: ContractSelectionStore,
  contractId: string | null,
  ownerKey?: string | null,
) {
  try {
    await store.setSelectedContractId(contractId, ownerKey);
  } catch {
    // SQLite persistence must not block auth or navigation state.
  }
}
