import { EncodedSourceMap } from '@jridgewell/gen-mapping';
import { z } from 'zod';

export interface SyntaxNode {
	type: string;
	text: string;
	startPosition: {
		row: number;
		column: number;
	};
	endPosition: {
		row: number;
		column: number;
	};
	startRow: number;
	startCol: number;
	endRow: number;
	endCol: number;
	namedChildren: SyntaxNode[];
	children: SyntaxNode[];
	childForFieldName(name: string): SyntaxNode | null;
	childrenForFieldName(name: string): SyntaxNode[];
	parent: SyntaxNode | null;
	previousSibling: SyntaxNode | null;
	/** Byte offset of the start of this node in the source text. */
	startOffset?: number;
	/** Byte offset of the end of this node in the source text. */
	endOffset?: number;
	/** Return the field name for the child at the given index, or null. */
	fieldNameForChild?(index: number): string | null;
	/** True if this node is an ERROR node (parse failure). */
	isError?: boolean;
	/** True if this node was inserted by the parser (expected but not found). */
	isMissing?: boolean;
	/** True if this is a "named" node (not anonymous punctuation/keyword). */
	isNamed?: boolean;
	/** True if this node or any descendant has an error. */
	hasError?: boolean;
	/** Return an s-expression string representation of this node (for debugging). */
	toSExp?(): string;
}
export interface Position {
	line: number;
	character: number;
}
interface Range$1 {
	start: Position;
	end: Position;
}
export interface CstMeta {
	node: SyntaxNode;
	range: Range$1;
}
/** Where a comment is placed relative to its owning AST node. */
export type CommentAttachment = "leading" | "inline" | "trailing";
interface Comment$1 {
	value: string;
	attachment: CommentAttachment;
	range?: Range$1;
}
/**
 * LSP DiagnosticSeverity values. MUST NOT be changed -- LSP clients depend on these exact values.
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnosticSeverity
 */
export declare enum DiagnosticSeverity {
	Error = 1,
	Warning = 2,
	Information = 3,
	Hint = 4
}
export declare enum DiagnosticTag {
	Unnecessary = 1,
	Deprecated = 2
}
export interface Diagnostic {
	range: Range$1;
	message: string;
	severity: DiagnosticSeverity;
	/** kebab-case, e.g., "syntax-error", "undefined-reference" */
	code?: string;
	/** "agentscript" (parser), "agentscript-schema", or "agentscript-lint" */
	source?: string;
	/** LSP DiagnosticTag values (Unnecessary=1, Deprecated=2) */
	tags?: DiagnosticTag[];
	/** Additional structured data for tooling (LSP-compatible) */
	data?: {
		context?: string;
		expected?: string[];
		found?: string;
		[key: string]: unknown;
	};
}
/**
 * A single highlight/query capture result.
 *
 * Produced by parseAndHighlight() and executeQuery().
 * The shape matches tree-sitter's QueryCapture format.
 */
interface HighlightCapture {
	/** Capture name (e.g., "keyword", "string", "variable") */
	name: string;
	/** The captured text */
	text: string;
	/** Start row (0-based) */
	startRow: number;
	/** Start column (0-based) */
	startCol: number;
	/** End row (0-based) */
	endRow: number;
	/** End column (0-based) */
	endCol: number;
}
/**
 * Parser object returned by getParser().
 */
export interface Parser {
	parse(source: string): {
		rootNode: SyntaxNode;
	};
}
/**
 * Get a parser object.
 *
 * Returns the WASM backend if initialized, otherwise the default backend.
 */
export declare function getParser(): Parser;
/**
 * Execute a highlight query against source code.
 *
 * Uses the WASM backend's executeQuery if initialized, otherwise
 * falls back to the default backend.
 */
export declare function executeQuery(source: string, querySource?: string): HighlightCapture[];
export declare function init(): Promise<void>;
export declare function createDiagnostic(rangeOrNode: Range$1 | Parsed<object> | SyntaxNode, message: string, severity?: DiagnosticSeverity, code?: string, data?: Diagnostic["data"]): Diagnostic;
export declare function undefinedReferenceDiagnostic(range: Range$1, message: string, referenceName: string, suggestion?: string, expected?: string[]): Diagnostic;
/**
 * Push a diagnostic onto an AST node's __diagnostics array.
 *
 * Throws if the node lacks __diagnostics, indicating a programming error
 * (not a valid AST node). All AST nodes initialize __diagnostics via
 * AstNodeBase, createNode(), or withCst().
 */
