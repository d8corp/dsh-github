import type { IncomingMessage, ServerResponse } from 'node:http';
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export declare function createApiHandler(_ctx: unknown, { trustedHosts }: {
    trustedHosts: string[];
}): ApiHandler;
