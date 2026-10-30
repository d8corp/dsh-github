import { MAX_BODY_BYTES } from "./constants.mjs";
// src/fence.ts
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");
function parseAuthority(authority) {
	if (typeof authority !== "string") return void 0;
	const value = authority.trim();
	if (value === "" || /[/?#@\\\s]/.test(value)) return void 0;
	try {
		const url = new URL(`http://${value}`);
		if (url.username !== "" || url.password !== "" || url.pathname !== "/") return void 0;
		return url;
	} catch {
		return;
	}
}
function isLoopbackHostname(hostname) {
	if (typeof hostname !== "string" || hostname === "") return false;
	let name = hostname.toLowerCase();
	if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
	if (name === "localhost" || name === "::1") return true;
	const parts = (name.startsWith("::ffff:") ? name.slice(7) : name).split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function canonicalFrom(url, authority) {
	const explicitPort = /:(\d+)$/.exec(authority.trim());
	return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`;
}
function canonicalAuthority(authority) {
	const url = parseAuthority(authority);
	return url === void 0 ? void 0 : canonicalFrom(url, authority);
}
function isTrustedAuthority(authority, hostUrl, trustedHosts) {
	const requestAuthority = canonicalAuthority(authority) || hostUrl.hostname;
	return trustedHosts.some((entry) => {
		const url = parseAuthority(entry);
		if (url === void 0) return false;
		const canonical = canonicalFrom(url, entry);
		return canonical !== url.hostname ? canonical === requestAuthority : url.hostname === hostUrl.hostname;
	});
}
function buildTrustedHosts(entries, warn) {
	const trusted = [];
	for (const entry of Array.isArray(entries) ? entries : []) {
		if (typeof entry !== "string") {
			if (warn) warn("trusted host entry is not a string");
			continue;
		}
		const canonical = canonicalAuthority(entry);
		if (canonical === void 0 || canonical !== entry.trim().toLowerCase()) {
			if (warn) warn(`entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
			continue;
		}
		trusted.push(entry.trim());
	}
	return trusted;
}
function headersOf(req) {
	return req !== null && typeof req === "object" && "headers" in req && req.headers !== null && typeof req.headers === "object" ? req.headers : {};
}
function isTrustedApiRequest(req, trustedHosts = []) {
	if (req === null || typeof req !== "object") return false;
	const headers = headersOf(req);
	const host = typeof headers.host === "string" ? headers.host : void 0;
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(host, hostUrl, trustedHosts)) return false;
	const site = headers["sec-fetch-site"];
	if (typeof site === "string" && site.toLowerCase() === "cross-site") return false;
	const origin = headers.origin;
	if (origin === void 0 || origin === "") return true;
	if (typeof origin !== "string") return false;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/**
* Whether a request targets a loopback authority.
*
* @param req incoming request carrying a Host header.
* @returns true for localhost, ::1 and 127.0.0.0/8 authorities.
*/
function isLoopbackRequest(req) {
	if (req === null || typeof req !== "object") return false;
	const headers = headersOf(req);
	const host = typeof headers.host === "string" ? headers.host : void 0;
	if (host === void 0) return false;
	const authority = parseAuthority(host);
	return authority !== void 0 && isLoopbackHostname(authority.hostname);
}
function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		req.on("data", (chunk) => {
			if (settled) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
			size += buffer.length;
			if (size > maxBytes) {
				settled = true;
				req.pause();
				resolve(PAYLOAD_TOO_LARGE);
				return;
			}
			chunks.push(buffer);
		});
		req.on("end", () => {
			if (settled) return;
			settled = true;
			try {
				const raw = Buffer.concat(chunks).toString("utf8").trim();
				resolve(raw === "" ? null : JSON.parse(raw));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (settled) return;
			settled = true;
			resolve(null);
		});
	});
}
function writeJson(res, status, value) {
	if (!res || res.writableEnded || res.destroyed) return;
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(body);
}
export { PAYLOAD_TOO_LARGE, buildTrustedHosts, canonicalAuthority, isLoopbackHostname, isLoopbackRequest, isTrustedApiRequest, parseAuthority, readJsonBody, writeJson };
