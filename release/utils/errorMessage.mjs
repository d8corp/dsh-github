// src/utils/errorMessage.ts
function errorMessage(error, fallback) {
	return error instanceof Error && error.message ? error.message : fallback;
}
export { errorMessage };
