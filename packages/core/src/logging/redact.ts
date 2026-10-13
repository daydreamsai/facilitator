/**
 * Log redaction.
 *
 * viem errors embed the RPC URL (`URL: ...`) and the full JSON-RPC payload (`Request body: ...`)
 * in their message and details. Hosted RPC providers put the API key in that URL, so printing
 * an error verbatim leaks the key into every log sink. Everything here is pure; installing it
 * over the process's output is left to the application.
 */

import { format } from "node:util";

const REDACTED = "[redacted]";
const MIN_SECRET_LENGTH = 6;

const LINE_PATTERNS: RegExp[] = [/(\bURL:\s*)[^\s'"]+/gi, /(Request body:\s*)[^\n]*/g];

const INLINE_PATTERNS: Array<[RegExp, string]> = [
  // Path-embedded provider keys, e.g. /v2/<key>, /v3/<key>, /rpc/<key>.
  [/(\/(?:v\d+|rpc|api)\/)[A-Za-z0-9_-]{16,}/g, `$1${REDACTED}`],
  // Credentials in URL userinfo, e.g. postgres://user:pass@host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Key-like query parameters.
  [/([?&](?:api[-_]?key|apikey|key|token|access[-_]?token|secret)=)[^&\s"']+/gi, `$1${REDACTED}`],
  // Authorization headers.
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
];

const SECRET_ENV_NAME = /(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|RPC_URL)/i;

/**
 * Collect the values of secret-looking environment variables, so they can be removed from
 * logs even when they appear in a shape no pattern recognises.
 */
export function collectSecretsFromEnv(
  env: Record<string, string | undefined> = process.env
): string[] {
  const secrets = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_ENV_NAME.test(name)) continue;
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length < MIN_SECRET_LENGTH) continue;
      secrets.add(trimmed);
      // A private key may be configured with or without its 0x prefix.
      if (trimmed.startsWith("0x")) secrets.add(trimmed.slice(2));
    }
  }
  // Longest first, so a secret containing another is replaced whole.
  return [...secrets].sort((a, b) => b.length - a.length);
}

/** Remove RPC URLs, request bodies, credentials and the given secret values from text. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of LINE_PATTERNS) out = out.replace(pattern, `$1${REDACTED}`);
  for (const [pattern, replacement] of INLINE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

// viem errors carry the request URL and body as properties too (`url`, `body`, `metaMessages`),
// and those print in shapes no line pattern can bound. Errors are reduced to their stack and
// the messages down their cause chain instead.
function describeError(error: Error): string {
  const parts = [error.stack ?? `${error.name}: ${error.message}`];
  let cause: unknown = (error as { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 8; depth++) {
    parts.push(cause instanceof Error ? `Caused by: ${cause.name}: ${cause.message}` : `Caused by: ${format(cause)}`);
    cause = cause instanceof Error ? (cause as { cause?: unknown }).cause : undefined;
  }
  return parts.join("\n");
}

/** Format console-style arguments (Errors included) into one redacted string. */
export function formatForLog(args: readonly unknown[], secrets: readonly string[] = []): string {
  const prepared = args.map((arg) => (arg instanceof Error ? describeError(arg) : arg));
  return redactSecrets(format(...prepared), secrets);
}

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug" | "trace";
const CONSOLE_METHODS: ConsoleMethod[] = ["log", "info", "warn", "error", "debug", "trace"];

/**
 * Route every console call and every write to stdout/stderr through redaction. Covering the
 * streams as well as the console catches structured loggers that write to them directly.
 * Returns a function that restores the originals.
 */
export function installLogRedaction(
  options: { secrets?: readonly string[] } = {}
): () => void {
  const secrets = options.secrets ?? collectSecretsFromEnv();
  const restore: Array<() => void> = [];

  for (const method of CONSOLE_METHODS) {
    const original = console[method];
    console[method] = (...args: unknown[]) => original.call(console, formatForLog(args, secrets));
    restore.push(() => {
      console[method] = original;
    });
  }

  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write;
    stream.write = function (chunk: unknown, ...rest: unknown[]) {
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("utf8")
            : chunk;
      const redacted = typeof text === "string" ? redactSecrets(text, secrets) : text;
      return (original as (...a: unknown[]) => boolean).call(stream, redacted, ...rest);
    } as typeof stream.write;
    restore.push(() => {
      stream.write = original;
    });
  }

  return () => restore.forEach((undo) => undo());
}
