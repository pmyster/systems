/**
 * Ambient type declarations for `bitecs/legacy`.
 *
 * bitecs 0.4 moved the friendly SoA-component API (`defineComponent`,
 * `Types`) into the `legacy` submodule and the published package ships
 * no `.d.ts` for it. We use legacy because it gives us the familiar
 * `Position.x[eid] = 1.0` SoA access pattern that the rest of the sim
 * is built around. The 0.4 "next" API is also valid but more verbose
 * and we don't need its features yet.
 *
 * Only the surface area we actually use is declared here. Extend if
 * later systems pull in more functions.
 */
declare module "bitecs/legacy" {
  /** Numeric type tags accepted by `defineComponent` schemas. */
  export const Types: {
    readonly i8: "i8";
    readonly ui8: "ui8";
    readonly ui8c: "ui8c";
    readonly i16: "i16";
    readonly ui16: "ui16";
    readonly i32: "i32";
    readonly ui32: "ui32";
    readonly f32: "f32";
    readonly f64: "f64";
    readonly eid: "eid";
  };

  /** A primitive type tag string from the `Types` registry. */
  export type TypeTag =
    | "i8" | "ui8" | "ui8c" | "i16" | "ui16"
    | "i32" | "ui32" | "f32" | "f64" | "eid";

  /** SoA schema: leaf is a type tag, branch is a nested schema. */
  export type ComponentSchema = {
    readonly [key: string]: TypeTag | ComponentSchema;
  };

  /** Storage built from a schema — each key becomes a typed array indexed by entity id. */
  export type Component<S extends ComponentSchema> = {
    readonly [K in keyof S]: S[K] extends TypeTag
      ? ArrayLike<number> & { [i: number]: number }
      : S[K] extends ComponentSchema
        ? Component<S[K]>
        : never;
  };

  export function defineComponent<S extends ComponentSchema>(
    schema: S,
    max?: number,
  ): Component<S>;
}
