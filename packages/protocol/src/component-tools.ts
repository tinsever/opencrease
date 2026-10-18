// Component tools (SPEC §4.9, §8.2 additions). Namespaced with oc_ so they never collide with Paper's set.
import { z } from "zod";
import type { ToolDef } from "./tools";

const fileId = z.string().min(1).describe("ID of the file to work on.");
const nodeId = z.string().min(1);
const propValue = z.union([z.string(), z.boolean()]);
const styleValue = z.union([z.string(), z.number()]);

const propDef = z.object({
  name: z.string().min(1).describe("Prop name, unique within the component, e.g. \"label\"."),
  type: z.enum(["text", "boolean", "instance-swap", "slot"]).describe(
    'text: drives the text of a Text layer. boolean: shows or hides a layer. instance-swap: swaps the component of a nested instance. slot: a frame whose children each instance fills with its own content. Variant (enum) props come from component sets, see oc_create_component_set.',
  ),
  target: z.string().describe('Id of the bound layer inside the main component. For a layer inside a nested instance use the path "<nested instance id>/<layer id in its main component>".'),
  default: propValue.optional().describe("Optional default (informational for text and boolean: the bound layer itself is the default)."),
  description: z.string().optional(),
});

const codeRef = z
  .object({
    package: z.string().min(1).describe('Import source, e.g. "@acme/ui".'),
    export: z.string().min(1).describe('Named export, e.g. "Button". "default" imports the default export.'),
    propsMap: z.record(z.string(), z.string()).optional().describe('Design prop name to code prop name, e.g. {"label": "children"}. Map a prop to "" to leave it out. Unlisted props keep their design name.'),
  })
  .describe("Code component this design component stands for. get_jsx then emits <Button variant=\"primary\" /> with an import line instead of raw markup.");

function def<S extends z.ZodRawShape>(d: ToolDef<S>): ToolDef {
  return d;
}

export const COMPONENT_TOOLS: ToolDef[] = [
  def({
    name: "oc_list_components",
    title: "List components",
    side: "editor",
    readOnly: true,
    description: "List the main components in a file and in the libraries it subscribes to: id, name, variant values, props (with types, targets and options), code mapping and how many instances exist. Call it before placing instances or editing components.",
    inputShape: {
      fileId,
      includeLibraries: z.boolean().optional().describe("Include components of subscribed libraries (default true)."),
    },
  }),
  def({
    name: "oc_create_component",
    title: "Create component",
    side: "editor",
    readOnly: false,
    description: `Turn existing frames into main components. Build the component first with write_html (one frame with its layers), then call this. Instances placed with oc_create_instance follow every later change to the main component and keep their own overrides.
Optionally declare props right away (see oc_set_component_props) and a code mapping.`,
    inputShape: {
      fileId,
      nodeIds: z.array(nodeId).min(1).describe("Frames to turn into components (each becomes its own component)."),
      name: z.string().optional().describe("New name (only when a single frame is passed)."),
      props: z.array(propDef).optional().describe("Prop definitions (single frame only)."),
      codeRef: codeRef.optional(),
      description: z.string().optional(),
    },
  }),
  def({
    name: "oc_create_component_set",
    title: "Create component set",
    side: "editor",
    readOnly: false,
    description: 'Combine sibling main components into a component set: each becomes a variant with a value for an enum prop (default prop name "variant"; values default to the last part of each name, so "Button/Primary" becomes "primary"). Instances switch variants with oc_set_instance_props. To add a second axis such as size, set each variant\'s values with oc_set_component_props({variant: {variant: "primary", size: "md"}}).',
    inputShape: {
      fileId,
      componentIds: z.array(nodeId).min(1).describe("Main components with the same parent."),
      name: z.string().optional().describe('Set name, e.g. "Button".'),
      propName: z.string().optional().describe('Enum prop name (default "variant").'),
      values: z.array(z.string()).optional().describe("One variant value per component, in the same order."),
      codeRef: codeRef.optional(),
    },
  }),
  def({
    name: "oc_set_component_props",
    title: "Set component props",
    side: "editor",
    readOnly: false,
    description: "Edit a main component (or a component set): replace its prop definitions, set or clear its code mapping, rename it, change its description, or set its variant values when it is in a set. Instances update immediately and keep the values they set.",
    inputShape: {
      fileId,
      componentId: nodeId.describe("Main component or component set."),
      props: z.array(propDef).optional().describe("Full list of prop definitions (replaces the current list)."),
      codeRef: codeRef.nullable().optional().describe("Code mapping; null removes it."),
      variant: z.record(z.string(), z.string()).optional().describe('Variant values for a component in a set, e.g. {"variant": "primary", "size": "md"}.'),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
    },
  }),
  def({
    name: "oc_create_instance",
    title: "Create instance",
    side: "editor",
    readOnly: false,
    description: `Place an instance of a component inside a frame (or on the page). Pass prop values by name, including variant props such as {"variant": "ghost"}. Styles on the instance frame are kept as overrides; position styles place it.
You can also write instances with write_html: <x-instance component="Button" label="Shop" variant="ghost"></x-instance>, or with the code component tag from get_jsx (<Button variant="ghost">Shop</Button>) when the component has a code mapping. Fill slots with <x-slot name="slotProp">...</x-slot> inside it.`,
    inputShape: {
      fileId,
      componentId: z.string().min(1).describe("Component id, component or set name, or code export name."),
      parentId: nodeId.describe("Frame to place the instance in, or a page root id for a top-level instance."),
      index: z.number().int().optional().describe("Position among the parent's children (default: last)."),
      library: z.string().optional().describe("Library file id when the component comes from a subscribed library (see oc_list_components)."),
      props: z.record(z.string(), propValue).optional().describe('Prop values, e.g. {"label": "Shop the firing", "variant": "primary", "iconRight": false}.'),
      styles: z.record(z.string(), styleValue).optional().describe("Styles for the instance frame (left/top for top-level instances)."),
      name: z.string().optional().describe("Layer name (default: the component name)."),
    },
  }),
  def({
    name: "oc_set_instance_props",
    title: "Set instance props",
    side: "editor",
    readOnly: false,
    description: "Set prop values on instances: text, boolean and instance-swap values, and variant props (which switch the instance to the matching variant). Works on nested instances inside other instances too. Pass null to go back to the main component's value.",
    inputShape: {
      fileId,
      updates: z
        .array(z.object({ instanceId: nodeId, props: z.record(z.string(), propValue.nullable()) }))
        .min(1),
    },
  }),
  def({
    name: "oc_reset_overrides",
    title: "Reset overrides",
    side: "editor",
    readOnly: false,
    description: "Remove the overrides of instances (style, text, visibility and name changes made on the instance), so they match their main component again. Prop values stay. Pass a layer inside an instance to reset just that layer.",
    inputShape: { fileId, nodeIds: z.array(nodeId).min(1) },
  }),
  def({
    name: "oc_detach_instance",
    title: "Detach instance",
    side: "editor",
    readOnly: false,
    destructive: true,
    description: "Turn instances into ordinary layers that no longer follow their main component. Nested instances inside them stay instances. Use this only when a one-off change cannot be expressed as props or overrides.",
    inputShape: { fileId, nodeIds: z.array(nodeId).min(1) },
  }),
];
