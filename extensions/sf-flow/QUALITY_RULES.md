# SF Flow Quality Rules

SF Flow implements an independent, data-first quality engine for Salesforce Flow metadata. Rule concepts marked **Lightning Flow Scanner-inspired** are based on that project's published rule catalog and black-box package behavior. SF Flow does not include or import Lightning Flow Scanner production source code.

## White-Room Contract

- Public specifications: published rule IDs, labels, descriptions, package API, and observed black-box results.
- Independent implementation: SF Pi facts, evaluators, messages, severities, profiles, and source ranges.
- Fresh fixtures: SF Pi fixtures are written independently and are not copied from upstream examples.
- Dev-only oracle: `@flow-scanner/lightning-flow-scanner-core@6.19.4` runs only in parity tests.
- Production guard: tests reject any `@flow-scanner/*` import under `extensions/sf-flow/lib/`.
- Parity compares occurrence, affected element, applicability, and broad location. Exact messages are intentionally not copied.

## Profiles

**generation** runs the low-noise preventive rules used by `author.plan`, post-edit feedback, and local pre-validation diagnosis.

**review** includes generation rules plus implemented maintainability checks. Planned review rules remain explicit coverage gaps.

**audit** includes every implemented rule and reserves project/migration rules for later evaluators.

SF Flow has no numeric quality score. Findings, metrics, and coverage remain separate.

## Implemented Lightning Flow Scanner-Inspired Rules

| Rule ID                         | SF Pi category  | Default severity | Maturity | Notes                                                                     |
| ------------------------------- | --------------- | ---------------: | -------- | ------------------------------------------------------------------------- |
| `dml-in-loop`                   | Performance     |             High | Stable   | Create, Update, or Delete Records on a loop path                          |
| `soql-in-loop`                  | Performance     |             High | Stable   | Get Records on a loop path                                                |
| `hardcoded-id`                  | Reliability     |             High | Stable   | High-confidence 15/18-character ID literals                               |
| `hardcoded-secret`              | Security        |             High | Beta     | High-confidence private key, bearer, AWS, and Salesforce session patterns |
| `hardcoded-url`                 | Reliability     |         Moderate | Stable   | HTTP(S) endpoint literals                                                 |
| `unsafe-running-context`        | Security        |             High | Stable   | Screen/caller-launched Flow in system mode without sharing                |
| `duplicate-dml`                 | Reliability     |         Moderate | Stable   | Screen DML followed by a back-enabled downstream screen                   |
| `missing-fault-path`            | Reliability     |     Moderate/Low | Stable   | Existing SF Pi graph evaluator; Get Records remains lower severity        |
| `missing-null-handler`          | Reliability     |         Moderate | Stable   | Single-record lookup without an immediate decision                        |
| `recursive-record-update`       | Reliability     |         Moderate | Stable   | After-save update of the triggering record                                |
| `action-call-in-loop`           | Performance     |         Moderate | Stable   | Apex/plugin/action call on a loop iteration path                          |
| `get-record-all-fields`         | Performance     |         Moderate | Stable   | Automatic storage with no explicit queried fields                         |
| `invalid-api-version`           | Correctness     |         Moderate | Stable   | API version below the local authoring baseline                            |
| `missing-record-trigger-filter` | Performance     |         Moderate | Beta     | Record trigger with no Start filter or filter formula                     |
| `same-record-field-updates`     | Performance     |         Moderate | Stable   | Same-record DML where before-save assignment may apply                    |
| `missing-flow-description`      | Maintainability |         Moderate | Stable   | No Flow-level description                                                 |
| `unreachable-element`           | Correctness     |         Moderate | Stable   | Existing SF Pi reachability evaluator                                     |
| `unused-variable`               | Maintainability |              Low | Stable   | Local non-contract variable with no references                            |
| `missing-auto-layout`           | Layout          |              Low | Stable   | Canvas mode is not Auto-Layout                                            |
| `missing-start-reference`       | Correctness     |             High | Beta     | Start has no runnable path for the Flow family                            |

## Review and Audit Rules

These independently implemented rule concepts stay outside the automatic generation profile:

| Rule ID                           | Profile | Default severity | Maturity |
| --------------------------------- | ------- | ---------------: | -------- |
| `cognitive-complexity`            | Review  |              Low | Beta     |
| `excessive-cyclomatic-complexity` | Review  |              Low | Stable   |
| `unspecified-trigger-order`       | Review  |              Low | Stable   |
| `record-id-as-string`             | Review  |              Low | Beta     |
| `transform-instead-of-loop`       | Review  |              Low | Beta     |
| `missing-metadata-description`    | Review  |         Moderate | Beta     |
| `unclear-api-naming`              | Review  |         Moderate | Stable   |
| `process-builder-usage`           | Audit   |             High | Stable   |
| `inactive-flow`                   | Audit   |         Moderate | Stable   |
| `invalid-naming-convention`       | Audit   |             High | Stable   |

Profile exclusion is disclosed as policy scope, not represented as evidence that an excluded rule passed.

## Black-Box Parity Evidence

The pinned 6.19.4 oracle and SF Pi run against the same fresh fixtures for all 30 inspired rule concepts. Tests assert either matching occurrence or an explicit, reviewable divergence.

Current intentional SF Pi-broader cases are:

- `hardcoded-url`: also checks endpoint literals in text templates.
- `missing-null-handler`: expects an immediate found/not-found decision after a single-record lookup.
- `recursive-record-update` and `same-record-field-updates`: recognize same-object Id-filter updates directly.
- `duplicate-dml`: treats DML before a back-enabled downstream screen as repeatable.
- `missing-auto-layout`: reports absent CanvasMode on minimal new source.
- `missing-start-reference`: reports executable nodes without a Start edge and empty caller-launched or screen Flows that cannot run.
- `record-id-as-string`: reports an input String named like a record ID without requiring additional downstream shape, except for Omni-Channel Flows whose platform contract intentionally uses Text ID inputs.
- `inactive-flow`: audits Draft legacy Workflow metadata even though the pinned oracle excludes that process type from this rule.

These differences are independent SF Pi policy, not claims of strict upstream parity. Exact messages are never compared.

## SF Pi-Native Correctness Rules

These rules are independent SF Flow lifecycle checks rather than Lightning Flow Scanner parity targets:

- `xml-syntax`
- `flow-root`
- `required-core-metadata`
- `core-flow-family`
- `omni-channel-contract`
- `duplicate-name`
- `dangling-target`
- `unresolved-reference`
- `record-context`
- `element-not-allowed-before-save`
- `conflicting-create-output-storage`
- `invalid-async-path-configuration`
- `missing-async-path-entry-guard`
- `invalid-start-filter-logic`
- `invalid-record-filter`

## Acknowledgement

Rule design is informed by [Lightning Flow Scanner](https://lightningflowscanner.org/) and its [MIT-licensed repository](https://github.com/Flow-Scanner/lightning-flow-scanner). See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for the license notice.
