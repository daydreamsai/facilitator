import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UptoFacilitatorClient } from "../../src/upto/settlement.js";

const createUptoSweeper = vi.fn(() => ({ name: "upto.sweeper" }));

vi.mock("../../src/upto/sweeper.js", () => ({
  createUptoSweeper,
}));

const { createUptoModule } = await import("../../src/upto/module.js");

describe("createUptoModule sweeperConfig", () => {
  const facilitatorClient = {
    settle: vi.fn(),
  } as unknown as UptoFacilitatorClient;

  beforeEach(() => {
    createUptoSweeper.mockClear();
  });

  it("passes sweeperConfig defaults to createUptoSweeper", () => {
    const module = createUptoModule({
      facilitatorClient,
      sweeperConfig: {
        intervalMs: 12_345,
        idleSettleMs: 60_000,
      },
    });

    module.createSweeper();

    expect(createUptoSweeper).toHaveBeenCalledWith(
      expect.objectContaining({
        store: module.store,
        facilitatorClient,
        intervalMs: 12_345,
        idleSettleMs: 60_000,
      })
    );
  });

  it("allows sweeper overrides to take precedence", () => {
    const module = createUptoModule({
      facilitatorClient,
      sweeperConfig: {
        intervalMs: 30_000,
        idleSettleMs: 120_000,
      },
    });

    module.createSweeper({ intervalMs: 5_000 });

    expect(createUptoSweeper).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 5_000,
        idleSettleMs: 120_000,
      })
    );
  });
});
