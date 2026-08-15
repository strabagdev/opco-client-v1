import { Contract } from "./opco-api";

export function selectContractId(contracts: Contract[], persistedContractId: string | null) {
  if (contracts.length === 0) {
    return null;
  }

  if (persistedContractId && contracts.some((contract) => contract.id === persistedContractId)) {
    return persistedContractId;
  }

  if (contracts.length === 1) {
    return contracts[0].id;
  }

  return null;
}