export declare function attachDiagnostic(node: AstNodeLike, diagnostic: Diagnostic): void;
export declare function typeMismatchDiagnostic(range: Range$1, message: string, expectedType: string, actualType: string, source?: string): Diagnostic;
export interface Expression {
	readonly __kind: string;
	__emit(ctx: EmitContext): string;
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	__comments?: Comment$1[];
	/** User-friendly description for error messages (e.g., "number 42") */
	__describe(): string;
}
export declare class StringLiteral extends AstNodeBase implements Expression {
	value: string;
	static readonly kind: "StringLiteral";
	static readonly kindLabel = "a string";
	readonly __kind: "StringLiteral";
	constructor(value: string);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<StringLiteral>;
}
/** A plain text segment within a template. */
export declare class TemplateText extends AstNodeBase {
	value: string;
	static readonly kind: "TemplateText";
	static readonly kindLabel = "template text";
	readonly __kind: "TemplateText";
	constructor(value: string);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
}
/** An interpolated expression `{!expr}` within a template. */
export declare class TemplateInterpolation extends AstNodeBase {
	expression: Expression;
	static readonly kind: "TemplateInterpolation";
	static readonly kindLabel = "template interpolation";
	readonly __kind: "TemplateInterpolation";
	constructor(expression: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
}
export type TemplatePart = TemplateText | TemplateInterpolation;
declare const ALL_TEMPLATE_PART_CLASSES: readonly [
	typeof TemplateText,
	typeof TemplateInterpolation
];
export type TemplatePartKind = (typeof ALL_TEMPLATE_PART_CLASSES)[number]["kind"];
export declare const TEMPLATE_PART_KINDS: ReadonlySet<TemplatePartKind>;
export declare function isTemplatePartKind(kind: string): kind is TemplatePartKind;
/** Parse template CST node into TemplatePart nodes with diagnostics. */
export declare function parseTemplateParts(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): {
	parts: TemplatePart[];
	diagnostics: Diagnostic[];
};
export declare class TemplateExpression extends AstNodeBase implements Expression {
	parts: TemplatePart[];
	static readonly kind: "TemplateExpression";
	static readonly kindLabel = "a template";
	readonly __kind: "TemplateExpression";
	/**
	 * When true, the `|` was on its own line with content on following lines.
	 * Detected from CST text: `|` followed by only whitespace/newline before content.
	 */
	barePipeMultiline: boolean;
	/**
	 * When true, emit a space between `|` and the content (e.g. `| Hello`).
	 * Detected from CST source text during parse; defaults to false for
	 * programmatically constructed templates.
	 */
	spaceAfterPipe: boolean;
	constructor(parts: TemplatePart[]);
	get content(): string;
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<TemplateExpression>;
}
export declare class NumberLiteral extends AstNodeBase implements Expression {
	value: number;
	static readonly kind: "NumberLiteral";
	static readonly kindLabel = "a number";
	readonly __kind: "NumberLiteral";
	constructor(value: number);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<NumberLiteral>;
}
export declare class BooleanLiteral extends AstNodeBase implements Expression {
	value: boolean;
	static readonly kind: "BooleanLiteral";
	static readonly kindLabel = "True or False";
	readonly __kind: "BooleanLiteral";
	constructor(value: boolean);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<BooleanLiteral>;
}
export declare class NoneLiteral extends AstNodeBase implements Expression {
	static readonly kind: "NoneLiteral";
	static readonly kindLabel = "None";
	readonly __kind: "NoneLiteral";
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<NoneLiteral>;
}
export declare class Identifier extends AstNodeBase implements Expression {
	name: string;
	static readonly kind: "Identifier";
	static readonly kindLabel = "an identifier";
	readonly __kind: "Identifier";
	constructor(name: string);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<Identifier>;
}
/**
 * Placeholder expression for values that failed to parse.
 * Preserves the raw source text for faithful round-trip emission.
 */
export declare class ErrorValue extends AstNodeBase implements Expression {
	rawText: string;
	static readonly kind: "ErrorValue";
	static readonly kindLabel = "an error value";
	readonly __kind: "ErrorValue";
	constructor(rawText: string);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
}
export declare class AtIdentifier extends AstNodeBase implements Expression {
	name: string;
	static readonly kind: "AtIdentifier";
	static readonly kindLabel = "a reference (e.g., @Foo)";
	readonly __kind: "AtIdentifier";
	constructor(name: string);
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<AtIdentifier>;
}
export declare class MemberExpression extends AstNodeBase implements Expression {
	object: Expression;
	property: string;
	static readonly kind: "MemberExpression";
	static readonly kindLabel = "a reference (e.g., @Foo.Bar)";
	readonly __kind: "MemberExpression";
	constructor(object: Expression, property: string);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<MemberExpression>;
}
export declare class SubscriptExpression extends AstNodeBase implements Expression {
	object: Expression;
	index: Expression;
	static readonly kind: "SubscriptExpression";
	static readonly kindLabel = "a subscript expression";
	readonly __kind: "SubscriptExpression";
	constructor(object: Expression, index: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<SubscriptExpression>;
}
export type BinaryOperator = "+" | "-" | "*" | "/" | "and" | "or";
export declare class BinaryExpression extends AstNodeBase implements Expression {
	left: Expression;
	operator: BinaryOperator;
	right: Expression;
	static readonly kind: "BinaryExpression";
	static readonly kindLabel = "a binary expression";
	readonly __kind: "BinaryExpression";
	constructor(left: Expression, operator: BinaryOperator, right: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<BinaryExpression>;
}
export type UnaryOperator = "not" | "+" | "-";
export declare class UnaryExpression extends AstNodeBase implements Expression {
	operator: UnaryOperator;
	operand: Expression;
	static readonly kind: "UnaryExpression";
	static readonly kindLabel = "a unary expression";
	readonly __kind: "UnaryExpression";
	constructor(operator: UnaryOperator, operand: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<UnaryExpression>;
}
export type ComparisonOperator = "==" | "!=" | "<" | ">" | "<=" | ">=" | "is" | "is not";
export declare class ComparisonExpression extends AstNodeBase implements Expression {
	left: Expression;
	operator: ComparisonOperator;
	right: Expression;
	static readonly kind: "ComparisonExpression";
	static readonly kindLabel = "a comparison";
	readonly __kind: "ComparisonExpression";
	constructor(left: Expression, operator: ComparisonOperator, right: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<ComparisonExpression>;
}
export declare class ListLiteral extends AstNodeBase implements Expression {
	elements: Expression[];
	static readonly kind: "ListLiteral";
	static readonly kindLabel = "a list";
	readonly __kind: "ListLiteral";
	constructor(elements: Expression[]);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<ListLiteral>;
}
export declare class DictLiteral extends AstNodeBase implements Expression {
	entries: Array<AstNode<{
		key: Expression;
		value: Expression;
	}>>;
	static readonly kind: "DictLiteral";
	static readonly kindLabel = "a dictionary";
	readonly __kind: "DictLiteral";
	constructor(entries: Array<AstNode<{
		key: Expression;
		value: Expression;
	}>>);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<DictLiteral>;
}
/**
 * A function call expression, e.g. len(x)
 */
export declare class CallExpression extends AstNodeBase implements Expression {
	func: Expression;
	args: Expression[];
	static readonly kind: "CallExpression";
	static readonly kindLabel = "a function call";
	readonly __kind: "CallExpression";
	constructor(func: Expression, args: Expression[]);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<CallExpression>;
}
/**
 * Python-style ternary: consequence if condition else alternative
 */
export declare class TernaryExpression extends AstNodeBase implements Expression {
	consequence: Expression;
	condition: Expression;
	alternative: Expression;
	static readonly kind: "TernaryExpression";
	static readonly kindLabel = "a ternary expression";
	readonly __kind: "TernaryExpression";
	constructor(consequence: Expression, condition: Expression, alternative: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<TernaryExpression>;
}
export declare class Ellipsis extends AstNodeBase implements Expression {
	static readonly kind: "Ellipsis";
	static readonly kindLabel = "an ellipsis (...)";
	readonly __kind: "Ellipsis";
	__describe(): string;
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode): Parsed<Ellipsis>;
}
/**
 * A spread/unpack expression, e.g. *items or *@variables.artifacts
 * Python-style iterable unpacking in function calls and list literals.
 */
export declare class SpreadExpression extends AstNodeBase implements Expression {
	expression: Expression;
	static readonly kind: "SpreadExpression";
	static readonly kindLabel = "a spread expression";
	readonly __kind: "SpreadExpression";
	constructor(expression: Expression);
	__describe(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<SpreadExpression>;
}
export interface AtMemberDecomposition {
	namespace: string;
	property: string;
}
/**
 * Decompose a `namespace.property` member expression into its parts.
 * Matches `@namespace.property` (AtIdentifier) unconditionally.
 * Also matches bare `namespace.property` (Identifier) when the name
 * appears in the optional {@link knownNamespaces} set.
 */
export declare function decomposeMemberExpression(expr: unknown, knownNamespaces?: ReadonlySet<string>): AtMemberDecomposition | null;
/**
 * Decompose an `@namespace.property` expression into its parts.
 * Returns null if the expression is not a MemberExpression with an AtIdentifier object.
 */
export declare function decomposeAtMemberExpression(expr: unknown): AtMemberDecomposition | null;
declare const ALL_EXPRESSION_CLASSES: readonly [
	typeof StringLiteral,
	typeof TemplateExpression,
	typeof NumberLiteral,
	typeof BooleanLiteral,
	typeof NoneLiteral,
	typeof Identifier,
	typeof AtIdentifier,
	typeof MemberExpression,
	typeof SubscriptExpression,
	typeof BinaryExpression,
	typeof UnaryExpression,
	typeof ComparisonExpression,
	typeof TernaryExpression,
	typeof CallExpression,
	typeof ListLiteral,
	typeof DictLiteral,
	typeof Ellipsis,
	typeof SpreadExpression
];
export type ExpressionKind = (typeof ALL_EXPRESSION_CLASSES)[number]["kind"];
export interface Statement {
	readonly __kind: string;
	__emit(ctx: EmitContext): string;
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	__comments?: Comment$1[];
}
export declare class Template extends AstNodeBase implements Statement {
	parts: TemplatePart[];
	readonly __kind = "Template";
	/**
	 * When true, the `|` was on its own line with content on following lines.
	 * Detected from CST: `|` followed by only whitespace/newline before content.
	 */
	barePipeMultiline: boolean;
	/**
	 * When true, emit a space between `|` and the content (e.g. `| Hello`).
	 * Detected from CST source text during parse; defaults to false for
	 * programmatically constructed templates.
	 */
	spaceAfterPipe: boolean;
	constructor(parts: TemplatePart[]);
	get content(): string;
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<Template>;
}
export declare class WithClause extends AstNodeBase implements Statement {
	param: string;
	value: Expression;
	readonly __kind = "WithClause";
	__paramCstNode?: SyntaxNode;
	constructor(param: string, value: Expression);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<WithClause>;
	/** Desugar comma-separated `with x=a,y=b` into separate WithClause nodes. */
	static parseAll(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<WithClause>[];
}
export declare class SetClause extends AstNodeBase implements Statement {
	target: Expression;
	value: Expression;
	readonly __kind = "SetClause";
	constructor(target: Expression, value: Expression);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<SetClause>;
}
export declare class ToClause extends AstNodeBase implements Statement {
	target: Expression;
	readonly __kind = "ToClause";
	constructor(target: Expression);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<ToClause>;
}
export declare class AvailableWhen extends AstNodeBase implements Statement {
	condition: Expression;
	readonly __kind = "AvailableWhen";
	constructor(condition: Expression);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<AvailableWhen>;
}
export declare class RunStatement extends AstNodeBase implements Statement {
	target: Expression;
	body: Statement[];
	readonly __kind = "RunStatement";
	constructor(target: Expression, body: Statement[]);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression, parseStmt: (n: SyntaxNode) => Statement | Statement[] | null): Parsed<RunStatement>;
}
export declare class IfStatement extends AstNodeBase implements Statement {
	condition: Expression;
	body: Statement[];
	orelse: Statement[];
	readonly __kind = "IfStatement";
	constructor(condition: Expression, body: Statement[], orelse?: Statement[]);
	__emit(ctx: EmitContext): string;
	private __emitConditional;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression, parseProcedure: (n: SyntaxNode) => Statement[]): Parsed<IfStatement>;
}
export declare class TransitionStatement extends AstNodeBase implements Statement {
	clauses: Statement[];
	readonly __kind = "TransitionStatement";
	constructor(clauses: Statement[]);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, parseExpr: (n: SyntaxNode) => Expression): Parsed<TransitionStatement>;
}
/**
 * Represents an unrecognized CST node found in a statement context.
 * Preserves the original text so round-trip emit doesn't silently lose content,
 * and carries a diagnostic so the user is informed of the problem.
 */
export declare class UnknownStatement extends AstNodeBase implements Statement {
	text: string;
	readonly __kind = "UnknownStatement";
	constructor(text: string);
	__emit(ctx: EmitContext): string;
}
export interface BlockCore {
	__kind: string;
	__symbol?: SymbolMeta;
	__name?: string;
	__scope?: string;
	/**
	 * @internal Ordered list of children, preserving CST structure for faithful
	 * round-trip emission.
	 *
	 * **Single source of truth.** For simple fields, FieldChild stores the canonical
	 * value and block properties are getter/setter accessors that delegate here.
	 * For NamedMap/TypedMap, MapEntryChild entries store entries. For SequenceNode,
	 * SequenceItemChild entries store items.
	 */
	__children?: BlockChild[];
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	__comments?: Comment$1[];
	__emit(ctx: EmitContext): string;
	/** Schema-defined fields are set dynamically via Object.defineProperty. */
	[key: string]: unknown;
}
/** Build the canonical NamedMap label for a given collection key. */
export declare function collectionLabel(key: string): string;
/**
 * Map-like collection that also implements BlockCore.
 *
 * Used for NamedBlock collections (e.g., `actions:`) and
 * TypedMap entries (e.g., `variables:`, `inputs:`, `outputs:`).
 *
 * Maintains an O(1) lookup index while preserving CST insertion order
 * in `__children` for emission.
 */
export declare class NamedMap<T> implements BlockCore {
	[key: string]: unknown;
	/** @internal Brand for `isNamedMap` type guard. */
	readonly [NAMED_MAP_BRAND] = true;
	__kind: string;
	__symbol?: SymbolMeta;
	__children: BlockChild[];
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	__comments?: Comment$1[];
	/** @internal Lazily-derived O(1) lookup index — keys → MapEntryChild. */
	private _mapIndex;
	/** Create a NamedMap with the canonical collection label for the given key. */
	static forCollection<T>(key: string, options?: {
		symbol?: SymbolMeta;
		entries?: Iterable<[
			string,
			T
		]>;
	}): NamedMap<T>;
	constructor(kind: string, options?: {
		symbol?: SymbolMeta;
		entries?: Iterable<[
			string,
			T
		]>;
	});
	get size(): number;
	get(key: string): T | undefined;
	has(key: string): boolean;
	set(key: string, value: T): this;
	delete(key: string): boolean;
	clear(): void;
	private _entries;
	entries(): IterableIterator<[
		string,
		T
	]>;
	keys(): IterableIterator<string>;
	values(): IterableIterator<T>;
	forEach(callbackfn: (value: T, key: string, map: NamedMap<T>) => void): void;
	[Symbol.iterator](): IterableIterator<[
		string,
		T
	]>;
	toJSON(): Record<string, T>;
	__emit(ctx: EmitContext): string;
}
/** Contract for __children entries that can emit source text. */
export interface Emittable {
	readonly __type: string;
	__emit(ctx: EmitContext): string;
}
/**
 * A parsed schema field stored in __children. Self-emitting.
 *
 * Stores the canonical value for the field. The block's property is an
 * accessor (getter/setter) that delegates here.
 */
export declare class FieldChild implements Emittable {
	readonly key: string;
	private _fieldType;
	/** Set for document-level named entries (e.g., `topic main:`). */
	readonly entryName?: string | undefined;
	/** Source range of the key token, for diagnostic positioning. */
	readonly __keyRange?: Range$1 | undefined;
	readonly __type: "field";
	private _value;
	/** Original CST mapping_element text for verbatim emission. */
	__elementText?: string;
	/** Column of the original CST mapping_element for verbatim emission. */
	__elementColumn?: number;
	constructor(key: string, value: unknown, _fieldType: FieldType, 
	/** Set for document-level named entries (e.g., `topic main:`). */
	entryName?: string | undefined, 
	/** Source range of the key token, for diagnostic positioning. */
	__keyRange?: Range$1 | undefined);
	get value(): unknown;
	set value(newValue: unknown);
	__emit(ctx: EmitContext): string;
}
/**
 * A named entry in a NamedMap or TypedMap stored in __children.
 * Wraps a value with its name for ordered emission.
 */
export declare class MapEntryChild<T = unknown> implements Emittable {
	readonly name: string;
	readonly __type: "map_entry";
	value: T;
	/** Original CST mapping_element text for verbatim emission. */
	__elementText?: string;
	/** Column of the original CST mapping_element for verbatim emission. */
	__elementColumn?: number;
	constructor(name: string, value: T);
	__emit(ctx: EmitContext): string;
}
/**
 * A sequence item stored in SequenceNode.__children. Self-emitting.
 * Handles dash-prefix formatting for YAML-style sequence emission.
 */
export declare class SequenceItemChild implements Emittable {
	readonly __type: "sequence_item";
	value: unknown;
	constructor(value: unknown);
	__emit(ctx: EmitContext): string;
}
export declare class ErrorBlock implements Emittable {
	readonly __type: "error";
	readonly __kind: "ErrorBlock";
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	/** Normalized raw text with zero-based relative indentation. */
	readonly rawText: string;
	readonly originalIndent: number;
	constructor(rawText: string, originalIndent: number);
	__emit(ctx: EmitContext): string;
}
/**
 * Structured representation of an unknown/unrecognized block.
 *
 * Combines raw-text emission (like ErrorBlock, for round-trip fidelity)
 * with structured `__children` parsed from the CST. This enables
 * downstream tooling (symbols, completions, walkers) to operate
 * inside unknown blocks while preserving faithful emission.
 */
export declare class UntypedBlock implements Emittable {
	/** The unrecognized key (e.g., "tpoic"). */
	readonly key: string;
	readonly __type: "untyped";
	readonly __kind: "UntypedBlock";
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	__comments?: Comment$1[];
	/** Structured children for analysis (symbols, walkers, completions). */
	__children: BlockChild[];
	/** Normalized raw text with zero-based relative indentation. */
	readonly rawText?: string;
	readonly originalIndent: number;
	/**
	 * The second key id (e.g., "billing" in "tpoic billing:").
	 * Stored with __ prefix to avoid collision with defineFieldAccessors
	 * which can create a `name` property accessor when a child has key "name".
	 */
	readonly __blockName?: string;
	/**
	 * Public accessor for the second key id.
	 * NOTE: defineFieldAccessors may overwrite this with a getter for a child
	 * named "name". Internal emission uses __blockName to avoid this.
	 */
	get name(): string | undefined;
	constructor(
	/** The unrecognized key (e.g., "tpoic"). */
	key: string, 
	/** The second id if present (e.g., "billing" in "tpoic billing:"). */
	name?: string, 
	/** Raw element text for faithful emission. */
	rawText?: string, 
	/** Column offset for re-indentation during emission. */
	originalIndent?: number);
	__emit(ctx: EmitContext): string;
}
/**
 * A colinear expression value stored in __children (e.g., `@actions.send_email`
 * in `send_email: @actions.send_email`). Emission is handled by the parent
 * block's __emit — this child just stores the canonical value.
 */
export declare class ValueChild implements Emittable {
	readonly __type: "value";
	value: unknown;
	constructor(value: unknown);
	/** Value emission is handled inline by the parent; this is a no-op. */
	__emit(_ctx: EmitContext): string;
}
/**
 * A statement stored in __children (e.g., `with`, `set`, `to`, `available when`).
 * Self-emitting — delegates to the wrapped statement's __emit.
 */
export declare class StatementChild implements Emittable {
	readonly __type: "statement";
	value: Statement;
	constructor(statement: Statement);
	__emit(ctx: EmitContext): string;
}
export type BlockChild = FieldChild | ErrorBlock | UntypedBlock | MapEntryChild | SequenceItemChild | ValueChild | StatementChild;
/**
 * Type guard for BlockChild values.
 * All BlockChild variants carry a `__type` discriminant string.
 */
export declare function isBlockChild(value: unknown): value is BlockChild;
/**
 * Type guard for named block instances that support `emitWithKey`.
 * Uses `__kind` as a reliable discriminator (only block instances have it)
 * rather than raw structural duck-typing on arbitrary objects.
 */
export declare function isNamedBlockValue(v: unknown): v is BlockCore & {
	emitWithKey: (key: string, ctx: EmitContext) => string;
};
/**
 * Type guard for objects with an `__emit` method.
 * Matches blocks, statements, and expressions — anything that can emit source text.
 */
export declare function isEmittable(value: unknown): value is BlockCore & {
	__emit(ctx: EmitContext): string;
};
/**
 * Type guard for singular (unnamed) block instances.
 * These have `__kind` and `__children` (block structure) but no `__name`,
 * which distinguishes them from named blocks and from statements/expressions
 * that also carry `__kind`.
 */
export declare function isSingularBlock(value: unknown): value is BlockCore;
/** Emit an array of BlockChild entries, filtering empty results. */
export declare function emitChildren(children: BlockChild[], ctx: EmitContext, sep?: string): string;
/**
 * Define getter/setter property accessors on the block for each simple
 * (non-named) FieldChild, delegating to FieldChild as the single source
 * of truth.
 *
 * Accessors are defined as own properties (not prototype) so that
 * `Object.keys()` and `Object.entries()` pick them up — which is required
 * by AST walkers.
 *
 * **Serialization note:** `JSON.stringify` calls getters, so serialization
 * works. `Object.assign({}, block)` produces value snapshots (not accessor
 * delegation). `console.log` may show `[Getter/Setter]` — use `.toJSON()`
 * or explicit property access for cleaner output.
 *
 * **Invariant:** Each accessor closes over its `FieldChild` instance. If
 * `__children` is ever replaced (e.g., via `.filter()`), the replacement
 * **must** preserve all `FieldChild` entries — otherwise the accessor will
 * silently read/write an orphaned `FieldChild` that is no longer in the
 * array. Mutations that only add or remove non-field children (statements,
 * values, errors) are safe. Dropping a `FieldChild` from the array without
 * re-defining the accessor is a bug.
 */
export declare function defineFieldAccessors(block: object, children: BlockChild[]): void;
/**
 * Extract `__children` from a parse result, returning cleaned fields and children separately.
 *
 * Used at boundaries where `parseMappingElements` results feed into Block constructors,
 * so internal metadata isn't smuggled through the `InferFields<T>` type boundary.
 * Centralizes the extraction so that a rename of `__children` only needs to change here.
 */
export declare function extractChildren(parsed: Record<string, unknown> & {
	__children?: BlockChild[];
}): {
	fields: Record<string, unknown>;
	children: BlockChild[] | undefined;
};
/** Shared base for typed declarations (variables, parameters). */
export declare abstract class TypedDeclarationBase extends AstNodeBase {
	abstract readonly __kind: string;
	abstract readonly __symbol: SymbolMeta;
	type: Expression;
	defaultValue?: Expression;
	properties?: BlockCore;
	__children: BlockChild[];
	constructor(data: {
		type: Expression;
		defaultValue?: Expression;
		properties?: BlockCore;
	});
}
/** Variable declaration node with optional modifier (mutable/linked). */
export declare class VariableDeclarationNode extends TypedDeclarationBase {
	readonly __kind: "VariableDeclaration";
	readonly __symbol: SymbolMeta;
	modifier?: Identifier;
	constructor(data: {
		type: Expression;
		defaultValue?: Expression;
		modifier?: Identifier;
		properties?: BlockCore;
	});
}
/** Parameter declaration node (no modifier). */
export declare class ParameterDeclarationNode extends TypedDeclarationBase {
	readonly __kind: "ParameterDeclaration";
	readonly __symbol: SymbolMeta;
	constructor(data: {
		type: Expression;
		defaultValue?: Expression;
		properties?: BlockCore;
	});
}
/**
 * Configuration for discriminant-based schema variant resolution.
 * When provided to `parseMappingElements`, a pre-scan extracts the
 * discriminant field value and selects the corresponding variant schema.
 */
export interface DiscriminantConfig {
	/** The field name whose value selects the variant (e.g., "kind") */
	field: string;
	/** Variant schemas keyed by discriminant value, already merged with base schema */
	variants: Record<string, Record<string, FieldType>>;
	/** Valid variant names for error messages */
	validValues: string[];
}
export declare class Dialect {
	/** Parse source from parser CST using the given schema. */
	parse<T extends Schema>(node: SyntaxNode, schema: T): ParseResult<InferFields<T>>;
	parseComment(node: SyntaxNode, attachment?: CommentAttachment): Comment$1;
	/** Build the schema path by walking up the CST to the document root. */
	private buildContextPath;
	/**
	 * Build a human-readable location string for diagnostics in statement context.
	 * e.g. `" in topic 'test' before_reasoning"` from path [topic, test, before_reasoning].
	 */
	private formatStatementContext;
	/**
	 * Parse a mapping block using the given schema.
	 * Infers cardinality from key structure (1 id = singular, 2 ids = map).
	 */
	parseMapping<T extends Schema>(node: SyntaxNode, schema: T, extraElements?: SyntaxNode[], options?: {
		preserveOrphanedStatements?: boolean;
		discriminant?: DiscriminantConfig;
	}): ParseResult<InferFields<T>>;
	/**
	 * Core parsing engine used by parseMapping() and Sequence.
	 * Accepts an explicit list of elements so callers can merge elements
	 * from different CST locations.
	 */
	parseMappingElements<T extends Schema>(elements: SyntaxNode[], schema: T, cstNode: SyntaxNode, discriminant?: DiscriminantConfig): ParseResult<InferFields<T>>;
	/**
	 * Parse a singular field value (Block, TypedMap, or Primitive).
	 * Handles comment splitting (before/after body), dedented comment detection,
	 * and key-only fallbacks for empty blocks and typed maps.
	 */
	private parseSingularField;
	/** Extract comments on the same line as an element (inline comments). */
	private parseInlineComments;
	/** Extract all comment children from an element. */
	private parseElementComments;
	/**
	 * Split comments into those before and after a value node's range.
	 *
	 * Comments without source range info (programmatic comments) are always
	 * placed in `beforeBody`. The `afterBody` array is guaranteed to contain
	 * only comments with range info, since only comments whose source line
	 * falls after the value node can land there.
	 */
	private splitContainerComments;
	/** Attach comments to the first entry of a TypedMap-like value. */
	private attachToFirstTypedMapEntry;
	/** Attach comments to the first statement in a procedure-like value. */
	private attachToFirstProcedureStatement;
	/** Attach comments as trailing to the last statement in a procedure-like value. */
	private attachToLastProcedureStatement;
	private parseNamedEntry;
	/** Returns [typeId, nameId?] where nameId is present for 2-id keys. */
	getKeyIds(element: SyntaxNode): [
		string,
		string | undefined
	];
	/** Parse an expression from CST, dispatching by node type. */
	parseExpression(node: SyntaxNode): Expression;
	/** Unwrap atom/expression wrapper nodes that delegate to children. */
	private unwrapExpression;
	parseProcedure(node: SyntaxNode): Statement[];
	/**
	 * Parse both mapping fields and statements from a block body node.
	 * Works uniformly for procedure, mapping, or mixed block bodies.
	 */
	parseBlockContent<T extends Schema>(node: SyntaxNode, blockSchema: T, options?: {
		discriminant?: DiscriminantConfig;
	}): {
		fields: InferFields<T>;
		statements: Statement[];
		diagnostics: Diagnostic[];
	};
	/**
	 * Parse an array of CST nodes as statements.
	 * @param procedureContext When true, mapping_element nodes are flagged as
	 *   invalid (procedures should only contain statements). When false
	 *   (default), mapping_element and comment nodes are silently skipped
	 *   because they are handled by parseMapping in parseBlockContent.
	 */
	parseStatementNodes(nodes: SyntaxNode[], procedureContext?: boolean): Statement[];
	/**
	 * Parse a single statement from CST.
	 * May return an array for desugared nodes (e.g. comma-separated with clauses).
	 * Returns an UnknownStatement with a diagnostic for unrecognized node types
	 * in procedure context, so content is never silently dropped.
	 */
	parseStatement(node: SyntaxNode, procedureContext?: boolean): Statement | Statement[] | null;
	parseVariableDeclaration(node: SyntaxNode): Parsed<VariableDeclarationNode>;
	emit(value: unknown, indent?: number): string;
}
/** Parse a CST comment node into a Comment object. */
export declare function parseCommentNode(node: SyntaxNode, attachment?: CommentAttachment): Comment$1;
export type AstNode<T> = T & {
	__cst?: CstMeta;
	__diagnostics: Diagnostic[];
	__comments?: Comment$1[];
};
export type Parsed<T> = AstNode<T> & {
	__cst: CstMeta;
};
/**
 * Base type for a parsed AST root node with metadata.
 * Extends AstNodeLike so internal analysis code can access schema-defined
 * fields via the index signature without casting.
 */
export interface AstRoot extends AstNodeLike {
	__cst: CstMeta;
	__diagnostics: Diagnostic[];
}
export declare function withCst<T extends object>(ast: T, node: SyntaxNode): Parsed<T>;
export declare function createNode<T extends object>(ast: T): AstNode<T>;
/** Provides common AST metadata fields shared by expression and statement classes. */
export declare abstract class AstNodeBase {
	__diagnostics: Diagnostic[];
	__cst?: CstMeta;
	__comments?: Comment$1[];
}
/** Extract the text content of a key child node (either 'id' or 'string'). */
export declare function getKeyText(node: SyntaxNode): string;
/** Quotes the key name if it contains non-identifier characters. */
export declare function emitKeyName(name: string): string;
export declare function isKeyNode(node: SyntaxNode): boolean;
export interface EmitContext {
	indent: number;
	/** Spaces per indent level (default 4). */
	tabSize?: number;
}
export declare function emitIndent(ctx: EmitContext): string;
/** Structural type for any AST node that can carry comments. */
export interface CommentTarget {
	__cst?: CstMeta;
	__comments?: Comment$1[];
}
/** Filter comments by attachment position. */
export declare function leadingComments(node: CommentTarget | null | undefined): Comment$1[];
/** Filter comments by attachment position. */
export declare function trailingComments(node: CommentTarget | null | undefined): Comment$1[];
/** Filter comments by attachment position. */
export declare function inlineComments(node: CommentTarget | null | undefined): Comment$1[];
/**
 * LSP SymbolKind values. MUST NOT be changed -- LSP clients depend on these exact values.
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
 */
export declare enum SymbolKind {
	File = 1,
	Module = 2,
	Namespace = 3,
	Package = 4,
	Class = 5,
	Method = 6,
	Property = 7,
	Field = 8,
	Constructor = 9,
	Enum = 10,
	Interface = 11,
	Function = 12,
	Variable = 13,
	Constant = 14,
	String = 15,
	Number = 16,
	Boolean = 17,
	Array = 18,
	Object = 19,
	Key = 20,
	Null = 21,
	EnumMember = 22,
	Struct = 23,
	Event = 24,
	Operator = 25,
	TypeParameter = 26
}
export interface SymbolMeta {
	kind: SymbolKind;
	noRecurse?: boolean;
}
/**
 * Internal type for schema-driven tree walking (lint passes, scope analysis,
 * completions). The index signature allows dynamic access to schema-defined
 * fields whose names are only known at runtime.
 *
 * Contrast with {@link AstRoot} which is the consumer-facing strict type
 * without an index signature. Use {@link astField} for dynamic access on
 * AstRoot; use AstNodeLike's index signature for internal traversal code.
 */
export interface AstNodeLike {
	__kind?: string;
	__cst?: CstMeta;
	__diagnostics?: Diagnostic[];
	__children?: BlockChild[];
	__scope?: string;
	__name?: string;
	__symbol?: SymbolMeta;
	__comments?: Comment$1[];
	[key: string]: unknown;
}
export interface ParseResult<T> {
	value: Parsed<T>;
	diagnostics: Diagnostic[];
}
export declare function parseResult<T>(value: Parsed<T>, diagnostics: Diagnostic[]): ParseResult<T>;
export type Schema = Record<string, FieldType | FieldType[]>;
/** A wildcard prefix that matches field names starting with a given string. */
export interface WildcardPrefix {
	readonly prefix: string;
	readonly fieldType: FieldType;
}
/**
 * Schema keys whose field types are colinear-scannable (not Block, Collection, or TypedMap).
 * Discriminant fields must be colinear scalar values that prescanDiscriminantValue() can read.
 */
export type ColinearFieldKeys<T extends Schema> = {
	[K in keyof T & string]: T[K] extends {
		readonly __fieldKind: "Block" | "Collection" | "TypedMap";
	} ? never : K;
}[keyof T & string];
/** Semantic capability that a block type declares (e.g., can be called as a tool, can be transitioned to). */
export type BlockCapability = "invocationTarget" | "transitionTarget";
/** Value-level validation constraints, modeled after JSON Schema. */
export interface ConstraintMetadata {
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	multipleOf?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	enum?: ReadonlyArray<string | number | boolean>;
	const?: string | number | boolean;
	minItems?: number;
	maxItems?: number;
	/** Restrict ReferenceValue to only allow these @namespaces. */
	allowedNamespaces?: ReadonlyArray<string>;
	/** The resolved expression must reference a namespace with this capability (e.g. 'invocationTarget'). */
	resolvedType?: BlockCapability;
}
/**
 * Metadata that describes any named language concept — fields, keywords, types.
 * This is the base for both schema field metadata and keyword documentation.
 */
export interface DocumentationMetadata {
	description?: string;
	example?: string;
	minVersion?: string;
	deprecated?: {
		message?: string;
		since?: string;
		removeIn?: string;
		replacement?: string;
	};
	experimental?: boolean;
}
/** Full metadata for a schema field — extends DocumentationMetadata with field-specific behavior. */
export interface FieldMetadata extends DocumentationMetadata {
	required?: boolean;
	/** When true, collection fields must contain at most one entry. */
	singular?: boolean;
	constraints?: ConstraintMetadata;
	/** When true, ProcedureValue fields emit without the arrow (->) syntax. */
	omitArrow?: boolean;
	/** When true, ProcedureValue fields disallow Template statements. */
	disallowTemplates?: boolean;
	/**
	 * When true, this scoped namespace supports cross-block @namespace.member
	 * references via colinear resolution. For example, marking `outputs` as
	 * crossBlockReferenceable means `@outputs.result` inside a reasoning action
	 * resolves against the outputs of the action referenced by the sibling
	 * colinear value (e.g., `@actions.fetch_data`).
	 */
	crossBlockReferenceable?: boolean;
	/** When true, the field is valid in the schema but not shown in code completions. */
	hidden?: boolean;
}
/**
 * Describes a keyword in the language (e.g., a modifier like `mutable` or a type like `string`).
 *
 * @example
 * ```ts
 * { keyword: 'mutable', description: 'A variable that can change during the conversation.' }
 * ```
 */
export interface KeywordInfo {
	keyword: string;
	description?: string;
	metadata?: DocumentationMetadata;
}
/** Extract just the keyword name strings from a KeywordInfo array. */
export declare function keywordNames(keywords: readonly KeywordInfo[]): string[];
export interface FieldTypeBase<V = any, F = V> {
	readonly __fieldKind: "Block" | "TypedMap" | "Collection" | "Primitive" | "Sequence";
	/**
	 * Phantom field carrying the type that appears on a parent block when this
	 * field type is used in a schema. For primitives F = V. For NamedBlock
	 * F = NamedMap<Parsed<...>>. Pre-computed at each factory call site
	 * so InferFields never recurses — Zod-style eager resolution.
	 */
	readonly __fieldOutput?: F;
	__accepts?: string[];
	__metadata?: FieldMetadata;
	emit: (value: V, ctx: EmitContext) => string;
	emitField?: (key: string, value: V, ctx: EmitContext) => string;
	schema?: Schema;
	scopeAlias?: string;
	/** Semantic capabilities declared by this block type (e.g., 'invocationTarget', 'transitionTarget'). */
	readonly capabilities?: readonly BlockCapability[];
	readonly __isCollection?: boolean;
	readonly __isTypedMap?: boolean;
	propertiesSchema?: Schema;
	__modifiers?: readonly KeywordInfo[];
	__primitiveTypes?: readonly KeywordInfo[];
	/** The discriminant field name, if using field-based discrimination. */
	readonly discriminantField?: string;
	/** Resolve variant schema by discriminant field value. */
	resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
}
/** All field types: parse(node, dialect). */
export interface SingularFieldType<V = any, F = V> extends FieldTypeBase<V, F> {
	isNamed?: false;
	parse: (node: SyntaxNode, dialect: Dialect, extraElements?: SyntaxNode[]) => ParseResult<V>;
}
export type FieldType<V = any, F = V> = SingularFieldType<V, F>;
export type ResolveFieldType<T> = T extends FieldType[] ? FieldType : T & FieldType;
/**
 * Extract the field-level output type from a FieldType.
 *
 * Prefers `__fieldOutput` (pre-computed phantom set by factory call sites)
 * over `V` (the parse-level value type). This is the Zod-style trick:
 * each Block/NamedBlock/TypedMap factory eagerly resolves its output type
 * at definition time, so InferFields never recurses into nested schemas.
 *
 * For variant CollectionBlocks wrapping variant NamedBlocks, `__variants`
 * takes priority to produce a typed NamedMap with variant-aware `get()`.
 */
export type FieldOutput<T> = T extends {
	__variants: infer V extends Record<string, Schema>;
} ? [
	keyof V
] extends [
	never
] ? T extends FieldTypeBase<infer _V, infer F> ? F : never : NamedMap<Parsed<VariantBlockInstance<V[keyof V]>>> : T extends FieldTypeBase<infer _V, infer F> ? F : never;
/**
 * Map a schema to its parsed field types. Each field's output type is
 * extracted via {@link FieldOutput} — a single conditional that reads the
 * pre-computed `__fieldOutput` phantom. No recursion, no deep conditionals.
 */
export type InferFields<T extends Schema> = {
	[K in keyof T]?: FieldOutput<ResolveFieldType<T[K]>>;
};
/** @internal */
export type VariantBlockInstance<S extends Schema> = {
	__kind: string;
	__diagnostics: Diagnostic[];
} & InferFields<S>;
/**
 * Extract the parse value type from a FieldType or NamedBlock entry type.
 * Works with both FieldType (parse returns ParseResult<V>) and NamedBlockFactory
 * (parse returns ParseResult<V> with a 3-arg signature).
 *
 * For variant NamedBlockFactories, produces a union of base instance types
 * intersected with each variant's inferred fields. The `isNamed: true`
 * guard ensures this only applies to entry-level NamedBlockFactory, not
 * CollectionBlockFactory (which carries __variants for FieldOutput only).
 */
export type InferFieldType<T> = T extends {
	__variants: infer V extends Record<string, Schema>;
	parse: (...args: never[]) => ParseResult<infer Base>;
	isNamed: true;
} ? [
	keyof V
] extends [
	never
] ? Base : VariantFieldType<Base, V> : T extends {
	parse: (...args: never[]) => ParseResult<infer V>;
} ? V : never;
/** @internal Distributes Base over each variant schema to produce a union. */
export type VariantFieldType<Base, V extends Record<string, Schema>> = {
	[K in keyof V]: Base & InferFields<V[K]>;
}[keyof V];
/**
 * For collection factories, extract the entry block's parsed type.
 * Falls back to `InferFieldType<T>` for non-collection types.
 */
export type InferEntryType<T> = T extends {
	entryBlock: infer E;
} ? InferFieldType<E> : InferFieldType<T>;
declare const NAMED_MAP_BRAND: unique symbol;
/**
 * Runtime type guard for NamedMap instances.
 * Uses a Symbol brand set in the NamedMap constructor — reliable and
 * immune to false positives from objects that happen to have similar
 * properties (e.g., a block with a `get` field).
 */
export declare function isNamedMap(value: unknown): value is NamedMap<unknown>;
/**
 * Shape of a NamedBlock entry factory as seen by CollectionBlock at runtime.
 * NamedBlock is NOT a FieldType — it's the entry type inside a CollectionBlock.
 */
export interface NamedBlockEntryType {
	readonly isNamed: true;
	readonly allowAnonymous: boolean;
	readonly kind: string;
	readonly schema: Record<string, FieldType>;
	parse: (node: SyntaxNode, name: string, dialect: Dialect, adoptedSiblings?: SyntaxNode[]) => ParseResult<unknown>;
	resolveSchemaForName(name: string): Record<string, FieldType>;
	/** The discriminant field name, if using field-based discrimination. */
	readonly discriminantField?: string;
	/** Resolve variant schema by discriminant field value. */
	resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
}
/** Structural interface for CollectionBlock field types detected at runtime. */
export interface CollectionFieldType extends SingularFieldType {
	readonly __isCollection: true;
	readonly entryBlock: NamedBlockEntryType;
	readonly kind: string;
}
/** Discriminator: field type is a CollectionBlock (holds typed variadic named children). */
export declare function isCollectionFieldType(ft: FieldType): ft is CollectionFieldType;
/**
 * Structural interface for NamedCollectionBlock field types detected at runtime.
 * A NamedCollectionBlock is a CollectionBlock whose entries are declared as
 * sibling keys (e.g., `subagent Foo:`, `subagent Bar:`) rather than nested
 * children under a single container key.
 */
export interface NamedCollectionFieldType extends CollectionFieldType {
	readonly __isNamedCollection: true;
}
/** Discriminator: field type is a NamedCollectionBlock (sibling-keyed named entries). */
export declare function isNamedCollectionFieldType(ft: FieldType): ft is NamedCollectionFieldType;
/**
 * Build a reverse lookup from block `__kind` (e.g. "ConfigBlock") to schema
 * key (e.g. "config"). Computed once at schema definition time.
 */
export declare function buildKindToSchemaKey(schema: Record<string, FieldType>): Map<string, string>;
/**
 * Schema metadata for core modules (scope, completions, lint).
 * Keeps core/ decoupled from any specific schema definition.
 */
export interface SchemaInfo {
	readonly schema: Record<string, FieldType>;
	readonly aliases: Record<string, string>;
	/** Global scopes: namespaces with known members, always resolvable (e.g., @utils, @system_variables). */
	readonly globalScopes?: Readonly<Record<string, ReadonlySet<string>>>;
	/**
	 * Namespaced function definitions: namespace name → set of allowed function names.
	 * These are callable as bare `ns.func()` in expressions.
	 */
	readonly namespacedFunctions?: Readonly<Record<string, ReadonlySet<string>>>;
	/**
	 * Extra schema keys to include when resolving a namespace.
	 * E.g., `{ topic: ['start_agent'] }` makes `@topic.X` also search `start_agent` entries.
	 * Unlike aliases, this doesn't affect completions — it only affects reference resolution.
	 */
	readonly extraNamespaceKeys?: Readonly<Record<string, readonly string[]>>;
}
/** Which constraint families a FieldType supports. */
export type ConstraintCategory = "number" | "string" | "generic" | "sequence";
/**
 * Infer the field-output type `F` from a FieldType.
 * This is the counterpart to Zod's `z.infer<T>` — recovers the concrete
 * output type from an erased `FieldType<any, any>`.
 *
 * Extracts `F` (field-level output), not `V` (parse-level value).
 * For primitives F = V; for NamedBlock F = NamedMap<Parsed<...>>.
 */
export type InferFieldValue<T> = T extends FieldType<any, infer F> ? F : any;
/**
 * FieldBuilder enhanced with the correct builder + constraint methods.
 * Every chainable method returns another ConstrainedBuilder with the same
 * constraint categories, parsed value type V, AND field output type F,
 * preserving type-safety through the entire chain.
 */
export type ConstrainedBuilder<S extends readonly ConstraintCategory[] = readonly [
], V = unknown, F = V> = FieldBuilder<V, F> & BuilderMethods<S, V, F> & ResolveConstraints<S, V, F>;
/** Maps constraint categories to their method interfaces via conditional types. */
export type ResolveConstraints<S extends readonly ConstraintCategory[], V = unknown, F = V> = ("number" extends S[number] ? NumberConstraintMethods<S, V, F> : unknown) & ("string" extends S[number] ? StringConstraintMethods<S, V, F> : unknown) & ("generic" extends S[number] ? GenericConstraintMethods<S, V, F> : unknown) & ("sequence" extends S[number] ? SequenceConstraintMethods<S, V, F> : unknown);
export interface BuilderMethods<S extends readonly ConstraintCategory[] = readonly [
], V = unknown, F = V> {
	describe(description: string): ConstrainedBuilder<S, V, F>;
	example(example: string): ConstrainedBuilder<S, V, F>;
	minVersion(version: string): ConstrainedBuilder<S, V, F>;
	deprecated(message?: string, opts?: {
		since?: string;
		removeIn?: string;
		replacement?: string;
	}): ConstrainedBuilder<S, V, F>;
	experimental(): ConstrainedBuilder<S, V, F>;
	required(): ConstrainedBuilder<S, V, F>;
	accepts(kinds: string[]): ConstrainedBuilder<S, V, F>;
	pick(keys: string[]): ConstrainedBuilder<S, V, F>;
	omitArrow(): ConstrainedBuilder<S, V, F>;
	disallowTemplates(suggestion?: string): ConstrainedBuilder<S, V, F>;
	allowedNamespaces(namespaces: string[]): ConstrainedBuilder<S, V, F>;
	resolvedType(type: BlockCapability): ConstrainedBuilder<S, V, F>;
	crossBlockReferenceable(): ConstrainedBuilder<S, V, F>;
	hidden(): ConstrainedBuilder<S, V, F>;
	extend(additionalFields: Schema, overrideOptions?: Record<string, unknown>): ConstrainedBuilder<S, V, F>;
	omit(...keys: string[]): ConstrainedBuilder<S, V, F>;
	withProperties(newPropertiesBlock: FieldType): ConstrainedBuilder<S, V, F>;
	extendProperties(additionalFields: Schema): ConstrainedBuilder<S, V, F>;
	clone(): ConstrainedBuilder<S, V, F>;
}
export interface NumberConstraintMethods<S extends readonly ConstraintCategory[] = readonly [
], V = unknown, F = V> {
	min(value: number): ConstrainedBuilder<S, V, F>;
	max(value: number): ConstrainedBuilder<S, V, F>;
	exclusiveMin(value: number): ConstrainedBuilder<S, V, F>;
	exclusiveMax(value: number): ConstrainedBuilder<S, V, F>;
	multipleOf(value: number): ConstrainedBuilder<S, V, F>;
}
export interface StringConstraintMethods<S extends readonly ConstraintCategory[] = readonly [
], V = unknown, F = V> {
	minLength(value: number): ConstrainedBuilder<S, V, F>;
	maxLength(value: number): ConstrainedBuilder<S, V, F>;
	pattern(regex: string | RegExp): ConstrainedBuilder<S, V, F>;
}
export interface GenericConstraintMethods<S extends readonly ConstraintCategory[] = readonly [
], V = unknown, F = V> {
	enum(values: ReadonlyArray<string | number | boolean>): ConstrainedBuilder<S, V, F>;
	const(value: string | number | boolean): ConstrainedBuilder<S, V, F>;
}
export interface SequenceConstraintMethods<S extends readonly ConstraintCategory[] = readonly [
], V = unknown, F = V> {
	minItems(value: number): ConstrainedBuilder<S, V, F>;
	maxItems(value: number): ConstrainedBuilder<S, V, F>;
}
/**
 * Pure data holder and FieldType proxy. All chainable builder methods
 * (describe, required, min, etc.) are added dynamically by addBuilderMethods().
 * FieldBuilder itself has NO builder methods — only delegation to the base type.
 *
 * Generic `V` carries the parsed value type, `F` carries the field-output type.
 * Both are erased at runtime — purely compile-time markers for type inference.
 */
export declare class FieldBuilder<V = any, F = V> {
	private baseType;
	readonly __fieldKind: FieldType["__fieldKind"];
	/** Phantom — carries the field-output type through builder chains. */
	readonly __fieldOutput?: F;
	readonly __metadata: FieldMetadata;
	readonly __constraintCategories?: readonly ConstraintCategory[];
	readonly emitField?: FieldType<V>["emitField"];
	readonly isNamed?: false;
	constructor(baseType: FieldType, initialMetadata?: FieldMetadata, constraintCategories?: readonly ConstraintCategory[]);
	parse(node: SyntaxNode, dialect: Dialect, extraElements?: SyntaxNode[]): ParseResult<V>;
	emit(value: V, ctx: EmitContext): string;
	get schema(): Schema | undefined;
}
/**
 * Add builder methods (.describe(), .deprecated(), etc.) and optionally
 * constraint methods (.min(), .maxLength(), etc.) to a FieldType.
 *
 * Constraint methods are gated by the `constraints` parameter:
 * - `['number', 'generic']` adds .min(), .max(), .enum(), .const(), etc.
 * - `['string', 'generic']` adds .minLength(), .pattern(), .enum(), etc.
 * - `['sequence']` adds .minItems(), .maxItems()
 * - `[]` or omitted adds no constraint methods
 *
 * Every method returns an immutable enhanced builder.
 * Uses a single `populateMethods` function as the source of truth for all
 * method definitions — both static entry points and chained instance methods.
 */
export declare function addBuilderMethods<T extends FieldType, const S extends readonly ConstraintCategory[] = readonly [
]>(fieldType: T, constraints?: S): T & BuilderMethods<S, InferFieldValue<T>, InferFieldValue<T>> & ResolveConstraints<S, InferFieldValue<T>, InferFieldValue<T>>;
/**
 * StringValue is a union type -- returns the actual expression node, not a wrapper.
 * Use __kind to discriminate: 'StringLiteral' for "quoted", 'TemplateExpression' for |template
 */
export type TStringValue = StringLiteral | TemplateExpression;
export type StringValue = TStringValue;
export declare const StringValue: FieldType<TStringValue> & BuilderMethods<readonly [
	"string",
	"generic"
], TStringValue, TStringValue> & StringConstraintMethods<readonly [
	"string",
	"generic"
], TStringValue, TStringValue> & GenericConstraintMethods<readonly [
	"string",
	"generic"
], TStringValue, TStringValue>;
declare class NumberValueNode extends AstNodeBase {
	value: number;
	static readonly __fieldKind: "Primitive";
	static __accepts: string[];
	readonly __kind = "NumberValue";
	constructor(value: number);
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode, dialect: Dialect): ParseResult<NumberValueNode>;
	static emit(value: NumberValueNode, ctx: EmitContext): string;
}
export type NumberValue = NumberValueNode;
export declare const NumberValue: typeof NumberValueNode & BuilderMethods<readonly [
	"number",
	"generic"
], unknown, unknown> & NumberConstraintMethods<readonly [
	"number",
	"generic"
], unknown, unknown> & GenericConstraintMethods<readonly [
	"number",
	"generic"
], unknown, unknown>;
declare class BooleanValueNode extends AstNodeBase {
	value: boolean;
	static readonly __fieldKind: "Primitive";
	static __accepts: string[];
	readonly __kind = "BooleanValue";
	constructor(value: boolean);
	__emit(_ctx: EmitContext): string;
	static parse(node: SyntaxNode, dialect: Dialect): ParseResult<BooleanValueNode>;
	static emit(value: BooleanValueNode, ctx: EmitContext): string;
}
export type BooleanValue = BooleanValueNode;
export declare const BooleanValue: typeof BooleanValueNode & BuilderMethods<readonly [
	"generic"
], unknown, unknown> & GenericConstraintMethods<readonly [
	"generic"
], unknown, unknown>;
declare class ProcedureValueNode extends AstNodeBase {
	statements: Statement[];
	static readonly __fieldKind: "Primitive";
	readonly __kind = "ProcedureValue";
	constructor(statements: Statement[]);
	__emit(ctx: EmitContext): string;
	static parse(node: SyntaxNode, dialect: Dialect): ParseResult<ProcedureValueNode>;
	static emit(value: ProcedureValueNode, ctx: EmitContext): string;
	static emitField(key: string, value: ProcedureValueNode, ctx: EmitContext): string;
}
export type ProcedureValue = ProcedureValueNode;
export declare const ProcedureValue: typeof ProcedureValueNode & BuilderMethods<readonly [
], unknown, unknown>;
export declare const ExpressionValue: {
	__fieldKind: "Primitive";
	parse: (node: SyntaxNode, dialect: Dialect) => ParseResult<Expression>;
	emit: (value: Expression, ctx: EmitContext) => string;
} & BuilderMethods<readonly [
], unknown, unknown>;
export type ReferenceValue = MemberExpression;
export declare const ReferenceValue: {
	__fieldKind: "Primitive";
	__accepts: string[];
	parse: (node: SyntaxNode, dialect: Dialect) => ParseResult<MemberExpression>;
	emit: (value: MemberExpression, ctx: EmitContext) => string;
} & BuilderMethods<readonly [
], unknown, unknown>;
/**
 * Creates a FieldType that accepts any of the given types.
 * Disambiguation is based on __kind after a single parseExpression() call.
 * Templates are handled at the CST level (node.type === 'template').
 */
export declare function union(...types: FieldType[]): SingularFieldType<Expression>;
export type BlockInstance<T extends Schema> = BlockCore & InferFields<T>;
/**
 * Instance of a NamedBlock, including colinear value and body statements.
 * At runtime, ALL NamedBlockNode instances expose `value` and `statements`
 * as getter/setters backed by __children.
 */
export type NamedBlockInstance<T extends Schema> = BlockInstance<T> & {
	/** Colinear expression value (e.g., `@actions.X`). */
	value?: unknown;
	/** Body procedure statements (with/set/to clauses). */
	statements?: Statement[];
};
/** Instance type of a CollectionBlock — a NamedMap with typed entries over __children. */
export type CollectionBlockInstance<T extends Schema> = NamedMap<Parsed<InferFields<T> & BlockCore>>;
export interface BlockClass<T extends Schema> {
	readonly kind: string;
	readonly schema: T;
	readonly isNamed: false;
	new (fields: InferFields<T>): BlockInstance<T>;
	parse(node: SyntaxNode, dialect: Dialect, extraElements?: SyntaxNode[]): ParseResult<BlockInstance<T>>;
}
export interface NamedBlockClass<T extends Schema> {
	readonly kind: string;
	readonly schema: T;
	readonly isNamed: true;
	readonly allowAnonymous: boolean;
	readonly scopeAlias?: string;
	readonly colinearType?: SingularFieldType;
	readonly hasColinear: boolean;
	readonly hasBody: boolean;
	new (name: string, fields: InferFields<T>): NamedBlockInstance<T>;
	parse(node: SyntaxNode, name: string, dialect: Dialect): ParseResult<NamedBlockInstance<T>>;
	/** Resolve the effective schema for a given instance name.
	 *  For variant NamedBlocks, returns the merged variant schema.
	 *  For non-variant blocks, always returns the base schema. */
	resolveSchemaForName(name: string): Record<string, FieldType>;
}
export interface BlockFactoryOptions {
	symbol?: SymbolMeta;
	/** Description set on __metadata at creation time, avoiding the TS7056-prone `.describe()` chain on exports. */
	description?: string;
	/** Semantic capabilities this block declares (e.g., 'invocationTarget', 'transitionTarget'). */
	capabilities?: readonly BlockCapability[];
	/** Wildcard prefixes that accept any field name matching a given prefix pattern. */
	wildcardPrefixes?: readonly WildcardPrefix[];
	/** Field name whose string value selects the variant schema. Requires `variants`. */
	discriminant?: string;
	/** Variant schemas keyed by discriminant value. Requires `discriminant`. */
	variants?: Record<string, Schema>;
}
export interface NamedBlockOpts {
	colinear?: SingularFieldType;
	body?: SingularFieldType;
	symbol?: SymbolMeta;
	scopeAlias?: string;
	/** Variant schemas keyed by instance name or discriminant value. Prefer the chained `.variant()` API. */
	variants?: Record<string, Schema>;
	/** Field name whose string value selects the variant schema. When set, variants are resolved by field value instead of instance name. */
	discriminant?: string;
	/** Description set on __metadata at creation time, avoiding the TS7056-prone `.describe()` chain on exports. */
	description?: string;
	/** When true, a nameless key (e.g. `start_agent:`) is parsed as an anonymous instance instead of a named-entry container. */
	allowAnonymous?: boolean;
	/** Semantic capabilities this block declares (e.g., 'invocationTarget', 'transitionTarget'). */
	capabilities?: readonly BlockCapability[];
}
export interface CollectionBlockOpts {
	/** Description set on __metadata at creation time. */
	description?: string;
}
export interface TypedMapOptions {
	/**
	 * Valid modifiers for entries (e.g., `mutable`, `linked`).
	 *
	 * Each entry provides both the keyword name and a description shown on hover.
	 *
	 * @example Using the built-in modifiers:
	 * ```ts
	 * modifiers: VARIABLE_MODIFIERS
	 * ```
	 *
	 * @example Extending with a custom modifier:
	 * ```ts
	 * modifiers: [
	 *   ...VARIABLE_MODIFIERS,
	 *   { keyword: 'readonly', description: 'Cannot be changed after initialization.' },
	 * ]
	 * ```
	 *
	 * @example Defining from scratch:
	 * ```ts
	 * modifiers: [
	 *   { keyword: 'mutable', description: 'A variable that can change during the conversation.' },
	 *   { keyword: 'linked', description: 'A variable sourced from an external system.' },
	 * ]
	 * ```
	 */
	modifiers?: readonly KeywordInfo[];
	/**
	 * Valid primitive type names for entries.
	 *
	 * Each entry provides both the type name and a description shown on hover.
	 * Undefined means any type is accepted.
	 *
	 * @example Using the built-in types:
	 * ```ts
	 * primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES
	 * ```
	 *
	 * @example Extending with a dialect-specific type:
	 * ```ts
	 * primitiveTypes: [
	 *   ...AGENTSCRIPT_PRIMITIVE_TYPES,
	 *   { keyword: 'picklist', description: 'A predefined set of values from an external system.' },
	 * ]
	 * ```
	 *
	 * @example Defining a minimal set:
	 * ```ts
	 * primitiveTypes: [
	 *   { keyword: 'string', description: 'A text value.' },
	 *   { keyword: 'number', description: 'A numeric value.' },
	 * ]
	 * ```
	 */
	primitiveTypes?: readonly KeywordInfo[];
	symbol?: SymbolMeta;
	/** Description set on __metadata at creation time, avoiding the TS7056-prone `.describe()` chain on exports. */
	description?: string;
	/** Regex pattern that map keys must match. */
	keyPattern?: string;
}
/**
 * Metadata methods available on all factory types.
 *
 * Generic `Self` parameter ensures `.describe()` etc. return the original
 * factory type instead of `ConstrainedBuilder`, which avoids TS7056
 * serialization overflow on exported declarations.
 */
export interface FactoryBuilderMethods<Self> {
	describe(description: string): Self;
	example(example: string): Self;
	minVersion(version: string): Self;
	deprecated(message?: string, opts?: {
		since?: string;
		removeIn?: string;
		replacement?: string;
	}): Self;
	experimental(): Self;
	required(): Self;
	crossBlockReferenceable(): Self;
	singular(): Self;
	accepts(kinds: string[]): Self;
	omitArrow(): Self;
	withProperties(newPropertiesBlock: FieldType): Self;
	extendProperties(additionalFields: Schema): Self;
	/**
	 * Create an independent copy of this factory with the same schema, options,
	 * and metadata. Use this when the same block definition is assigned to
	 * multiple schema keys that need different metadata (e.g., different
	 * `.example()` values for `start_agent` and `topic`).
	 */
	clone(): Self;
}
/**
 * Full return type from Block().
 *
 * Using an `interface` (not a type alias) ensures TypeScript always references
 * this by name in `.d.ts` output, preventing TS7056 serialization overflow.
 *
 * The `__fieldOutput` phantom carries `InferFields<T> & BlockCore` — the
 * pre-computed type that appears on a parent block when this factory is used
 * as a schema field. This enables InferFields to read the phantom directly
 * instead of recursing (Zod-style eager resolution).
 */
export interface BlockFactory<T extends Schema> extends FactoryBuilderMethods<BlockFactory<T>> {
	readonly __fieldKind: "Block";
	/** Phantom: pre-computed field output type for InferFields. */
	readonly __fieldOutput?: InferFields<T> & BlockCore;
	__accepts?: string[];
	__metadata?: FieldMetadata;
	emit(value: BlockInstance<T>, ctx: EmitContext): string;
	emitField?(key: string, value: BlockInstance<T>, ctx: EmitContext): string;
	scopeAlias?: string;
	/** Semantic capabilities declared by this block type. */
	readonly capabilities?: readonly BlockCapability[];
	readonly kind: string;
	readonly schema: T;
	readonly isNamed: false;
	new (fields: InferFields<T>): BlockInstance<T>;
	parse(node: SyntaxNode, dialect: Dialect, extraElements?: SyntaxNode[]): ParseResult<BlockInstance<T>>;
	/** @internal Used by Sequence to construct from pre-parsed fields. */
	fromParsedFields(fields: InferFields<T>, cstNode: SyntaxNode, diagnostics: Diagnostic[], children?: BlockChild[]): ParseResult<BlockInstance<T>>;
	extend<U extends Schema>(additionalFields: U, overrideOptions?: Partial<BlockFactoryOptions>): BlockFactory<Omit<T, keyof U> & U>;
	omit<K extends string>(...keys: K[]): BlockFactory<Omit<T, K>>;
	pick<K extends string & keyof T>(keys: K[]): BlockFactory<Pick<T, K>>;
	/** The discriminant field name, if using field-based discrimination. */
	readonly discriminantField?: string;
	/** Resolve variant schema by discriminant field value. */
	resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
	/** Set the discriminant field for field-based variant resolution. */
	discriminant(fieldName: string): BlockFactory<T>;
	/** Add a variant schema keyed by discriminant value. */
	variant(name: string, variantSchema: Schema): BlockFactory<T>;
}
/**
 * Full return type from NamedBlock().
 *
 * NamedBlock is NOT a FieldType — it cannot be used directly as a schema field.
 * Instead, wrap it with CollectionBlock() to use in schemas.
 * NamedBlock defines the entry type (individual named items inside a collection).
 */
export interface NamedBlockFactory<T extends Schema, V extends Record<string, Schema> = Record<never, never>> extends FactoryBuilderMethods<NamedBlockFactory<T, V>> {
	/** Phantom: variant schemas keyed by variant name. Empty `{}` when no variants. */
	readonly __variants: V;
	__metadata?: FieldMetadata;
	emit(value: BlockInstance<T>, ctx: EmitContext): string;
	emitField?(key: string, value: unknown, ctx: EmitContext): string;
	scopeAlias?: string;
	/** Semantic capabilities declared by this block type. */
	readonly capabilities?: readonly BlockCapability[];
	parse(node: SyntaxNode, name: string, dialect: Dialect): ParseResult<NamedBlockInstance<T>>;
	readonly kind: string;
	readonly schema: T;
	readonly isNamed: true;
	readonly allowAnonymous: boolean;
	readonly colinearType?: SingularFieldType;
	readonly hasColinear: boolean;
	readonly hasBody: boolean;
	new (name: string, fields: InferFields<T>): NamedBlockInstance<T>;
	resolveSchemaForName(name: string): Record<string, FieldType>;
	/** The discriminant field name, if using field-based discrimination. */
	readonly discriminantField?: string;
	/** Resolve variant schema by discriminant field value. */
	resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
	extend<U extends Schema>(additionalFields: U, overrideOpts?: Partial<NamedBlockOpts>): NamedBlockFactory<Omit<T, keyof U> & U>;
	omit<K extends string>(...keys: K[]): NamedBlockFactory<Omit<T, K>>;
	pick<K extends string & keyof T>(keys: K[]): NamedBlockFactory<Pick<T, K>>;
	variant<N extends string, S extends Schema>(name: N, variantSchema: S): NamedBlockFactory<T, V & Record<N, S>>;
	/** Set the discriminant field for field-based variant resolution. */
	discriminant(fieldName: string): NamedBlockFactory<T, V>;
}
/**
 * Full return type from CollectionBlock().
 *
 * A CollectionBlock is a SingularFieldType — the collection IS the field value.
 * Its `__fieldOutput` phantom carries `NamedMap<Parsed<...>>` so that
 * InferFields produces the same Map-like type as NamedBlock did.
 */
export interface CollectionBlockFactory<T extends Schema, V extends Record<string, Schema> = Record<never, never>> extends FactoryBuilderMethods<CollectionBlockFactory<T, V>> {
	readonly __fieldKind: "Collection";
	/** Phantom: pre-computed field output type for InferFields. */
	readonly __fieldOutput?: NamedMap<Parsed<InferFields<T> & BlockCore>>;
	/** Phantom: variant schemas propagated from entryBlock for FieldOutput. */
	readonly __variants: V;
	__accepts?: string[];
	__metadata?: FieldMetadata;
	emit(value: CollectionBlockInstance<T>, ctx: EmitContext): string;
	emitField?(key: string, value: CollectionBlockInstance<T>, ctx: EmitContext): string;
	schema?: T;
	scopeAlias?: string;
	/**
	 * Whether the collection block itself is a NamedBlock (requires a name on
	 * its own declaration line).  This is always `false` — the *container* is
	 * not named.  Individual *entries* inside the collection may be named
	 * (NamedBlockFactory), but that is tracked on `entryBlock`, not here.
	 *
	 * Note: `NamedCollectionBlockFactory` inherits this `false` value, which
	 * can look contradictory.  "Named" in that type name refers to the
	 * declaration pattern (sibling keys like `subagent Foo:`) — not to this
	 * flag, which answers "is the collection node itself a NamedBlock?".
	 */
	isNamed: false;
	readonly __isCollection: true;
	readonly kind: string;
	readonly entryBlock: NamedBlockFactory<T, V>;
	new (): CollectionBlockInstance<T>;
	parse(node: SyntaxNode, dialect: Dialect): ParseResult<CollectionBlockInstance<T>>;
}
/**
 * Full return type from NamedCollectionBlock().
 * Extends CollectionBlockFactory with a `__isNamedCollection` discriminator.
 *
 * Uses Omit to strip FactoryBuilderMethods from CollectionBlockFactory so we
 * can re-bind them to return NamedCollectionBlockFactory (preserving chaining).
 */
export interface NamedCollectionBlockFactory<T extends Schema, V extends Record<string, Schema> = Record<never, never>> extends Omit<CollectionBlockFactory<T, V>, keyof FactoryBuilderMethods<unknown>>, FactoryBuilderMethods<NamedCollectionBlockFactory<T, V>> {
	readonly __isNamedCollection: true;
}
/**
 * Full return type from TypedMap().
 *
 * The `__fieldOutput` phantom carries `NamedMap<T>` — the pre-computed
 * type for when this TypedMap is used as a field in a parent schema.
 */
export interface TypedMapFactory<T extends TypedDeclarationBase = TypedDeclarationBase> extends FactoryBuilderMethods<TypedMapFactory<T>> {
	readonly __fieldKind: "TypedMap";
	/** Phantom: pre-computed field output type for InferFields. */
	readonly __fieldOutput?: NamedMap<T>;
	__accepts?: string[];
	__metadata?: FieldMetadata;
	emit(value: NamedMap<T>, ctx: EmitContext): string;
	emitField?(key: string, value: NamedMap<T>, ctx: EmitContext): string;
	scopeAlias?: string;
	/** Semantic capabilities declared by this block type. */
	readonly capabilities?: readonly BlockCapability[];
	isNamed: false;
	readonly kind: string;
	new (entries?: Iterable<[
		string,
		T
	]>): NamedMap<T>;
	parse(node: SyntaxNode, dialect: Dialect): ParseResult<NamedMap<T>>;
	readonly __isTypedMap: true;
	readonly propertiesSchema?: Schema;
	readonly __modifiers: readonly KeywordInfo[];
	readonly __primitiveTypes: readonly KeywordInfo[];
	withProperties(newPropertiesBlock: FieldType): TypedMapFactory<T>;
	extendProperties<U extends Schema>(additionalFields: U): TypedMapFactory<T>;
	withKeyPattern(pattern: string): TypedMapFactory<T>;
	readonly propertiesBlock: FieldType & BuilderMethods;
}
/**
 * AST node representing a sequence (dash-prefixed list).
 * Items are stored in `__children` as `SequenceItemChild` entries.
 */
export declare class SequenceNode extends AstNodeBase {
	readonly __kind = "Sequence";
	__children: BlockChild[];
	get items(): (BlockCore | Expression)[];
	set items(newItems: (BlockCore | Expression)[]);
	constructor(items?: (BlockCore | Expression)[]);
	__emit(ctx: EmitContext): string;
}
/**
 * Create a FieldType for sequences where mapping elements are parsed
 * against the given block type's schema. Expression elements are parsed as expressions.
 */
export declare function Sequence<T extends Schema>(blockType: BlockFactory<T>): SingularFieldType<SequenceNode, SequenceNode> & BuilderMethods<readonly [
	"sequence"
], SequenceNode, SequenceNode> & SequenceConstraintMethods<readonly [
	"sequence"
], SequenceNode, SequenceNode>;
/**
 * Create a FieldType for expression-only sequences.
 * Mapping elements produce diagnostics.
 */
export declare function ExpressionSequence(): SingularFieldType<SequenceNode, SequenceNode> & BuilderMethods<readonly [
	"sequence"
], SequenceNode, SequenceNode> & SequenceConstraintMethods<readonly [
	"sequence"
], SequenceNode, SequenceNode>;
export declare function Block(kind: string): BlockFactory<Record<never, never>>;
export declare function Block<T extends Schema>(kind: string, inputSchema: T, options?: BlockFactoryOptions): BlockFactory<T>;
export declare function NamedBlock(kind: string): NamedBlockFactory<Record<never, never>>;
export declare function NamedBlock<T extends Schema>(kind: string, inputSchema: T, opts?: NamedBlockOpts): NamedBlockFactory<T>;
/**
 * Create a collection block factory — a block that holds typed variadic
 * named children. The collection IS a block (has __kind, __children, __cst,
 * __diagnostics, __emit). `__children` is the single source of truth.
 *
 * The kind is derived automatically as `Collection<EntryBlockKind>`.
 *
 * @example
 * ```ts
 * const ActionsBlock = CollectionBlock(ActionBlock);
 * // __kind = "Collection<ActionBlock>"
 * // Used in schema:
 * const TopicBlock = NamedBlock('TopicBlock', {
 *   actions: ActionsBlock,
 * });
 * ```
 */
export declare function CollectionBlock<T extends Schema, V extends Record<string, Schema> = Record<never, never>>(entryBlock: NamedBlockFactory<T, V>, opts?: CollectionBlockOpts): CollectionBlockFactory<T, V>;
/**
 * Create a named collection block factory — a CollectionBlock whose entries
 * are declared as sibling keys with the collection keyword as prefix.
 *
 * Use this for top-level collections like `subagent`, `start_agent`,
 * `connected_subagent`, `topic`, `connection`, `modality` where each entry
 * repeats the schema key: `subagent Foo:`, `subagent Bar:`.
 *
 * Use plain `CollectionBlock` for nested containers like `actions:`
 * where entries are children under a single key.
 *
 * @example
 * ```ts
 * // Sibling pattern: `subagent Foo:`, `subagent Bar:`
 * const schema = { subagent: NamedCollectionBlock(SubagentBlock) };
 *
 * // Nested pattern: `actions:` with `Foo:`, `Bar:` as children
 * const schema = { actions: CollectionBlock(ActionBlock) };
 * ```
 */
export declare function NamedCollectionBlock<T extends Schema, V extends Record<string, Schema> = Record<never, never>>(entryBlock: NamedBlockFactory<T, V>, opts?: CollectionBlockOpts): NamedCollectionBlockFactory<T, V>;
export declare function TypedMap<T extends TypedDeclarationBase = TypedDeclarationBase>(kind: string, propertiesBlock: FieldType, options?: TypedMapOptions): TypedMapFactory<T>;
export declare function isTemplateText(node: unknown): node is TemplateText;
export declare function isTemplateInterpolation(node: unknown): node is TemplateInterpolation;
export declare function isMemberExpression(node: unknown): node is MemberExpression;
export declare function isIdentifier(node: unknown): node is Identifier;
export declare function isStringLiteral(node: unknown): node is StringLiteral;
export declare function isSubscriptExpression(node: unknown): node is SubscriptExpression;
export declare function isAtIdentifier(node: unknown): node is AtIdentifier;
export declare function isIfStatement(node: unknown): node is IfStatement;
export declare function isTransitionStatement(node: unknown): node is TransitionStatement;
export declare function isToClause(node: unknown): node is ToClause;
export declare function isSetClause(node: unknown): node is SetClause;
export declare function isWithClause(node: unknown): node is WithClause;
/**
 * Emit a parsed document back to source text.
 *
 * Prefers `__children` for CST-order output (preserves original source order).
 * Falls back to schema-based emission for manually constructed objects that
 * lack `__children` (e.g., objects not created through Block/NamedBlock constructors).
 *
 * Top-level entries are separated by blank lines (`\n\n`), while fields within
 * a block use single newlines (`\n`) — see `BlockNode.__emit`.
 */
export declare function emitDocument<S extends Record<string, FieldType>>(parsed: Parsed<InferFields<S>>, schema: S, options?: {
	tabSize?: number;
}): string;
export declare function emitDocument(parsed: Record<string, unknown>, schema: Record<string, FieldType>, options?: {
	tabSize?: number;
}): string;
export declare const AGENTSCRIPT_PRIMITIVE_TYPES: readonly [
	{
		readonly keyword: "string";
		readonly description: "A text value, such as a name, message, or ID.";
	},
	{
		readonly keyword: "number";
		readonly description: "A numeric value that can include decimals (e.g., 3.14).";
	},
	{
		readonly keyword: "boolean";
		readonly description: "A True or False value.";
	},
	{
		readonly keyword: "object";
		readonly description: "A collection of named values (key-value pairs).";
	},
	{
		readonly keyword: "currency";
		readonly description: "A monetary amount.";
	},
	{
		readonly keyword: "date";
		readonly description: "A calendar date without a time (e.g., 2025-03-15).";
	},
	{
		readonly keyword: "datetime";
		readonly description: "A date and time with timezone (e.g., 2025-03-15T10:30:00Z).";
	},
	{
		readonly keyword: "time";
		readonly description: "A time of day without a date (e.g., 14:30).";
	},
	{
		readonly keyword: "timestamp";
		readonly description: "A point in time represented as a Unix epoch value.";
	},
	{
		readonly keyword: "id";
		readonly description: "A unique record identifier.";
	},
	{
		readonly keyword: "integer";
		readonly description: "A whole number with no decimal part (e.g., 42).";
	},
	{
		readonly keyword: "long";
		readonly description: "A large whole number for values that may exceed normal integer range.";
	}
];
export type AgentScriptPrimitiveType = (typeof AGENTSCRIPT_PRIMITIVE_TYPES)[number]["keyword"];
export declare const VARIABLE_MODIFIERS: readonly [
	{
		readonly keyword: "mutable";
		readonly description: "A variable that can be changed during the conversation. Use `set` to update its value.";
	},
	{
		readonly keyword: "linked";
		readonly description: "A variable whose value comes from an external system (e.g., a CRM record). Cannot be changed directly.";
	}
];
export type VariableModifier = (typeof VARIABLE_MODIFIERS)[number]["keyword"];
export declare const VariablePropertiesBlock: BlockFactory<{
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	is_required: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
}>;
export declare const InputPropertiesBlock: BlockFactory<{
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	is_required: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
}>;
export declare const OutputPropertiesBlock: BlockFactory<{
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}>;
export declare const VariablesBlock: TypedMapFactory<TypedDeclarationBase>;
export declare const InputsBlock: TypedMapFactory<TypedDeclarationBase>;
export declare const OutputsBlock: TypedMapFactory<TypedDeclarationBase>;
export declare const ActionBlock: NamedBlockFactory<{
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	inputs: TypedMapFactory<TypedDeclarationBase>;
	outputs: TypedMapFactory<TypedDeclarationBase>;
	target: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	source: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, Record<never, never>>;
export declare const ActionsBlock: CollectionBlockFactory<{
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	inputs: TypedMapFactory<TypedDeclarationBase>;
	outputs: TypedMapFactory<TypedDeclarationBase>;
	target: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	source: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, Record<never, never>>;
export declare const ReasoningActionBlock: NamedBlockFactory<{
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, Record<never, never>>;
export declare const ReasoningActionsBlock: CollectionBlockFactory<{
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, Record<never, never>>;
/**
 * Enclosing block scope for a position in the AST.
 *
 * Keys are scope names from NamedBlocks (e.g., 'topic', 'action'),
 * values are block instance names. Example: `{ topic: 'main', action: 'fetch_data' }`
 */
export type ScopeContext = Readonly<Record<string, string>>;
/** Metadata for a namespace, used for bare-@ completions. */
export interface NamespaceMeta {
	kind: SymbolKind;
	/**
	 * Set of scope levels that host this namespace. A namespace is "in scope"
	 * when any of these scope levels is active. Multiple entries appear when
	 * peer root-level blocks share a namespace (e.g., `actions` is defined on
	 * both `topic` and `subagent` in AgentForce).
	 */
	scopesRequired?: ReadonlySet<string>;
}
/** Pre-computed schema-derived data. Create via `createSchemaContext(info)`. */
export interface SchemaContext {
	readonly info: SchemaInfo;
	/**
	 * Maps a namespace name to the set of scope levels that host its
	 * definitions. A namespace may appear under multiple peer scopes — for
	 * example, `actions` is defined on both `topic` and `subagent` in
	 * AgentForce — so the value is a set, not a single scope.
	 */
	readonly scopedNamespaces: ReadonlyMap<string, ReadonlySet<string>>;
	readonly scopeNavigation: ReadonlyMap<string, ScopeNavInfo>;
	readonly namespaceMetadata: ReadonlyMap<string, NamespaceMeta>;
	readonly schemaNamespaces: ReadonlySet<string>;
	/** Global scopes: namespace -> set of known members. */
	readonly globalScopes: ReadonlyMap<string, ReadonlySet<string>>;
	/** Scoped namespaces that support colinear cross-block @-reference resolution (e.g., 'outputs'). */
	readonly colinearResolvedScopes: ReadonlySet<string>;
	/** Namespaces whose blocks declare the 'invocationTarget' capability (can be called as a tool). */
	readonly invocationTargetNamespaces: ReadonlySet<string>;
	/** Namespaces whose blocks declare the 'transitionTarget' capability (can receive a handoff/transition). */
	readonly transitionTargetNamespaces: ReadonlySet<string>;
}
/** Create a SchemaContext from a SchemaInfo. All derived data is computed eagerly. */
export declare function createSchemaContext(info: SchemaInfo): SchemaContext;
/**
 * Resolve a namespace to all equivalent schema keys (including aliases).
 * Resolves transitively: if topic→subagent and start_agent→subagent,
 * resolveNamespaceKeys('topic') -> ['topic', 'subagent', 'start_agent']
 */
export declare function resolveNamespaceKeys(namespace: string, ctx: SchemaContext): string[];
/** Navigation info for a scope level in the AST. */
export interface ScopeNavInfo {
	/** Root-level schema keys for this scope (e.g., ['topic'] for 'topic' scope). */
	rootKeys: string[];
	/** For nested scopes, the parent scope name. */
	parentScope?: string;
}
/**
 * Set of root-level schema keys (namespace names).
 * Used by undefined-reference validation to check if a namespace
 * is statically resolvable even when no entries exist in the document.
 */
export declare function getSchemaNamespaces(ctx: SchemaContext): ReadonlySet<string>;
/** Global scopes: namespace -> set of known member names. */
export declare function getGlobalScopes(ctx: SchemaContext): ReadonlyMap<string, ReadonlySet<string>>;
declare enum SymbolTag {
	Deprecated = 1
}
export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: SymbolKind;
	tags?: SymbolTag[];
	deprecated?: boolean;
	range: Range$1;
	selectionRange: Range$1;
	children?: DocumentSymbol[];
}
/**
 * Extract a hierarchical DocumentSymbol tree from a parsed AST.
 * Nodes without __cst are skipped.
 */
export declare function getDocumentSymbols(ast: AstRoot): DocumentSymbol[];
/**
 * Get member names for a namespace from the DocumentSymbol tree.
 * Returns string[] if found (may be empty), or null if the namespace
 * has no static definitions.
 */
export declare function getSymbolMembers(symbols: DocumentSymbol[], namespace: string, ctx: SchemaContext, scope?: ScopeContext, position?: {
	line: number;
	character: number;
}): string[] | null;
/** A branded string that carries value type `T` at the type level. */
export type StoreKey<T> = string & {
	readonly __type: T;
};
/** Create a typed store key. */
export declare function storeKey<T = never>(name: string): StoreKey<T>;
/**
 * Key-value store for sharing data between lint passes.
 * Each key can only be set once -- attempting to overwrite throws.
 */
export declare class PassStore {
	private data;
	set<T>(key: StoreKey<T>, value: T): void;
	get<T>(key: StoreKey<T>): T | undefined;
	has(key: StoreKey<unknown>): boolean;
	update<T>(key: StoreKey<T>, fn: (current: T) => T): void;
}
/**
 * A lint pass that can participate in AST walking, data extraction, and validation.
 * All hooks are optional -- implement only what your pass needs.
 */
export interface LintPass {
	readonly id: StoreKey<unknown>;
	readonly description: string;
	/** StoreKeys that must be populated before finalize() runs. */
	readonly finalizeAfter?: readonly StoreKey<unknown>[];
	/** StoreKeys required in PassStore before run(). Missing keys skip run(). */
	readonly requires?: readonly StoreKey<unknown>[];
	init?(): void;
	visitVariables?(variables: NamedMap<unknown>): void;
	visitExpression?(expr: AstNodeLike, ctx: ScopeContext): void;
	enterNode?(key: string, value: unknown, parent: unknown): void;
	exitNode?(key: string, value: unknown, parent: unknown): void;
	/** Store extracted data after the walk. Toposorted by finalizeAfter. */
	finalize?(store: PassStore, root: AstRoot): void;
	/** Validate and attach diagnostics. Runs after all finalizes. */
	run?(store: PassStore, root: AstRoot): void;
}
/**
 * Marker for an iteration dependency in defineRule.
 * Wraps a store key so that the rule iterates the result per element.
 */
export interface EachDep<T> {
	readonly __each: true;
	readonly key: StoreKey<unknown>;
	readonly selector?: (source: never) => T[];
}
/**
 * Mark a dependency for per-item iteration in defineRule.
 *
 * With a selector, the stored value is transformed into an array first.
 * At most one each() dep is allowed per rule.
 */
export declare function each<T>(key: StoreKey<T[]>): EachDep<T>;
export declare function each<S, T>(key: StoreKey<S>, selector: (source: S) => T[]): EachDep<T>;
/** A dependency is either a direct StoreKey or an each-wrapped StoreKey. */
export type Dep = StoreKey<unknown> | EachDep<unknown>;
/** Resolve a single dep: StoreKey<T> -> T, EachDep<T> -> T (element). */
export type ResolveDep<D> = D extends EachDep<infer T> ? T : D extends StoreKey<infer V> ? V : never;
/** Map a deps record to its resolved types. */
export type ResolveDeps<TDeps extends Record<string, Dep>> = {
	[K in keyof TDeps]: ResolveDep<TDeps[K]>;
};
/**
 * Create a LintPass with strongly-typed, named dependencies.
 *
 * Declare deps as a record; the factory resolves them from PassStore and
 * passes them as a typed object to your `run` callback. Use `each(key)`
 * for array-valued deps that should be iterated per element.
 *
 * At most one `each()` dep is allowed per rule. For multiple iterable
 * deps, implement `LintPass` directly.
 */
export declare function defineRule<const TDeps extends Record<string, Dep>>(config: {
	id: string;
	description: string;
	deps: TDeps;
	run(deps: ResolveDeps<TDeps>): void;
}): LintPass;
/** Thrown when pass finalize dependencies cannot be resolved. */
export declare class DependencyResolutionError extends Error {
	readonly missingDependencies?: string[] | undefined;
	readonly cyclicDependencies?: string[] | undefined;
	constructor(message: string, missingDependencies?: string[] | undefined, cyclicDependencies?: string[] | undefined);
}
/** Store key for the SchemaContext passed into the engine run. */
export declare const schemaContextKey: StoreKey<SchemaContext>;
/**
 * Lint engine that orchestrates all passes against an AST.
 *
 * Performs a single recursive AST walk dispatching to all pass visitor hooks,
 * then runs finalize (toposorted) and run (requires-gated) phases.
 */
export declare class LintEngine {
	private readonly passes;
	private readonly disabled;
	private readonly source;
	constructor(options?: {
		passes?: readonly LintPass[];
		source?: string;
	});
	/** Register a pass. Throws on duplicate id. */
	addPass(pass: LintPass): this;
	/** Disable a pass by id. */
	disable(id: string): this;
	/** Re-enable a previously disabled pass. */
	enable(id: string): this;
	/**
	 * Run all enabled passes against the AST.
	 *
	 * Mutates the AST by clearing diagnostics with this engine's source tag
	 * during the walk phase, ensuring re-runs produce fresh results.
	 */
	run(root: AstRoot, ctx: SchemaContext): {
		diagnostics: Diagnostic[];
		store: PassStore;
	};
	/**
	 * Dispatch targeted hooks (visitVariables) at root level.
	 * Gives passes access to specific AST regions without enterNode/exitNode.
	 */
	private dispatchTargetedHooks;
	/**
	 * Recursive walk dispatching to all pass visitors.
	 * Also clears lint diagnostics from previous runs.
	 */
	private walkNode;
	/** Topologically sort passes for finalize() ordering using Kahn's algorithm. */
	private sortFinalize;
	private systemDiagnostic;
}
export interface ExpressionEntry {
	expr: AstNodeLike;
	range: Range$1;
	scope: ScopeContext;
}
export interface DefinitionEntry {
	namespace: string;
	name: string;
	keyRange: Range$1;
	fullRange: Range$1;
	scope: ScopeContext;
}
export interface ScopeEntry {
	range: Range$1;
	scope: ScopeContext;
}
export interface PositionIndex {
	expressions: ExpressionEntry[];
	definitions: DefinitionEntry[];
	scopes: ScopeEntry[];
}
export declare const positionIndexKey: StoreKey<PositionIndex>;
/** Find the expression at a position. Uses smallest-range heuristic. */
export declare function queryExpressionAtPosition(index: PositionIndex, line: number, character: number): ExpressionEntry | null;
/** Find the definition key at a position. Uses smallest-range heuristic. */
export declare function queryDefinitionAtPosition(index: PositionIndex, line: number, character: number): DefinitionEntry | null;
/** Find the deepest scope context at a position. */
export declare function queryScopeAtPosition(index: PositionIndex, line: number, character: number): ScopeContext;
/** A resolved reference pointing to a definition in the AST. */
export interface ResolvedReference {
	namespace: string;
	name: string;
	symbolKind: SymbolKind;
	/** Key range for cursor placement on go-to-definition. */
	definitionRange: Range$1;
	fullRange: Range$1;
}
/** A reference occurrence found by findAllReferences. */
export interface ReferenceOccurrence {
	range: Range$1;
	/** Range covering only the property/name portion (for rename). */
	nameRange: Range$1;
	isDefinition: boolean;
}
/** Result of a definition lookup, with optional failure reason. */
export interface DefinitionResult {
	definition: ResolvedReference | null;
	reason?: string;
}
/**
 * Find the definition of the reference at the given position.
 *
 * When `symbols` is provided, uses the pre-computed symbol tree
 * to resolve definitions without re-walking the AST.
 */
export declare function findDefinitionAtPosition(ast: AstRoot, line: number, character: number, ctx: SchemaContext, symbols?: DocumentSymbol[], index?: PositionIndex): DefinitionResult;
/**
 * Find all references to the symbol at the given position.
 * Works when the cursor is on either a reference expression or a definition key.
 */
export declare function findReferencesAtPosition(ast: AstRoot, line: number, character: number, includeDeclaration: boolean, ctx: SchemaContext, symbols?: DocumentSymbol[], index?: PositionIndex): ReferenceOccurrence[];
/**
 * Resolve a namespace + name reference to its definition in the AST.
 * Uses the pre-computed symbol tree when available for fast lookup.
 */
export declare function resolveReference(ast: AstRoot, namespace: string, name: string, ctx: SchemaContext, scope?: ScopeContext, symbols?: DocumentSymbol[]): ResolvedReference | null;
/**
 * Find all occurrences of a reference to the given namespace + name.
 *
 * Expression references always require an AST walk. The declaration
 * lookup uses the symbol tree when available.
 */
export declare function findAllReferences(ast: AstRoot, namespace: string, name: string, ctx: SchemaContext, scope?: ScopeContext, includeDeclaration?: boolean, symbols?: DocumentSymbol[]): ReferenceOccurrence[];
/** Walk the AST visiting all definition keys (NamedMap entries, named blocks). */
export declare function walkDefinitionKeys(ast: AstRoot, callback: (namespace: string, name: string, keyRange: Range$1, fullRange: Range$1, ctx: ScopeContext) => void): void;
/** A completion candidate returned by the dialect layer. */
export interface CompletionCandidate {
	name: string;
	kind: SymbolKind;
	detail?: string;
	documentation?: string;
	/** Auto-generated LSP snippet text with tab stops, for compound fields. */
	snippet?: string;
}
/**
 * Find the enclosing scope for a cursor position.
 * Uses the position index for O(1) lookup when available, otherwise walks the AST.
 */
export declare function findEnclosingScope(ast: AstRoot, line: number, character: number, index?: PositionIndex): ScopeContext;
/** Get available namespace suggestions for bare @ or @partial. */
export declare function getAvailableNamespaces(ctx: SchemaContext, scope?: ScopeContext): CompletionCandidate[];
/**
 * Get completion candidates for entries within a namespace.
 * For scoped namespaces, uses the cursor scope to find the right block.
 *
 * When `symbols` is provided, uses the pre-computed DocumentSymbol tree
 * to avoid re-walking the AST.
 *
 * When `line`/`character` are provided, applies a nested-run override for
 * colinear-resolved scoped namespaces (e.g. `outputs`): if the cursor is
 * inside a `set` clause of a nested `run @actions.X`, `@outputs.` resolves
 * against `X` instead of the enclosing binding's action. `with` clauses
 * are intentionally NOT overridden — their RHS passes inputs TO the run
 * and references the outer scope's outputs. Mirrors the lint-side
 * transparency rule in `undefined-reference.ts`.
 */
export declare function getCompletionCandidates(ast: AstRoot, namespace: string, ctx: SchemaContext, scope?: ScopeContext, symbols?: DocumentSymbol[], line?: number, character?: number): CompletionCandidate[];
/**
 * Get field name completions for a cursor position.
 *
 * Uses the schema to determine valid fields at the current nesting level.
 * Returns field names not already present in the enclosing block.
 */
export declare function getFieldCompletions(ast: AstRoot, line: number, character: number, ctx: SchemaContext, 
/** Source text — enables indentation-based fallback for blank lines. */
source?: string): CompletionCandidate[];
/**
 * Get value completions for a TypedMap entry's value position.
 *
 * When the cursor is after `key: ` inside a TypedMap (e.g., `inputs:`,
 * `outputs:`, `variables:`), returns the primitive types and modifiers
 * defined by the TypedMap's schema.
 */
export declare function getValueCompletions(line: number, _character: number, ctx: SchemaContext, source: string): CompletionCandidate[];
export interface SnippetOptions {
	/** Spaces per indent level. Default 4. */
	tabSize?: number;
}
/**
 * Generate an LSP snippet string for a field completion.
 *
 * Returns `undefined` when a snippet adds no value (leaf primitives, sequences).
 */
export declare function generateFieldSnippet(fieldName: string, fieldType: FieldType, opts?: SnippetOptions): string | undefined;
/**
 * Interface for navigating the schema tree during hover resolution.
 * FieldType structurally satisfies this interface so no cast is needed
 * when passing a dialect schema to {@link resolveSchemaField}.
 */
export interface SchemaFieldInfo {
	isNamed?: boolean;
	__isCollection?: boolean;
	schema?: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>;
	__metadata?: FieldMetadata;
	__isTypedMap?: boolean;
	propertiesSchema?: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>;
	__modifiers?: readonly KeywordInfo[];
	__primitiveTypes?: readonly KeywordInfo[];
}
/**
 * Result of resolving a schema path to a field.
 */
export interface ResolvedSchemaField {
	field: SchemaFieldInfo;
	resolvedPath: string[];
	lastKey: string;
}
/**
 * Resolve a schema path to a field and its metadata.
 *
 * Handles three structural cases:
 * - Named/Collection (isNamed or __isCollection): skip instance name
 * - TypedMap (__isTypedMap): skip entry name, use propertiesSchema
 * - Regular Block/Field: direct schema key lookup
 */
export declare function resolveSchemaField(path: string[], schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>): ResolvedSchemaField | null;
/**
 * Build a markdown string summarizing the constraint metadata on a field.
 * Returns undefined if no constraints are present.
 */
export declare function formatConstraints(metadata: FieldMetadata): string | undefined;
/**
 * Format a full hover markdown string for a schema field.
 * Includes path, description, deprecation, version, modifiers, types, and constraints.
 */
export declare function formatSchemaHoverMarkdown(path: string[], metadata: FieldMetadata, modifiers?: readonly KeywordInfo[], primitiveTypes?: readonly KeywordInfo[]): string;
/**
 * Format hover markdown for a keyword (modifier or primitive type).
 *
 * @param keyword - The keyword text (e.g., "mutable", "string")
 * @param kind - Whether this is a 'modifier' or 'type'
 * @param info - The KeywordInfo for the keyword, if found
 * @returns Markdown string for the hover tooltip
 */
export declare function formatKeywordHoverMarkdown(keyword: string, kind: "modifier" | "type", info: KeywordInfo | undefined): string;
/**
 * Find a keyword in a KeywordInfo array by name.
 */
export declare function findKeywordInfo(keyword: string, keywords: readonly KeywordInfo[]): KeywordInfo | undefined;
/**
 * Thin abstraction over CST node access.
 *
 * `SyntaxNode` (parser native) and `SerializedNode` (web-worker
 * serialized) expose positions and children differently.  Rather than
 * wrapping every node, callers pass a stateless accessor object.
 */
export interface NodeAccessor<N> {
	/** Node grammar type (e.g. `"id"`, `"mapping_element"`). */
	type(node: N): string;
	/** Full source text spanned by the node. */
	text(node: N): string;
	/** All direct children (named + anonymous). */
	children(node: N): readonly N[];
	/** Named children only. */
	namedChildren(node: N): readonly N[];
	startLine(node: N): number;
	startColumn(node: N): number;
	endLine(node: N): number;
	endColumn(node: N): number;
	/**
	 * Return the first child whose grammar field name is `name`, or `null`.
	 *
	 * - SyntaxNode: `node.childForFieldName(name)`
	 * - SerializedNode: `node.children.find(c => c.fieldName === name)`
	 */
	childByFieldName(node: N, name: string): N | null;
}
export interface HoverRange {
	start: {
		line: number;
		character: number;
	};
	end: {
		line: number;
		character: number;
	};
}
export interface SchemaFieldHover {
	kind: "field";
	key: string;
	path: string[];
	metadata: FieldMetadata;
	range: HoverRange;
	modifiers?: readonly KeywordInfo[];
	primitiveTypes?: readonly KeywordInfo[];
}
export interface KeywordHover {
	kind: "modifier" | "type";
	keyword: string;
	info: KeywordInfo | undefined;
	range: HoverRange;
}
export type HoverResult = SchemaFieldHover | KeywordHover;
/**
 * Resolve hover information at a 0-based position in a CST.
 *
 * This is the single implementation shared by the LSP and Monaco hover
 * providers.  All tree-API differences are handled by the `accessor`.
 */
export declare function resolveHover<N>(root: N, line: number, character: number, schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>, accessor: NodeAccessor<N>): HoverResult | null;
/**
 * Recurse into an AST node's children using the correct iteration strategy.
 *
 * For blocks/sequences, `__children` is the single source of truth —
 * all data (fields, values, statements, map entries, sequence items)
 * lives there. No fallback `Object.entries` loop is needed.
 *
 * For expressions/statements (no `__children`), falls back to
 * `Object.entries`, skipping `__`-prefixed metadata keys.
 */
export declare function recurseAstChildren(value: unknown, recurse: (key: string, child: unknown, parent: unknown) => void): void;
/**
 * Enumerate the child expressions of a compound expression node.
 * Used by both the lint engine and reference resolution.
 */
export declare function forEachExpressionChild(obj: AstNodeLike, callback: (child: unknown, key: string, parent: AstNodeLike) => void): void;
/**
 * Shared dispatch logic for AST children traversal.
 *
 * Composes scope-update, expression-check, and recurse into a single
 * pattern used by walkAstExpressions and LintEngine.walkNode.
 */
export declare function dispatchAstChildren(value: unknown, ctx: ScopeContext, onExpression: ((obj: AstNodeLike, ctx: ScopeContext) => void) | null, recurse: (child: unknown, ctx: ScopeContext, key: string, parent: unknown) => void): ScopeContext;
/** Walk the entire AST visiting every expression node with scope context. */
export declare function walkAstExpressions(value: unknown, callback: (expr: AstNodeLike, ctx: ScopeContext) => void, ctx?: ScopeContext, visited?: Set<unknown>): void;
/** Walk the AST collecting all __diagnostics into a flat array. */
export declare function collectDiagnostics(value: unknown): Diagnostic[];
export declare const symbolTableKey: StoreKey<DocumentSymbol[]>;
export declare function symbolTableAnalyzer(): LintPass;
export declare function undefinedReferencePass(): LintPass;
export declare function duplicateKeyPass(): LintPass;
export declare function requiredFieldPass(): LintPass;
/**
 * Create a lint pass that enforces singular collection fields.
 * Reads the `singular` flag from field metadata set via `.singular()`.
 */
export declare function singularCollectionPass(): LintPass;
export declare const constraintValidationKey: StoreKey<ReadonlySet<AstNodeLike>>;
export declare function constraintValidationPass(): LintPass;
export declare function positionIndexPass(): LintPass;
export declare function unreachableCodePass(): LintPass;
export declare function emptyBlockPass(): LintPass;
export declare function spreadContextPass(): LintPass;
export declare function unusedVariablePass(): LintPass;
/**
 * Default set of built-in functions recognized by the AgentScript runtime.
 * Dialects can replace this entirely via {@link ExpressionValidationOptions.functions}.
 */
export declare const BUILTIN_FUNCTIONS: ReadonlySet<string>;
/**
 * Configuration options for the expression validation lint pass.
 * Allows dialects to customise the set of recognized functions and operators.
 * Both options replace the defaults entirely when provided.
 */
export interface ExpressionValidationOptions {
	/** Complete set of allowed function names. Defaults to {@link BUILTIN_FUNCTIONS}. */
	functions?: ReadonlySet<string>;
	/** Map from namespace name to the set of function names allowed under that namespace (e.g. `{ a2a: new Set(['task', 'message']) }`). Defaults to empty object. */
	namespacedFunctions?: Record<string, ReadonlySet<string>>;
	/** Complete set of supported binary operators. Defaults to the built-in operator set. */
	supportedOperators?: ReadonlySet<string>;
}
export declare function expressionValidationPass(options?: ExpressionValidationOptions): LintPass;
export declare const LINT_SOURCE = "agentscript-lint";
/** Distance <= 40% of the longer name's length is considered a plausible typo. */
export declare const SUGGESTION_THRESHOLD = 0.4;
/** Levenshtein edit distance with O(min(a,b)) space. */
export declare function levenshtein(a: string, b: string): number;
/**
 * Append a "Did you mean '...'?" hint to a message if a suggestion is provided.
 * Use `prefix` to prepend a sigil (e.g., '@') to the suggestion display.
 */
export declare function formatSuggestionHint(message: string, suggestion: string | undefined, prefix?: string): string;
/** Find the closest "Did you mean?" candidate within the similarity threshold. */
export declare function findSuggestion(name: string, candidates: string[]): string | undefined;
/** Extract the action name from a reasoning action's colinear `@actions.X` value. */
export declare function resolveColinearAction(raBlock: {
	value?: unknown;
}): string | null;
/** Create a lint diagnostic with the standard source tag and optional suggestion. */
export declare function lintDiagnostic(range: Range$1, message: string, severity: DiagnosticSeverity, code: string, options?: {
	suggestion?: string;
	tags?: DiagnosticTag[];
}): Diagnostic;
/** Extract an `@outputs.X` reference and its CST range from a SetClause value. */
export declare function extractOutputRef(value: unknown): {
	name: string;
	cst?: CstMeta;
} | null;
/** Extract an `@variables.X` reference, or null if not a variables reference. */
export declare function extractVariableRef(expr: unknown): string | null;
/**
 * Configuration for a dialect. After implementing this interface, register
 * the dialect in `packages/lsp/src/dialect-registry.ts` so all LSP servers
 * and the UI pick it up automatically.
 */
export interface DialectConfig {
	/** Unique name for this dialect (e.g., 'agentscript', 'agentforce'). Derived from package name. */
	readonly name: string;
	/** Human-readable display name (e.g., 'AgentScript', 'Agentforce'). */
	readonly displayName: string;
	/** Short description for UI display. */
	readonly description: string;
	/** Dialect version from package.json (e.g., '2.2.6'). */
	readonly version: string;
	/** Full schema metadata: root schema, aliases, and global scopes. Single source of truth. */
	readonly schemaInfo: SchemaInfo;
	/** Factory that creates fresh lint passes for each analysis run. */
	readonly createRules: () => LintPass[];
	/** Diagnostic source tag (defaults to `${name}-lint`). */
	readonly source?: string;
}
/**
 * Parse `# @dialect: NAME=VERSION` annotations from document source.
 */
export interface DialectAnnotation {
	/** Dialect name, lowercased (e.g., 'agentforce'). */
	name: string;
	/** Optional version constraint (e.g., '1.1.0' or '1'). */
	version?: string;
	/** Zero-based line number where the annotation was found. */
	line: number;
	/** Zero-based character offset of the NAME portion within the line. */
	nameStart: number;
	/** Length of the NAME portion. */
	nameLength: number;
	/** Zero-based character offset of the VERSION portion (after '='). -1 if no version. */
	versionStart: number;
	/** Length of the VERSION portion. 0 if no version. */
	versionLength: number;
}
/**
 * Parse a `# @dialect: NAME=VERSION` annotation from the first ~10 lines of source.
 * Returns null if no annotation is found.
 */
export declare function parseDialectAnnotation(source: string): DialectAnnotation | null;
/** Configuration needed for dialect resolution. */
export interface DialectResolutionConfig {
	/** Available dialects. */
	dialects: DialectConfig[];
	/** Default dialect name when no `# @dialect:` annotation is present. Defaults to first dialect's name. */
	defaultDialect?: string;
}
export interface VersionDiagnostic {
	message: string;
	/** 1 = Error, 2 = Warning */
	severity: 1 | 2;
	line: number;
	versionStart: number;
	versionLength: number;
	/** Suggested replacement versions (major and major.minor). */
	suggestedVersions: string[];
}
export interface ResolvedDialect {
	dialect: DialectConfig;
	versionDiagnostic?: VersionDiagnostic;
	unknownDialect?: {
		name: string;
		line: number;
		nameStart: number;
		nameLength: number;
		availableNames: string[];
	};
}
/**
 * Resolve the dialect for a document based on its `# @dialect:` annotation
 * or the default dialect from config.
 */
export declare function resolveDialect(source: string, config: DialectResolutionConfig): ResolvedDialect;
/**
 * Shared semantic token definitions for syntax highlighting.
 *
 * This module is the single source of truth for the token type/modifier
 * registry and the highlight capture → token mapping used by the LSP
 * server, the Monaco editor integration, and the Agentforce package.
 */
export declare const TOKEN_TYPES: readonly [
	"keyword",
	"type",
	"function",
	"variable",
	"string",
	"number",
	"operator",
	"comment",
	"namespace",
	"property",
	"decorator"
];
export declare const TOKEN_MODIFIERS: readonly [
	"defaultLibrary",
	"modification",
	"readonly",
	"block",
	"blockName"
];
export interface SemanticToken {
	line: number;
	startChar: number;
	length: number;
	tokenType: number;
	tokenModifiers: number;
}
/** A single capture from a highlight highlights query. */
interface HighlightCapture$1 {
	name: string;
	startRow: number;
	startCol: number;
	endRow: number;
	endCol: number;
}
/**
 * Explicit mapping from highlight capture names to semantic token
 * type + modifier pairs.  `null` means "don't highlight".
 */
export declare const CAPTURE_MAP: Record<string, {
	type: number;
	modifiers: number;
} | null>;
/**
 * Map a highlight capture name to a token type + modifiers pair.
 * Returns `null` for captures that should not be highlighted.
 */
export declare function mapCaptureToToken(captureName: string): {
	type: number;
	modifiers: number;
} | null;
/**
 * Remove overlapping tokens at the same position.
 * Expects tokens pre-sorted by (line, startChar, length desc).
 * When two tokens share the same range, the later one wins (higher
 * query-pattern priority).
 */
export declare function dedupeOverlappingTokens(tokens: SemanticToken[]): SemanticToken[];
export interface LanguageService {
	update(cstNode: SyntaxNode): void;
	readonly ast: AstRoot | null;
	readonly diagnostics: ReadonlyArray<Diagnostic>;
	readonly store: PassStore | null;
	getSymbols(): DocumentSymbol[];
	getDefinition(line: number, char: number): DefinitionResult | null;
	getReferences(line: number, char: number, includeDeclaration?: boolean): ReferenceOccurrence[];
	getCompletions(line: number, char: number, namespace: string): CompletionCandidate[];
	getNamespaceCompletions(line: number, char: number): CompletionCandidate[];
	getFieldCompletions(line: number, char: number): CompletionCandidate[];
	getEnclosingScope(line: number, char: number): ScopeContext;
	readonly schemaContext: SchemaContext;
	readonly dialectConfig: DialectConfig;
}
export declare function createLanguageService(config: {
	dialect: DialectConfig;
}): LanguageService;
export declare function parseAndLint(node: SyntaxNode, dialect: DialectConfig, options?: {
	dialectParser?: Dialect;
	engine?: LintEngine;
}): {
	ast: AstRoot;
	diagnostics: Diagnostic[];
	store: PassStore;
};
/**
 * Shared indentation rules for AgentScript.
 *
 * Exported as regex source strings so they can be consumed by both
 * Monaco (LanguageConfiguration) and VSCode (language-configuration.json).
 */
/**
 * Describes an action to take when Enter is pressed.
 */
export interface OnEnterRule {
	/** Regex source string matched against the line content before the cursor. */
	beforeText: string;
	/** Regex source string matched against the line content after the cursor. */
	afterText?: string;
	/** Regex source string matched against the line above. */
	previousLineText?: string;
	/** Indentation action: indent, outdent, or none (maintain). */
	action: "indent" | "outdent" | "none";
	/** Text to append after the new line's indentation. */
	appendText?: string;
}
/**
 * Lines ending with `:` or `->` (with optional trailing whitespace/comment)
 * should increase indentation on the next line.
 *
 * Excludes comment-only lines (lines where `#` appears before `:` or `->`).
 */
export declare const increaseIndentPattern = "^[^#]*(?::|->)\\s*(?:#.*)?$";
/**
 * Never-match pattern — offside-rule languages don't decrease indent
 * based on content patterns (indentation is structural).
 */
export declare const decreaseIndentPattern = "^\\s*NEVERMATCH$";
/**
 * Rules that determine indentation behavior when Enter is pressed.
 *
 * Both Monaco and VSCode support these rules natively. Monaco accepts
 * RegExp objects; VSCode accepts regex source strings in JSON.
 */
export declare const onEnterRules: OnEnterRule[];
/**
 * Generate semantic tokens from source code.
 *
 * @param source - Source code to highlight
 * @returns Array of semantic tokens sorted by position
 */
export declare function generateSemanticTokens(source: string): SemanticToken[];
export declare const ContextBlock: BlockFactory<{
	memory: BlockFactory<{
		enabled: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
	}>;
}>;
export declare const AFActionsBlock: CollectionBlockFactory<Omit<{
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	inputs: TypedMapFactory<TypedDeclarationBase>;
	outputs: TypedMapFactory<TypedDeclarationBase>;
	target: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	source: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
	source: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	require_user_confirmation: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
	include_in_progress_indicator: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
	progress_indicator_message: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	inputs: TypedMapFactory<TypedDeclarationBase>;
	outputs: TypedMapFactory<TypedDeclarationBase>;
}, Record<never, never>>;
export declare const SecurityBlock: BlockFactory<{
	sharing_policy: BlockFactory<{
		use_default_sharing_entities: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		custom_sharing_entities: ConstrainedBuilder<readonly [
			"sequence"
		], SequenceNode, SequenceNode>;
	}>;
	verified_customer_record_access: BlockFactory<{
		use_default_objects: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		additional_objects: ConstrainedBuilder<readonly [
			"sequence"
		], SequenceNode, SequenceNode>;
	}>;
}>;
declare const AFTopicBlock: NamedBlockFactory<{
	actions: CollectionBlockFactory<Omit<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
		target: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		require_user_confirmation: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		include_in_progress_indicator: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		progress_indicator_message: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
	}, Record<never, never>>;
	model_config: BlockFactory<{
		model: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		params: BlockFactory<{}>;
	}>;
	security: BlockFactory<{
		sharing_policy: BlockFactory<{
			use_default_sharing_entities: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			custom_sharing_entities: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
		verified_customer_record_access: BlockFactory<{
			use_default_objects: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			additional_objects: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
	}>;
	before_reasoning: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	after_reasoning: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	reasoning: BlockFactory<{
		instructions: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, never>, Record<never, never>>;
	}>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	system: BlockFactory<Pick<{
		instructions: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		messages: BlockFactory<{
			welcome: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			error: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}>;
	}, "instructions">>;
	schema: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, Record<never, never>>;
declare const AFSubagentBlock: NamedBlockFactory<{
	actions: CollectionBlockFactory<Omit<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
		target: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		require_user_confirmation: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		include_in_progress_indicator: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		progress_indicator_message: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
	}, Record<never, never>>;
	model_config: BlockFactory<{
		model: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		params: BlockFactory<{}>;
	}>;
	security: BlockFactory<{
		sharing_policy: BlockFactory<{
			use_default_sharing_entities: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			custom_sharing_entities: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
		verified_customer_record_access: BlockFactory<{
			use_default_objects: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			additional_objects: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
	}>;
	before_reasoning: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	after_reasoning: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	reasoning: BlockFactory<{
		instructions: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, never>, Record<never, never>>;
	}>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	system: BlockFactory<Pick<{
		instructions: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		messages: BlockFactory<{
			welcome: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			error: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}>;
	}, "instructions">>;
	schema: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, Record<never, never>>;
declare const AFStartAgentBlock: NamedBlockFactory<Omit<{
	before_reasoning: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	after_reasoning: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	reasoning: BlockFactory<{
		instructions: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, never>, Record<never, never>>;
	}>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	system: BlockFactory<Pick<{
		instructions: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		messages: BlockFactory<{
			welcome: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			error: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}>;
	}, "instructions">>;
	actions: CollectionBlockFactory<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
		target: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, Record<never, never>>;
	schema: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}, "actions" | "model_config" | "security" | "reasoning"> & {
	actions: CollectionBlockFactory<Omit<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
		target: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
		source: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		require_user_confirmation: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		include_in_progress_indicator: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		progress_indicator_message: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
		outputs: TypedMapFactory<TypedDeclarationBase>;
	}, Record<never, never>>;
	reasoning: BlockFactory<{
		instructions: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, never>, Record<never, never>>;
	}>;
	model_config: BlockFactory<{
		model: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		params: BlockFactory<{}>;
	}>;
	security: BlockFactory<{
		sharing_policy: BlockFactory<{
			use_default_sharing_entities: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			custom_sharing_entities: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
		verified_customer_record_access: BlockFactory<{
			use_default_objects: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			additional_objects: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
	}>;
}, Record<never, never>>;
export declare const KnowledgeBlock: BlockFactory<{
	citations_url: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	rag_feature_config_id: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	citations_enabled: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
}>;
export declare const ConnectionBlock: NamedBlockFactory<{
	adaptive_response_allowed: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
	escalation_message: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	instructions: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	outbound_route_type: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	outbound_route_name: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	response_actions: CollectionBlockFactory<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, Record<never, never>>;
}, Record<never, never>>;
export declare const ConnectionsBlock: NamedCollectionBlockFactory<{
	adaptive_response_allowed: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
	escalation_message: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	instructions: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	outbound_route_type: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	outbound_route_name: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	response_actions: CollectionBlockFactory<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, Record<never, never>>;
}, Record<never, never>>;
export declare const PronunciationDictEntryBlock: BlockFactory<{
	grapheme: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	phoneme: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	type: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}>;
export declare const InboundKeywordsBlock: BlockFactory<{
	keywords: ConstrainedBuilder<readonly [
		"sequence"
	], SequenceNode, SequenceNode>;
}>;
declare const SpeakUpConfigBlock: BlockFactory<{
	speak_up_first_wait_time_ms: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	speak_up_follow_up_wait_time_ms: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	speak_up_message: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}>;
declare const EndpointingConfigBlock: BlockFactory<{
	max_wait_time_ms: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
}>;
declare const BeepBoopConfigBlock: BlockFactory<{
	max_wait_time_ms: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
}>;
declare const AdditionalConfigsBlock: BlockFactory<{
	speak_up_config: BlockFactory<{
		speak_up_first_wait_time_ms: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		speak_up_follow_up_wait_time_ms: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		speak_up_message: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}>;
	endpointing_config: BlockFactory<{
		max_wait_time_ms: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
	}>;
	beepboop_config: BlockFactory<{
		max_wait_time_ms: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
	}>;
}>;
declare const VoiceModalitySchema: {
	readonly inbound_filler_words_detection: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
	readonly inbound_keywords: BlockFactory<{
		keywords: ConstrainedBuilder<readonly [
			"sequence"
		], SequenceNode, SequenceNode>;
	}>;
	readonly voice_id: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	readonly outbound_speed: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly outbound_style_exaggeration: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly outbound_stability: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly outbound_similarity: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly pronunciation_dict: ConstrainedBuilder<readonly [
		"sequence"
	], SequenceNode, SequenceNode>;
	readonly outbound_filler_sentences: ConstrainedBuilder<readonly [
		"sequence"
	], SequenceNode, SequenceNode>;
	readonly additional_configs: BlockFactory<{
		speak_up_config: BlockFactory<{
			speak_up_first_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
			speak_up_follow_up_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
			speak_up_message: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}>;
		endpointing_config: BlockFactory<{
			max_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
		}>;
		beepboop_config: BlockFactory<{
			max_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
		}>;
	}>;
};
declare const ModalityBlock: NamedBlockFactory<Record<never, never>, Record<never, never> & Record<"voice", {
	readonly inbound_filler_words_detection: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
	readonly inbound_keywords: BlockFactory<{
		keywords: ConstrainedBuilder<readonly [
			"sequence"
		], SequenceNode, SequenceNode>;
	}>;
	readonly voice_id: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	readonly outbound_speed: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly outbound_style_exaggeration: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly outbound_stability: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly outbound_similarity: ConstrainedBuilder<readonly [
		"number",
		"generic"
	], unknown, unknown>;
	readonly pronunciation_dict: ConstrainedBuilder<readonly [
		"sequence"
	], SequenceNode, SequenceNode>;
	readonly outbound_filler_sentences: ConstrainedBuilder<readonly [
		"sequence"
	], SequenceNode, SequenceNode>;
	readonly additional_configs: BlockFactory<{
		speak_up_config: BlockFactory<{
			speak_up_first_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
			speak_up_follow_up_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
			speak_up_message: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}>;
		endpointing_config: BlockFactory<{
			max_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
		}>;
		beepboop_config: BlockFactory<{
			max_wait_time_ms: ConstrainedBuilder<readonly [
				"number",
				"generic"
			], unknown, unknown>;
		}>;
	}>;
}>>;
export declare const AgentforceSchema: {
	config: BlockFactory<Omit<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, "developer_name" | "agent_label" | "agent_description" | "agent_type" | "agent_id" | "agent_name" | "default_agent_user" | "agent_version" | "enable_enhanced_event_logs" | "company" | "role" | "planner_type" | "additional_parameter__reset_to_initial_node" | "additional_parameter__DISABLE_GROUNDEDNESS" | "debug" | "max_tokens" | "temperature" | "agent_template" | "outbound_flow" | "user_locale"> & {
		developer_name: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		agent_label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		agent_description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		agent_type: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		agent_id: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		agent_name: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		default_agent_user: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		agent_version: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		enable_enhanced_event_logs: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		company: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		role: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		planner_type: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		additional_parameter__reset_to_initial_node: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		additional_parameter__DISABLE_GROUNDEDNESS: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		debug: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		max_tokens: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		temperature: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		agent_template: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		outbound_flow: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		user_locale: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}>;
	variables: TypedMapFactory<TypedDeclarationBase>;
	model_config: BlockFactory<{
		model: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		params: BlockFactory<{}>;
	}>;
	knowledge: BlockFactory<{
		citations_url: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		rag_feature_config_id: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		citations_enabled: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
	}>;
	connection: NamedCollectionBlockFactory<{
		adaptive_response_allowed: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		escalation_message: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		instructions: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		outbound_route_type: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		outbound_route_name: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		response_actions: CollectionBlockFactory<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, Record<never, never>>;
	}, Record<never, never>>;
	connected_subagent: NamedCollectionBlockFactory<{
		target: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		loading_text: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		inputs: TypedMapFactory<TypedDeclarationBase>;
	}, Record<never, never>>;
	modality: NamedCollectionBlockFactory<Record<never, never>, Record<never, never> & Record<"voice", {
		readonly inbound_filler_words_detection: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
		readonly inbound_keywords: BlockFactory<{
			keywords: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
		readonly voice_id: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		readonly outbound_speed: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		readonly outbound_style_exaggeration: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		readonly outbound_stability: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		readonly outbound_similarity: ConstrainedBuilder<readonly [
			"number",
			"generic"
		], unknown, unknown>;
		readonly pronunciation_dict: ConstrainedBuilder<readonly [
			"sequence"
		], SequenceNode, SequenceNode>;
		readonly outbound_filler_sentences: ConstrainedBuilder<readonly [
			"sequence"
		], SequenceNode, SequenceNode>;
		readonly additional_configs: BlockFactory<{
			speak_up_config: BlockFactory<{
				speak_up_first_wait_time_ms: ConstrainedBuilder<readonly [
					"number",
					"generic"
				], unknown, unknown>;
				speak_up_follow_up_wait_time_ms: ConstrainedBuilder<readonly [
					"number",
					"generic"
				], unknown, unknown>;
				speak_up_message: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}>;
			endpointing_config: BlockFactory<{
				max_wait_time_ms: ConstrainedBuilder<readonly [
					"number",
					"generic"
				], unknown, unknown>;
			}>;
			beepboop_config: BlockFactory<{
				max_wait_time_ms: ConstrainedBuilder<readonly [
					"number",
					"generic"
				], unknown, unknown>;
			}>;
		}>;
	}>>;
	security: BlockFactory<{
		sharing_policy: BlockFactory<{
			use_default_sharing_entities: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			custom_sharing_entities: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
		verified_customer_record_access: BlockFactory<{
			use_default_objects: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			additional_objects: ConstrainedBuilder<readonly [
				"sequence"
			], SequenceNode, SequenceNode>;
		}>;
	}>;
	context: BlockFactory<{
		memory: BlockFactory<{
			enabled: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
		}>;
	}>;
	subagent: NamedCollectionBlockFactory<{
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
			target: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			require_user_confirmation: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			include_in_progress_indicator: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			progress_indicator_message: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
		}, Record<never, never>>;
		model_config: BlockFactory<{
			model: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			params: BlockFactory<{}>;
		}>;
		security: BlockFactory<{
			sharing_policy: BlockFactory<{
				use_default_sharing_entities: ConstrainedBuilder<readonly [
					"generic"
				], unknown, unknown>;
				custom_sharing_entities: ConstrainedBuilder<readonly [
					"sequence"
				], SequenceNode, SequenceNode>;
			}>;
			verified_customer_record_access: BlockFactory<{
				use_default_objects: ConstrainedBuilder<readonly [
					"generic"
				], unknown, unknown>;
				additional_objects: ConstrainedBuilder<readonly [
					"sequence"
				], SequenceNode, SequenceNode>;
			}>;
		}>;
		before_reasoning: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		after_reasoning: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		reasoning: BlockFactory<{
			instructions: ConstrainedBuilder<readonly [
			], unknown, unknown>;
			actions: CollectionBlockFactory<Omit<{
				description: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				label: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}, never>, Record<never, never>>;
		}>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		system: BlockFactory<Pick<{
			instructions: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			messages: BlockFactory<{
				welcome: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				error: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}>;
		}, "instructions">>;
		schema: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, Record<never, never>>;
	start_agent: NamedCollectionBlockFactory<Omit<{
		before_reasoning: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		after_reasoning: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		reasoning: BlockFactory<{
			instructions: ConstrainedBuilder<readonly [
			], unknown, unknown>;
			actions: CollectionBlockFactory<Omit<{
				description: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				label: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}, never>, Record<never, never>>;
		}>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		system: BlockFactory<Pick<{
			instructions: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			messages: BlockFactory<{
				welcome: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				error: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}>;
		}, "instructions">>;
		actions: CollectionBlockFactory<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
			target: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, Record<never, never>>;
		schema: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, "actions" | "model_config" | "security" | "reasoning"> & {
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
			target: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			require_user_confirmation: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			include_in_progress_indicator: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			progress_indicator_message: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
		}, Record<never, never>>;
		reasoning: BlockFactory<{
			instructions: ConstrainedBuilder<readonly [
			], unknown, unknown>;
			actions: CollectionBlockFactory<Omit<{
				description: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				label: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}, never>, Record<never, never>>;
		}>;
		model_config: BlockFactory<{
			model: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			params: BlockFactory<{}>;
		}>;
		security: BlockFactory<{
			sharing_policy: BlockFactory<{
				use_default_sharing_entities: ConstrainedBuilder<readonly [
					"generic"
				], unknown, unknown>;
				custom_sharing_entities: ConstrainedBuilder<readonly [
					"sequence"
				], SequenceNode, SequenceNode>;
			}>;
			verified_customer_record_access: BlockFactory<{
				use_default_objects: ConstrainedBuilder<readonly [
					"generic"
				], unknown, unknown>;
				additional_objects: ConstrainedBuilder<readonly [
					"sequence"
				], SequenceNode, SequenceNode>;
			}>;
		}>;
	}, Record<never, never>>;
	topic: NamedCollectionBlockFactory<{
		actions: CollectionBlockFactory<Omit<{
			description: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			label: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
			target: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}, "source" | "require_user_confirmation" | "include_in_progress_indicator" | "progress_indicator_message" | "inputs" | "outputs"> & {
			source: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			require_user_confirmation: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			include_in_progress_indicator: ConstrainedBuilder<readonly [
				"generic"
			], unknown, unknown>;
			progress_indicator_message: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			inputs: TypedMapFactory<TypedDeclarationBase>;
			outputs: TypedMapFactory<TypedDeclarationBase>;
		}, Record<never, never>>;
		model_config: BlockFactory<{
			model: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			params: BlockFactory<{}>;
		}>;
		security: BlockFactory<{
			sharing_policy: BlockFactory<{
				use_default_sharing_entities: ConstrainedBuilder<readonly [
					"generic"
				], unknown, unknown>;
				custom_sharing_entities: ConstrainedBuilder<readonly [
					"sequence"
				], SequenceNode, SequenceNode>;
			}>;
			verified_customer_record_access: BlockFactory<{
				use_default_objects: ConstrainedBuilder<readonly [
					"generic"
				], unknown, unknown>;
				additional_objects: ConstrainedBuilder<readonly [
					"sequence"
				], SequenceNode, SequenceNode>;
			}>;
		}>;
		before_reasoning: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		after_reasoning: ConstrainedBuilder<readonly [
		], unknown, unknown>;
		reasoning: BlockFactory<{
			instructions: ConstrainedBuilder<readonly [
			], unknown, unknown>;
			actions: CollectionBlockFactory<Omit<{
				description: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				label: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}, never>, Record<never, never>>;
		}>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		system: BlockFactory<Pick<{
			instructions: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			messages: BlockFactory<{
				welcome: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
				error: ConstrainedBuilder<readonly [
					"string",
					"generic"
				], TStringValue, TStringValue>;
			}>;
		}, "instructions">>;
		schema: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, Record<never, never>>;
	system: BlockFactory<{
		instructions: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		messages: BlockFactory<{
			welcome: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
			error: ConstrainedBuilder<readonly [
				"string",
				"generic"
			], TStringValue, TStringValue>;
		}>;
	}>;
	language: BlockFactory<{
		default_locale: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		additional_locales: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		all_additional_locales: ConstrainedBuilder<readonly [
			"generic"
		], unknown, unknown>;
	}>;
};
export type AgentforceSchema = typeof AgentforceSchema;
/** Fully-parsed AgentForce document with CST metadata. */
export type ParsedAgentforce = Parsed<InferFields<typeof AgentforceSchema>> & AstRoot;
/** Pre-built reverse lookup: block `__kind` → schema key. */
export declare const AgentforceKindToSchemaKey: Map<string, string>;
export declare const AgentforceSchemaAliases: Record<string, string>;
export declare const AgentforceSchemaInfo: SchemaInfo;
export declare const agentforceSchemaContext: SchemaContext;
declare const MessagesBlock: BlockFactory<{
	welcome: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	error: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
}>;
declare const SystemBlock: BlockFactory<{
	instructions: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	messages: BlockFactory<{
		welcome: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		error: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}>;
}>;
declare const LanguageBlock: BlockFactory<{
	default_locale: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	additional_locales: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	all_additional_locales: ConstrainedBuilder<readonly [
		"generic"
	], unknown, unknown>;
}>;
declare const ReasoningBlock: BlockFactory<{
	instructions: ConstrainedBuilder<readonly [
	], unknown, unknown>;
	actions: CollectionBlockFactory<Omit<{
		description: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
		label: ConstrainedBuilder<readonly [
			"string",
			"generic"
		], TStringValue, TStringValue>;
	}, never>, Record<never, never>>;
}>;
declare const ConnectedSubagentBlock: NamedBlockFactory<{
	target: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	label: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	description: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	loading_text: ConstrainedBuilder<readonly [
		"string",
		"generic"
	], TStringValue, TStringValue>;
	inputs: TypedMapFactory<TypedDeclarationBase>;
}, Record<never, never>>;
export type ParsedSystem = InferFieldType<typeof SystemBlock>;
export type ParsedLanguage = InferFieldType<typeof LanguageBlock>;
export type ParsedReasoningAction = InferFieldType<typeof ReasoningActionBlock>;
export type ParsedMessages = InferFieldType<typeof MessagesBlock>;
export type ParsedConnectedAgent = InferFieldType<typeof ConnectedSubagentBlock>;
/** All Agentforce lint rules — extends AgentScript rules with security checks. */
export declare function defaultRules(): LintPass[];
export type ParsedTopicReasoning = InferFieldType<typeof ReasoningBlock>;
export type ParsedConfig = InferFieldType<typeof AgentforceSchema.config>;
export type ParsedTopic = InferFieldType<typeof AFTopicBlock>;
export type ParsedSubagent = InferFieldType<typeof AFSubagentBlock>;
export type ParsedStartAgent = InferFieldType<typeof AFStartAgentBlock>;
export type ParsedKnowledge = InferFieldType<typeof KnowledgeBlock>;
export type ParsedConnection = InferFieldType<typeof ConnectionBlock>;
export type ParsedSecurity = InferFieldType<typeof SecurityBlock>;
export type ParsedModality = InferFieldType<typeof ModalityBlock>;
export type ParsedVoiceModality = InferFields<typeof VoiceModalitySchema>;
export type ParsedAdditionalConfigs = InferFieldType<typeof AdditionalConfigsBlock>;
export type ParsedSpeakUpConfig = InferFieldType<typeof SpeakUpConfigBlock>;
export type ParsedEndpointingConfig = InferFieldType<typeof EndpointingConfigBlock>;
export type ParsedBeepBoopConfig = InferFieldType<typeof BeepBoopConfigBlock>;
export type ParsedContext = InferFieldType<typeof ContextBlock>;
export declare const agentforceDialect: DialectConfig;
/**
 * JSON-serializable representation of a CST node.
 * Preserves all CST node metadata needed for debug views.
 */
export interface SerializedCSTNode {
	type: string;
	text?: string;
	range: {
		start: {
			line: number;
			character: number;
		};
		end: {
			line: number;
			character: number;
		};
	};
	children?: SerializedCSTNode[];
	fieldName?: string | null;
	isNamed: boolean;
	hasError: boolean;
	isMissing: boolean;
}
/**
 * Full parse result from `parseComponentDebug()`.
 *
 * Generic over `T` so the `component` field carries the same type safety as
 * `parseComponent()`.  Defaults to `unknown` for backward-compatible usage.
 */
export interface ParseComponentDebugResult<T = unknown> {
	/** The extracted component (block instance, or undefined on failure). */
	component: T | undefined;
	/** Serialized CST with positions adjusted to the user's original source. */
	cst: SerializedCSTNode | null;
	/** Parse and lint diagnostics. */
	diagnostics: Diagnostic[];
}
/**
 * Internal parser interface.
 *
 * Used internally by `parseComponent()`, `parseComponentDebug()`, and `AgentforceDocument`.
 */
export interface AgentScriptParser {
	parse(source: string): {
		rootNode: SyntaxNode;
	};
}
/**
 * Valid component kinds for `parseComponent()`.
 *
 * Schema block keys map to their respective block types in the Agentforce schema.
 * `'statement'` and `'expression'` are special kinds for parsing isolated statements
 * and expressions respectively.
 *
 * In JavaScript, these are just strings — no import needed.
 */
export type ComponentKind = keyof AgentforceSchema | "statement" | "expression" | "action" | "actions" | "reasoning_actions";
/**
 * Maps each schema block key to its parsed block type (single entry, not NamedMap).
 *
 * Uses `InferEntryType` which, for collection factories, follows the `entryBlock`
 * reference to get the single-entry parsed type (exactly what `parseComponent()`
 * returns via `extractNamedEntry`). For non-collection types it falls back to
 * `InferFieldType`.
 */
export type ComponentResultMap = {
	[K in keyof AgentforceSchema]: InferEntryType<AgentforceSchema[K]> extends BlockCore ? InferEntryType<AgentforceSchema[K]> : never;
};
/**
 * Schema keys whose FieldType holds named entries (NamedBlock or CollectionBlock).
 * These keys accept named entries via `addEntry()` / `removeEntry()`.
 */
export type NamedKeys = {
	[K in keyof AgentforceSchema]: AgentforceSchema[K] extends {
		isNamed: true;
	} ? K : AgentforceSchema[K] extends {
		__isCollection: true;
	} ? K : never;
}[keyof AgentforceSchema];
/**
 * Schema keys whose FieldType does NOT hold named entries (singular blocks).
 * These keys accept direct values via `setField()` / `removeField()`.
 */
export type SingularKeys = {
	[K in keyof AgentforceSchema]: AgentforceSchema[K] extends {
		isNamed: true;
	} ? never : AgentforceSchema[K] extends {
		__isCollection: true;
	} ? never : K;
}[keyof AgentforceSchema];
/**
 * Extract non-internal (`__`-prefixed) field keys from a block type.
 * When `T` is a specific parsed block, this narrows to its known field names.
 * Falls back to `string` for plain `BlockCore`.
 */
export type BlockFieldKeys<T> = Exclude<{
	[K in keyof T]: K extends `__${string}` ? never : K;
}[keyof T], undefined> & string;
/**
 * Extract field keys from `T` whose values are NamedMap collections.
 * Falls back to `string` when `T` is plain `BlockCore`.
 */
export type NamedMapFieldKeys<T> = Exclude<{
	[K in keyof T]: K extends `__${string}` ? never : NonNullable<T[K]> extends NamedMap<unknown> ? K : never;
}[keyof T], undefined> & string;
/**
 * Helpers available inside mutation callbacks for __children-safe mutations.
 *
 * Generic over the block type `T` so that field keys and values are typed when
 * the concrete block type is known (works for both document-root and standalone
 * component mutations). Falls back to `string` / `unknown` for plain `BlockCore`.
 */
export interface MutationHelpers<T = BlockCore> {
	/** Set a field value (new or existing). Creates FieldChild + accessor if new. */
	setField<K extends BlockFieldKeys<T>>(key: K, value: NonNullable<T[K]>): void;
	/** Set a field value by arbitrary string key (escape hatch for dynamic keys). */
	setField(key: string, value: unknown): void;
	/** Remove a field. Removes FieldChild from __children and deletes accessor. */
	removeField<K extends BlockFieldKeys<T>>(key: K): void;
	/** Remove a field by arbitrary string key. */
	removeField(key: string): void;
	/** Add a named entry to a NamedMap field. Handles NamedMap + __children. */
	addEntry<K extends NamedMapFieldKeys<T>>(key: K, name: string, value: BlockCore): void;
	/** Add a named entry by arbitrary string key (escape hatch for dynamic keys). */
	addEntry(key: string, name: string, value: BlockCore): void;
	/** Remove a named entry from a NamedMap field. Handles NamedMap + __children. */
	removeEntry<K extends NamedMapFieldKeys<T>>(key: K, name: string): void;
	/** Remove a named entry by arbitrary string key (escape hatch for dynamic keys). */
	removeEntry(key: string, name: string): void;
}
/**
 * A single entry in the document's mutation history.
 * Used to power undo/redo, change list panels, and diff viewers.
 */
export interface HistoryEntry {
	/** Source snapshot BEFORE this mutation was applied. */
	readonly source: string;
	/** Human-readable description of the change (from mutate()'s label parameter). */
	readonly label: string | undefined;
	/** Wall-clock time when the mutation was applied. */
	readonly timestamp: number;
}
declare class Document$1 {
	private _ast;
	private _diagnostics;
	private _parser;
	private _isDirty;
	private _history;
	private _historyIndex;
	private _redoStack;
	private constructor();
	/** @internal Factory used by `parse()`. */
	static create(ast: ParsedAgentforce, diagnostics: readonly Diagnostic[], store: PassStore, parser: AgentScriptParser): Document$1;
	/** @internal Factory for creating an empty document (used when parse fails). */
	static empty(diagnostics: readonly Diagnostic[]): Document$1;
	get ast(): ParsedAgentforce;
	get diagnostics(): readonly Diagnostic[];
	get hasErrors(): boolean;
	get errors(): Diagnostic[];
	get warnings(): Diagnostic[];
	emit(options?: {
		tabSize?: number;
	}): string;
	/**
	 * Apply a mutation to the AST in-place.
	 *
	 * Creates an undo point (source snapshot before the mutation).
	 * After `fn` executes, auto-syncs document `__children` for singular
	 * root-level property changes. For named entries, use the `helpers`.
	 */
	mutate(fn: (ast: ParsedAgentforce, helpers: MutationHelpers<ParsedAgentforce>) => void, label?: string): this;
	/** Add/replace a singular root-level block. Handles `__children`. */
	setField<K extends SingularKeys>(key: K, value: InferFieldType<AgentforceSchema[K]>, label?: string): this;
	/** Remove a singular root-level block. Handles `__children`. */
	removeField(key: SingularKeys, label?: string): this;
	/** Add a named entry (topic, connection, etc.). Handles NamedMap + document `__children`. */
	addEntry<K extends NamedKeys>(key: K, name: string, value: InferFieldType<AgentforceSchema[K]>, label?: string): this;
	/** Remove a named entry. Handles NamedMap + document `__children`. */
	removeEntry(key: NamedKeys, name: string, label?: string): this;
	get canUndo(): boolean;
	get canRedo(): boolean;
	get isDirty(): boolean;
	undo(): this;
	redo(): this;
	get history(): readonly HistoryEntry[];
	get historyIndex(): number;
	/**
	 * Get before/after source for diffing.
	 * Defaults to comparing the state before the last mutation to the current state.
	 */
	getDiff(fromIndex?: number, toIndex?: number): {
		before: string;
		after: string;
	};
	private _parseFrom;
}
/**
 * Parse an AgentScript source string into a Document.
 *
 * This function never throws. If parsing fails due to a runtime error,
 * it returns a Document with an empty AST and a diagnostic describing
 * the failure.
 *
 * @param source - The AgentScript source text.
 * @returns A Document with the parsed AST, diagnostics, and mutation API.
 *
 * @example
 * ```typescript
 * import { parse } from '@agentscript/agentforce';
 *
 * const doc = parse('system:\n  instructions: "Hello"');
 * console.log(doc.hasErrors);
 * console.log(doc.emit());
 * ```
 */
export declare function parse(source: string): Document$1;
/**
 * Parse a standalone AgentScript component (block, statement, or expression).
 *
 * For block kinds (e.g. `'topic'`, `'config'`), the source should be a complete
 * block with header. Returns the block instance directly — it already has
 * `__emit()`, `__kind`, `__children`, `__name`, `__diagnostics`.
 *
 * For `'statement'`, the source should be one or more statements (e.g. `if`, `run`).
 * Returns an array of Statement objects.
 *
 * For `'expression'`, the source should be a single expression.
 * Returns the Expression object.
 *
 * Never throws — returns `undefined` (or `[]` for statements) on failure.
 *
 * @example
 * ```typescript
 * import { parseComponent } from '@agentscript/agentforce';
 *
 * // Parse a topic block — return type is inferred as ParsedTopic
 * const topic = parseComponent(
 *   'topic billing:\n  description: "Handle billing"',
 *   'topic'
 * );
 * doc.addEntry('topic', 'billing', topic);
 *
 * // Parse a statement
 * const stmts = parseComponent('run MyAction()', 'statement');
 *
 * // Parse an expression
 * const expr = parseComponent('"hello " + name', 'expression');
 * ```
 */
export declare function parseComponent(source: string, kind: "statement"): Statement[];
export declare function parseComponent(source: string, kind: "expression"): Expression | undefined;
export declare function parseComponent(source: string, kind: "action" | "actions" | "reasoning_actions"): ComponentResultMap[keyof ComponentResultMap] | undefined;
export declare function parseComponent<K extends keyof AgentforceSchema>(source: string, kind: K): ComponentResultMap[K] | undefined;
/**
 * Parse a standalone component and return the full result including CST and diagnostics.
 *
 * Unlike `parseComponent()` which only returns the extracted component, this function
 * also returns the serialized CST tree and all diagnostics — useful for debug tooling.
 *
 * All positions in the returned CST and component are adjusted to be relative to the
 * user's original source (editor coordinates), even when wrapping was applied internally.
 */
export declare function parseComponentDebug(source: string, kind: "action" | "actions" | "reasoning_actions"): ParseComponentDebugResult<ComponentResultMap[keyof ComponentResultMap]>;
export declare function parseComponentDebug<K extends keyof AgentforceSchema>(source: string, kind: K): ParseComponentDebugResult<ComponentResultMap[K]>;
export interface ComponentParseResult {
	ast: Record<string, unknown>;
	diagnostics: Diagnostic[];
}
export interface ComponentKindConfig {
	label: string;
	/** Schema used for parsing. */
	schema: Record<string, FieldType>;
	/** Wrap user source so the parser sees a valid top-level document. */
	wrap(source: string): string;
	/** Extract the parsed component from the full parse result. */
	extract(ast: Record<string, unknown>): unknown;
	/** Run the dialect/lint parse on a CST root node. */
	parse(rootNode: SyntaxNode): ComponentParseResult;
	/**
	 * Strip synthetic wrapper nodes from a serialized CST.
	 * For nested kinds this descends past the wrapper; for non-nested kinds
	 * this is an identity function.
	 */
	stripWrapperCST(cst: SerializedCSTNode): SerializedCSTNode;
	/** Line/column offsets introduced by wrapping (for position adjustment). */
	wrapOffsets: {
		lines: number;
		columns: number;
	};
}
/**
 * Get the component kind configuration for a given kind.
 * Returns `undefined` for unknown kinds.
 */
export declare function getComponentKindConfig(kind: string): ComponentKindConfig | undefined;
/**
 * Get all available component kinds as `{ value, label }` pairs
 * suitable for a dropdown selector.
 */
export declare function getComponentKindOptions(): ReadonlyArray<{
	readonly value: string;
	readonly label: string;
}>;
export interface EmitComponentOptions {
	tabSize?: number;
	/** When true, throws if any field is not defined in the block's schema. */
	strict?: boolean;
}
/**
 * Emit a parsed component back to AgentScript source text.
 *
 * Handles all `parseComponent()` return types:
 * - Block instances (topic, config, etc.) — emitted with their full header
 * - `Statement[]` arrays
 * - Single `Statement` or `Expression` values
 *
 * When `strict: true`, throws if the block contains non-schema fields.
 */
export declare function emitComponent(component: BlockCore | Statement[] | Statement | Expression | undefined, options?: EmitComponentOptions): string;
/**
 * Validate that all fields on a block are defined in its schema.
 * Throws if any non-schema field is found.
 */
export declare function validateStrictSchema(block: BlockCore): void;
/**
 * Mutate a standalone block component in-place with helpers for operations
 * that can't be expressed as simple property assignment.
 *
 * For simple field changes, you can assign directly — `emitComponent()` auto-syncs.
 * Use `mutateComponent()` when you need helpers for operations that can't be expressed
 * as simple property assignment:
 * - **Remove** fields (`helpers.removeField()`)
 * - **Add/remove named entries** (`helpers.addEntry()` / `helpers.removeEntry()`)
 *
 * @example
 * ```typescript
 * // Simple field changes — assign directly, emitComponent auto-syncs:
 * topic.description = new StringLiteral('Updated');
 * topic.source = new StringLiteral('billing_v2'); // new field
 * emitComponent(topic); // both changes are emitted
 *
 * // For removal or NamedMap ops, use mutateComponent:
 * mutateComponent(topic, (block, helpers) => {
 *   helpers.removeField('source');
 *   helpers.addEntry('actions', 'myAction', actionBlock);
 * });
 * ```
 *
 * @returns The same block instance, for chaining.
 */
export interface MutateComponentOptions {
	/** When true, throws if any field is not defined in the block's schema. */
	strict?: boolean;
}
export declare function mutateComponent<T extends BlockCore>(block: T, fn: (block: T, helpers: MutationHelpers<T>) => void, options?: MutateComponentOptions): T;
declare const agentDslAuthoring: z.ZodObject<{
	schema_version: z.ZodString;
	global_configuration: z.ZodObject<{
		developer_name: z.ZodString;
		label: z.ZodString;
		description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
		enable_enhanced_event_logs: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
		agent_type: z.ZodEnum<{
			EinsteinServiceAgent: "EinsteinServiceAgent";
			AgentforceEmployeeAgent: "AgentforceEmployeeAgent";
			SalesEinsteinCoach: "SalesEinsteinCoach";
		}>;
		template_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
		default_agent_user: z.ZodOptional<z.ZodNullable<z.ZodString>>;
		default_outbound_routing: z.ZodOptional<z.ZodNullable<z.ZodString>>;
		context_variables: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
			developer_name: z.ZodString;
			label: z.ZodString;
			description: z.ZodOptional<z.ZodString>;
			data_type: z.ZodEnum<{
				string: "string";
				number: "number";
				boolean: "boolean";
				date: "date";
				timestamp: "timestamp";
				currency: "currency";
				id: "id";
			}>;
			field_mapping: z.ZodOptional<z.ZodNullable<z.ZodString>>;
		}, z.core.$strip>>>>;
		security: z.ZodOptional<z.ZodNullable<z.ZodObject<{
			verified_customer_record_access: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				use_default_objects: z.ZodBoolean;
				additional_objects: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
			}, z.core.$strip>>>;
		}, z.core.$strip>>>;
	}, z.core.$strip>;
	agent_version: z.ZodUnion<readonly [
		z.ZodObject<{
			developer_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
			planner_type: z.ZodEnum<{
				AiCopilot__ReAct: "AiCopilot__ReAct";
				Atlas__ConcurrentMultiAgentOrchestration: "Atlas__ConcurrentMultiAgentOrchestration";
				Atlas__VoiceAgent: "Atlas__VoiceAgent";
				SentOS__SearchAgent: "SentOS__SearchAgent";
			}>;
			system_messages: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				message_type: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
					Welcome: "Welcome";
					Error: "Error";
					Escalation: "Escalation";
				}>>>;
			}, z.core.$strip>>>>;
			modality_parameters: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				voice: z.ZodOptional<z.ZodNullable<z.ZodObject<{
					inbound_filler_words_detection: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					inbound_keywords: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						keywords: z.ZodArray<z.ZodString>;
					}, z.core.$strip>>>;
					voice_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					outbound_speed: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					outbound_style_exaggeration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					outbound_filler_sentences: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						filler_sentences: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
					}, z.core.$strip>>>>;
					outbound_stability: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					outbound_similarity: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					pronunciation_dict: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						pronunciations: z.ZodArray<z.ZodObject<{
							grapheme: z.ZodString;
							phoneme: z.ZodString;
							type: z.ZodEnum<{
								IPA: "IPA";
								CMU: "CMU";
							}>;
						}, z.core.$strip>>;
					}, z.core.$strip>>>;
					additional_configs: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						speak_up_config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
							speak_up_first_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
							speak_up_follow_up_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
							speak_up_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						}, z.core.$strip>>>;
						endpointing_config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
							max_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
						}, z.core.$strip>>>;
						beepboop_config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
							max_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
						}, z.core.$strip>>>;
					}, z.core.$strip>>>;
				}, z.core.$strip>>>;
				language: z.ZodOptional<z.ZodNullable<z.ZodObject<{
					default_locale: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
						id: "id";
						in: "in";
						en_US: "en_US";
						en_GB: "en_GB";
						en_AU: "en_AU";
						fr: "fr";
						fr_CA: "fr_CA";
						it: "it";
						de: "de";
						es: "es";
						es_MX: "es_MX";
						ca: "ca";
						nl_NL: "nl_NL";
						da: "da";
						no: "no";
						sv: "sv";
						fi: "fi";
						ja: "ja";
						zh_CN: "zh_CN";
						zh_TW: "zh_TW";
						ko: "ko";
						hi: "hi";
						tl: "tl";
						th: "th";
						vi: "vi";
						ms: "ms";
						pt_PT: "pt_PT";
						pt_BR: "pt_BR";
						iw: "iw";
						he: "he";
						ar: "ar";
						tr: "tr";
						bg: "bg";
						hr: "hr";
						cs: "cs";
						et: "et";
						el: "el";
						hu: "hu";
						pl: "pl";
						ro: "ro";
					}>>>;
					additional_locales: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
						id: "id";
						in: "in";
						en_US: "en_US";
						en_GB: "en_GB";
						en_AU: "en_AU";
						fr: "fr";
						fr_CA: "fr_CA";
						it: "it";
						de: "de";
						es: "es";
						es_MX: "es_MX";
						ca: "ca";
						nl_NL: "nl_NL";
						da: "da";
						no: "no";
						sv: "sv";
						fi: "fi";
						ja: "ja";
						zh_CN: "zh_CN";
						zh_TW: "zh_TW";
						ko: "ko";
						hi: "hi";
						tl: "tl";
						th: "th";
						vi: "vi";
						ms: "ms";
						pt_PT: "pt_PT";
						pt_BR: "pt_BR";
						iw: "iw";
						he: "he";
						ar: "ar";
						tr: "tr";
						bg: "bg";
						hr: "hr";
						cs: "cs";
						et: "et";
						el: "el";
						hu: "hu";
						pl: "pl";
						ro: "ro";
					}>>>>;
					all_additional_locales: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
				}, z.core.$strip>>>;
			}, z.core.$strip>>>;
			additional_parameters: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
			company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
			role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
			state_variables: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				developer_name: z.ZodString;
				label: z.ZodString;
				description: z.ZodOptional<z.ZodString>;
				data_type: z.ZodEnum<{
					string: "string";
					number: "number";
					boolean: "boolean";
					object: "object";
					date: "date";
					timestamp: "timestamp";
					currency: "currency";
					id: "id";
				}>;
				is_list: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
				default: z.ZodOptional<z.ZodUnknown>;
				visibility: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
					Internal: "Internal";
					External: "External";
				}>>>;
			}, z.core.$strip>>>>;
			initial_node: z.ZodString;
			nodes: z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
				z.ZodIntersection<z.ZodObject<{
					type: z.ZodLiteral<"subagent">;
				}, z.core.$strip>, z.ZodObject<{
					model_configuration: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						model_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						configuration: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
					}, z.core.$strip>>>;
					before_reasoning_iteration: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					instructions: z.ZodOptional<z.ZodString>;
					type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						related_agent: "related_agent";
						router: "router";
						subagent: "subagent";
					}>>>;
					reasoning_type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					before_reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					focus_prompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					tools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								supervision: "supervision";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
							name: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							input_parameters: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
								developer_name: z.ZodString;
								label: z.ZodString;
								description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
								data_type: z.ZodEnum<{
									String: "String";
									Boolean: "Boolean";
									DateTime: "DateTime";
									Double: "Double";
									ID: "ID";
									Integer: "Integer";
									Long: "Long";
									Date: "Date";
									Time: "Time";
									SObject: "SObject";
									ApexDefined: "ApexDefined";
									LightningTypes: "LightningTypes";
								}>;
								complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
								is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
								required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
								is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
								constant_value: z.ZodOptional<z.ZodUnknown>;
							}, z.core.$strip>>>>;
							forced: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"supervision">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								supervision: "supervision";
							}>>>;
							target: z.ZodString;
							name: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							forced: z.ZodOptional<z.ZodUnknown>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							supervision: "supervision";
						}>>;
					}, z.core.$strip>>>>>;
					pre_tool_call: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						target: z.ZodString;
						actions: z.ZodArray<z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>;
					}, z.core.$strip>>>>;
					post_tool_call: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						target: z.ZodString;
						actions: z.ZodArray<z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>;
					}, z.core.$strip>>>>;
					after_all_tool_calls: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					after_reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					developer_name: z.ZodString;
					label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					on_init: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					on_exit: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>>;
						target: z.ZodString;
						bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
						llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
						enabled: z.ZodOptional<z.ZodUnknown>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>>>;
					action_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						label: z.ZodString;
						description: z.ZodString;
						require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						invocation_target_type: z.ZodString;
						invocation_target_name: z.ZodString;
						input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							constant_value: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>>>;
						output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
						}, z.core.$strip>>>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>>,
				z.ZodIntersection<z.ZodObject<{
					type: z.ZodLiteral<"related_agent">;
				}, z.core.$strip>, z.ZodObject<{
					type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						related_agent: "related_agent";
						router: "router";
						subagent: "subagent";
					}>>>;
					developer_name: z.ZodString;
					label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					invocation_target_type: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
					invocation_target_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					loading_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
					on_init: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					on_exit: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>>;
						target: z.ZodString;
						bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
						llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
						enabled: z.ZodOptional<z.ZodUnknown>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>>>;
					action_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						label: z.ZodString;
						description: z.ZodString;
						require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						invocation_target_type: z.ZodString;
						invocation_target_name: z.ZodString;
						input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							constant_value: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>>>;
						output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
						}, z.core.$strip>>>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>>,
				z.ZodIntersection<z.ZodObject<{
					type: z.ZodLiteral<"router">;
				}, z.core.$strip>, z.ZodObject<{
					model_configuration: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						model_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						configuration: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
					}, z.core.$strip>>>;
					before_reasoning_iteration: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					instructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						related_agent: "related_agent";
						router: "router";
						subagent: "subagent";
					}>>>;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					tools: z.ZodArray<z.ZodObject<{
						name: z.ZodString;
						target: z.ZodString;
						enabled: z.ZodOptional<z.ZodUnknown>;
						description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>;
					developer_name: z.ZodString;
					label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					on_init: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					on_exit: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>>;
						target: z.ZodString;
						bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
						llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
						enabled: z.ZodOptional<z.ZodUnknown>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>>>;
					action_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						label: z.ZodString;
						description: z.ZodString;
						require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						invocation_target_type: z.ZodString;
						invocation_target_name: z.ZodString;
						input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							constant_value: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>>>;
						output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
						}, z.core.$strip>>>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>>
			]>, z.ZodObject<{
				type: z.ZodOptional<z.ZodEnum<{
					related_agent: "related_agent";
					router: "router";
					subagent: "subagent";
				}>>;
			}, z.core.$strip>>>;
			knowledge_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				rag_feature_id: z.ZodString;
				rag_feature_name: z.ZodString;
				rag_feature_namespace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				rag_feature_fully_qualified_name: z.ZodString;
				adl_configuration: z.ZodObject<{
					ai_ground_library_label: z.ZodString;
					ai_grounding_library_id: z.ZodString;
					ai_grounding_library_name: z.ZodString;
					ai_grounding_library_namespace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					ai_grounding_library_fully_qualified_name: z.ZodString;
					referenced_retrievers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						fully_qualified_name: z.ZodString;
						namespace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						dataspace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						grounding_source_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						external_source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>;
			}, z.core.$strip>>>>;
			legacy_knowledge_action: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				developer_name: z.ZodString;
				source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				label: z.ZodString;
				description: z.ZodString;
				require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
				include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
				progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				invocation_target_type: z.ZodString;
				invocation_target_name: z.ZodString;
				input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
					developer_name: z.ZodString;
					label: z.ZodString;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					data_type: z.ZodEnum<{
						String: "String";
						Boolean: "Boolean";
						DateTime: "DateTime";
						Double: "Double";
						ID: "ID";
						Integer: "Integer";
						Long: "Long";
						Date: "Date";
						Time: "Time";
						SObject: "SObject";
						ApexDefined: "ApexDefined";
						LightningTypes: "LightningTypes";
					}>;
					complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					constant_value: z.ZodOptional<z.ZodUnknown>;
				}, z.core.$strip>>>>;
				output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
					developer_name: z.ZodString;
					label: z.ZodString;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					data_type: z.ZodEnum<{
						String: "String";
						Boolean: "Boolean";
						DateTime: "DateTime";
						Double: "Double";
						ID: "ID";
						Integer: "Integer";
						Long: "Long";
						Date: "Date";
						Time: "Time";
						SObject: "SObject";
						ApexDefined: "ApexDefined";
						LightningTypes: "LightningTypes";
					}>;
					complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
				}, z.core.$strip>>>>;
			}, z.core.$strip>>>;
			surfaces: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				surface_type: z.ZodString;
				adaptive_response_allowed: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
				outbound_route_configs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
					escalation_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					outbound_route_type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						OmniChannelFlow: "OmniChannelFlow";
					}>>>;
					outbound_route_name: z.ZodString;
				}, z.core.$strip>>>>;
			}, z.core.$strip>>>>;
			context: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				memory: z.ZodOptional<z.ZodNullable<z.ZodObject<{
					enabled: z.ZodBoolean;
				}, z.core.$strip>>>;
			}, z.core.$strip>>>;
		}, z.core.$strip>,
		z.ZodArray<z.ZodObject<{
			developer_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
			planner_type: z.ZodEnum<{
				AiCopilot__ReAct: "AiCopilot__ReAct";
				Atlas__ConcurrentMultiAgentOrchestration: "Atlas__ConcurrentMultiAgentOrchestration";
				Atlas__VoiceAgent: "Atlas__VoiceAgent";
				SentOS__SearchAgent: "SentOS__SearchAgent";
			}>;
			system_messages: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				message_type: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
					Welcome: "Welcome";
					Error: "Error";
					Escalation: "Escalation";
				}>>>;
			}, z.core.$strip>>>>;
			modality_parameters: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				voice: z.ZodOptional<z.ZodNullable<z.ZodObject<{
					inbound_filler_words_detection: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					inbound_keywords: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						keywords: z.ZodArray<z.ZodString>;
					}, z.core.$strip>>>;
					voice_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					outbound_speed: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					outbound_style_exaggeration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					outbound_filler_sentences: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						filler_sentences: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>;
					}, z.core.$strip>>>>;
					outbound_stability: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					outbound_similarity: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
					pronunciation_dict: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						pronunciations: z.ZodArray<z.ZodObject<{
							grapheme: z.ZodString;
							phoneme: z.ZodString;
							type: z.ZodEnum<{
								IPA: "IPA";
								CMU: "CMU";
							}>;
						}, z.core.$strip>>;
					}, z.core.$strip>>>;
					additional_configs: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						speak_up_config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
							speak_up_first_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
							speak_up_follow_up_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
							speak_up_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						}, z.core.$strip>>>;
						endpointing_config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
							max_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
						}, z.core.$strip>>>;
						beepboop_config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
							max_wait_time_ms: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
						}, z.core.$strip>>>;
					}, z.core.$strip>>>;
				}, z.core.$strip>>>;
				language: z.ZodOptional<z.ZodNullable<z.ZodObject<{
					default_locale: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
						id: "id";
						in: "in";
						en_US: "en_US";
						en_GB: "en_GB";
						en_AU: "en_AU";
						fr: "fr";
						fr_CA: "fr_CA";
						it: "it";
						de: "de";
						es: "es";
						es_MX: "es_MX";
						ca: "ca";
						nl_NL: "nl_NL";
						da: "da";
						no: "no";
						sv: "sv";
						fi: "fi";
						ja: "ja";
						zh_CN: "zh_CN";
						zh_TW: "zh_TW";
						ko: "ko";
						hi: "hi";
						tl: "tl";
						th: "th";
						vi: "vi";
						ms: "ms";
						pt_PT: "pt_PT";
						pt_BR: "pt_BR";
						iw: "iw";
						he: "he";
						ar: "ar";
						tr: "tr";
						bg: "bg";
						hr: "hr";
						cs: "cs";
						et: "et";
						el: "el";
						hu: "hu";
						pl: "pl";
						ro: "ro";
					}>>>;
					additional_locales: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodEnum<{
						id: "id";
						in: "in";
						en_US: "en_US";
						en_GB: "en_GB";
						en_AU: "en_AU";
						fr: "fr";
						fr_CA: "fr_CA";
						it: "it";
						de: "de";
						es: "es";
						es_MX: "es_MX";
						ca: "ca";
						nl_NL: "nl_NL";
						da: "da";
						no: "no";
						sv: "sv";
						fi: "fi";
						ja: "ja";
						zh_CN: "zh_CN";
						zh_TW: "zh_TW";
						ko: "ko";
						hi: "hi";
						tl: "tl";
						th: "th";
						vi: "vi";
						ms: "ms";
						pt_PT: "pt_PT";
						pt_BR: "pt_BR";
						iw: "iw";
						he: "he";
						ar: "ar";
						tr: "tr";
						bg: "bg";
						hr: "hr";
						cs: "cs";
						et: "et";
						el: "el";
						hu: "hu";
						pl: "pl";
						ro: "ro";
					}>>>>;
					all_additional_locales: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
				}, z.core.$strip>>>;
			}, z.core.$strip>>>;
			additional_parameters: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
			company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
			role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
			state_variables: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				developer_name: z.ZodString;
				label: z.ZodString;
				description: z.ZodOptional<z.ZodString>;
				data_type: z.ZodEnum<{
					string: "string";
					number: "number";
					boolean: "boolean";
					object: "object";
					date: "date";
					timestamp: "timestamp";
					currency: "currency";
					id: "id";
				}>;
				is_list: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
				default: z.ZodOptional<z.ZodUnknown>;
				visibility: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
					Internal: "Internal";
					External: "External";
				}>>>;
			}, z.core.$strip>>>>;
			initial_node: z.ZodString;
			nodes: z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
				z.ZodIntersection<z.ZodObject<{
					type: z.ZodLiteral<"subagent">;
				}, z.core.$strip>, z.ZodObject<{
					model_configuration: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						model_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						configuration: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
					}, z.core.$strip>>>;
					before_reasoning_iteration: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					instructions: z.ZodOptional<z.ZodString>;
					type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						related_agent: "related_agent";
						router: "router";
						subagent: "subagent";
					}>>>;
					reasoning_type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					before_reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					focus_prompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					tools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								supervision: "supervision";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
							name: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							input_parameters: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
								developer_name: z.ZodString;
								label: z.ZodString;
								description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
								data_type: z.ZodEnum<{
									String: "String";
									Boolean: "Boolean";
									DateTime: "DateTime";
									Double: "Double";
									ID: "ID";
									Integer: "Integer";
									Long: "Long";
									Date: "Date";
									Time: "Time";
									SObject: "SObject";
									ApexDefined: "ApexDefined";
									LightningTypes: "LightningTypes";
								}>;
								complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
								is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
								required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
								is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
								constant_value: z.ZodOptional<z.ZodUnknown>;
							}, z.core.$strip>>>>;
							forced: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"supervision">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								supervision: "supervision";
							}>>>;
							target: z.ZodString;
							name: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							forced: z.ZodOptional<z.ZodUnknown>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							supervision: "supervision";
						}>>;
					}, z.core.$strip>>>>>;
					pre_tool_call: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						target: z.ZodString;
						actions: z.ZodArray<z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>;
					}, z.core.$strip>>>>;
					post_tool_call: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						target: z.ZodString;
						actions: z.ZodArray<z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>;
					}, z.core.$strip>>>>;
					after_all_tool_calls: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					after_reasoning: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					developer_name: z.ZodString;
					label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					on_init: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					on_exit: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>>;
						target: z.ZodString;
						bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
						llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
						enabled: z.ZodOptional<z.ZodUnknown>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>>>;
					action_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						label: z.ZodString;
						description: z.ZodString;
						require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						invocation_target_type: z.ZodString;
						invocation_target_name: z.ZodString;
						input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							constant_value: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>>>;
						output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
						}, z.core.$strip>>>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>>,
				z.ZodIntersection<z.ZodObject<{
					type: z.ZodLiteral<"related_agent">;
				}, z.core.$strip>, z.ZodObject<{
					type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						related_agent: "related_agent";
						router: "router";
						subagent: "subagent";
					}>>>;
					developer_name: z.ZodString;
					label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					invocation_target_type: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
					invocation_target_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					loading_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
					on_init: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					on_exit: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>>;
						target: z.ZodString;
						bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
						llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
						enabled: z.ZodOptional<z.ZodUnknown>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>>>;
					action_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						label: z.ZodString;
						description: z.ZodString;
						require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						invocation_target_type: z.ZodString;
						invocation_target_name: z.ZodString;
						input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							constant_value: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>>>;
						output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
						}, z.core.$strip>>>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>>,
				z.ZodIntersection<z.ZodObject<{
					type: z.ZodLiteral<"router">;
				}, z.core.$strip>, z.ZodObject<{
					model_configuration: z.ZodOptional<z.ZodNullable<z.ZodObject<{
						model_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						configuration: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
					}, z.core.$strip>>>;
					before_reasoning_iteration: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					instructions: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						related_agent: "related_agent";
						router: "router";
						subagent: "subagent";
					}>>>;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					tools: z.ZodArray<z.ZodObject<{
						name: z.ZodString;
						target: z.ZodString;
						enabled: z.ZodOptional<z.ZodUnknown>;
						description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>;
					developer_name: z.ZodString;
					label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					on_init: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodIntersection<z.ZodUnion<readonly [
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"action">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
							llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>,
						z.ZodIntersection<z.ZodObject<{
							type: z.ZodLiteral<"handoff">;
						}, z.core.$strip>, z.ZodObject<{
							type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
								action: "action";
								handoff: "handoff";
							}>>>;
							target: z.ZodString;
							enabled: z.ZodOptional<z.ZodUnknown>;
							state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
						}, z.core.$strip>>
					]>, z.ZodObject<{
						type: z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>;
					}, z.core.$strip>>>>>;
					on_exit: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
							action: "action";
							handoff: "handoff";
						}>>>;
						target: z.ZodString;
						bound_inputs: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
						llm_inputs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
						enabled: z.ZodOptional<z.ZodUnknown>;
						state_updates: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>>>;
					}, z.core.$strip>>>>;
					action_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						label: z.ZodString;
						description: z.ZodString;
						require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
						progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						invocation_target_type: z.ZodString;
						invocation_target_name: z.ZodString;
						input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							constant_value: z.ZodOptional<z.ZodUnknown>;
						}, z.core.$strip>>>>;
						output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
							developer_name: z.ZodString;
							label: z.ZodString;
							description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							data_type: z.ZodEnum<{
								String: "String";
								Boolean: "Boolean";
								DateTime: "DateTime";
								Double: "Double";
								ID: "ID";
								Integer: "Integer";
								Long: "Long";
								Date: "Date";
								Time: "Time";
								SObject: "SObject";
								ApexDefined: "ApexDefined";
								LightningTypes: "LightningTypes";
							}>;
							complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
							is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
							is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
						}, z.core.$strip>>>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>>
			]>, z.ZodObject<{
				type: z.ZodOptional<z.ZodEnum<{
					related_agent: "related_agent";
					router: "router";
					subagent: "subagent";
				}>>;
			}, z.core.$strip>>>;
			knowledge_definitions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				rag_feature_id: z.ZodString;
				rag_feature_name: z.ZodString;
				rag_feature_namespace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				rag_feature_fully_qualified_name: z.ZodString;
				adl_configuration: z.ZodObject<{
					ai_ground_library_label: z.ZodString;
					ai_grounding_library_id: z.ZodString;
					ai_grounding_library_name: z.ZodString;
					ai_grounding_library_namespace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					ai_grounding_library_fully_qualified_name: z.ZodString;
					referenced_retrievers: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
						developer_name: z.ZodString;
						fully_qualified_name: z.ZodString;
						namespace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						dataspace: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						grounding_source_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
						external_source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					}, z.core.$strip>>>>;
				}, z.core.$strip>;
			}, z.core.$strip>>>>;
			legacy_knowledge_action: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				developer_name: z.ZodString;
				source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				label: z.ZodString;
				description: z.ZodString;
				require_user_confirmation: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
				include_in_progress_indicator: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
				progress_indicator_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
				invocation_target_type: z.ZodString;
				invocation_target_name: z.ZodString;
				input_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
					developer_name: z.ZodString;
					label: z.ZodString;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					data_type: z.ZodEnum<{
						String: "String";
						Boolean: "Boolean";
						DateTime: "DateTime";
						Double: "Double";
						ID: "ID";
						Integer: "Integer";
						Long: "Long";
						Date: "Date";
						Time: "Time";
						SObject: "SObject";
						ApexDefined: "ApexDefined";
						LightningTypes: "LightningTypes";
					}>;
					complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					required: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					is_user_input: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					constant_value: z.ZodOptional<z.ZodUnknown>;
				}, z.core.$strip>>>>;
				output_type: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
					developer_name: z.ZodString;
					label: z.ZodString;
					description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					data_type: z.ZodEnum<{
						String: "String";
						Boolean: "Boolean";
						DateTime: "DateTime";
						Double: "Double";
						ID: "ID";
						Integer: "Integer";
						Long: "Long";
						Date: "Date";
						Time: "Time";
						SObject: "SObject";
						ApexDefined: "ApexDefined";
						LightningTypes: "LightningTypes";
					}>;
					complex_data_type_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					is_list: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					is_used_by_planner: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
					is_displayable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
				}, z.core.$strip>>>>;
			}, z.core.$strip>>>;
			surfaces: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
				surface_type: z.ZodString;
				adaptive_response_allowed: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
				outbound_route_configs: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
					escalation_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
					outbound_route_type: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
						OmniChannelFlow: "OmniChannelFlow";
					}>>>;
					outbound_route_name: z.ZodString;
				}, z.core.$strip>>>>;
			}, z.core.$strip>>>>;
			context: z.ZodOptional<z.ZodNullable<z.ZodObject<{
				memory: z.ZodOptional<z.ZodNullable<z.ZodObject<{
					enabled: z.ZodBoolean;
				}, z.core.$strip>>>;
			}, z.core.$strip>>>;
		}, z.core.$strip>>
	]>;
	context: z.ZodOptional<z.ZodNullable<z.ZodObject<{
		memory: z.ZodOptional<z.ZodNullable<z.ZodObject<{
			enabled: z.ZodBoolean;
		}, z.core.$strip>>>;
	}, z.core.$strip>>>;
}, z.core.$strip>;
/**
 * Base AgentDSLAuthoring type from generated OpenAPI schema.
 */
