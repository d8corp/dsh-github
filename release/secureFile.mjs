import { dshHomeDir } from "./settings.mjs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, realpathSync, unlinkSync } from "node:fs";
// src/secureFile.ts
/**
* Private-file helpers for the GitHub App key.
*
* Deletions are restricted to the harness home so a tampered settings file
* cannot turn `clearConfig` into arbitrary file removal.
*/
/**
* Real path when it exists. Missing paths are resolved through their nearest
* existing ancestor, so symlinked parents (`/var` → `/private/var` on macOS)
* still compare correctly against a real home directory.
*/
function realOrResolved(path) {
	const resolved = resolve(path);
	try {
		return realpathSync.native(resolved);
	} catch {
		const parent = dirname(resolved);
		if (parent === resolved) return resolved;
		return join(realOrResolved(parent), basename(resolved));
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
