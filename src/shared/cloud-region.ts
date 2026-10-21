/** Explicit offering-login compatibility choice. Automatic sends no country
 * override; this choice does not select a proxy or a streaming server. */
export const CLOUD_LOGIN_COUNTRIES = Object.freeze(['auto', 'pl', 'us', 'br', 'jp', 'kr'] as const);
export type CloudLoginCountry = typeof CLOUD_LOGIN_COUNTRIES[number];
