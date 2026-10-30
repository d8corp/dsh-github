/**
 * Parse an ISO-8601 timestamp (or epoch milliseconds) into epoch milliseconds.
 *
 * @param value candidate timestamp.
 * @returns epoch milliseconds, or null when missing, unparsable or negative.
 */
export declare function parseTimestamp(value: unknown): number | null;
