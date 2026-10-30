import { writeSecretFile } from "./atomicFile.mjs";
import { KEY_ENCRYPTED_FILENAME, KEY_FILENAME, PLUGIN_DIR_NAME, SETTINGS_FILENAME } from "./constants.mjs";
import { parseTimestamp } from "./time.mjs";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
// src/settings.ts
/**
* Host-side settings for @d8corp/dsh-github.
*
* Stored at `$DSH_HOME/dsh-github/github.json` (or `~/.dsh/dsh-github/github.json`).
* The private key is never stored here — only its path on the host. The key
* itself lives in a separate 0600 file encrypted with a passphrase that is
* never persisted.
*
* Files written by older releases directly under the DSH home are moved into
* the plugin directory once by `migrateLegacyLayout()`.
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
* @returns `$DSH_HOME/dsh-github`.
*/
function pluginDir(env = process.env) {
	return join(dshHomeDir(env), PLUGIN_DIR_NAME);
}
function settingsPath(env = process.env) {
	return join(pluginDir(env), SETTINGS_FILENAME);
}
/** Pre-directory settings location, still read until the migration moves it. */
function legacySettingsPath(env = process.env) {
	return join(dshHomeDir(env), SETTINGS_FILENAME);
}
/** Fixed location of the encrypted private key envelope. */
function encryptedKeyPath(env = process.env) {
	return join(pluginDir(env), KEY_ENCRYPTED_FILENAME);
}
function defaultSettingsFile(env = process.env) {
	const current = settingsPath(env);
	if (existsSync(current)) return current;
	const legacy = legacySettingsPath(env);
	return existsSync(legacy) ? legacy : current;
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
		keyEncrypted: source.keyEncrypted === true,
		tokenIssuedAt: normalizeTimestamp(source.tokenIssuedAt),
		tokenExpiresAt: normalizeTimestamp(source.tokenExpiresAt)
	};
}
function readSettings(file = defaultSettingsFile()) {
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
function warn(message) {
	console.warn(`[@d8corp/dsh-github] ${message}`);
}
/**
* Move the pre-directory layout into `$DSH_HOME/dsh-github/`.
*
* Old releases kept `github.json`, `github-app.pem.enc` and the plaintext
* `github-app.pem` directly under the DSH home. Existing destinations are
* never overwritten; a failed move leaves the old file in place, and
* `readSettings()` keeps reading it through the legacy fallback.
*
* @param env environment to read `DSH_HOME` from.
*/
function migrateLegacyLayout(env = process.env) {
	const home = dshHomeDir(env);
	const dir = pluginDir(env);
	const move = (from, to) => {
		if (!existsSync(from) || existsSync(to)) return;
		try {
			mkdirSync(dir, {
				recursive: true,
				mode: 448
			});
			renameSync(from, to);
		} catch (error) {
			warn(`cannot move ${from} to ${to}: ${error instanceof Error && error.message ? error.message : error}`);
		}
	};
	move(join(home, SETTINGS_FILENAME), join(dir, SETTINGS_FILENAME));
	move(join(home, KEY_ENCRYPTED_FILENAME), join(dir, KEY_ENCRYPTED_FILENAME));
	move(join(home, KEY_FILENAME), join(dir, KEY_FILENAME));
	const settings = readSettings();
	const legacyKeys = [join(home, KEY_ENCRYPTED_FILENAME), join(home, KEY_FILENAME)];
	const index = settings.keyPath === null ? -1 : legacyKeys.indexOf(settings.keyPath);
	if (index === -1) return;
	const target = join(dir, index === 0 ? KEY_ENCRYPTED_FILENAME : KEY_FILENAME);
	if (!existsSync(target)) return;
	try {
		writeSettings({
			...settings,
			keyPath: target
		});
	} catch (error) {
		warn(`cannot repoint keyPath to ${target}: ${error instanceof Error && error.message ? error.message : error}`);
	}
}
function keyFileExists(settings) {
	const s = normalizeSettings(settings);
	return !!s.keyPath && existsSync(s.keyPath);
}
export { dshHomeDir, encryptedKeyPath, keyFileExists, legacySettingsPath, migrateLegacyLayout, normalizeSettings, pluginDir, readSettings, settingsPath, writeSettings };
