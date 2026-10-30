import { writeSecretFile } from "./atomicFile.mjs";
import { KEY_ENCRYPTED_FILENAME, PLUGIN_DIR_NAME, SETTINGS_FILENAME } from "./constants.mjs";
import { parseTimestamp } from "./time.mjs";
import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
// src/settings.ts
/**
* Host-side settings for dsh-github-app.
*
* Stored at `$DSH_HOME/dsh-github-app/github.json` (or `~/.dsh/dsh-github-app/github.json`).
* The private key is never stored here — only its path on the host. The key
* itself lives in a separate 0600 file encrypted with a passphrase that is
* never persisted.
*/
const MAX_ID_CHARS = 64;
const MAX_GIT_NAME_CHARS = 128;
const MAX_GIT_EMAIL_CHARS = 255;
/**
* Expand a leading `~` to the current user's home directory. `~user/...` is
* deliberately left alone, matching the harness home-path helper.
*
* @param value configured path.
* @returns the path with `~` (or `~/`) expanded.
*/
function expandHome(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}
/**
* Resolve the DeepSeek Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`.
*
* The configured value is `~`-expanded and resolved to an absolute path, so
* `DSH_HOME=~/harness` means `$HOME/harness` — never a literal `./~` directory
* relative to the server's working directory.
*
* Kept local on purpose — the host half must load with no runtime dependency
* beyond Node built-ins, so no `@deepseek-ai/*` helper package is imported here.
*
* @returns the absolute harness home directory.
*/
function dshHomeDir(env = process.env) {
	const configured = env && typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
	return resolve(configured === "" ? join(homedir(), ".dsh") : expandHome(configured));
}
/**
* Plugin-owned data directory under the DSH home.
*
* @param env environment to read `DSH_HOME` from.
* @returns `$DSH_HOME/dsh-github-app`.
*/
function pluginDir(env = process.env) {
	return join(dshHomeDir(env), PLUGIN_DIR_NAME);
}
function settingsPath(env = process.env) {
	return join(pluginDir(env), SETTINGS_FILENAME);
}
/** Fixed location of the encrypted private key envelope. */
function encryptedKeyPath(env = process.env) {
	return join(pluginDir(env), KEY_ENCRYPTED_FILENAME);
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizeId(value) {
	if (typeof value === "number" && Number.isFinite(value)) value = String(Math.trunc(value));
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (trimmed === "") return "";
	return trimmed.slice(0, MAX_ID_CHARS);
}
function normalizePath(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	return trimmed;
}
/**
* Normalize a persisted token timestamp to canonical ISO-8601 UTC.
*
* Accepts a parseable date string or a finite, non-negative epoch-millisecond
* number; anything else — objects, arrays, `"nonsense"`, `NaN`, negative or
* out-of-range numbers — normalizes to `null` instead of throwing.
*
* @param value candidate timestamp read from settings JSON.
* @returns canonical ISO string, or null when the value is unusable.
*/
function normalizeTimestamp(value) {
	const ms = parseTimestamp(value);
	if (ms === null) return null;
	try {
		return new Date(ms).toISOString();
	} catch {
		return null;
	}
}
function normalizeSettings(value) {
	const source = isPlainObject(value) ? value : {};
	return {
		appId: normalizeId(source.appId),
		installationId: normalizeId(source.installationId),
		gitUserName: typeof source.gitUserName === "string" ? source.gitUserName.trim().slice(0, MAX_GIT_NAME_CHARS) : "",
		gitUserEmail: typeof source.gitUserEmail === "string" ? source.gitUserEmail.trim().slice(0, MAX_GIT_EMAIL_CHARS) : "",
		keyPath: normalizePath(source.keyPath),
		keyFileName: typeof source.keyFileName === "string" && source.keyFileName.trim() !== "" ? source.keyFileName.trim().slice(0, 255) : null,
		tokenIssuedAt: normalizeTimestamp(source.tokenIssuedAt),
		tokenExpiresAt: normalizeTimestamp(source.tokenExpiresAt)
	};
}
function readSettings(file = settingsPath()) {
	try {
		return normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
	} catch {
		return normalizeSettings({});
	}
}
function writeSettings(settings, file = settingsPath()) {
	const normalized = normalizeSettings(settings);
	writeSecretFile(file, `${JSON.stringify(normalized, null, 2)}\n`);
	return normalized;
}
function keyFileExists(settings) {
	const s = normalizeSettings(settings);
	return !!s.keyPath && existsSync(s.keyPath);
}
export { dshHomeDir, encryptedKeyPath, keyFileExists, normalizeSettings, pluginDir, readSettings, settingsPath, writeSettings };
