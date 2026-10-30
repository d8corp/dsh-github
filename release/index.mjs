import "./_virtual/_rollup-plugin-process-env.mjs";
import { API_PREFIX } from "./constants.mjs";
import { buildTrustedHosts } from "./fence.mjs";
import { migrateLegacyLayout } from "./settings.mjs";
import { createApiHandler } from "./api.mjs";
import { cancelUninstallCleanup, profileDeclaresPackage, watchForUninstallCleanup } from "./uninstall.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// src/index.ts
/**
* Resolve the profile directory from the loader context. The loader sets
* `baseUrl` to the directory of the profile configuration, which is also the
* directory holding `package.json`.
*
* @param baseUrl context base URL, usually a `file:` URL.
* @returns an absolute directory path, or null when it cannot be resolved.
*/
function resolveProfileDir(baseUrl) {
	if (typeof baseUrl !== "string" || baseUrl.trim() === "") return null;
	try {
		const value = baseUrl.startsWith("file:") ? fileURLToPath(new URL(".", baseUrl)) : baseUrl;
		return resolve(value);
	} catch {
		return null;
	}
}
const name = "github";
const inject = ["webServer", "webStartup"];
function apply(ctx) {
	cancelUninstallCleanup();
	migrateLegacyLayout();
	const trustedHosts = buildTrustedHosts(ctx.webStartup?.trustedHosts, (message) => {
		console.warn("[@d8corp/dsh-github] ignoring invalid trusted host:", message);
	});
	const handler = createApiHandler(ctx, { trustedHosts });
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler
	}), "@d8corp/dsh-github: api");
	const profileDir = resolveProfileDir(ctx.baseUrl);
	if (profileDir !== null && profileDeclaresPackage(profileDir) === true) {
		const watchedProfileDir = profileDir;
		ctx.effect(() => () => {
			watchForUninstallCleanup({ profileDir: watchedProfileDir });
		}, "@d8corp/dsh-github: uninstall cleanup");
	}
}
export { apply, inject, name };