export type AgentDSLAuthoring = z.infer<typeof agentDslAuthoring>;
/**
 * Result of the compile() function.
 */
export interface CompileResult {
	/** The AgentJSON output object (plain values — all Sourced<T> unwrapped) */
	output: AgentDSLAuthoring;
	/** Source range data for serializer: (object, key) → Range */
	ranges: WeakMap<object, Map<string, Range$1>>;
	/** Compiler diagnostics (errors, warnings) */
	diagnostics: Diagnostic[];
}
/**
 * Compile a parsed AgentScript AST into AgentJSON (AgentDSLAuthoring schema v2.0).
 *
 * Output values are plain primitives. Source ranges are tracked in `ranges`
 * (populated automatically by ctx.track()). Pass both to serializeWithSourceMap().
 */
export declare function compile(ast: ParsedAgentforce): CompileResult;
export interface SerializeOptions {
	/** Original source file path (goes into sources[]) */
	sourcePath: string;
	/** Original source text (goes into sourcesContent[]) */
	sourceContent: string;
	/** Output file name (goes into source map "file" field) */
	file?: string;
	/** JSON indentation (default: 2) */
	indent?: number;
}
export interface SerializeResult {
	/** The serialized JSON string */
	json: string;
	/** Standard Source Map V3 */
	sourceMap: EncodedSourceMap;
}
/**
 * Range map type: (output object, property key) → source Range.
 * Populated by CompilerContext.track(), read by the serializer.
 */
