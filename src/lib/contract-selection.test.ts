import { describe, expect, it } from "vitest";

import { selectContractId } from "./contract-selection";
import { Contract } from "./opco-api";

const contracts: Contract[] = [
  {
    id: "contract_1",
    name: "Contrato 1",
    role: "ADMIN",
  },
  {
    id: "contract_2",
    name: "Contrato 2",
    role: "MEMBER",
  },
];

describe("selectContractId", () => {
  it("selects the only contract automatically", () => {
    expect(selectContractId([contracts[0]], null)).toBe("contract_1");
  });

  it("requires selection when multiple contracts exist and none was persisted", () => {
    expect(selectContractId(contracts, null)).toBeNull();
  });

  it("keeps a persisted contract when it is still available", () => {
    expect(selectContractId(contracts, "contract_2")).toBe("contract_2");
  });
});
