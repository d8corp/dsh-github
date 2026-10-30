import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const PAYLOAD_TOO_LARGE: unique symbol;
export declare function parseAuthority(authority: unknown): URL | undefined;
export declare function isLoopbackHostname(hostname: unknown): boolean;
export declare function canonicalAuthority(authority: string): string | undefined;
export declare function buildTrustedHosts(entries: unknown, warn?: (message: string) => void): string[];
export declare function isTrustedApiRequest(req: unknown, trustedHosts?: string[]): boolean;
/**
 * Whether a request targets a loopback authority.
 *
 * @param req incoming request carrying a Host header.
 * @returns true for localhost, ::1 and 127.0.0.0/8 authorities.
 */
export declare function isLoopbackRequest(req: unknown): boolean;
export declare function readJsonBody(req: IncomingMessage, maxBytes?: number): Promise<unknown>;
export declare function writeJson(res: ServerResponse, status: number, value: unknown): void;
