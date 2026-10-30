import { KEY_ENCRYPTED_FILENAME, KEY_FILENAME, PACKAGE_NAME, SETTINGS_FILENAME } from "./constants.mjs";
import { dshHomeDir, pluginDir } from "./settings.mjs";
import { join, resolve } from "node:path";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
// src/uninstall.ts
/**
* Removes plugin-owned artifacts after the bundle is uninstalled.
*
* DSH has no uninstall lifecycle: removing a bundle disposes the plugin fiber
* exactly like disabling it, an HMR reload, or a host restart. Disposal alone
* therefore proves nothing. The watcher keeps reading the profile manifest
* after disposal and deletes plugin data only after the package has stayed
* absent from both `dependencies` and `dsh.profile.bundles` for a quiet
* period. Until the package is gone, the manifest still declares it, so a
* disable, reload, or restart leaves the data alone.
*
* The watcher lives in the host process, so this covers removals performed
* while a DSH host is running. Removing the package with no host running
* (`dsh plugin remove`) leaves the data directory for manual cleanup.
*/
/** How often the watcher re-reads the profile manifest. */
const WATCH_INTERVAL_MS = 1e3;
/** Consecutive absent readings required before deleting anything. */
const WATCH_CONFIRMATIONS = 15;
/** Upper bound on one watcher's lifetime. */
const WATCH_TIMEOUT_MS = 3e5;
const activeWatchers = /* @__PURE__ */ new Set();
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Whether a profile manifest still claims this package.
*
* @param profileDir profile root holding `package.json`.
* @param packageName bundle package name.
* @returns true when declared, false when absent, null when the manifest
* cannot be read — callers must treat null as "still installed".
*/
function profileDeclaresPackage(profileDir, packageName = PACKAGE_NAME) {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
	} catch {
		return null;
	}
	if (!isRecord(manifest)) return null;
	if (isRecord(manifest.dependencies) && Object.hasOwn(manifest.dependencies, packageName)) return true;
	if (isRecord(manifest.devDependencies) && Object.hasOwn(manifest.devDependencies, packageName)) return true;
	const dsh = isRecord(manifest.dsh) ? manifest.dsh : {};
	const profile = isRecord(dsh.profile) ? dsh.profile : {};
	return (Array.isArray(profile.bundles) ? profile.bundles : []).includes(packageName);
}
/**
* Delete the plugin directory and the files older releases kept directly in
* the DSH home. Paths are derived from `DSH_HOME`, never from user input.
*
* @param env environment to read `DSH_HOME` from.
* @returns true when at least one artifact was removed.
*/
function removePluginArtifacts(env = process.env) {
	const home = resolve(dshHomeDir(env));
	const dir = resolve(pluginDir(env));
	if (dir !== join(home, "dsh-github")) return false;
	let removed = false;
	try {
		if (existsSync(dir)) {
			rmSync(dir, {
				recursive: true,
				force: true
			});
			removed = true;
		}
		for (const name of [
			SETTINGS_FILENAME,
			KEY_ENCRYPTED_FILENAME,
			KEY_FILENAME
		]) {
			const file = join(home, name);
			if (!existsSync(file)) continue;
			unlinkSync(file);
			removed = true;
		}
	} catch (error) {
		console.warn("[@d8corp/dsh-github] cannot remove plugin data:", error instanceof Error && error.message ? error.message : error);
		return false;
	}
	return removed;
}
/**
* Watch the profile for this package's removal and delete plugin artifacts.
*
* @param options profile location and timing knobs.
* @returns a function that stops the watcher before it acts.
*/
function watchForUninstallCleanup(options) {
	const { profileDir, packageName = PACKAGE_NAME, env = process.env } = options;
	const intervalMs = Math.max(1, options.intervalMs ?? WATCH_INTERVAL_MS);
	const confirmations = Math.max(1, options.confirmations ?? WATCH_CONFIRMATIONS);
	const deadline = Date.now() + Math.max(intervalMs, options.timeoutMs ?? WATCH_TIMEOUT_MS);
	let absentReadings = 0;
	let timer;
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (timer !== void 0) clearTimeout(timer);
		activeWatchers.delete(stop);
	};
	const tick = () => {
		if (stopped) return;
		if (profileDeclaresPackage(profileDir, packageName) === false) absentReadings += 1;
		else absentReadings = 0;
		if (absentReadings >= confirmations) {
			stop();
			removePluginArtifacts(env);
			return;
		}
		if (Date.now() >= deadline) {
			stop();
			return;
		}
		timer = setTimeout(tick, intervalMs);
		timer.unref();
	};
	activeWatchers.add(stop);
	timer = setTimeout(tick, intervalMs);
	timer.unref();
	return stop;
}
/**
* Cancel watchers started by this module instance, for example when the
* plugin mounts again after an HMR reload or a reinstall.
*/
function cancelUninstallCleanup() {
	for (const stop of [...activeWatchers]) stop();
}
export { cancelUninstallCleanup, profileDeclaresPackage, removePluginArtifacts, watchForUninstallCleanup };
