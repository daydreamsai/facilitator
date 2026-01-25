import { Elysia, file } from "elysia";
import { node } from "@elysiajs/node";
import { staticPlugin } from "@elysiajs/static";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

import { logger } from "@bogeychan/elysia-logger";
import { defaultSigners } from "./setup";
import { createFacilitator } from "@daydreamsai/facilitator";

const facilitator = createFacilitator({
  ...defaultSigners,
});

function normalizeSupportedVersions(supported: {
  kinds: Array<{ x402Version: number; network: string }>;
  extensions: unknown[];
  signers: Record<string, string[]>;
}) {
  for (const kind of supported.kinds) {
    if (!kind.network.includes(":")) {
      kind.x402Version = 1;
    }
  }
  return supported;
}

// Elysia app (Node adapter for Node.js runtime)
export const app = new Elysia({ adapter: node() })
  .use(
    logger({
      autoLogging: true,
      level: "info",
    })
  )
  .use(
    opentelemetry({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "x402-facilitator",
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    })
  )
  .get("/", () => file("./public/index.html"))
  .use(staticPlugin())
  /**
   * POST /verify
   * Verify a payment against requirements
   *
   * Note: Payment tracking and bazaar discovery are handled by lifecycle hooks
   */
  .post("/verify", async ({ body, status }) => {
    try {
      const { paymentPayload, paymentRequirements } = body as {
        paymentPayload?: PaymentPayload;
        paymentRequirements?: PaymentRequirements;
      };

      if (!paymentPayload || !paymentRequirements) {
        return status(400, {
          error: "Missing paymentPayload or paymentRequirements",
        });
      }

      // Hooks will automatically:
      // - Track verified payment (onAfterVerify)
      // - Extract and catalog discovery info (onAfterVerify)
      const response: VerifyResponse = await facilitator.verify(
        paymentPayload,
        paymentRequirements
      );

      return response;
    } catch (error) {
      console.error("Verify error:", error);
      return status(500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })
  /**
   * POST /settle
   * Settle a payment on-chain
   *
   * Note: Verification validation and cleanup are handled by lifecycle hooks
   */
  .post("/settle", async ({ body, status }) => {
    try {
      const { paymentPayload, paymentRequirements } = body as {
        paymentPayload?: PaymentPayload;
        paymentRequirements?: PaymentRequirements;
      };

      if (!paymentPayload || !paymentRequirements) {
        return status(400, {
          error: "Missing paymentPayload or paymentRequirements",
        });
      }

      // Hooks will automatically:
      // - Validate payment was verified (onBeforeSettle - will abort if not)
      // - Check verification timeout (onBeforeSettle)
      // - Clean up tracking (onAfterSettle / onSettleFailure)
      const response: SettleResponse = await facilitator.settle(
        paymentPayload,
        paymentRequirements
      );

      return response;
    } catch (error) {
      console.error("Settle error:", error);

      // Check if this was an abort from hook
      if (
        error instanceof Error &&
        error.message.includes("Settlement aborted:")
      ) {
        // Return a proper SettleResponse instead of 500 error
        const { paymentPayload } = body as {
          paymentPayload?: PaymentPayload;
        };

        return {
          success: false,
          errorReason: error.message.replace("Settlement aborted: ", ""),
          network: paymentPayload?.accepted?.network || "unknown",
        } as SettleResponse;
      }

      return status(500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })
  /**
   * GET /supported
   * Get supported payment kinds and extensions
   */
  .get("/supported", ({ status }) => {
    try {
      return normalizeSupportedVersions(facilitator.getSupported());
    } catch (error) {
      console.error("Supported error:", error);
      return status(500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
