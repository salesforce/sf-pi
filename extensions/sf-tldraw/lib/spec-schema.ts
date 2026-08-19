/* SPDX-License-Identifier: Apache-2.0 */
/** Single runtime/static source of truth for Salesforce Diagram Spec v2. */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const ID_PATTERN = "^[A-Za-z][A-Za-z0-9._-]{0,79}$";
const API_NAME_PATTERN = "^[A-Za-z][A-Za-z0-9_]{0,127}$";
const ICON_NAME_PATTERN = "^[a-z0-9][a-z0-9_]{0,79}$";
const ORG_ALIAS_PATTERN = "^[A-Za-z0-9._-]{1,80}$";

const Id = Type.String({ pattern: ID_PATTERN });
const Evidence = Type.Array(Id, { minItems: 1 });
const Label = Type.String({ minLength: 1, maxLength: 120 });

export const DiagramSourceSchema = Type.Object(
  {
    id: Id,
    label: Label,
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    kind: StringEnum(["official_doc", "org_describe", "org_query", "user_provided"] as const),
  },
  { additionalProperties: false },
);

const GroundingBase = {
  as_of: Type.String({ minLength: 4, maxLength: 40 }),
  sources: Type.Array(DiagramSourceSchema, { minItems: 1 }),
};

export const ReferenceGroundingSchema = Type.Object(
  {
    mode: Type.Literal("reference"),
    ...GroundingBase,
  },
  { additionalProperties: false },
);

export const OrgGroundingSchema = Type.Object(
  {
    mode: Type.Literal("org"),
    ...GroundingBase,
    display_label: Type.String({ minLength: 1, maxLength: 80 }),
    target_org: Type.String({ pattern: ORG_ALIAS_PATTERN }),
  },
  { additionalProperties: false },
);

export const DiagramGroundingSchema = Type.Union([ReferenceGroundingSchema, OrgGroundingSchema]);

export const DiagramIconSchema = Type.Object(
  {
    category: StringEnum(["standard", "custom", "utility", "action", "doctype"] as const),
    name: Type.String({ pattern: ICON_NAME_PATTERN }),
    color: Type.Optional(Type.String({ pattern: "^#[0-9a-fA-F]{6}$" })),
  },
  { additionalProperties: false },
);

const BaseSpecFields = {
  title: Type.String({ minLength: 1, maxLength: 100 }),
  scope: Type.String({ minLength: 1, maxLength: 180 }),
  purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 180 })),
  grounding: DiagramGroundingSchema,
};

const BaseSpec = {
  spec_version: Type.Literal("2.0"),
  ...BaseSpecFields,
};

const RowCountSchema = Type.Object(
  {
    value: Type.Number({ minimum: 0 }),
    exact: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const ObservationsSchema = Type.Object(
  {
    row_count: Type.Optional(RowCountSchema),
    owd: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    record_types: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 20 }),
    ),
  },
  { additionalProperties: false },
);

