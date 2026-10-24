interface DshModuleLoader {
    load(module: {
        id: string;
        factory: (require: (id: string) => unknown) => unknown;
    }): void;
}
declare global {
    interface Window {
        __ModuleLoader__: DshModuleLoader;
    }
}
export {};
