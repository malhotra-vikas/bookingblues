/**
 * Local type stub for the `zipcodes` package (no official @types). Covers
 * only the surface area we actually use: `radius()` for distance lookups.
 *
 * If we adopt more of the package's API later, expand here.
 */
declare module 'zipcodes' {
  export function radius(zip: string, miles: number): string[];
  export function lookup(
    zip: string,
  ): { zip: string; latitude: number; longitude: number; city: string; state: string; country: string } | undefined;

  const _default: {
    radius: typeof radius;
    lookup: typeof lookup;
  };
  export default _default;
}
