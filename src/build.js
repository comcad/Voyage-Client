/**
 * Which build this is: set when the bundle is built (build.mjs), "dev" when the source is run without one. The
 * server says which build it has now at /build.json, so a page still running an older one can say so.
 */
/* global __VOYAGE_BUILD__ */
export const BUILD = typeof __VOYAGE_BUILD__ === 'string' ? __VOYAGE_BUILD__ : 'dev';
