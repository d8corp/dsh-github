import type { ApiHandler } from './api';
interface PluginContext {
    baseUrl?: unknown;
    webStartup?: {
        trustedHosts?: unknown;
    };
    webServer: {
        register(route: {
            kind: 'prefix';
            path: string;
            handler: ApiHandler;
        }): unknown;
    };
    effect(callback: () => unknown, label: string): unknown;
}
export declare const name = "github";
export declare const inject: string[];
export declare function apply(ctx: PluginContext): void;
export {};
