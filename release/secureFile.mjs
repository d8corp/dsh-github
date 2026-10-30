import { dshHomeDir } from "./settings.mjs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { existsSync, realpathSync, unlinkSync } from "node:fs";
// src/secureFile.ts
/**
* Private-file helpers for the GitHub App key.
*
* Deletions are restricted to the harness home so a tampered settings file
* cannot turn `clearConfig` into arbitrary file removal.
*/
/** Real path when it exists, otherwise a lexically resolved absolute path. */
function realOrResolved(path) {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}
/**
* Whether a path lives inside the harness home, judged by its parent's real
* location so a symlinked directory cannot escape the check.
*
* @param file candidate path.
* @returns true when removing the path cannot reach outside `$DSH_HOME`.
*/
function isInsideDshHome(file) {
	if (typeof file !== "string" || file.trim() === "") return false;
	const home = realOrResolved(dshHomeDir());
	const parent = realOrResolved(dirname(resolve(file)));
	const relation = relative(home, parent);
	return !relation.startsWith("..") && !isAbsolute(relation);
}
/**
* Remove a file only when it is inside the harness home.
*
* @param file candidate path.
* @returns true when the file is gone (or was absent), false otherwise.
*/
function removeSecretFile(file) {
	if (!isInsideDshHome(file)) return false;
	const target = file;
	try {
		if (existsSync(target)) unlinkSync(target);
		return true;
	} catch {
		return false;
	}
}
export { isInsideDshHome, removeSecretFile };