export const DataModelObjectSchema = Type.Object(
  {
    id: Id,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    api_name: Type.Optional(Type.String({ pattern: API_NAME_PATTERN })),
    family: StringEnum(["standard", "custom", "external", "special"] as const),
    entity_kind: Type.Optional(
      StringEnum(["object", "record_type", "conceptual", "external"] as const),
    ),
    icon: Type.Optional(DiagramIconSchema),
    key_fields: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 4 }),
    ),
    observations: Type.Optional(ObservationsSchema),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const DataModelRelationshipSchema = Type.Object(
  {
    id: Id,
    from: Id,
    to: Id,
    type: StringEnum(["lookup", "master_detail"] as const),
    from_cardinality: StringEnum(["one", "many", "zero_or_one", "zero_or_many"] as const),
    to_cardinality: StringEnum(["one", "many", "zero_or_one", "zero_or_many"] as const),
    field_api_name: Type.Optional(Type.String({ pattern: API_NAME_PATTERN })),
    from_label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    to_label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const DataModelSpecSchema = Type.Object(
  {
    ...BaseSpec,
    family: Type.Literal("data_model"),
    objects: Type.Array(DataModelObjectSchema, { minItems: 1 }),
    relationships: Type.Array(DataModelRelationshipSchema),
  },
  { additionalProperties: false },
);

const NodeKind = StringEnum([
  "salesforce",
  "external",
  "user",
  "data_store",
  "integration",
] as const);

export const ArchitectureSystemSchema = Type.Object(
  {
    id: Id,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    kind: NodeKind,
    responsibility: Type.String({ minLength: 1, maxLength: 140 }),
    boundary: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    icon: Type.Optional(DiagramIconSchema),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const ArchitectureConnectionSchema = Type.Object(
  {
    id: Id,
    from: Id,
    to: Id,
    label: Type.String({ minLength: 1, maxLength: 100 }),
    meaning: StringEnum(["directional", "async_or_batch", "dependency"] as const),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const ArchitectureSpecSchema = Type.Object(
  {
    ...BaseSpec,
    family: Type.Literal("architecture"),
    systems: Type.Array(ArchitectureSystemSchema, { minItems: 1 }),
    connections: Type.Array(ArchitectureConnectionSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const SequenceParticipantSchema = Type.Object(
  {
    id: Id,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    kind: NodeKind,
    icon: Type.Optional(DiagramIconSchema),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const SequenceInteractionSchema = Type.Object(
  {
    id: Id,
    step: Type.Integer({ minimum: 1 }),
    from: Id,
    to: Id,
    label: Type.String({ minLength: 1, maxLength: 100 }),
    kind: StringEnum(["request", "response", "async", "event"] as const),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const SequenceActivationSchema = Type.Object(
  {
    id: Id,
    participant: Id,
    start_step: Type.Integer({ minimum: 1 }),
    end_step: Type.Integer({ minimum: 1 }),
    evidence: Evidence,
  },
  { additionalProperties: false },
);

export const SequenceSpecSchema = Type.Object(
  {
    ...BaseSpec,
    family: Type.Literal("sequence"),
    participants: Type.Array(SequenceParticipantSchema, { minItems: 1 }),
    interactions: Type.Array(SequenceInteractionSchema, { minItems: 1 }),
    activations: Type.Optional(Type.Array(SequenceActivationSchema)),
  },
  { additionalProperties: false },
);

/** Execute-time union of the three supported Salesforce Diagram Spec v2 families. */
export const SalesforceDiagramSpecSchema = Type.Union([
  DataModelSpecSchema,
  ArchitectureSpecSchema,
  SequenceSpecSchema,
]);

export type DiagramSource = Static<typeof DiagramSourceSchema>;
export type ReferenceGrounding = Static<typeof ReferenceGroundingSchema>;
export type OrgGrounding = Static<typeof OrgGroundingSchema>;
export type DiagramGrounding = Static<typeof DiagramGroundingSchema>;
export type DiagramIcon = Static<typeof DiagramIconSchema>;
export type IconCategory = DiagramIcon["category"];
export type ObjectFamily = Static<typeof DataModelObjectSchema>["family"];
export type DataModelEntityKind = NonNullable<Static<typeof DataModelObjectSchema>["entity_kind"]>;
export type EndpointCardinality = Static<typeof DataModelRelationshipSchema>["from_cardinality"];
export type DataModelObject = Static<typeof DataModelObjectSchema>;
export type DataModelRelationship = Static<typeof DataModelRelationshipSchema>;
type RawDataModelSpec = Static<typeof DataModelSpecSchema>;
export type DataModelSpec = Omit<RawDataModelSpec, "spec_version"> & { spec_version: "2.0" };
export type ArchitectureSystem = Static<typeof ArchitectureSystemSchema>;
export type ArchitectureConnection = Static<typeof ArchitectureConnectionSchema>;
type RawArchitectureSpec = Static<typeof ArchitectureSpecSchema>;
export type ArchitectureSpec = Omit<RawArchitectureSpec, "spec_version"> & { spec_version: "2.0" };
export type SequenceParticipant = Static<typeof SequenceParticipantSchema>;
export type SequenceInteraction = Static<typeof SequenceInteractionSchema>;
export type SequenceActivation = Static<typeof SequenceActivationSchema>;
type RawSequenceSpec = Static<typeof SequenceSpecSchema>;
export type SequenceSpec = Omit<RawSequenceSpec, "spec_version"> & { spec_version: "2.0" };
export type SalesforceDiagramSpec = DataModelSpec | ArchitectureSpec | SequenceSpec;
export type DiagramFamily = SalesforceDiagramSpec["family"];
