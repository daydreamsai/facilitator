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

import { facilitator } from "./setup.js";

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
    const startTime = Date.now();
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

      const network = paymentRequirements.network || "unknown";
      const scheme = paymentRequirements.scheme || "unknown";
      console.log(
        `[Verify] Starting verification: scheme=${scheme}, network=${network}`
      );

      // Verbose logging for debugging
      console.log(
        "[Verify] Payment payload authorization:",
        JSON.stringify(paymentPayload.payload?.authorization, null, 2)
      );
      console.log(
        "[Verify] Payment payload signature:",
        paymentPayload.payload?.signature
      );
      console.log(
        "[Verify] Payment payload accepted:",
        JSON.stringify(paymentPayload.accepted, null, 2)
      );
      console.log(
        "[Verify] Payment requirements:",
        JSON.stringify(
          {
            scheme: paymentRequirements.scheme,
            network: paymentRequirements.network,
            amount: paymentRequirements.amount,
            asset: paymentRequirements.asset,
            payTo: paymentRequirements.payTo,
            extra: paymentRequirements.extra,
          },
          null,
          2
        )
      );
      console.log(
        "[Verify] Payment requirements extra (full):",
        JSON.stringify(paymentRequirements.extra, null, 2)
      );

      // Hooks will automatically:
      // - Track verified payment (onAfterVerify)
      // - Extract and catalog discovery info (onAfterVerify)
      const verifyStartTime = Date.now();
      let response: VerifyResponse;
      try {
        response = await facilitator.verify(
          paymentPayload,
          paymentRequirements
        );
      } catch (verifyError) {
        const verifyDuration = Date.now() - verifyStartTime;
        console.error(
          `[Verify] Exception during verification after ${verifyDuration}ms:`,
          verifyError instanceof Error
            ? verifyError.message
            : String(verifyError),
          verifyError instanceof Error ? verifyError.stack : undefined
        );
        throw verifyError;
      }
      const verifyDuration = Date.now() - verifyStartTime;

      const totalDuration = Date.now() - startTime;
      console.log(
        `[Verify] Completed: isValid=${response.isValid}, invalidReason=${
          response.invalidReason || "none"
        }, payer=${
          response.payer || "none"
        }, duration=${verifyDuration}ms, total=${totalDuration}ms`
      );

      return response;
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      console.error(
        `[Verify] Error after ${totalDuration}ms:`,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );
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
      return facilitator.getSupported();
    } catch (error) {
      console.error("Supported error:", error);
      return status(500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
