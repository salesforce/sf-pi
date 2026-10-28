/* SPDX-License-Identifier: Apache-2.0 */
/** Translate Salesforce Flow deployment problems into stable rule ids and repair hints. */

export interface FlowFailureHint {
  rule_id: string;
  hint: string;
}

interface HintPattern extends FlowFailureHint {
  pattern: RegExp;
}

// Platform messages use both straight and typographic apostrophes, so patterns accept either.
const HINT_PATTERNS: HintPattern[] = [
  {
    pattern: /missing a type mapping/i,
    rule_id: "screen-component-contract",
    hint: "Add a dataTypeMappings entry (for example typeName T with the record object) to the screen component.",
  },
  {
    pattern: /can[’']t find this input attribute/i,
    rule_id: "screen-component-contract",
    hint: "Remove the inputParameter the component does not declare; use the field-level element instead when one exists.",
  },
  {
    pattern: /required input parameter is missing/i,
    rule_id: "screen-component-contract",
    hint: "Add the named required inputParameter to the screen component.",
  },
  {
    pattern: /assigned value must be a flow variable with the isCollection/i,
    rule_id: "collection-scalar-mismatch",
    hint: "Pass a record collection variable or a Get Records collection of the mapped type; a Collection Sort has no output, so sort a collection variable in place and reference that variable.",
  },
  {
    pattern: /type for the input parameter .* doesn[’']t match/i,
    rule_id: "collection-scalar-mismatch",
    hint: "Make the assigned resource the same object type as the component type mapping.",
  },
  {
    pattern:
      /mapping from .* isn[’']t supported\. Map to a target field that references an equal or greater number of collections/i,
    rule_id: "transform-scalar-into-collection",
    hint: "Make the first mapping of a collection Transform a per-item ([$EachItem]) source; a single value such as a parent Id can follow it.",
  },
  {
    pattern:
      /isn[’']t available to the flow|invalid reference to ".*\.(selectedRows|firstSelectedRow)/i,
    rule_id: "component-output-binding",
    hint: "Store the component outputs (storeOutputAutomatically) and read only selectedRows or firstSelectedRow.",
  },
  {
    pattern: /isn[’']t a valid reference/i,
    rule_id: "invalid-reference",
    hint: "Reference an existing resource of the expected type. A Collection Sort element sorts its input in place and cannot be referenced as an output.",
  },
  {
    pattern: /data type of .* can[’']t be/i,
    rule_id: "choice-set-datatype",
    hint: "Use the data type required by the resource, for example Picklist for a picklist-field choice set.",
  },
  {
    pattern: /condition doesn[’']t support/i,
    rule_id: "condition-operand-type",
    hint: "Compare compatible types. Cross-object paths such as Parent.Field are not supported in this element; query the parent records and filter by Id instead.",
  },
  {
    pattern: /null__NotFound/i,
    rule_id: "record-field-path",
    hint: "Get Records reads only fields on its own object; query related records separately and filter by Id.",
  },
  {
    pattern: /Enter a sort field for the/i,
    rule_id: "record-field-path",
    hint: "Sort Get Records by a field on its own object.",
  },
  {
    pattern: /field .* doesn[’']t exist/i,
    rule_id: "unknown-field",
    hint: "Use a field that exists on the element's object; Get Records cannot query parent fields with dotted paths.",
  },
];

export function flowFailureHint(problem: string): FlowFailureHint | undefined {
  const match = HINT_PATTERNS.find((candidate) => candidate.pattern.test(problem));
  return match ? { rule_id: match.rule_id, hint: match.hint } : undefined;
}
