import { dirname } from "node:path";
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
// src/atomicFile.ts
/**
* Atomic private-file writes shared by settings and key storage.
*
* Files are written to a sibling temp file, fsynced, renamed into place and
* tightened to 0600, so a crash never leaves a half-written secret and an
* existing destination cannot keep looser permissions.
*/
/**
* Write a secret file atomically with mode 0600.
*
* @param file destination path.
* @param content file contents.
*/
function writeSecretFile(file, content) {
	const directory = dirname(file);
	mkdirSync(directory, {
		recursive: true,
		mode: 448
	});
	const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	let handle;
	try {
		handle = openSync(temp, "w", 384);
		writeFileSync(handle, content, "utf8");
		fsyncSync(handle);
		closeSync(handle);
		handle = void 0;
	} catch (error) {
		if (handle !== void 0) try {
			closeSync(handle);
		} catch {}
		try {
			unlinkSync(temp);
		} catch {}
		throw error;
	}
	try {
		renameSync(temp, file);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {}
		throw error;
	}
	try {
		chmodSync(file, 384);
	} catch {}
}
export { writeSecretFile };
