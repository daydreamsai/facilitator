import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";

export type UptoSessionStatus = "open" | "settling" | "closed";

export type UptoSession = {
  cap: bigint;
  deadline: bigint;
  pendingSpent: bigint;
  settledTotal: bigint;
  lastActivityMs: number;
  status: UptoSessionStatus;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  lastSettlement?: {
    atMs: number;
    reason: string;
    receipt: SettleResponse;
  };
};

export interface UptoSessionStore {
  get(id: string): UptoSession | undefined;
  set(id: string, session: UptoSession): void;
  delete(id: string): void;
  entries(): IterableIterator<[string, UptoSession]>;
}

export class InMemoryUptoSessionStore implements UptoSessionStore {
  private readonly map = new Map<string, UptoSession>();

  get(id: string): UptoSession | undefined {
    return this.map.get(id);
  }

  set(id: string, session: UptoSession): void {
    this.map.set(id, session);
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  entries(): IterableIterator<[string, UptoSession]> {
    return this.map.entries();
  }
}

