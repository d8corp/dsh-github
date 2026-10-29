import "./_virtual/_rollup-plugin-process-env.mjs";
import { API_PREFIX } from "./constants.mjs";
import { buildTrustedHosts } from "./fence.mjs";
import { createApiHandler } from "./api.mjs";
// src/index.ts
const name = "github";
const inject = [
	"webServer",
	"webStartup",
	"credentials"
];
function apply(ctx) {
	const trustedHosts = buildTrustedHosts(ctx.webStartup && ctx.webStartup.trustedHosts, (message) => {
		console.warn("[@d8corp/dsh-github] ignoring invalid trusted host:", message);
	});
	const handler = createApiHandler(ctx, { trustedHosts });
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler
	}), "@d8corp/dsh-github: api");
}
export { apply, inject, name };