export type RangeMap = WeakMap<object, Map<string, Range$1>>;
/**
 * Custom JSON serializer that writes JSON output while simultaneously
 * building a standard Source Map V3.
 *
 * Ranges come from the range map (populated by ctx.track()).
 * Each mapped property becomes a V3 mapping entry with the JSON path as name.
 */
declare function serializeWithSourceMap(output: unknown, ranges: RangeMap, options: SerializeOptions): SerializeResult;
/**
 * Result of `compileSource()`.
 */
export interface AgentforceCompileResult {
	/** The compiled AgentJSON output (plain values) */
	output: AgentDSLAuthoring;
	/** Source range data for serializer */
	ranges: CompileResult["ranges"];
	/** Combined parse + compile diagnostics */
	diagnostics: Diagnostic[];
	/** The parsed Document (for mutation, emit, etc.) */
	document: Document$1;
}
/**
 * Parse, lint, and compile an AgentScript source string to AgentJSON.
 *
 * @param source - The AgentScript source text.
 * @returns The compiled output, diagnostics, and parsed document.
 */
export declare function compileSource(source: string): AgentforceCompileResult;

export {
	AgentforceSchema as AgentforceSchemaType,
	Document$1 as Document,
	HighlightCapture as QueryCapture,
	HighlightCapture$1 as HighlightCapture,
	serializeWithSourceMap as serialize,
};

export {};
