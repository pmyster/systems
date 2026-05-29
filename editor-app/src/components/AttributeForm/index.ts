/**
 * Public surface of the AttributeForm subtree.
 *
 * Only the top-level AttributeForm is exported. Sub-sections are
 * internal — keep the import line in App.tsx and tests short and stop
 * other components from reaching into the form's guts.
 */

export { AttributeForm } from "./AttributeForm";
export { HardpointSection } from "./HardpointSection";
export type { HardpointSectionProps } from "./HardpointSection";
export { RigSection } from "./RigSection";
export type { RigSectionProps } from "./RigSection";
