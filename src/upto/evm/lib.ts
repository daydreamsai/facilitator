/**
 * @daydreamsai/facilitator/upto/evm - EVM-specific Upto scheme components
 *
 * This module exports EVM-specific implementations of the upto scheme
 * for both facilitators and resource servers.
 *
 * @example
 * ```typescript
 * // Facilitator side
 * import { registerUptoEvmScheme } from "@daydreamsai/facilitator/upto/evm";
 * registerUptoEvmScheme(facilitator, { signer, networks: "eip155:8453" });
 *
 * // Resource server side
 * import { UptoEvmServerScheme } from "@daydreamsai/facilitator/upto/evm";
 * resourceServer.register("eip155:*", new UptoEvmServerScheme());
 * ```
 */

// Facilitator-side scheme registration
export { registerUptoEvmScheme } from "./register.js";

// Facilitator-side scheme implementation
export { UptoEvmScheme } from "./facilitator.js";

// Resource server-side scheme
export { UptoEvmServerScheme } from "./serverScheme.js";
