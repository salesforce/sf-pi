var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AFActionsBlock: () => AFActionsBlock,
  AGENTSCRIPT_PRIMITIVE_TYPES: () => AGENTSCRIPT_PRIMITIVE_TYPES,
  ActionBlock: () => ActionBlock,
  ActionsBlock: () => ActionsBlock,
  AgentforceKindToSchemaKey: () => AgentforceKindToSchemaKey,
  AgentforceSchema: () => AgentforceSchema,
  AgentforceSchemaAliases: () => AgentforceSchemaAliases,
  AgentforceSchemaInfo: () => AgentforceSchemaInfo,
  AstNodeBase: () => AstNodeBase,
  AtIdentifier: () => AtIdentifier,
  AvailableWhen: () => AvailableWhen,
  BUILTIN_FUNCTIONS: () => BUILTIN_FUNCTIONS,
  BinaryExpression: () => BinaryExpression,
  Block: () => Block,
  BooleanLiteral: () => BooleanLiteral,
  BooleanValue: () => BooleanValue,
  CAPTURE_MAP: () => CAPTURE_MAP,
  CallExpression: () => CallExpression,
  CollectionBlock: () => CollectionBlock,
  ComparisonExpression: () => ComparisonExpression,
  ConnectionBlock: () => ConnectionBlock,
  ConnectionsBlock: () => ConnectionsBlock,
  ContextBlock: () => ContextBlock,
  DependencyResolutionError: () => DependencyResolutionError,
  DiagnosticSeverity: () => DiagnosticSeverity,
  DiagnosticTag: () => DiagnosticTag,
  Dialect: () => Dialect,
  DictLiteral: () => DictLiteral,
  Document: () => Document,
  Ellipsis: () => Ellipsis,
  ErrorBlock: () => ErrorBlock,
  ErrorValue: () => ErrorValue,
  ExpressionSequence: () => ExpressionSequence,
  ExpressionValue: () => ExpressionValue,
  FieldBuilder: () => FieldBuilder,
  FieldChild: () => FieldChild,
  Identifier: () => Identifier,
  IfStatement: () => IfStatement,
  InboundKeywordsBlock: () => InboundKeywordsBlock,
  InputPropertiesBlock: () => InputPropertiesBlock,
  InputsBlock: () => InputsBlock,
  KnowledgeBlock: () => KnowledgeBlock,
  LINT_SOURCE: () => LINT_SOURCE,
  LintEngine: () => LintEngine,
  ListLiteral: () => ListLiteral,
  MapEntryChild: () => MapEntryChild,
  MemberExpression: () => MemberExpression,
  NamedBlock: () => NamedBlock,
  NamedCollectionBlock: () => NamedCollectionBlock,
  NamedMap: () => NamedMap,
  NoneLiteral: () => NoneLiteral,
  NumberLiteral: () => NumberLiteral,
  NumberValue: () => NumberValue,
  OutputPropertiesBlock: () => OutputPropertiesBlock,
  OutputsBlock: () => OutputsBlock,
  ParameterDeclarationNode: () => ParameterDeclarationNode,
  PassStore: () => PassStore,
  ProcedureValue: () => ProcedureValue,
  PronunciationDictEntryBlock: () => PronunciationDictEntryBlock,
  ReasoningActionBlock: () => ReasoningActionBlock,
  ReasoningActionsBlock: () => ReasoningActionsBlock,
  ReferenceValue: () => ReferenceValue,
  RunStatement: () => RunStatement,
  SUGGESTION_THRESHOLD: () => SUGGESTION_THRESHOLD,
  SecurityBlock: () => SecurityBlock,
  Sequence: () => Sequence,
  SequenceItemChild: () => SequenceItemChild,
  SequenceNode: () => SequenceNode,
  SetClause: () => SetClause,
  SpreadExpression: () => SpreadExpression,
  StatementChild: () => StatementChild,
  StringLiteral: () => StringLiteral,
  StringValue: () => StringValue,
  SubscriptExpression: () => SubscriptExpression,
  SymbolKind: () => SymbolKind,
  TEMPLATE_PART_KINDS: () => TEMPLATE_PART_KINDS,
  TOKEN_MODIFIERS: () => TOKEN_MODIFIERS,
  TOKEN_TYPES: () => TOKEN_TYPES,
  Template: () => Template,
  TemplateExpression: () => TemplateExpression,
  TemplateInterpolation: () => TemplateInterpolation,
  TemplateText: () => TemplateText,
  TernaryExpression: () => TernaryExpression,
  ToClause: () => ToClause,
  TransitionStatement: () => TransitionStatement,
  TypedDeclarationBase: () => TypedDeclarationBase,
  TypedMap: () => TypedMap,
  UnaryExpression: () => UnaryExpression,
  UnknownStatement: () => UnknownStatement,
  UntypedBlock: () => UntypedBlock,
  VARIABLE_MODIFIERS: () => VARIABLE_MODIFIERS,
  ValueChild: () => ValueChild,
  VariableDeclarationNode: () => VariableDeclarationNode,
  VariablePropertiesBlock: () => VariablePropertiesBlock,
  VariablesBlock: () => VariablesBlock,
  WithClause: () => WithClause,
  addBuilderMethods: () => addBuilderMethods,
  agentforceDialect: () => agentforceDialect,
  agentforceSchemaContext: () => agentforceSchemaContext,
  attachDiagnostic: () => attachDiagnostic,
  buildKindToSchemaKey: () => buildKindToSchemaKey,
  collectDiagnostics: () => collectDiagnostics,
  collectionLabel: () => collectionLabel,
  compile: () => compile,
  compileSource: () => compileSource,
  constraintValidationKey: () => constraintValidationKey,
  constraintValidationPass: () => constraintValidationPass,
  createDiagnostic: () => createDiagnostic,
  createLanguageService: () => createLanguageService,
  createNode: () => createNode,
  createSchemaContext: () => createSchemaContext,
  decomposeAtMemberExpression: () => decomposeAtMemberExpression,
  decomposeMemberExpression: () => decomposeMemberExpression,
  decreaseIndentPattern: () => decreaseIndentPattern,
  dedupeOverlappingTokens: () => dedupeOverlappingTokens,
  defaultRules: () => defaultRules2,
  defineFieldAccessors: () => defineFieldAccessors,
  defineRule: () => defineRule,
  dispatchAstChildren: () => dispatchAstChildren,
  duplicateKeyPass: () => duplicateKeyPass,
  each: () => each,
  emitChildren: () => emitChildren,
  emitComponent: () => emitComponent,
  emitDocument: () => emitDocument,
  emitIndent: () => emitIndent,
  emitKeyName: () => emitKeyName,
  emptyBlockPass: () => emptyBlockPass,
  executeQuery: () => executeQuery2,
  expressionValidationPass: () => expressionValidationPass,
  extractChildren: () => extractChildren,
  extractOutputRef: () => extractOutputRef,
  extractVariableRef: () => extractVariableRef,
  findAllReferences: () => findAllReferences,
  findDefinitionAtPosition: () => findDefinitionAtPosition,
  findEnclosingScope: () => findEnclosingScope,
  findKeywordInfo: () => findKeywordInfo,
  findReferencesAtPosition: () => findReferencesAtPosition,
  findSuggestion: () => findSuggestion,
  forEachExpressionChild: () => forEachExpressionChild,
  formatConstraints: () => formatConstraints,
  formatKeywordHoverMarkdown: () => formatKeywordHoverMarkdown,
  formatSchemaHoverMarkdown: () => formatSchemaHoverMarkdown,
  formatSuggestionHint: () => formatSuggestionHint,
  generateFieldSnippet: () => generateFieldSnippet,
  generateSemanticTokens: () => generateSemanticTokens2,
  getAvailableNamespaces: () => getAvailableNamespaces,
  getCompletionCandidates: () => getCompletionCandidates,
  getComponentKindConfig: () => getComponentKindConfig,
  getComponentKindOptions: () => getComponentKindOptions,
  getDocumentSymbols: () => getDocumentSymbols,
  getFieldCompletions: () => getFieldCompletions,
  getGlobalScopes: () => getGlobalScopes,
  getKeyText: () => getKeyText,
  getParser: () => getParser2,
  getSchemaNamespaces: () => getSchemaNamespaces,
  getSymbolMembers: () => getSymbolMembers,
  getValueCompletions: () => getValueCompletions,
  increaseIndentPattern: () => increaseIndentPattern,
  init: () => init,
  inlineComments: () => inlineComments,
  isAtIdentifier: () => isAtIdentifier2,
  isBlockChild: () => isBlockChild,
  isCollectionFieldType: () => isCollectionFieldType,
  isEmittable: () => isEmittable,
  isIdentifier: () => isIdentifier,
  isIfStatement: () => isIfStatement,
  isKeyNode: () => isKeyNode,
  isMemberExpression: () => isMemberExpression2,
  isNamedBlockValue: () => isNamedBlockValue,
  isNamedCollectionFieldType: () => isNamedCollectionFieldType,
  isNamedMap: () => isNamedMap,
  isSetClause: () => isSetClause,
  isSingularBlock: () => isSingularBlock,
  isStringLiteral: () => isStringLiteral,
  isSubscriptExpression: () => isSubscriptExpression,
  isTemplateInterpolation: () => isTemplateInterpolation,
  isTemplatePartKind: () => isTemplatePartKind,
  isTemplateText: () => isTemplateText,
  isToClause: () => isToClause,
  isTransitionStatement: () => isTransitionStatement,
  isWithClause: () => isWithClause,
  keywordNames: () => keywordNames,
  leadingComments: () => leadingComments,
  levenshtein: () => levenshtein,
  lintDiagnostic: () => lintDiagnostic,
  mapCaptureToToken: () => mapCaptureToToken,
  mutateComponent: () => mutateComponent,
  onEnterRules: () => onEnterRules,
  parse: () => parse3,
  parseAndLint: () => parseAndLint,
  parseCommentNode: () => parseCommentNode,
  parseComponent: () => parseComponent,
  parseComponentDebug: () => parseComponentDebug,
  parseDialectAnnotation: () => parseDialectAnnotation,
  parseResult: () => parseResult,
  parseTemplateParts: () => parseTemplateParts,
  positionIndexKey: () => positionIndexKey,
  positionIndexPass: () => positionIndexPass,
  queryDefinitionAtPosition: () => queryDefinitionAtPosition,
  queryExpressionAtPosition: () => queryExpressionAtPosition,
  queryScopeAtPosition: () => queryScopeAtPosition,
  recurseAstChildren: () => recurseAstChildren,
  requiredFieldPass: () => requiredFieldPass,
  resolveColinearAction: () => resolveColinearAction,
  resolveDialect: () => resolveDialect,
  resolveHover: () => resolveHover,
  resolveNamespaceKeys: () => resolveNamespaceKeys,
  resolveReference: () => resolveReference,
  resolveSchemaField: () => resolveSchemaField,
  schemaContextKey: () => schemaContextKey,
  serialize: () => serializeWithSourceMap,
  singularCollectionPass: () => singularCollectionPass,
  spreadContextPass: () => spreadContextPass,
  storeKey: () => storeKey,
  symbolTableAnalyzer: () => symbolTableAnalyzer,
  symbolTableKey: () => symbolTableKey,
  trailingComments: () => trailingComments,
  typeMismatchDiagnostic: () => typeMismatchDiagnostic,
  undefinedReferenceDiagnostic: () => undefinedReferenceDiagnostic,
  undefinedReferencePass: () => undefinedReferencePass,
  union: () => union,
  unreachableCodePass: () => unreachableCodePass,
  unusedVariablePass: () => unusedVariablePass,
  validateStrictSchema: () => validateStrictSchema,
  walkAstExpressions: () => walkAstExpressions,
  walkDefinitionKeys: () => walkDefinitionKeys,
  withCst: () => withCst
});

// ../parser-javascript/dist/cst-node.js
var EMPTY_CHILDREN = Object.freeze([]);
var CSTNode = class {
  constructor(type, source, startOffset, endOffset, startPosition, endPosition, isNamed = true, isError = false, isMissing = false) {
    __publicField(this, "type");
    /** Whether this is a "named" node (true) or anonymous punctuation/keyword (false). */
    __publicField(this, "isNamed");
    __publicField(this, "isError");
    __publicField(this, "isMissing");
    __publicField(this, "startOffset");
    __publicField(this, "endOffset");
    // Flat position storage — avoids object allocations per node.
    // Also exposed as startPosition/endPosition getters for compat.
    __publicField(this, "startRow");
    __publicField(this, "startCol");
    __publicField(this, "endRow");
    __publicField(this, "endCol");
    /** Lazy children array — null for leaf nodes, allocated on first appendChild. */
    __publicField(this, "_children", null);
    __publicField(this, "parent", null);
    /** Index of this node within its parent's children array. -1 if no parent. */
    __publicField(this, "_childIndex", -1);
    /** Field name → child indices. Lazy: null until first field is added. */
    __publicField(this, "_fields", null);
    /** Reverse map: child index → field name. Built lazily. */
    __publicField(this, "_childFieldNames", null);
    /** Cached named children. */
    __publicField(this, "_namedChildren", null);
    /** The original source string, shared across all nodes in a tree. */
    __publicField(this, "_source");
    this.type = type;
    this._source = source;
    this.startOffset = startOffset;
    this.endOffset = endOffset;
    this.startRow = startPosition.row;
    this.startCol = startPosition.column;
    this.endRow = endPosition.row;
    this.endCol = endPosition.column;
    this.isNamed = isNamed;
    this.isError = isError;
    this.isMissing = isMissing;
  }
  get text() {
    return this._source.slice(this.startOffset, this.endOffset);
  }
  get startPosition() {
    return { row: this.startRow, column: this.startCol };
  }
  set startPosition(pos) {
    this.startRow = pos.row;
    this.startCol = pos.column;
  }
  get endPosition() {
    return { row: this.endRow, column: this.endCol };
  }
  set endPosition(pos) {
    this.endRow = pos.row;
    this.endCol = pos.column;
  }
  get children() {
    return this._children ?? EMPTY_CHILDREN;
  }
  set children(value) {
    this._children = value;
  }
  get namedChildren() {
    if (!this._namedChildren) {
      this._namedChildren = this.children.filter((c) => c.isNamed);
    }
    return this._namedChildren;
  }
  get previousSibling() {
    if (!this.parent || this._childIndex <= 0)
      return null;
    return this.parent.children[this._childIndex - 1];
  }
  get nextSibling() {
    if (!this.parent)
      return null;
    const siblings = this.parent.children;
    return this._childIndex < siblings.length - 1 ? siblings[this._childIndex + 1] : null;
  }
  childForFieldName(name) {
    if (!this._fields)
      return null;
    const indices = this._fields.get(name);
    if (!indices || indices.length === 0)
      return null;
    return this.children[indices[0]] ?? null;
  }
  childrenForFieldName(name) {
    if (!this._fields)
      return [];
    const indices = this._fields.get(name);
    if (!indices)
      return [];
    return indices.map((i) => this.children[i]).filter(Boolean);
  }
  /** True if this node or any descendant has an error or missing node. */
  get hasError() {
    if (this.isError || this.isMissing)
      return true;
    return this.children.some((c) => c.hasError);
  }
  /** Get the field name for a child at a given index. */
  fieldNameForChild(index) {
    if (!this._fields)
      return null;
    if (!this._childFieldNames) {
      this._childFieldNames = /* @__PURE__ */ new Map();
      for (const [fieldName, indices] of this._fields) {
        for (const idx2 of indices) {
          this._childFieldNames.set(idx2, fieldName);
        }
      }
    }
    return this._childFieldNames.get(index) ?? null;
  }
  /** Add a child node, optionally associating it with a field name. */
  appendChild(child, fieldName) {
    if (!this._children)
      this._children = [];
    const idx2 = this._children.length;
    child.parent = this;
    child._childIndex = idx2;
    this._children.push(child);
    this.endRow = child.endRow;
    this.endCol = child.endCol;
    this.endOffset = child.endOffset;
    if (fieldName) {
      if (!this._fields)
        this._fields = /* @__PURE__ */ new Map();
      let arr = this._fields.get(fieldName);
      if (!arr) {
        arr = [];
        this._fields.set(fieldName, arr);
      }
      arr.push(idx2);
    }
  }
  /** @deprecated No-op: appendChild() tracks end position incrementally. */
  finalize() {
  }
  /** Serialize to s-expression format for testing (named nodes only, no text). */
  toSExp() {
    return nodeToSExp(this);
  }
  /**
   * Serialize to verbose s-expression format that includes ALL nodes
   * (both named and anonymous) with truncated text content.
   * Matches the source-of-truth format in sot/source.s-expression.
   */
  toVerboseSExp() {
    return nodeToVerboseSExp(this, 0);
  }
};
function nodeToSExp(node) {
  const parts = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child.isNamed && !child.isError && !child.isMissing)
      continue;
    const fieldName = node.fieldNameForChild(i);
    const childStr = child.children.length > 0 || child.isError ? nodeToSExp(child) : child.isMissing ? `(MISSING ${child.type})` : `(${child.type})`;
    if (fieldName) {
      parts.push(`${fieldName}: ${childStr}`);
    } else {
      parts.push(childStr);
    }
  }
  if (node.isError) {
    if (parts.length === 0) {
      return `(ERROR)`;
    }
    return `(ERROR ${parts.join(" ")})`;
  }
  if (node.isMissing) {
    return `(MISSING ${node.type})`;
  }
  if (parts.length === 0) {
    return `(${node.type})`;
  }
  return `(${node.type} ${parts.join(" ")})`;
}
function nodeToVerboseSExp(node, depth) {
  const indent = "  ".repeat(depth);
  if (node.isMissing) {
    return `${indent}(MISSING ${JSON.stringify(node.type)})`;
  }
  if (node.isError && node.children.length === 0) {
    return `${indent}(ERROR)`;
  }
  if (node.children.length === 0) {
    const rawText = node.text;
    const truncated = rawText.length > 20 ? rawText.slice(0, 20) + "\u2026" : rawText;
    const escaped = JSON.stringify(truncated);
    return `${indent}(${node.type} ${escaped})`;
  }
  const childLines = [];
  for (const child of node.children) {
    childLines.push(nodeToVerboseSExp(child, depth + 1));
  }
  return `${indent}(${node.type}
${childLines.join("\n")})`;
}

// ../parser-javascript/dist/token.js
var TokenKind;
(function(TokenKind2) {
  TokenKind2["NEWLINE"] = "NEWLINE";
  TokenKind2["INDENT"] = "INDENT";
  TokenKind2["DEDENT"] = "DEDENT";
  TokenKind2["EOF"] = "EOF";
  TokenKind2["ID"] = "ID";
  TokenKind2["NUMBER"] = "NUMBER";
  TokenKind2["STRING"] = "STRING";
  TokenKind2["STRING_CONTENT"] = "STRING_CONTENT";
  TokenKind2["ESCAPE_SEQUENCE"] = "ESCAPE_SEQUENCE";
  TokenKind2["DATETIME"] = "DATETIME";
  TokenKind2["TEMPLATE_CONTENT"] = "TEMPLATE_CONTENT";
  TokenKind2["PLUS"] = "PLUS";
  TokenKind2["MINUS"] = "MINUS";
  TokenKind2["STAR"] = "STAR";
  TokenKind2["SLASH"] = "SLASH";
  TokenKind2["DOT"] = "DOT";
  TokenKind2["COMMA"] = "COMMA";
  TokenKind2["COLON"] = "COLON";
  TokenKind2["EQ"] = "EQ";
  TokenKind2["EQEQ"] = "EQEQ";
  TokenKind2["NEQ"] = "NEQ";
  TokenKind2["LT"] = "LT";
  TokenKind2["GT"] = "GT";
  TokenKind2["LTE"] = "LTE";
  TokenKind2["GTE"] = "GTE";
  TokenKind2["ARROW"] = "ARROW";
  TokenKind2["ELLIPSIS"] = "ELLIPSIS";
  TokenKind2["PERCENT"] = "PERCENT";
  TokenKind2["PIPE"] = "PIPE";
  TokenKind2["AT"] = "AT";
  TokenKind2["LPAREN"] = "LPAREN";
  TokenKind2["RPAREN"] = "RPAREN";
  TokenKind2["LBRACKET"] = "LBRACKET";
  TokenKind2["RBRACKET"] = "RBRACKET";
  TokenKind2["LBRACE"] = "LBRACE";
  TokenKind2["RBRACE"] = "RBRACE";
  TokenKind2["TEMPLATE_EXPR_START"] = "TEMPLATE_EXPR_START";
  TokenKind2["DASH_SPACE"] = "DASH_SPACE";
  TokenKind2["DQUOTE"] = "DQUOTE";
  TokenKind2["COMMENT"] = "COMMENT";
  TokenKind2["ERROR_TOKEN"] = "ERROR_TOKEN";
})(TokenKind || (TokenKind = {}));
function isTokenKind(token, kind) {
  return token.kind === kind;
}

// ../parser-javascript/dist/highlighter.js
function highlight(root) {
  const captures = [];
  walkNode(root, captures);
  return captures;
}
function capture(node, name, captures) {
  captures.push({
    name,
    text: node.text,
    startRow: node.startRow,
    startCol: node.startCol,
    endRow: node.endRow,
    endCol: node.endCol
  });
}
function walkNode(node, captures) {
  switch (node.type) {
    case "comment":
      capture(node, "comment", captures);
      return;
    // Don't recurse into comments
    case "number":
      capture(node, "number", captures);
      return;
    case "string":
      capture(node, "string", captures);
      for (const child of node.children) {
        if (child.type === "escape_sequence") {
          capture(child, "string.escape", captures);
        }
      }
      return;
    case "string_content":
      capture(node, "string", captures);
      return;
    case "escape_sequence":
      capture(node, "string.escape", captures);
      return;
    case "template_content":
      capture(node, "string", captures);
      return;
    case "ellipsis":
      capture(node, "constant.builtin", captures);
      return;
    case "id":
      captureId(node, captures);
      return;
    case "at_id":
      captureAtId(node, captures);
      return;
    case "template_expression":
      captureTemplateExpression(node, captures);
      return;
    case "variable_declaration":
      captureVariableDeclaration(node, captures);
      return;
  }
  if (!node.isNamed && node.children.length === 0) {
    captureAnonymous(node, captures);
    return;
  }
  for (const child of node.children) {
    walkNode(child, captures);
  }
}
function isRootLevelKey(keyNode) {
  const mappingElement = keyNode.parent;
  if (mappingElement?.type !== "mapping_element")
    return false;
  const mapping = mappingElement.parent;
  if (mapping?.type !== "mapping")
    return false;
  return mapping.parent?.type === "source_file";
}
function captureId(node, captures) {
  const parent = node.parent;
  if (node.text === "True" || node.text === "False" || node.text === "None") {
    capture(node, "constant.builtin", captures);
    return;
  }
  if (parent?.type === "at_id") {
    capture(node, "module", captures);
    return;
  }
  if (parent?.type === "key") {
    if (isRootLevelKey(parent)) {
      const namedSiblings = parent.namedChildren;
      if (namedSiblings.length > 0 && namedSiblings[0] === node) {
        capture(node, "keyword.block", captures);
      } else {
        capture(node, "keyword.block.name", captures);
      }
    } else {
      capture(node, "key", captures);
    }
    return;
  }
  if (parent?.type === "member_expression") {
    const parentChildren = parent.namedChildren;
    if (parentChildren.length > 0 && parentChildren[parentChildren.length - 1] === node) {
      capture(node, "variable", captures);
      return;
    }
  }
  if (parent?.type === "with_statement") {
    const fieldName = parent.fieldNameForChild(node._childIndex);
    if (fieldName === "param") {
      capture(node, "variable", captures);
      return;
    }
  }
  capture(node, "variable", captures);
}
function captureAtId(node, captures) {
  for (const child of node.children) {
    if (child.type === "@" || child.text === "@") {
      capture(child, "decorator", captures);
    } else if (child.type === "id") {
      capture(child, "module", captures);
    }
  }
}
function captureTemplateExpression(node, captures) {
  for (const child of node.children) {
    if (child.text === "{!") {
      capture(child, "punctuation.template", captures);
    } else if (child.text === "}") {
      capture(child, "punctuation.template", captures);
    } else {
      walkNode(child, captures);
    }
  }
}
function captureVariableDeclaration(node, captures) {
  for (const child of node.children) {
    if (!child.isNamed && (child.text === "mutable" || child.text === "linked")) {
      capture(child, "keyword.modifier", captures);
    } else {
      walkNode(child, captures);
    }
  }
}
function captureAnonymous(node, captures) {
  const text = node.text;
  switch (text) {
    case "if":
    case "elif":
    case "else":
    case "run":
    case "with":
    case "set":
    case "transition":
    case "available":
    case "when":
    case "and":
    case "or":
    case "not":
    case "is":
    case "to":
      capture(node, "keyword", captures);
      return;
    case "mutable":
    case "linked":
      capture(node, "keyword.modifier", captures);
      return;
    case "True":
    case "False":
    case "None":
      capture(node, "constant.builtin", captures);
      return;
  }
  switch (text) {
    case "==":
    case "!=":
    case "<":
    case ">":
    case "<=":
    case ">=":
    case "+":
    case "*":
    case "/":
    case "=":
      capture(node, "operator", captures);
      return;
    case "-":
      if (node.parent?.type === "sequence_element") {
        capture(node, "punctuation.special", captures);
      } else {
        capture(node, "operator", captures);
      }
      return;
  }
  switch (text) {
    case ":":
    case ".":
    case ",":
      capture(node, "punctuation.delimiter", captures);
      return;
    case "[":
    case "]":
    case "{":
    case "}":
      capture(node, "punctuation.bracket", captures);
      return;
    case "|":
    case "->":
    case "- ":
      capture(node, "punctuation.special", captures);
      return;
    case "@":
      capture(node, "decorator", captures);
      return;
    case '"':
      capture(node, "string", captures);
      return;
  }
}

// ../../node_modules/.pnpm/tiny-invariant@1.3.3/node_modules/tiny-invariant/dist/esm/tiny-invariant.js
var isProduction = true;
var prefix = "Invariant failed";
function invariant(condition, message) {
  if (condition) {
    return;
  }
  if (isProduction) {
    throw new Error(prefix);
  }
  var provided = typeof message === "function" ? message() : message;
  var value = provided ? "".concat(prefix, ": ").concat(provided) : prefix;
  throw new Error(value);
}

// ../parser-javascript/dist/lexer.js
var CH_TAB = 9;
var CH_LF = 10;
var CH_CR = 13;
var CH_SPACE = 32;
var CH_BANG = 33;
var CH_DQUOTE = 34;
var CH_HASH = 35;
var CH_DASH = 45;
var CH_DOT = 46;
var CH_0 = 48;
var CH_9 = 57;
var CH_LT = 60;
var CH_EQ = 61;
var CH_GT = 62;
var CH_A = 65;
var CH_Z = 90;
var CH_BACKSLASH = 92;
var CH_UNDERSCORE = 95;
var CH_a = 97;
var CH_z = 122;
var CH_LBRACE = 123;
var CH_NUL = 0;
function isIdStart(c) {
  return c >= CH_A && c <= CH_Z || c >= CH_a && c <= CH_z || c === CH_UNDERSCORE;
}
function isIdCont(c) {
  return isIdStart(c) || c >= CH_0 && c <= CH_9;
}
function isDigit(c) {
  return c >= CH_0 && c <= CH_9;
}
function isHorizontalWs(c) {
  return c === CH_SPACE || c === CH_TAB;
}
var SINGLE_CHAR_TOKENS = new Array(128).fill(0);
SINGLE_CHAR_TOKENS[43] = TokenKind.PLUS;
SINGLE_CHAR_TOKENS[CH_DASH] = TokenKind.MINUS;
SINGLE_CHAR_TOKENS[42] = TokenKind.STAR;
SINGLE_CHAR_TOKENS[47] = TokenKind.SLASH;
SINGLE_CHAR_TOKENS[CH_DOT] = TokenKind.DOT;
SINGLE_CHAR_TOKENS[44] = TokenKind.COMMA;
SINGLE_CHAR_TOKENS[58] = TokenKind.COLON;
SINGLE_CHAR_TOKENS[61] = TokenKind.EQ;
SINGLE_CHAR_TOKENS[60] = TokenKind.LT;
SINGLE_CHAR_TOKENS[CH_GT] = TokenKind.GT;
SINGLE_CHAR_TOKENS[124] = TokenKind.PIPE;
SINGLE_CHAR_TOKENS[64] = TokenKind.AT;
SINGLE_CHAR_TOKENS[40] = TokenKind.LPAREN;
SINGLE_CHAR_TOKENS[41] = TokenKind.RPAREN;
SINGLE_CHAR_TOKENS[91] = TokenKind.LBRACKET;
SINGLE_CHAR_TOKENS[93] = TokenKind.RBRACKET;
SINGLE_CHAR_TOKENS[CH_LBRACE] = TokenKind.LBRACE;
SINGLE_CHAR_TOKENS[125] = TokenKind.RBRACE;
var Lexer = class {
  constructor(source) {
    __publicField(this, "source");
    __publicField(this, "offset", 0);
    __publicField(this, "row", 0);
    __publicField(this, "col", 0);
    __publicField(this, "tokens", []);
    __publicField(this, "indentStack", [0]);
    /** True when the current line started with `|` (template line). */
    __publicField(this, "onTemplateLine", false);
    /** Indent level of the line containing `|`. Content deeper than this is template content. */
    __publicField(this, "templateBaseIndent", -1);
    /** Nested brace depth inside a template expression (for `{` inside `{!...}`). -1 means not inside a template expression. */
    __publicField(this, "templateExprBraceDepth", -1);
    /** Parenthesis depth — suppresses INDENT/DEDENT/NEWLINE when > 0 to support multi-line call expressions. */
    __publicField(this, "bracketDepth", 0);
    this.source = source;
  }
  get inTemplateExpr() {
    return this.templateExprBraceDepth >= 0;
  }
  tokenize() {
    this.tokens = [];
    const estimate = this.source.length / 8 | 0;
    if (estimate > 64) {
      this.tokens.length = estimate;
      this.tokens.length = 0;
    }
    this.offset = 0;
    this.row = 0;
    this.col = 0;
    this.indentStack = [0];
    this.bracketDepth = 0;
    while (this.hasMore) {
      this.tokenizeLine();
    }
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.emitVirtual(TokenKind.DEDENT);
    }
    this.emitVirtual(TokenKind.EOF);
    return this.tokens;
  }
  tokenizeLine() {
    const indentLength = this.consumeIndentation();
    if (this.consumeNewline()) {
      return;
    }
    const c = this.peekCharCode();
    if (c === CH_HASH && (!this.onTemplateLine || indentLength <= this.templateBaseIndent)) {
      const currentIndent2 = this.indentStack[this.indentStack.length - 1];
      if (indentLength > currentIndent2) {
        const nextContentIndent = this.peekNextContentIndent();
        if (nextContentIndent < indentLength) {
          this.emitIndentation(currentIndent2);
          return this.tokenizeComment();
        }
      } else if (indentLength < currentIndent2) {
        const nextContentIndent = this.peekNextContentIndent();
        if (nextContentIndent > indentLength) {
          this.emitIndentation(nextContentIndent);
          return this.tokenizeComment();
        }
      } else {
        const nextContentIndent = this.peekNextContentIndent();
        if (nextContentIndent > indentLength) {
          return this.tokenizeComment();
        }
      }
      this.emitIndentation(indentLength);
      return this.tokenizeComment();
    }
    const currentIndent = this.indentStack[this.indentStack.length - 1];
    if (this.onTemplateLine && indentLength > this.templateBaseIndent && currentIndent > this.templateBaseIndent && indentLength !== currentIndent) {
      this.emitIndentation(currentIndent);
    } else {
      this.emitIndentation(indentLength);
    }
    if (this.bracketDepth === 0 && c === CH_DASH) {
      const nc = this.peekCharCode(1);
      const atEOF = this.offset + 1 >= this.source.length;
      if (nc === CH_SPACE || this.atNewline(1) || atEOF) {
        this.emit(TokenKind.DASH_SPACE, nc === CH_SPACE ? "- " : "-");
      }
    }
    while (this.hasMore) {
      const c2 = this.peekCharCode();
      if (this.consumeNewline()) {
        return;
      }
      if (c2 === CH_CR) {
        invariant(!this.atNewline());
        this.advance();
        continue;
      }
      if (isHorizontalWs(c2)) {
        this.advance();
        continue;
      }
      if (c2 === CH_BACKSLASH) {
        if (this.atNewline(1)) {
          this.advance();
          invariant(this.consumeNewline());
          while (isHorizontalWs(this.peekCharCode())) {
            this.advance();
          }
          continue;
        }
      }
      if (c2 === CH_HASH && !this.onTemplateLine) {
        return this.tokenizeComment();
      }
      this.tokenizeToken();
    }
  }
  emitIndentation(indentLength) {
    if (this.bracketDepth > 0)
      return;
    const currentIndent = this.indentStack[this.indentStack.length - 1];
    if (indentLength > currentIndent) {
      this.indentStack.push(indentLength);
      this.emitVirtual(TokenKind.INDENT);
    } else if (indentLength < currentIndent) {
      if (indentLength <= this.templateBaseIndent) {
        this.onTemplateLine = false;
        this.templateExprBraceDepth = -1;
      }
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > indentLength) {
        this.indentStack.pop();
        this.emitVirtual(TokenKind.DEDENT);
      }
      this.emitVirtual(TokenKind.NEWLINE);
    } else {
      if (indentLength <= this.templateBaseIndent) {
        this.onTemplateLine = false;
        this.templateExprBraceDepth = -1;
      }
      if (this.tokens.length > 0) {
        this.emitVirtual(TokenKind.NEWLINE);
      }
    }
  }
  tokenizeToken() {
    const c = this.peekCharCode();
    if (isDigit(c)) {
      if (this.tryDatetime()) {
        return;
      }
      this.tokenizeNumber();
      return;
    }
    if (isIdStart(c)) {
      this.tokenizeId();
      return;
    }
    if (!this.onTemplateLine || this.inTemplateExpr) {
      if (c === CH_DQUOTE) {
        this.tokenizeString();
        return;
      }
    }
    if (c === CH_LBRACE && this.peekCharCode(1) === CH_BANG) {
      this.templateExprBraceDepth = 0;
      this.emit(TokenKind.TEMPLATE_EXPR_START, "{!");
      return;
    }
    if (c === CH_DOT) {
      if (this.peekCharCode(1) === CH_DOT && this.peekCharCode(2) === CH_DOT) {
        this.emit(TokenKind.ELLIPSIS, "...");
        return;
      }
      if (isDigit(this.peekCharCode(1))) {
        const prev = this.tokens[this.tokens.length - 1];
        const isMemberAccess = prev !== void 0 && (prev.kind === TokenKind.ID || prev.kind === TokenKind.NUMBER || prev.kind === TokenKind.RPAREN || prev.kind === TokenKind.RBRACKET);
        if (!isMemberAccess) {
          this.tokenizeNumber();
          return;
        }
      }
    }
    if (c === CH_DASH) {
      if (this.peekCharCode(1) === CH_GT) {
        return this.emit(TokenKind.ARROW, "->");
      }
    }
    const nc = this.peekCharCode(1);
    if (nc === CH_EQ) {
      if (c === CH_EQ) {
        return this.emit(TokenKind.EQEQ, "==");
      }
      if (c === CH_BANG) {
        return this.emit(TokenKind.NEQ, "!=");
      }
      if (c === CH_LT) {
        return this.emit(TokenKind.LTE, "<=");
      }
      if (c === CH_GT) {
        return this.emit(TokenKind.GTE, ">=");
      }
    }
    const kind = c < 128 ? SINGLE_CHAR_TOKENS[c] : 0;
    if (kind) {
      this.emitSpan(kind, 1);
      switch (kind) {
        // Track template lines: `|` starts a template context for this line
        // and continuation lines indented deeper than this level.
        case TokenKind.PIPE:
          this.onTemplateLine = true;
          this.templateBaseIndent = this.indentStack[this.indentStack.length - 1];
          break;
        // Track parenthesis depth to suppress structural tokens inside
        // multi-line call expressions.  Skip when inside a template line —
        // parens in template content are literal text and must not suppress
        // INDENT/DEDENT emission (unmatched parens would eat the rest of
        // the file).
        case TokenKind.LPAREN:
          if (!this.onTemplateLine)
            this.bracketDepth++;
          break;
        case TokenKind.RPAREN:
          if (!this.onTemplateLine)
            this.bracketDepth--;
          break;
        // Track brace depth inside {!...} template expressions so that nested
        // braces (e.g. JSON objects) don't prematurely close the expression.
        case TokenKind.LBRACE:
          if (this.inTemplateExpr) {
            this.templateExprBraceDepth++;
          }
          break;
        case TokenKind.RBRACE:
          if (this.inTemplateExpr) {
            this.templateExprBraceDepth--;
          }
          break;
      }
      return;
    }
    this.emitSpan(TokenKind.ERROR_TOKEN, 1);
  }
  tokenizeId() {
    let i = 0;
    for (; ; i++) {
      const c = this.peekCharCode(i);
      if (!isIdCont(c))
        break;
    }
    this.emitSpan(TokenKind.ID, i);
  }
  tokenizeNumber() {
    let tokenLength = 0;
    const leadingDot = this.peekCharCode(tokenLength) === CH_DOT;
    if (leadingDot) {
      tokenLength++;
    }
    while (isDigit(this.peekCharCode(tokenLength))) {
      tokenLength++;
    }
    if (!leadingDot && this.peekCharCode(tokenLength) === CH_DOT) {
      tokenLength++;
    }
    while (isDigit(this.peekCharCode(tokenLength))) {
      tokenLength++;
    }
    this.emitSpan(TokenKind.NUMBER, tokenLength);
  }
  tryDatetime() {
    const remaining = this.source.length - this.offset;
    if (remaining < 10)
      return false;
    if (this.source.charCodeAt(this.offset + 4) !== CH_DASH || this.source.charCodeAt(this.offset + 7) !== CH_DASH) {
      return false;
    }
    const slice = this.source.slice(this.offset, this.offset + 30);
    const match = slice.match(/^\d{4}-\d{2}-\d{2}(T\d{1,2}(:\d{2})?(:\d{2})?(\.\d+)?Z?)?/);
    if (!match)
      return false;
    const matchText = match[0];
    if (matchText.length < 10)
      return false;
    this.emit(TokenKind.DATETIME, matchText);
    return true;
  }
  tokenizeString() {
    const start = this.position;
    const startOffset = this.offset;
    const quoteCode = this.peekCharCode();
    this.advance();
    while (this.hasMore) {
      const c = this.peekCharCode();
      if (c === quoteCode) {
        this.advance();
        const text2 = this.source.slice(startOffset, this.offset);
        this.tokens.push(this.makeToken(TokenKind.STRING, text2, start, this.position, startOffset));
        return;
      }
      if (c === CH_BACKSLASH) {
        this.advance(2);
        continue;
      }
      if (this.atNewline()) {
        break;
      }
      if (c === CH_CR) {
        invariant(!this.atNewline());
        this.advance();
        continue;
      }
      if (c === CH_NUL) {
        break;
      }
      this.advance();
    }
    const text = this.source.slice(startOffset, this.offset);
    this.tokens.push(this.makeToken(TokenKind.STRING, text, start, this.position, startOffset));
  }
  tokenizeComment() {
    const start = this.position;
    const startOffset = this.offset;
    while (this.hasMore && !this.atNewline()) {
      this.advance();
    }
    const text = this.source.slice(startOffset, this.offset);
    this.tokens.push(this.makeToken(TokenKind.COMMENT, text, start, this.position, startOffset));
    this.consumeNewline();
  }
  consumeIndentation() {
    let indentLength = 0;
    while (this.hasMore) {
      const c = this.peekCharCode();
      if (c === CH_SPACE) {
        indentLength += 1;
        this.advance();
      } else if (c === CH_TAB) {
        indentLength += 3;
        this.advance();
      } else if (c === CH_CR) {
        indentLength = 0;
        this.advance();
      } else {
        break;
      }
    }
    return indentLength;
  }
  /**
   * Scan ahead (without advancing) past comment/blank lines to find the indent
   * of the next line with real (non-comment) content. Returns -1 if only
   * comments, blanks, or EOF remain. Matches tree-sitter scanner behavior which
   * skips past comment-only lines when computing INDENT/DEDENT.
   */
  peekNextContentIndent() {
    const startPosition = this.position;
    const startOffset = this.offset;
    while (this.hasMore) {
      if (this.consumeNewline())
        break;
      this.advance();
    }
    while (this.hasMore) {
      const lineIndent = this.consumeIndentation();
      if (this.consumeNewline())
        continue;
      const c = this.peekCharCode();
      if (c === CH_HASH) {
        while (this.hasMore) {
          if (this.consumeNewline())
            break;
          this.advance();
        }
        continue;
      }
      this.offset = startOffset;
      this.row = startPosition.row;
      this.col = startPosition.column;
      return lineIndent;
    }
    this.offset = startOffset;
    this.row = startPosition.row;
    this.col = startPosition.column;
    return -1;
  }
  // --- Utility methods ---
  peekCharCode(additiveOffset = 0) {
    return this.source.charCodeAt(this.offset + additiveOffset);
  }
  get hasMore() {
    return this.offset < this.source.length && this.offset >= 0;
  }
  /**
   * Attempt to advance n characters.
   * @returns how many characters were advanced.
   */
  advance(n = 1) {
    n = Math.max(0, Math.min(n, this.source.length - this.offset));
    this.col += n;
    for (let i = 0; i < n; i++) {
      if (this.peekCharCode(i) === CH_LF) {
        this.row++;
        this.col = n - i - 1;
      }
    }
    this.offset += n;
    return n;
  }
  /**
   * Attempt to consume a newline.
   * @returns whether a newline was consumed.
   */
  consumeNewline() {
    const newChars = this.atNewline();
    if (newChars > 0) {
      invariant(this.advance(newChars));
      return true;
    }
    return false;
  }
  /**
   * Checks if the current position is at a newline.
   * @param additiveOffset
   * @returns 0 if not at a newline, 1 if at an LF newline, 2 if at a CR LF newline.
   */
  atNewline(additiveOffset = 0) {
    const firstChar = this.peekCharCode(additiveOffset);
    if (firstChar === CH_LF)
      return 1;
    if (firstChar === CH_CR && this.peekCharCode(additiveOffset + 1) === CH_LF)
      return 2;
    return 0;
  }
  get position() {
    return { row: this.row, column: this.col };
  }
  emitSpan(kind, length) {
    const text = this.source.slice(this.offset, this.offset + length);
    return this.emit(kind, text);
  }
  emit(kind, text) {
    const startPosition = this.position;
    const startOffset = this.offset;
    invariant(text === this.source.slice(startOffset, startOffset + text.length), `expected '${text}' but got ${this.source.slice(startOffset, startOffset + text.length)} at offset ${startOffset}`);
    this.advance(text.length);
    this.tokens.push(this.makeToken(kind, text, startPosition, this.position, startOffset));
  }
  emitVirtual(kind) {
    return this.emit(kind, "");
  }
  makeToken(kind, text, start, end, startOffset) {
    return { kind, text, start, end, startOffset };
  }
};

// ../parser-javascript/dist/errors.js
function makeErrorNode(source, children, startOffset, endOffset, startPosition, endPosition) {
  const node = new CSTNode("ERROR", source, startOffset, endOffset, startPosition, endPosition, true, true);
  for (const child of children) {
    node.appendChild(child);
  }
  return node;
}
function tokenToLeaf(token, source, isNamed, offset) {
  return new CSTNode(tokenTypeToNodeType(token), source, offset, offset + token.text.length, token.start, token.end, isNamed);
}
var NAMED_TOKEN_KINDS = /* @__PURE__ */ new Set([
  TokenKind.ID,
  TokenKind.NUMBER,
  TokenKind.STRING,
  TokenKind.DATETIME,
  TokenKind.COMMENT,
  TokenKind.ELLIPSIS
]);
function tokenToAutoLeaf(token, source, offset) {
  return tokenToLeaf(token, source, NAMED_TOKEN_KINDS.has(token.kind), offset);
}
function tokenTypeToNodeType(token) {
  switch (token.kind) {
    case TokenKind.ID:
      return "id";
    case TokenKind.NUMBER:
      return "number";
    case TokenKind.STRING:
      return "string";
    case TokenKind.DATETIME:
      return "datetime_literal";
    case TokenKind.COMMENT:
      return "comment";
    case TokenKind.ELLIPSIS:
      return "ellipsis";
    default:
      return token.text;
  }
}
function isSyncPoint(kind) {
  return kind === TokenKind.NEWLINE || kind === TokenKind.DEDENT || kind === TokenKind.EOF;
}

// ../parser-javascript/dist/recovery.js
function makeEmptyError(ctx) {
  const offset = ctx.peekOffset();
  const pos = ctx.peek().start;
  return new CSTNode("ERROR", ctx.source, offset, offset, pos, pos, true, true);
}
function addMissingTarget(ctx, node) {
  const errAtom = makeEmptyError(ctx);
  const atom = new CSTNode("atom", ctx.source, errAtom.startOffset, errAtom.endOffset, errAtom.startPosition, errAtom.endPosition);
  atom.appendChild(errAtom);
  const expr = new CSTNode("expression", ctx.source, atom.startOffset, atom.endOffset, atom.startPosition, atom.endPosition);
  expr.appendChild(atom);
  node.appendChild(expr, "target");
}
function makeMissing(ctx, type) {
  const offset = ctx.peekOffset();
  const pos = ctx.peek().start;
  return new CSTNode(type, ctx.source, offset, offset, pos, pos, true, false, true);
}
function parseOrphanBlock(ctx, parseProcedure2) {
  const startOffset = ctx.peekOffset();
  const startPos = ctx.peek().start;
  const children = [];
  const keywordTok = ctx.consume();
  const kwOffset = ctx.currentOffset();
  children.push(new CSTNode(keywordTok.text, ctx.source, kwOffset, kwOffset + keywordTok.text.length, keywordTok.start, keywordTok.end, false));
  while (!ctx.isAtSyncPoint() && !isAtEnd(ctx) && ctx.peekKind() !== TokenKind.COLON) {
    ctx.consume();
  }
  if (ctx.peekKind() === TokenKind.COLON)
    ctx.consume();
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    const proc = parseProcedure2(ctx);
    if (proc) {
      for (const child of proc.namedChildren) {
        children.push(child);
      }
    }
    while (ctx.peekKind() === TokenKind.COMMENT || ctx.peekKind() === TokenKind.NEWLINE) {
      if (ctx.peekKind() === TokenKind.COMMENT) {
        children.push(ctx.consumeNamed("comment"));
      } else {
        ctx.consume();
      }
    }
    if (ctx.peekKind() === TokenKind.DEDENT)
      ctx.consume();
  }
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
  const endOffset = children.length > 0 ? children[children.length - 1].endOffset : ctx.peekOffset();
  const endPos = children.length > 0 ? children[children.length - 1].endPosition : ctx.peek().start;
  return makeErrorNode(ctx.source, children, startOffset, endOffset, startPos, endPos);
}
function recoverToBlockEnd(ctx, parent) {
  while (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
    if (ctx.peekKind() === TokenKind.NEWLINE) {
      ctx.consume();
      continue;
    }
    if (ctx.peekKind() === TokenKind.INDENT) {
      ctx.consume();
      recoverToBlockEnd(ctx, parent);
      if (ctx.peekKind() === TokenKind.DEDENT)
        ctx.consume();
      continue;
    }
    const err = synchronize(ctx);
    if (err) {
      parent.appendChild(err);
    } else {
      break;
    }
  }
}
function synchronizeUntil(ctx, extraStop) {
  if (ctx.isAtSyncPoint() || isAtEnd(ctx))
    return null;
  if (extraStop && extraStop(ctx.peekKind(), ctx.peek().start.row))
    return null;
  const startOffset = ctx.peekOffset();
  const startPos = ctx.peek().start;
  const children = [];
  while (!ctx.isAtSyncPoint() && !isAtEnd(ctx) && !(extraStop && extraStop(ctx.peekKind(), ctx.peek().start.row))) {
    const tok = ctx.consume();
    children.push(tokenToAutoLeaf(tok, ctx.source, ctx.currentOffset()));
  }
  if (children.length === 0)
    return null;
  const last = children[children.length - 1];
  return makeErrorNode(ctx.source, children, startOffset, last.endOffset, startPos, last.endPosition);
}
function synchronizeRowUntilColon(ctx, row) {
  return synchronizeUntil(ctx, (kind, r) => kind === TokenKind.INDENT || kind === TokenKind.COLON || r !== row);
}
function synchronizeRow(ctx, row) {
  return synchronizeUntil(ctx, (kind, r) => kind === TokenKind.INDENT || r !== row);
}
function synchronize(ctx) {
  return synchronizeUntil(ctx);
}
function skipNewlines(ctx) {
  while (ctx.peekKind() === TokenKind.NEWLINE) {
    ctx.consume();
  }
}
function consumeCommentsAndSkipNewlines(ctx, parent) {
  while (true) {
    if (ctx.peekKind() === TokenKind.COMMENT) {
      parent.appendChild(ctx.consumeNamed("comment"));
    } else if (ctx.peekKind() === TokenKind.NEWLINE) {
      ctx.consume();
    } else {
      break;
    }
  }
}
function isAtEnd(ctx) {
  return ctx.peekKind() === TokenKind.EOF;
}
function isTrailingCommentOnly(ctx) {
  let i = 0;
  while (i < 50) {
    const tok = ctx.peekAt(i);
    if (tok.kind === TokenKind.EOF || tok.kind === TokenKind.DEDENT)
      return true;
    if (tok.kind === TokenKind.COMMENT || tok.kind === TokenKind.NEWLINE) {
      i++;
      continue;
    }
    return false;
  }
  return false;
}

// ../parser-javascript/dist/expressions.js
var VALID_ESCAPES = /* @__PURE__ */ new Set(['"', "'", "\\", "n", "r", "t", "0"]);
var KEY_STOP_KEYWORDS = /* @__PURE__ */ new Set([
  "if",
  "elif",
  "else",
  "run",
  "set",
  "with",
  "to",
  "transition",
  "available",
  "and",
  "or",
  "not",
  "is",
  "True",
  "False",
  "None",
  "mutable",
  "linked",
  "empty"
]);
function makeMissingArgument(ctx) {
  const offset = ctx.peekOffset();
  const pos = ctx.peek().start;
  const missingId = new CSTNode("id", ctx.source, offset, offset, pos, pos, true, false, true);
  const atom = new CSTNode("atom", ctx.source, offset, offset, pos, pos);
  atom.appendChild(missingId);
  const expr = new CSTNode("expression", ctx.source, offset, offset, pos, pos);
  expr.appendChild(atom);
  return expr;
}
function makeEmptyError2(ctx) {
  const tok = ctx.peek();
  const offset = ctx.peekOffset();
  return new CSTNode("ERROR", ctx.source, offset, offset, tok.start, tok.start, true, true);
}
function parseExpression(ctx, minPrec = 0) {
  let left = parsePrefix(ctx);
  if (!left)
    return null;
  while (true) {
    const nextKind = ctx.peekKind();
    if (nextKind === TokenKind.NEWLINE || nextKind === TokenKind.DEDENT || nextKind === TokenKind.EOF)
      break;
    const prec = infixPrecedence(ctx);
    if (prec < minPrec)
      break;
    const result = parseInfix(ctx, left, prec);
    if (!result)
      break;
    left = result;
  }
  return left;
}
function parsePrefix(ctx) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.ID && tok.text === "not") {
    return parseUnary(ctx, "not", 3);
  }
  if (tok.kind === TokenKind.PLUS || tok.kind === TokenKind.MINUS) {
    const op = tok.text;
    return parseUnary(ctx, op, 7);
  }
  if (tok.kind === TokenKind.STAR) {
    return parseSpread(ctx);
  }
  if (tok.kind === TokenKind.LPAREN) {
    return parseParenthesized(ctx);
  }
  return parseAtom(ctx);
}
function parseUnary(ctx, _op, prec) {
  const startTok = ctx.peek();
  const node = ctx.startNode("unary_expression");
  ctx.addAnonymousChild(node, ctx.consume());
  const operand = parseExpression(ctx, prec + 1);
  if (operand) {
    node.appendChild(wrapExpression(ctx, operand));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseSpread(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("spread_expression");
  ctx.addAnonymousChild(node, ctx.consume());
  const operand = parseExpression(ctx, 8);
  if (operand) {
    node.appendChild(wrapExpression(ctx, operand), "expression");
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseParenthesized(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("parenthesized_expression");
  ctx.addAnonymousChild(node, ctx.consume());
  const expr = parseExpression(ctx, 0);
  if (expr) {
    node.appendChild(wrapExpression(ctx, expr), "expression");
  } else if (ctx.peekKind() === TokenKind.RPAREN) {
    node.appendChild(makeMissingArgument(ctx), "expression");
  }
  if (ctx.peekKind() === TokenKind.RPAREN) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseAtom(ctx) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.ID && (tok.text === "True" || tok.text === "False" || tok.text === "None")) {
    const node = ctx.startNode("atom");
    ctx.addAnonymousChild(node, ctx.consume());
    ctx.finishNode(node, tok);
    return node;
  }
  if (tok.kind === TokenKind.ID && tok.text === "empty") {
    const node = ctx.startNode("empty_keyword");
    ctx.addAnonymousChild(node, ctx.consume());
    ctx.finishNode(node, tok);
    return node;
  }
  if (tok.kind === TokenKind.AT) {
    return parseAtId(ctx);
  }
  if (tok.kind === TokenKind.ID) {
    return ctx.consumeNamed("id");
  }
  if (tok.kind === TokenKind.NUMBER) {
    return ctx.consumeNamed("number");
  }
  if (tok.kind === TokenKind.DATETIME) {
    return ctx.consumeNamed("datetime_literal");
  }
  if (tok.kind === TokenKind.STRING) {
    return parseString(ctx);
  }
  if (tok.kind === TokenKind.ELLIPSIS) {
    return ctx.consumeNamed("ellipsis");
  }
  if (tok.kind === TokenKind.LBRACKET) {
    return parseList(ctx);
  }
  if (tok.kind === TokenKind.LBRACE) {
    return parseDictionary(ctx);
  }
  return null;
}
function parseAtId(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("at_id");
  ctx.addAnonymousChild(node, ctx.consume());
  if (ctx.peekKind() === TokenKind.ID) {
    node.appendChild(ctx.consumeNamed("id"));
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseString(ctx) {
  const tok = ctx.peek();
  const startTok = tok;
  const node = ctx.startNode("string");
  const text = tok.text;
  const tokenOffset = ctx.peekOffset();
  ctx.consume();
  const baseRow = startTok.start.row;
  const baseCol = startTok.start.column;
  node.appendChild(new CSTNode('"', ctx.source, tokenOffset, tokenOffset + 1, { row: baseRow, column: baseCol }, { row: baseRow, column: baseCol + 1 }, false));
  let i = 1;
  const quoteChar = text[0];
  const hasClosingQuote = text.length > 1 && text[text.length - 1] === quoteChar;
  const contentEnd = hasClosingQuote ? text.length - 1 : text.length;
  let contentStart = i;
  while (i < contentEnd) {
    if (text[i] === "\\" && i + 1 < contentEnd && VALID_ESCAPES.has(text[i + 1])) {
      if (i > contentStart) {
        node.appendChild(new CSTNode("string_content", ctx.source, tokenOffset + contentStart, tokenOffset + i, { row: baseRow, column: baseCol + contentStart }, { row: baseRow, column: baseCol + i }));
      }
      const escLen = 2;
      node.appendChild(new CSTNode("escape_sequence", ctx.source, tokenOffset + i, tokenOffset + i + escLen, { row: baseRow, column: baseCol + i }, { row: baseRow, column: baseCol + i + escLen }));
      i += escLen;
      contentStart = i;
    } else if (text[i] === "\\" && i + 1 < contentEnd && !VALID_ESCAPES.has(text[i + 1])) {
      if (i > contentStart) {
        node.appendChild(new CSTNode("string_content", ctx.source, tokenOffset + contentStart, tokenOffset + i, { row: baseRow, column: baseCol + contentStart }, { row: baseRow, column: baseCol + i }));
      }
      const escStart = i;
      i += 2;
      while (i < contentEnd && /[a-zA-Z0-9_]/.test(text[i])) {
        i++;
      }
      const errNode = new CSTNode("ERROR", ctx.source, tokenOffset + escStart, tokenOffset + i, { row: baseRow, column: baseCol + escStart }, { row: baseRow, column: baseCol + i }, true, true);
      node.appendChild(errNode);
      contentStart = i;
    } else {
      i++;
    }
  }
  if (i > contentStart) {
    node.appendChild(new CSTNode("string_content", ctx.source, tokenOffset + contentStart, tokenOffset + i, { row: baseRow, column: baseCol + contentStart }, { row: baseRow, column: baseCol + i }));
  }
  if (hasClosingQuote) {
    node.appendChild(new CSTNode(quoteChar, ctx.source, tokenOffset + text.length - 1, tokenOffset + text.length, { row: baseRow, column: baseCol + text.length - 1 }, { row: baseRow, column: baseCol + text.length }, false));
  } else {
    const missingOffset = tokenOffset + text.length;
    const missingPos = { row: baseRow, column: baseCol + text.length };
    node.appendChild(new CSTNode(quoteChar, ctx.source, missingOffset, missingOffset, missingPos, missingPos, false, false, true));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseList(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("list");
  ctx.addAnonymousChild(node, ctx.consume());
  let _listIndentDepth = 0;
  while (ctx.peekKind() !== TokenKind.RBRACKET && ctx.peekKind() !== TokenKind.EOF) {
    if (ctx.peekKind() === TokenKind.NEWLINE) {
      ctx.consume();
      continue;
    }
    if (ctx.peekKind() === TokenKind.INDENT) {
      _listIndentDepth++;
      ctx.consume();
      continue;
    }
    if (ctx.peekKind() === TokenKind.DEDENT) {
      _listIndentDepth--;
      ctx.consume();
      continue;
    }
    const expr = parseExpression(ctx, 0);
    if (expr) {
      node.appendChild(wrapExpression(ctx, expr));
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }
  while (ctx.peekKind() === TokenKind.NEWLINE || ctx.peekKind() === TokenKind.INDENT || ctx.peekKind() === TokenKind.DEDENT) {
    ctx.consume();
  }
  if (ctx.peekKind() === TokenKind.RBRACKET) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseDictionary(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("dictionary");
  ctx.addAnonymousChild(node, ctx.consume());
  while (ctx.peekKind() !== TokenKind.RBRACE && ctx.peekKind() !== TokenKind.EOF) {
    if (ctx.peekKind() === TokenKind.NEWLINE || ctx.peekKind() === TokenKind.INDENT || ctx.peekKind() === TokenKind.DEDENT) {
      ctx.consume();
      continue;
    }
    const pair = parseDictionaryPair(ctx);
    if (pair) {
      node.appendChild(pair);
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }
  if (ctx.peekKind() === TokenKind.RBRACE) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseDictionaryPair(ctx) {
  const startTok = ctx.peek();
  if (!isKeyStart(ctx))
    return null;
  const node = ctx.startNode("dictionary_pair");
  const key = parseKey(ctx);
  if (key)
    node.appendChild(key, "key");
  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  }
  const value = parseExpression(ctx, 0);
  if (value)
    node.appendChild(wrapExpression(ctx, value), "value");
  ctx.finishNode(node, startTok);
  return node;
}
var INFIX_PREC_BY_KIND = /* @__PURE__ */ new Map([
  [TokenKind.LPAREN, 8],
  [TokenKind.DOT, 8],
  [TokenKind.LBRACKET, 8],
  [TokenKind.EQEQ, 4],
  [TokenKind.NEQ, 4],
  [TokenKind.LT, 4],
  [TokenKind.GT, 4],
  [TokenKind.LTE, 4],
  [TokenKind.GTE, 4],
  [TokenKind.PLUS, 5],
  [TokenKind.MINUS, 5],
  [TokenKind.STAR, 6],
  [TokenKind.SLASH, 6]
]);
var INFIX_KEYWORD_PREC = /* @__PURE__ */ new Map([
  ["if", 0],
  ["or", 1],
  ["and", 2],
  ["is", 4]
]);
function infixPrecedence(ctx) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.ID)
    return INFIX_KEYWORD_PREC.get(tok.text) ?? -2;
  return INFIX_PREC_BY_KIND.get(tok.kind) ?? -2;
}
function parseInfix(ctx, left, prec) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.LPAREN && prec === 8) {
    return parseCall(ctx, left);
  }
  if (tok.kind === TokenKind.DOT && prec === 8) {
    return parseMember(ctx, left);
  }
  if (tok.kind === TokenKind.LBRACKET && prec === 8) {
    return parseSubscript(ctx, left);
  }
  if (tok.kind === TokenKind.ID && tok.text === "if") {
    return parseTernary(ctx, left);
  }
  if (tok.kind === TokenKind.ID && tok.text === "is") {
    return parseIsExpression(ctx, left);
  }
  return parseBinaryOrComparison(ctx, left, prec);
}
function parseCall(ctx, func) {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt("call_expression", func);
  node.appendChild(wrapExpression(ctx, func), "function");
  ctx.addAnonymousChild(node, ctx.consume());
  while (ctx.peekKind() !== TokenKind.RPAREN && !ctx.isAtSyncPoint()) {
    const arg = parseExpression(ctx, 0);
    if (arg) {
      node.appendChild(wrapExpression(ctx, arg), "argument");
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
      if (ctx.peekKind() === TokenKind.RPAREN) {
        node.appendChild(makeMissingArgument(ctx), "argument");
        break;
      }
    } else {
      break;
    }
  }
  if (ctx.peekKind() === TokenKind.RPAREN) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseMember(ctx, object2) {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt("member_expression", object2);
  node.appendChild(wrapExpression(ctx, object2));
  ctx.addAnonymousChild(node, ctx.consume());
  if (ctx.peekKind() === TokenKind.ID) {
    node.appendChild(ctx.consumeNamed("id"));
  } else if (ctx.peekKind() === TokenKind.NUMBER) {
    const numNode = ctx.consumeNamed("number");
    const errNode = new CSTNode("ERROR", ctx.source, numNode.startOffset, numNode.endOffset, numNode.startPosition, numNode.endPosition, true, true);
    errNode.appendChild(numNode);
    node.appendChild(errNode);
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseSubscript(ctx, object2) {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt("subscript_expression", object2);
  node.appendChild(wrapExpression(ctx, object2));
  ctx.addAnonymousChild(node, ctx.consume());
  const index = parseExpression(ctx, 0);
  if (index) {
    node.appendChild(wrapExpression(ctx, index));
  }
  if (ctx.peekKind() === TokenKind.RBRACKET) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseTernary(ctx, consequence) {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt("ternary_expression", consequence);
  node.appendChild(wrapExpression(ctx, consequence), "consequence");
  ctx.addAnonymousChild(node, ctx.consume());
  const condition = parseExpression(ctx, 1);
  if (condition) {
    node.appendChild(wrapExpression(ctx, condition), "condition");
  }
  if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === "else") {
    ctx.addAnonymousChild(node, ctx.consume());
    const alt = parseExpression(ctx, 0);
    if (alt) {
      node.appendChild(wrapExpression(ctx, alt), "alternative");
    }
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseIsExpression(ctx, left) {
  const startTok = ctx.peek();
  const isNot = ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === "not";
  const nodeType = "comparison_expression";
  const node = ctx.startNodeAt(nodeType, left);
  node.appendChild(wrapExpression(ctx, left));
  ctx.addAnonymousChild(node, ctx.consume());
  if (isNot) {
    ctx.addAnonymousChild(node, ctx.consume());
  }
  const right = parseExpression(ctx, 5);
  if (right) {
    node.appendChild(wrapExpression(ctx, right));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseBinaryOrComparison(ctx, left, prec) {
  const tok = ctx.peek();
  const startTok = tok;
  const isComparison = tok.kind === TokenKind.EQEQ || tok.kind === TokenKind.NEQ || tok.kind === TokenKind.LT || tok.kind === TokenKind.GT || tok.kind === TokenKind.LTE || tok.kind === TokenKind.GTE || tok.kind === TokenKind.EQ;
  const nodeType = isComparison ? "comparison_expression" : "binary_expression";
  const node = ctx.startNodeAt(nodeType, left);
  node.appendChild(wrapExpression(ctx, left));
  ctx.addAnonymousChild(node, ctx.consume());
  const right = parseExpression(ctx, prec + 1);
  if (right) {
    node.appendChild(wrapExpression(ctx, right));
  } else {
    node.appendChild(makeEmptyError2(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
var SKIP_WRAP_TYPES = /* @__PURE__ */ new Set(["expression", "ERROR"]);
var ATOM_TYPES = /* @__PURE__ */ new Set([
  "id",
  "number",
  "string",
  "datetime_literal",
  "at_id",
  "list",
  "dictionary",
  "ellipsis"
]);
function wrapExpression(ctx, inner) {
  if (SKIP_WRAP_TYPES.has(inner.type)) {
    return inner;
  }
  let wrapped = inner;
  if (ATOM_TYPES.has(inner.type)) {
    const atom = new CSTNode("atom", ctx.source, inner.startOffset, inner.endOffset, inner.startPosition, inner.endPosition);
    atom.appendChild(inner);
    wrapped = atom;
  }
  const expr = new CSTNode("expression", ctx.source, wrapped.startOffset, wrapped.endOffset, wrapped.startPosition, wrapped.endPosition);
  expr.appendChild(wrapped);
  return expr;
}
function isKeyStart(ctx) {
  const tok = ctx.peek();
  return isKeyTokenStart(tok.kind);
}
function isKeyTokenStart(kind) {
  return kind === TokenKind.ID || kind === TokenKind.STRING || kind === TokenKind.NUMBER;
}
function isKeyTokenContinuation(kind) {
  return isKeyTokenStart(kind) || kind === TokenKind.MINUS || kind === TokenKind.DOT;
}
function parseKey(ctx) {
  if (!isKeyStart(ctx))
    return null;
  const startTok = ctx.peek();
  const node = ctx.startNode("key");
  if (ctx.peekKind() === TokenKind.NUMBER) {
    const numNode = ctx.consumeNamed("number");
    const errNode = new CSTNode("ERROR", ctx.source, numNode.startOffset, numNode.endOffset, numNode.startPosition, numNode.endPosition, true, true);
    node.appendChild(errNode);
    if (ctx.peekKind() === TokenKind.ID) {
      node.appendChild(ctx.consumeNamed("id"));
    }
  } else if (ctx.peekKind() === TokenKind.STRING) {
    node.appendChild(parseString(ctx));
  } else {
    node.appendChild(ctx.consumeNamed("id"));
  }
  if (ctx.peekKind() === TokenKind.ID && !ctx.isAtSyncPoint() && ctx.peek().start.row === startTok.start.row) {
    const nextText = ctx.peek().text;
    if (!KEY_STOP_KEYWORDS.has(nextText)) {
      node.appendChild(ctx.consumeNamed("id"));
    }
  }
  ctx.finishNode(node, startTok);
  return node;
}

// ../parser-javascript/dist/parse-statements.js
function isStatementStart(ctx) {
  const tok = ctx.peek();
  if (tok.kind !== TokenKind.ID)
    return false;
  switch (tok.text) {
    case "if":
    case "run":
    case "set":
    case "transition":
      return true;
    case "with":
      return ctx.peekAt(1).kind !== TokenKind.COLON;
    case "available":
      return ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === "when";
    default:
      return false;
  }
}
function parseProcedure(ctx, parseTemplate2) {
  const startTok = ctx.peek();
  const node = ctx.startNode("procedure");
  while (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
    skipNewlines(ctx);
    if (isAtEnd(ctx) || ctx.peekKind() === TokenKind.DEDENT)
      break;
    if (ctx.peekKind() === TokenKind.COMMENT && isTrailingCommentOnly(ctx)) {
      break;
    }
    const stmt = parseStatement(ctx, parseTemplate2);
    if (stmt) {
      node.appendChild(stmt);
    } else {
      const err = synchronize(ctx);
      if (err) {
        node.appendChild(err);
      } else if (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
        ctx.consume();
      }
    }
  }
  if (node.namedChildren.length === 0) {
    node.appendChild(makeEmptyError(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseStatement(ctx, parseTemplate2) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.ID) {
    switch (tok.text) {
      case "if":
        return parseIfStatement(ctx, parseTemplate2);
      case "run":
        return parseRunStatement(ctx, parseTemplate2);
      case "set":
        return parseSetStatement(ctx);
      case "transition":
        return parseTransitionStatement(ctx);
      case "with":
        return parseWithStatement(ctx);
      case "available": {
        if (ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === "when") {
          return parseAvailableWhenStatement(ctx);
        }
        break;
      }
      case "else":
      case "elif":
      case "for":
        return parseOrphanBlock(ctx, (c) => parseProcedure(c, parseTemplate2));
    }
  }
  if (tok.kind === TokenKind.PIPE && parseTemplate2) {
    return parseTemplate2(ctx);
  }
  if (tok.kind === TokenKind.COMMENT) {
    const comment2 = ctx.consumeNamed("comment");
    if (ctx.peekKind() === TokenKind.NEWLINE)
      ctx.consume();
    return comment2;
  }
  const expr = parseExpression(ctx, 0);
  if (expr) {
    const wrapped = wrapExpression(ctx, expr);
    if (ctx.peekKind() === TokenKind.NEWLINE)
      ctx.consume();
    return wrapped;
  }
  return null;
}
function parseColonAndProcedureBody(ctx, node, row, errorOnMissingBody, parseTemplate2) {
  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else if (errorOnMissingBody) {
    node.appendChild(makeEmptyError(ctx));
  }
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed("comment"));
  }
  const inlineErr = synchronizeRow(ctx, row);
  if (inlineErr)
    node.appendChild(inlineErr);
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    const proc = parseProcedure(ctx, parseTemplate2);
    if (proc)
      node.appendChild(proc, "consequence");
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT)
      ctx.consume();
  } else if (errorOnMissingBody && (ctx.peekKind() === TokenKind.NEWLINE || ctx.isAtSyncPoint())) {
    node.appendChild(makeEmptyError(ctx));
  }
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
}
function parseIfStatement(ctx, parseTemplate2) {
  const startTok = ctx.peek();
  const node = ctx.startNode("if_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  let condition = parseExpression(ctx, 0);
  if (condition && ctx.peekKind() === TokenKind.EQ) {
    const eqTok = ctx.consume();
    const right = parseExpression(ctx, 5);
    if (right) {
      const cmp = ctx.startNodeAt("comparison_expression", condition);
      cmp.appendChild(wrapExpression(ctx, condition));
      const eqChild = new CSTNode("=", ctx.source, eqTok.startOffset, eqTok.startOffset + 1, eqTok.start, eqTok.end, false);
      const eqErr = makeErrorNode(ctx.source, [eqChild], eqTok.startOffset, eqTok.startOffset + 1, eqTok.start, eqTok.end);
      cmp.appendChild(eqErr);
      cmp.appendChild(wrapExpression(ctx, right));
      cmp.finalize();
      condition = cmp;
    }
  }
  if (condition)
    node.appendChild(wrapExpression(ctx, condition), "condition");
  if (condition && ctx.peekKind() !== TokenKind.COLON && !ctx.isAtSyncPoint() && ctx.peekKind() !== TokenKind.INDENT) {
    const condRow = startTok.start.row;
    const err = synchronizeRowUntilColon(ctx, condRow);
    if (err)
      node.appendChild(err);
  }
  parseColonAndProcedureBody(ctx, node, startTok.start.row, true, parseTemplate2);
  while (ctx.peekKind() === TokenKind.ID && (ctx.peek().text === "elif" || ctx.peek().text === "elseif")) {
    const elif = parseElifClause(ctx, parseTemplate2);
    if (elif)
      node.appendChild(elif, "alternative");
  }
  if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === "else") {
    const elseClause = parseElseClause(ctx, parseTemplate2);
    if (elseClause)
      node.appendChild(elseClause, "alternative");
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseElifClause(ctx, parseTemplate2) {
  const startTok = ctx.peek();
  const node = ctx.startNode("elif_clause");
  const kw = ctx.consume();
  if (kw.text === "elseif") {
    const kwEnd = kw.startOffset + kw.text.length;
    const leaf = tokenToAutoLeaf(kw, ctx.source, kw.startOffset);
    const errNode = makeErrorNode(ctx.source, [leaf], kw.startOffset, kwEnd, kw.start, kw.end);
    node.appendChild(errNode);
  } else {
    ctx.addAnonymousChild(node, kw);
  }
  const condition = parseExpression(ctx, 0);
  if (condition)
    node.appendChild(wrapExpression(ctx, condition), "condition");
  if (condition && ctx.peekKind() !== TokenKind.COLON && !ctx.isAtSyncPoint() && ctx.peekKind() !== TokenKind.INDENT) {
    const condRow = startTok.start.row;
    const err = synchronizeRowUntilColon(ctx, condRow);
    if (err)
      node.appendChild(err);
  }
  parseColonAndProcedureBody(ctx, node, startTok.start.row, false, parseTemplate2);
  ctx.finishNode(node, startTok);
  return node;
}
function parseElseClause(ctx, parseTemplate2) {
  const startTok = ctx.peek();
  const node = ctx.startNode("else_clause");
  ctx.addAnonymousChild(node, ctx.consume());
  parseColonAndProcedureBody(ctx, node, startTok.start.row, false, parseTemplate2);
  ctx.finishNode(node, startTok);
  return node;
}
function parseRunStatement(ctx, parseTemplate2) {
  const startTok = ctx.peek();
  const node = ctx.startNode("run_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  if (!ctx.isAtSyncPoint()) {
    const target = parseExpression(ctx, 0);
    if (target) {
      node.appendChild(wrapExpression(ctx, target), "target");
    } else {
      addMissingTarget(ctx, node);
    }
  } else {
    addMissingTarget(ctx, node);
  }
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    consumeCommentsAndSkipNewlines(ctx, node);
    const proc = parseProcedure(ctx, parseTemplate2);
    if (proc) {
      const hasWithError = proc.namedChildren.some((c) => c.isError && c.children.some((cc) => cc.type === "with"));
      if (hasWithError) {
        for (const child of proc.namedChildren) {
          node.appendChild(child);
        }
      } else {
        node.appendChild(proc, "block_value");
      }
    }
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT)
      ctx.consume();
  }
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}
function parseSetStatement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("set_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  const target = parseExpression(ctx, 5);
  if (ctx.peekKind() === TokenKind.EQEQ) {
    const eqTok = ctx.consume();
    const rhs = parseExpression(ctx, 0);
    if (target && rhs) {
      const cmp = ctx.startNodeAt("comparison_expression", wrapExpression(ctx, target));
      cmp.appendChild(wrapExpression(ctx, target));
      cmp.appendChild(new CSTNode(eqTok.text, ctx.source, eqTok.startOffset, eqTok.startOffset + 2, eqTok.start, eqTok.end, false));
      cmp.appendChild(wrapExpression(ctx, rhs));
      cmp.finalize();
      const wrappedCmp = wrapExpression(ctx, cmp);
      if (ctx.peekKind() === TokenKind.NEWLINE)
        ctx.consume();
      return makeErrorNode(ctx.source, [wrappedCmp], wrappedCmp.startOffset, wrappedCmp.endOffset, wrappedCmp.startPosition, wrappedCmp.endPosition);
    }
  }
  if (target)
    node.appendChild(wrapExpression(ctx, target), "target");
  if (ctx.peekKind() === TokenKind.EQ) {
    ctx.addAnonymousChild(node, ctx.consume());
    const value = parseExpression(ctx, 0);
    if (value)
      node.appendChild(wrapExpression(ctx, value), "value");
  }
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}
function parseTransitionStatement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("transition_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  const withToList = tryParseWithToStatementList(ctx);
  if (withToList) {
    node.appendChild(withToList, "with_to_statement_list");
  } else if (!ctx.isAtSyncPoint() && ctx.peekKind() !== TokenKind.NEWLINE && ctx.peekKind() !== TokenKind.EOF) {
    const listNode = ctx.startNode("with_to_statement_list");
    const toNode = ctx.startNode("to_statement");
    toNode.appendChild(makeMissing(ctx, "to"));
    const target = parseExpression(ctx, 0);
    if (target)
      toNode.appendChild(wrapExpression(ctx, target), "target");
    toNode.finalize();
    listNode.appendChild(toNode);
    listNode.finalize();
    node.appendChild(listNode, "with_to_statement_list");
  }
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}
function parseWithStatement(ctx) {
  const startTok = ctx.peek();
  if (ctx.peekAt(1).kind !== TokenKind.ID && ctx.peekAt(1).kind !== TokenKind.STRING) {
    const withTok = ctx.consume();
    const kwOffset = ctx.currentOffset();
    const withChild = new CSTNode("with", ctx.source, kwOffset, kwOffset + 4, withTok.start, withTok.end, false);
    return makeErrorNode(ctx.source, [withChild], kwOffset, kwOffset + 4, withTok.start, withTok.end);
  }
  const node = ctx.startNode("with_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  parseWithParams(ctx, node);
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed("comment"));
  }
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}
function parseWithParams(ctx, node) {
  while (!ctx.isAtSyncPoint()) {
    if (ctx.peekKind() === TokenKind.ID || ctx.peekKind() === TokenKind.STRING) {
      if (ctx.peekKind() === TokenKind.STRING) {
        node.appendChild(parseString(ctx), "param");
      } else {
        node.appendChild(ctx.consumeNamed("id"), "param");
      }
    } else {
      const err = synchronize(ctx);
      if (err)
        node.appendChild(err);
      return;
    }
    if (ctx.peekKind() === TokenKind.EQ) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      node.appendChild(makeMissing(ctx, "="));
    }
    const value = parseExpression(ctx, 0);
    if (value)
      node.appendChild(wrapExpression(ctx, value), "value");
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }
}
function parseAvailableWhenStatement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("available_when_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  ctx.addAnonymousChild(node, ctx.consume());
  const condition = parseExpression(ctx, 0);
  if (condition)
    node.appendChild(wrapExpression(ctx, condition), "condition");
  if (ctx.peekKind() === TokenKind.NEWLINE)
    ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}
function tryParseWithToStatementList(ctx) {
  const tok = ctx.peek();
  if (!isTokenKind(tok, TokenKind.ID))
    return null;
  if (!["with", "to"].includes(tok.text))
    return null;
  const startTok = tok;
  const node = ctx.startNode("with_to_statement_list");
  while (!ctx.isAtSyncPoint()) {
    if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === "with") {
      node.appendChild(parseInlineWithStatement(ctx));
    } else if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === "to") {
      node.appendChild(parseToStatement(ctx));
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }
  if (node.children.length === 0)
    return null;
  ctx.finishNode(node, startTok);
  return node;
}
function parseInlineWithStatement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("with_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  parseWithParams(ctx, node);
  ctx.finishNode(node, startTok);
  return node;
}
function parseToStatement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("to_statement");
  ctx.addAnonymousChild(node, ctx.consume());
  const target = parseExpression(ctx, 0);
  if (target) {
    node.appendChild(wrapExpression(ctx, target), "target");
  } else {
    node.appendChild(makeEmptyError(ctx));
  }
  ctx.finishNode(node, startTok);
  return node;
}

// ../parser-javascript/dist/parse-templates.js
function parseTemplate(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("template");
  const pipeOffset = ctx.peekOffset();
  let lineStart = pipeOffset;
  while (lineStart > 0 && ctx.source.charCodeAt(lineStart - 1) !== 10) {
    lineStart--;
  }
  let templateOuterIndent = 0;
  for (let i = lineStart; i < pipeOffset; i++) {
    const ch = ctx.source.charCodeAt(i);
    if (ch === 32)
      templateOuterIndent += 1;
    else if (ch === 9)
      templateOuterIndent += 3;
    else
      break;
  }
  const pipeToken = ctx.consume();
  ctx.addAnonymousChild(node, pipeToken);
  const hasContentOnSameLine = !isAtEnd(ctx) && ctx.peekKind() !== TokenKind.NEWLINE && ctx.peekKind() !== TokenKind.INDENT && ctx.peekKind() !== TokenKind.DEDENT;
  if (hasContentOnSameLine) {
    const afterPipeOffset = pipeToken.startOffset + 1;
    gatherTemplateContentLine(ctx, node, afterPipeOffset);
  }
  if (ctx.peekKind() === TokenKind.NEWLINE) {
    ctx.consume();
  }
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    let indentDepth = 1;
    while (!isAtEnd(ctx)) {
      const tok = ctx.peek();
      if (tok.kind === TokenKind.DEDENT) {
        indentDepth--;
        ctx.consume();
        if (indentDepth <= 0) {
          if (templateContinues(ctx, templateOuterIndent)) {
            indentDepth = 0;
            continue;
          }
          break;
        }
      } else if (tok.kind === TokenKind.INDENT) {
        indentDepth++;
        ctx.consume();
      } else if (tok.kind === TokenKind.NEWLINE) {
        ctx.consume();
      } else {
        if (indentDepth <= 0 && !templateContinues(ctx, templateOuterIndent)) {
          break;
        }
        const lastChild = node.children.length > 0 ? node.children[node.children.length - 1] : null;
        const gapOffset = lastChild && lastChild.endOffset < ctx.peekOffset() ? lastChild.endOffset : void 0;
        const gapPos = gapOffset !== void 0 ? lastChild.endPosition : void 0;
        gatherTemplateContentLine(ctx, node, gapOffset, gapPos);
      }
    }
  }
  mergeTemplateContent(ctx, node);
  ctx.finishNode(node, startTok);
  return node;
}
function parseTemplateAsColinear(ctx) {
  return parseTemplate(ctx);
}
function templateContinues(ctx, templateOuterIndent) {
  let i = 0;
  while (ctx.peekAt(i).kind === TokenKind.NEWLINE)
    i++;
  const tok = ctx.peekAt(i);
  if (tok.kind === TokenKind.EOF || tok.kind === TokenKind.DEDENT)
    return false;
  if (tok.start.column > templateOuterIndent)
    return true;
  if (tok.kind === TokenKind.PIPE)
    return false;
  if (tok.kind === TokenKind.ID || tok.kind === TokenKind.STRING) {
    const after = ctx.peekAt(i + 1);
    if (after.kind === TokenKind.COLON)
      return false;
    if (after.kind === TokenKind.ID) {
      const afterAfter = ctx.peekAt(i + 2);
      if (afterAfter.kind === TokenKind.COLON)
        return false;
    }
  }
  if (tok.kind === TokenKind.ID) {
    switch (tok.text) {
      case "if":
      case "elif":
      case "else":
      case "run":
      case "set":
      case "transition":
        return false;
      case "with":
        if (ctx.peekAt(i + 1).kind !== TokenKind.COLON)
          return false;
        break;
      case "available":
        if (ctx.peekAt(i + 1).kind === TokenKind.ID && ctx.peekAt(i + 1).text === "when")
          return false;
        break;
    }
  }
  if (tok.kind === TokenKind.DASH_SPACE)
    return false;
  if (tok.kind === TokenKind.COMMENT)
    return false;
  return true;
}
function mergeTemplateContent(ctx, template) {
  const merged = [];
  let i = 0;
  while (i < template.children.length) {
    const child = template.children[i];
    if (child.type === "template_content") {
      let end = i + 1;
      while (end < template.children.length && template.children[end].type === "template_content") {
        end++;
      }
      if (end > i + 1) {
        const first = template.children[i];
        const last = template.children[end - 1];
        const mergedNode = new CSTNode("template_content", ctx.source, first.startOffset, last.endOffset, first.startPosition, last.endPosition);
        mergedNode.parent = template;
        merged.push(mergedNode);
        i = end;
      } else {
        merged.push(child);
        i++;
      }
    } else {
      merged.push(child);
      i++;
    }
  }
  template.children = merged;
}
function gatherTemplateContentLine(ctx, parent, initialOffset, initialPos) {
  let contentStartOffset = initialOffset ?? ctx.peekOffset();
  let contentStartPos = initialPos ?? ctx.peek().start;
  let lastConsumedEndOffset = contentStartOffset;
  let lastConsumedEndPos = contentStartPos;
  while (!isAtEnd(ctx)) {
    const tok = ctx.peek();
    if (tok.kind === TokenKind.NEWLINE || tok.kind === TokenKind.DEDENT || tok.kind === TokenKind.INDENT || tok.kind === TokenKind.EOF) {
      break;
    }
    if (tok.kind === TokenKind.TEMPLATE_EXPR_START) {
      const exprOffset = ctx.peekOffset();
      if (exprOffset > contentStartOffset) {
        parent.appendChild(new CSTNode("template_content", ctx.source, contentStartOffset, exprOffset, contentStartPos, tok.start));
      }
      const exprNode = parseTemplateExpression(ctx);
      parent.appendChild(exprNode);
      contentStartOffset = exprNode.endOffset;
      contentStartPos = exprNode.endPosition;
      lastConsumedEndOffset = exprNode.endOffset;
      lastConsumedEndPos = exprNode.endPosition;
      continue;
    }
    const tokOffset = ctx.peekOffset();
    lastConsumedEndOffset = tokOffset + tok.text.length;
    lastConsumedEndPos = tok.end;
    ctx.consume();
  }
  if (lastConsumedEndOffset > contentStartOffset) {
    parent.appendChild(new CSTNode("template_content", ctx.source, contentStartOffset, lastConsumedEndOffset, contentStartPos, lastConsumedEndPos));
  }
}
function parseTemplateExpression(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("template_expression");
  ctx.addAnonymousChild(node, ctx.consume());
  const expr = parseExpression(ctx, 0);
  if (expr) {
    node.appendChild(wrapExpression(ctx, expr), "expression");
  } else {
    node.appendChild(makeEmptyError(ctx));
  }
  if (ctx.peekKind() !== TokenKind.RBRACE && !ctx.isAtSyncPoint()) {
    const err = synchronize(ctx);
    if (err)
      node.appendChild(err);
  }
  if (ctx.peekKind() === TokenKind.RBRACE) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeMissing(ctx, "}"));
  }
  ctx.finishNode(node, startTok);
  return node;
}

// ../parser-javascript/dist/parse-mapping.js
var MAX_KEY_LOOKAHEAD = 10;
function parseMappingOrExpression(ctx, parseSequence2) {
  if (isMappingStart(ctx)) {
    return parseMapping(ctx, parseSequence2);
  }
  const expr = parseExpression(ctx, 0);
  if (!expr)
    return null;
  if (isTokenKind(ctx.peek(), TokenKind.EQ)) {
    const node = ctx.startNodeAt("assignment_expression", expr);
    node.appendChild(wrapExpression(ctx, expr), "left");
    ctx.addAnonymousChild(node, ctx.consumeKind(TokenKind.EQ));
    const right = parseExpression(ctx, 0);
    if (right)
      node.appendChild(wrapExpression(ctx, right), "right");
    return node;
  }
  return wrapExpression(ctx, expr);
}
function isMappingStart(ctx) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.COMMENT)
    return true;
  if (tok.kind === TokenKind.PIPE)
    return true;
  if (tok.kind === TokenKind.ID && isStatementStart(ctx))
    return true;
  if (!isKeyTokenStart(tok.kind))
    return false;
  const startRow = tok.start.row;
  for (let i = 1; i < MAX_KEY_LOOKAHEAD; i++) {
    const t = ctx.peekAt(i);
    if (t.kind === TokenKind.COLON || t.kind === TokenKind.INDENT || t.kind === TokenKind.ARROW || t.kind === TokenKind.AT)
      return true;
    if (i === 1 && (t.kind === TokenKind.STRING || t.kind === TokenKind.NUMBER))
      return true;
    if (t.kind === TokenKind.EOF || t.start.row !== startRow)
      return false;
    if (!isKeyTokenContinuation(t.kind))
      return false;
  }
  return false;
}
function parseMapping(ctx, parseSequence2) {
  const node = ctx.startNode("mapping");
  while (!isAtEnd(ctx)) {
    skipNewlines(ctx);
    const tok = ctx.peek();
    if (tok.kind === TokenKind.DEDENT || tok.kind === TokenKind.EOF)
      break;
    if (tok.kind === TokenKind.COMMENT && isTrailingCommentOnly(ctx)) {
      break;
    }
    const item = parseMappingItem(ctx, parseSequence2);
    if (item) {
      node.appendChild(item);
    } else {
      const err = synchronize(ctx);
      if (err) {
        node.appendChild(err);
      } else if (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
        ctx.consume();
      }
    }
  }
  return node;
}
function parseMappingItem(ctx, parseSequence2) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.ID) {
    switch (tok.text) {
      case "if":
        return parseIfStatement(ctx, (c) => parseTemplate(c));
      case "run":
        return parseRunStatement(ctx, (c) => parseTemplate(c));
      case "set":
        return parseSetStatement(ctx);
      case "transition":
        return parseTransitionStatement(ctx);
      case "with": {
        if (ctx.peekAt(1).kind !== TokenKind.COLON) {
          return parseWithStatement(ctx);
        }
        break;
      }
      case "available": {
        if (ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === "when") {
          return parseAvailableWhenStatement(ctx);
        }
        break;
      }
    }
  }
  if (tok.kind === TokenKind.PIPE) {
    return parseTemplate(ctx);
  }
  if (tok.kind === TokenKind.COMMENT) {
    return ctx.consumeNamed("comment");
  }
  if (tok.kind === TokenKind.ID && (tok.text === "else" || tok.text === "elif" || tok.text === "for")) {
    return parseOrphanBlock(ctx, (c) => parseProcedure(c, (c2) => parseTemplate(c2)));
  }
  if (isKeyStart(ctx)) {
    return parseMappingElement(ctx, parseSequence2);
  }
  return null;
}
function isColinearMappingElement(ctx) {
  if (!isKeyStart(ctx))
    return false;
  const tok = ctx.peek();
  const lookahead = 1;
  if (ctx.peekAt(lookahead).kind === TokenKind.ID && ctx.peekAt(lookahead).start.row === tok.start.row) {
    const afterSecond = ctx.peekAt(lookahead + 1);
    if (afterSecond.kind === TokenKind.COLON && afterSecond.start.row === tok.start.row) {
      return true;
    }
  }
  const next = ctx.peekAt(lookahead);
  return next.kind === TokenKind.COLON && next.start.row === tok.start.row;
}
function parseColinearMappingElement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("mapping_element");
  const key = parseKey(ctx);
  if (key)
    node.appendChild(key, "key");
  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  }
  const colinear = tryParseColinearValue(ctx);
  if (colinear) {
    if (colinear.errorPrefix)
      node.appendChild(colinear.errorPrefix);
    node.appendChild(colinear.value, "colinear_value");
  }
  ctx.finishNode(node, startTok);
  return node;
}
function tryParseColinearValue(ctx) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.PIPE) {
    return { value: parseTemplateAsColinear(ctx) };
  }
  if (tok.kind === TokenKind.ID && (tok.text === "mutable" || tok.text === "linked")) {
    return { value: parseVariableDeclaration(ctx) };
  }
  if (tok.kind === TokenKind.ID && isFuzzyModifier(tok.text)) {
    return { value: parseFuzzyVariableDeclaration(ctx) };
  }
  const expr = parseExpression(ctx, 0);
  if (!expr)
    return null;
  if ((expr.type === "number" || expr.type === "id" && /^[0-9]/.test(expr.text)) && ctx.peekKind() === TokenKind.ID && ctx.peek().start.row === expr.startRow) {
    const errNode = makeErrorNode(ctx.source, [wrapExpression(ctx, expr)], expr.startOffset, expr.endOffset, expr.startPosition, expr.endPosition);
    const realValue = tryParseColinearValue(ctx);
    if (realValue) {
      return { value: realValue.value, errorPrefix: errNode };
    }
  }
  const withToList = tryParseWithToStatementList(ctx);
  if (withToList) {
    const ewt2 = ctx.startNodeAt("expression_with_to", expr);
    ewt2.appendChild(wrapExpression(ctx, expr), "expression");
    ewt2.appendChild(withToList, "with_to_statement_list");
    ewt2.finalize();
    return { value: ewt2 };
  }
  if (ctx.peekKind() === TokenKind.EQ) {
    const assign = ctx.startNodeAt("assignment_expression", expr);
    assign.appendChild(wrapExpression(ctx, expr), "left");
    ctx.addAnonymousChild(assign, ctx.consume());
    const right = parseExpression(ctx, 0);
    if (right)
      assign.appendChild(wrapExpression(ctx, right), "right");
    assign.finalize();
    return { value: assign };
  }
  const ewt = ctx.startNodeAt("expression_with_to", expr);
  ewt.appendChild(wrapExpression(ctx, expr), "expression");
  return { value: ewt };
}
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }).fill(0));
  for (let i = 0; i <= m; i++)
    dp[i][0] = i;
  for (let j = 0; j <= n; j++)
    dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
function isFuzzyModifier(text) {
  return levenshteinDistance(text, "mutable") <= 2 || levenshteinDistance(text, "linked") <= 2;
}
function parseFuzzyVariableDeclaration(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("variable_declaration");
  const misspelled = ctx.consume();
  const misspelledEnd = misspelled.startOffset + misspelled.text.length;
  const leaf = tokenToAutoLeaf(misspelled, ctx.source, misspelled.startOffset);
  const errNode = makeErrorNode(ctx.source, [leaf], misspelled.startOffset, misspelledEnd, misspelled.start, misspelled.end);
  node.appendChild(errNode);
  const typeExpr = parseExpression(ctx, 0);
  if (typeExpr)
    node.appendChild(wrapExpression(ctx, typeExpr), "type");
  if (ctx.peekKind() === TokenKind.EQ) {
    ctx.addAnonymousChild(node, ctx.consume());
    const defaultExpr = parseExpression(ctx, 0);
    if (defaultExpr)
      node.appendChild(wrapExpression(ctx, defaultExpr), "default");
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseMappingElement(ctx, parseSequence2) {
  const startTok = ctx.peek();
  const node = ctx.startNode("mapping_element");
  const key = parseKey(ctx);
  invariant(key != null, "We must be at a key start");
  node.appendChild(key, "key");
  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consumeKind(TokenKind.COLON));
  } else if (ctx.peekKind() === TokenKind.INDENT || ctx.peekKind() === TokenKind.ARROW || ctx.peekKind() === TokenKind.ID || ctx.peekKind() === TokenKind.AT || ctx.peekKind() === TokenKind.STRING || ctx.peekKind() === TokenKind.NUMBER) {
    node.appendChild(makeMissing(ctx, ":"));
  } else {
    return node;
  }
  if (ctx.peekKind() === TokenKind.ARROW) {
    parseArrowBody(ctx, node);
  } else if (ctx.peekKind() === TokenKind.INDENT) {
    parseIndentedBlockValue(ctx, node, parseSequence2);
  } else {
    parseColinearAndBlock(ctx, node, startTok.start.row, parseSequence2);
  }
  return node;
}
function parseColinearAndBlock(ctx, node, startRow, parseSequence2) {
  const colinear = tryParseColinearValue(ctx);
  if (colinear) {
    if (colinear.errorPrefix)
      node.appendChild(colinear.errorPrefix);
    node.appendChild(colinear.value, "colinear_value");
  }
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed("comment"));
  }
  if (colinear) {
    const err = synchronizeRow(ctx, startRow);
    if (err)
      node.appendChild(err);
  } else if (!ctx.isAtSyncPoint() && ctx.peekKind() !== TokenKind.INDENT) {
    const err = synchronize(ctx);
    if (err)
      node.appendChild(err);
  }
  if (colinear?.value.type === "expression_with_to" && !colinear.value.childForFieldName("with_to_statement_list") && ctx.peekKind() === TokenKind.INDENT && ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === "to") {
    ctx.consumeKind(TokenKind.INDENT);
    const withToList = tryParseWithToStatementList(ctx);
    if (withToList) {
      colinear.value.appendChild(withToList, "with_to_statement_list");
      node.endOffset = colinear.value.endOffset;
      node.endPosition = colinear.value.endPosition;
    }
    ctx.consumeKind(TokenKind.DEDENT);
  } else if (ctx.peekKind() === TokenKind.INDENT) {
    parseIndentedBlockValue(ctx, node, parseSequence2);
  }
}
function parseArrowBody(ctx, node) {
  ctx.addAnonymousChild(node, ctx.consume());
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed("comment"));
  }
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    consumeCommentsAndSkipNewlines(ctx, node);
    const proc = parseProcedure(ctx, (c) => parseTemplate(c));
    if (proc)
      node.appendChild(proc, "block_value");
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT)
      ctx.consume();
  } else {
    const emptyProc = ctx.startNode("procedure");
    emptyProc.appendChild(makeEmptyError(ctx));
    ctx.finishNode(emptyProc, ctx.peek());
    node.appendChild(emptyProc, "block_value");
  }
}
function parseVariableDeclaration(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("variable_declaration");
  ctx.addAnonymousChild(node, ctx.consume());
  if (ctx.peekKind() === TokenKind.ID && (ctx.peek().text === "mutable" || ctx.peek().text === "linked")) {
    const errExpr = parseExpression(ctx, 0);
    if (errExpr) {
      const wrapped = wrapExpression(ctx, errExpr);
      const errNode = makeErrorNode(ctx.source, [wrapped], wrapped.startOffset, wrapped.endOffset, wrapped.startPosition, wrapped.endPosition);
      node.appendChild(errNode);
    }
  }
  const typeExpr = parseExpression(ctx, 0);
  if (typeExpr)
    node.appendChild(wrapExpression(ctx, typeExpr), "type");
  if (ctx.peekKind() === TokenKind.EQ) {
    ctx.addAnonymousChild(node, ctx.consume());
    const defaultExpr = parseExpression(ctx, 0);
    if (defaultExpr)
      node.appendChild(wrapExpression(ctx, defaultExpr), "default");
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseIndentedBlockValue(ctx, parent, parseSequence2) {
  ctx.consume();
  consumeCommentsAndSkipNewlines(ctx, parent);
  const blockValue = parseBlockValue(ctx, parseSequence2);
  if (blockValue)
    parent.appendChild(blockValue, "block_value");
  consumeCommentsAndSkipNewlines(ctx, parent);
  recoverToBlockEnd(ctx, parent);
  if (ctx.peekKind() === TokenKind.DEDENT)
    ctx.consume();
}
function parseBlockValue(ctx, parseSequence2) {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.DASH_SPACE) {
    return parseSequence2(ctx);
  }
  if (tok.kind === TokenKind.ID && tok.text === "empty") {
    const emptyNode = ctx.startNode("empty_keyword");
    ctx.addAnonymousChild(emptyNode, ctx.consume());
    ctx.finishNode(emptyNode, tok);
    return emptyNode;
  }
  if (isMappingStart(ctx)) {
    return parseMapping(ctx, parseSequence2);
  }
  return parseAtomBlockValue(ctx);
}
function parseAtomBlockValue(ctx) {
  const expr = parseExpression(ctx, 0);
  if (!expr)
    return null;
  if (ATOM_TYPES.has(expr.type)) {
    const atom = new CSTNode("atom", ctx.source, expr.startOffset, expr.endOffset, expr.startPosition, expr.endPosition);
    atom.appendChild(expr);
    return atom;
  }
  return expr;
}

// ../parser-javascript/dist/parse-sequence.js
function parseSequence(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("sequence");
  while (ctx.peekKind() === TokenKind.DASH_SPACE) {
    const elem = parseSequenceElement(ctx);
    if (elem)
      node.appendChild(elem);
    skipNewlines(ctx);
  }
  while (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT && ctx.peekKind() !== TokenKind.DASH_SPACE) {
    skipNewlines(ctx);
    if (isAtEnd(ctx) || ctx.peekKind() === TokenKind.DEDENT)
      break;
    const parseSeq = (_ctx) => parseSequence(_ctx);
    const item = parseMappingItem(ctx, parseSeq);
    if (item) {
      const errNode = makeErrorNode(ctx.source, [item], item.startOffset, item.endOffset, item.startPosition, item.endPosition);
      node.appendChild(errNode);
    } else {
      const err = synchronize(ctx);
      if (err) {
        node.appendChild(err);
      } else {
        ctx.consume();
      }
    }
  }
  ctx.finishNode(node, startTok);
  return node;
}
function parseSequenceElement(ctx) {
  const startTok = ctx.peek();
  const node = ctx.startNode("sequence_element");
  ctx.addAnonymousChild(node, ctx.consume());
  const parseSeq = (_ctx) => parseSequence(_ctx);
  if (isColinearMappingElement(ctx)) {
    const mappingElem = parseColinearMappingElement(ctx);
    if (mappingElem)
      node.appendChild(mappingElem, "colinear_mapping_element");
    if (ctx.peekKind() === TokenKind.NEWLINE)
      ctx.consume();
    if (ctx.peekKind() === TokenKind.INDENT) {
      ctx.consume();
      const blockValue = parseMapping(ctx, parseSeq);
      if (blockValue)
        node.appendChild(blockValue, "block_value");
      if (ctx.peekKind() === TokenKind.DEDENT)
        ctx.consume();
    }
  } else if (ctx.peekKind() === TokenKind.NEWLINE || ctx.peekKind() === TokenKind.EOF || ctx.peekKind() === TokenKind.INDENT) {
    if (ctx.peekKind() === TokenKind.NEWLINE)
      ctx.consume();
    if (ctx.peekKind() === TokenKind.INDENT) {
      ctx.consume();
      const blockValue = parseMapping(ctx, parseSeq);
      if (blockValue)
        node.appendChild(blockValue, "block_value");
      if (ctx.peekKind() === TokenKind.DEDENT)
        ctx.consume();
    }
  } else {
    const colinear = tryParseColinearValue(ctx);
    if (colinear) {
      if (colinear.errorPrefix)
        node.appendChild(colinear.errorPrefix);
      node.appendChild(colinear.value, "colinear_value");
    }
    if (ctx.peekKind() === TokenKind.COMMENT) {
      node.appendChild(ctx.consumeNamed("comment"));
    }
    if (ctx.peekKind() === TokenKind.NEWLINE)
      ctx.consume();
  }
  ctx.finishNode(node, startTok);
  return node;
}

// ../parser-javascript/dist/parser.js
var Parser = class {
  constructor(source) {
    __publicField(this, "source");
    __publicField(this, "tokens");
    __publicField(this, "pos", 0);
    __publicField(this, "_eof");
    this.source = source;
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
  }
  parse() {
    const root = this.parseSourceFile();
    return root;
  }
  // --- ParserContext implementation ---
  peek() {
    return this.peekAt(0);
  }
  peekAt(offset) {
    return this.peekAtIndex(this.pos + offset);
  }
  peekAtIndex(idx2) {
    return this.tokens[idx2] ?? this.eofToken();
  }
  peekKind() {
    return this.peek().kind;
  }
  consume() {
    const tok = this.peek();
    this.pos++;
    return tok;
  }
  consumeKind(kind) {
    const tok = this.peek();
    invariant(isTokenKind(tok, kind), `Expected token kind ${kind} but got ${tok.kind}`);
    this.pos++;
    return tok;
  }
  consumeNamed(type) {
    const tok = this.consume();
    const offset = tok.startOffset;
    return new CSTNode(type, this.source, offset, offset + tok.text.length, tok.start, tok.end);
  }
  currentOffset() {
    const idx2 = this.pos > 0 ? this.pos - 1 : 0;
    return this.peekAtIndex(idx2).startOffset;
  }
  peekOffset() {
    return this.peek().startOffset;
  }
  isAtSyncPoint() {
    return isSyncPoint(this.peekKind());
  }
  startNode(type) {
    const tok = this.peek();
    const offset = tok.startOffset;
    return new CSTNode(type, this.source, offset, offset, tok.start, tok.end);
  }
  startNodeAt(type, existingChild) {
    return new CSTNode(type, this.source, existingChild.startOffset, existingChild.endOffset, existingChild.startPosition, existingChild.endPosition);
  }
  finishNode(_node, _startTok) {
  }
  addAnonymousChild(parent, token) {
    const offset = token.startOffset;
    const child = new CSTNode(token.text, this.source, offset, offset + token.text.length, token.start, token.end, false);
    parent.appendChild(child);
  }
  // --- Top-level parsing ---
  parseSourceFile() {
    const node = this.startNode("source_file");
    skipNewlines(this);
    if (this.peekKind() === TokenKind.INDENT) {
      this.consume();
    }
    consumeCommentsAndSkipNewlines(this, node);
    if (this.peekKind() === TokenKind.DASH_SPACE) {
      node.appendChild(parseSequence(this));
    } else {
      const content = parseMappingOrExpression(this, (_ctx) => parseSequence(_ctx));
      if (content)
        node.appendChild(content);
    }
    consumeCommentsAndSkipNewlines(this, node);
    while (!isAtEnd(this)) {
      if (this.peekKind() === TokenKind.NEWLINE || this.peekKind() === TokenKind.DEDENT) {
        this.consume();
        continue;
      }
      if (this.peekKind() === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed("comment"));
        continue;
      }
      const err = synchronize(this);
      if (err) {
        node.appendChild(err);
      } else {
        this.consume();
      }
    }
    node.startOffset = 0;
    node.startPosition = { row: 0, column: 0 };
    node.endOffset = this.source.length;
    node.endPosition = this.eofToken().end;
    return node;
  }
  eofToken() {
    if (!this._eof) {
      const lastToken = this.tokens[this.tokens.length - 1];
      const pos = lastToken ? lastToken.end : { row: 0, column: 0 };
      this._eof = {
        kind: TokenKind.EOF,
        text: "",
        start: pos,
        end: pos,
        startOffset: this.source.length
      };
    }
    return this._eof;
  }
};

// ../parser-javascript/dist/index.js
function parse(source) {
  const parser = new Parser(source);
  return { rootNode: parser.parse() };
}
function parseAndHighlight(source) {
  const { rootNode } = parse(source);
  return highlight(rootNode);
}

// ../parser/dist/ts-backend.js
function createTsBackend() {
  return {
    parse,
    parseAndHighlight
  };
}

// ../parser/dist/api.js
function createApi(backend) {
  function parse6(source) {
    return backend.parse(source);
  }
  function parseAndHighlight3(source) {
    return backend.parseAndHighlight(source);
  }
  function getParser3() {
    return { parse: (source) => backend.parse(source) };
  }
  function executeQuery3(source, querySource) {
    if (querySource && backend.executeQuery) {
      return backend.executeQuery(source, querySource);
    }
    return backend.parseAndHighlight(source);
  }
  return { parse: parse6, parseAndHighlight: parseAndHighlight3, getParser: getParser3, executeQuery: executeQuery3 };
}

// ../parser/dist/adapter.js
var adapterCache = /* @__PURE__ */ new WeakMap();
function adaptNode(node) {
  const cached2 = adapterCache.get(node);
  if (cached2)
    return cached2;
  const adapted = new TreeSitterNodeAdapter(node);
  adapterCache.set(node, adapted);
  return adapted;
}
function adaptNodeOrNull(node) {
  return node ? adaptNode(node) : null;
}
function adaptNodes(nodes) {
  return nodes.filter((c) => c != null).map(adaptNode);
}
var TreeSitterNodeAdapter = class {
  constructor(node) {
    __publicField(this, "_node");
    __publicField(this, "_children", null);
    __publicField(this, "_namedChildren", null);
    this._node = node;
    adapterCache.set(node, this);
  }
  get type() {
    return this._node.type;
  }
  get text() {
    return this._node.text;
  }
  // Flat position fields — derived from tree-sitter's position objects
  get startRow() {
    return this._node.startPosition.row;
  }
  get startCol() {
    return this._node.startPosition.column;
  }
  get endRow() {
    return this._node.endPosition.row;
  }
  get endCol() {
    return this._node.endPosition.column;
  }
  // Position objects — pass through directly
  get startPosition() {
    return this._node.startPosition;
  }
  get endPosition() {
    return this._node.endPosition;
  }
  // Byte offsets — mapped from tree-sitter's startIndex/endIndex
  get startOffset() {
    return this._node.startIndex;
  }
  get endOffset() {
    return this._node.endIndex;
  }
  // Tree navigation — lazily cached, recursively wrapped
  get children() {
    if (!this._children) {
      this._children = adaptNodes(this._node.children);
    }
    return this._children;
  }
  get namedChildren() {
    if (!this._namedChildren) {
      this._namedChildren = adaptNodes(this._node.namedChildren);
    }
    return this._namedChildren;
  }
  get parent() {
    return adaptNodeOrNull(this._node.parent);
  }
  get previousSibling() {
    return adaptNodeOrNull(this._node.previousSibling);
  }
  childForFieldName(name) {
    return adaptNodeOrNull(this._node.childForFieldName(name));
  }
  childrenForFieldName(name) {
    return adaptNodes(this._node.childrenForFieldName(name));
  }
  fieldNameForChild(index) {
    return this._node.fieldNameForChild(index);
  }
  // Boolean flags
  get isError() {
    return this._node.isError ?? this._node.type === "ERROR";
  }
  get isMissing() {
    return this._node.isMissing;
  }
  get isNamed() {
    return this._node.isNamed;
  }
  get hasError() {
    return this._node.hasError;
  }
  toSExp() {
    return String(this._node);
  }
};

// ../parser/dist/wasm-backend.js
async function createWasmBackend(options) {
  const engineWasm = base64ToUint8Array(options.engineWasmBase64.join(""));
  const grammarWasm = base64ToUint8Array(options.grammarWasmBase64.join(""));
  const webTsModule = "web-tree-sitter";
  const { Parser: TSParser, Language, Query } = await import(
    /* @vite-ignore */
    webTsModule
  );
  await TSParser.init({
    locateFile: () => "",
    wasmBinary: stripWasmSourceMapUrl(engineWasm)
  });
  const language = await Language.load(grammarWasm);
  const wasmParser = new TSParser();
  wasmParser.setLanguage(language);
  const WasmQueryCtor = Query;
  const wasmLanguage = language;
  function parse6(source) {
    const tree = wasmParser.parse(source);
    if (!tree) {
      throw new Error("tree-sitter parse returned null");
    }
    return { rootNode: adaptNode(tree.rootNode) };
  }
  function parseAndHighlight3(_source) {
    return [];
  }
  function executeQuery3(source, querySource) {
    const tree = wasmParser.parse(source);
    if (!tree) {
      throw new Error("tree-sitter parse returned null");
    }
    const query = new WasmQueryCtor(wasmLanguage, querySource);
    const captures = query.captures(tree.rootNode);
    return captures.map((capture2) => ({
      name: capture2.name,
      text: capture2.node.text,
      startRow: capture2.node.startPosition.row,
      startCol: capture2.node.startPosition.column,
      endRow: capture2.node.endPosition.row,
      endCol: capture2.node.endPosition.column
    }));
  }
  return { parse: parse6, parseAndHighlight: parseAndHighlight3, executeQuery: executeQuery3 };
}
function stripWasmSourceMapUrl(wasm) {
  if (wasm.length < 8 || wasm[0] !== 0 || wasm[1] !== 97 || wasm[2] !== 115 || wasm[3] !== 109) {
    return wasm;
  }
  const sections = [];
  let i = 8;
  while (i < wasm.length) {
    const sectionStart = i;
    const sectionId = wasm[i++];
    let size = 0;
    let shift = 0;
    let b;
    do {
      b = wasm[i++];
      size |= (b & 127) << shift;
      shift += 7;
    } while (b & 128);
    const contentStart = i;
    const sectionEnd = contentStart + size;
    let keep = true;
    if (sectionId === 0 && size > 0) {
      let nameLen = 0;
      let nameShift = 0;
      let j = contentStart;
      do {
        b = wasm[j++];
        nameLen |= (b & 127) << nameShift;
        nameShift += 7;
      } while (b & 128);
      const name = String.fromCharCode(...wasm.slice(j, j + nameLen));
      if (name === "sourceMappingURL")
        keep = false;
    }
    if (keep)
      sections.push([sectionStart, sectionEnd]);
    i = sectionEnd;
  }
  const totalSize = 8 + sections.reduce((s, [a, b]) => s + b - a, 0);
  if (totalSize === wasm.length)
    return wasm;
  const out = new Uint8Array(totalSize);
  out.set(wasm.slice(0, 8), 0);
  let offset = 8;
  for (const [start, end] of sections) {
    out.set(wasm.slice(start, end), offset);
    offset += end - start;
  }
  return out;
}
function base64ToUint8Array(base642) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base642, "base64"));
  }
  const binary = atob(base642);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ../parser/dist/index.js
var { parse: parse2, parseAndHighlight: parseAndHighlight2, getParser, executeQuery } = createApi(createTsBackend());

// src/parser.ts
var _wasmBackend = null;
function getParser2() {
  if (_wasmBackend) {
    return { parse: (source) => _wasmBackend.parse(source) };
  }
  return getParser();
}
function executeQuery2(source, querySource) {
  if (_wasmBackend) {
    if (querySource && _wasmBackend.executeQuery) {
      return _wasmBackend.executeQuery(source, querySource);
    }
    return _wasmBackend.parseAndHighlight(source);
  }
  return executeQuery(source, querySource);
}
var _initPromise = null;
var _initialized = false;
async function init() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = doInit();
  try {
    await _initPromise;
  } catch (err) {
    _initPromise = null;
    throw err;
  }
}
async function doInit() {
  let wasmModule;
  try {
    const wasmModuleName = "./wasm-constants-generated";
    wasmModule = await import(
      /* @vite-ignore */
      `${wasmModuleName}.js`
    );
  } catch {
    _initialized = true;
    return;
  }
  const { TREE_SITTER_ENGINE_BASE64, TREE_SITTER_AGENTSCRIPT_BASE64 } = wasmModule;
  if (!TREE_SITTER_ENGINE_BASE64 || !TREE_SITTER_AGENTSCRIPT_BASE64) {
    _initialized = true;
    return;
  }
  const options = {
    engineWasmBase64: TREE_SITTER_ENGINE_BASE64,
    grammarWasmBase64: TREE_SITTER_AGENTSCRIPT_BASE64
  };
  _wasmBackend = await createWasmBackend(options);
  _initialized = true;
}

// ../types/dist/position.js
function toRange(node) {
  return {
    start: {
      line: node.startRow,
      character: node.startCol
    },
    end: { line: node.endRow, character: node.endCol }
  };
}

// ../types/dist/diagnostic.js
var DiagnosticSeverity;
(function(DiagnosticSeverity2) {
  DiagnosticSeverity2[DiagnosticSeverity2["Error"] = 1] = "Error";
  DiagnosticSeverity2[DiagnosticSeverity2["Warning"] = 2] = "Warning";
  DiagnosticSeverity2[DiagnosticSeverity2["Information"] = 3] = "Information";
  DiagnosticSeverity2[DiagnosticSeverity2["Hint"] = 4] = "Hint";
})(DiagnosticSeverity || (DiagnosticSeverity = {}));
var DiagnosticTag;
(function(DiagnosticTag2) {
  DiagnosticTag2[DiagnosticTag2["Unnecessary"] = 1] = "Unnecessary";
  DiagnosticTag2[DiagnosticTag2["Deprecated"] = 2] = "Deprecated";
})(DiagnosticTag || (DiagnosticTag = {}));

// ../language/dist/core/types.js
function parseCommentNode(node, attachment = "leading") {
  return {
    value: node.text.slice(1),
    attachment,
    range: toRange(node)
  };
}
function astField(ast, key) {
  return ast[key];
}
function extractDiscriminantValue(entry, fieldName) {
  const field = entry[fieldName];
  if (!field || typeof field !== "object")
    return void 0;
  const expr = field;
  if (typeof expr.value === "string")
    return expr.value;
  if (typeof expr.name === "string")
    return expr.name;
  return void 0;
}
function withCst(ast, node) {
  const existing = ast.__diagnostics;
  const result = Object.assign(ast, {
    __cst: {
      node,
      range: toRange(node)
    },
    __diagnostics: existing ?? []
  });
  return result;
}
function createNode(ast) {
  const result = Object.assign(ast, {
    __diagnostics: []
  });
  return result;
}
var AstNodeBase = class {
  constructor() {
    __publicField(this, "__diagnostics", []);
    __publicField(this, "__cst");
    __publicField(this, "__comments");
  }
};
var BARE_ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function getKeyText(node) {
  if (node.type === "id") {
    return node.text;
  }
  if (node.type === "string") {
    let value = "";
    for (const child of node.namedChildren) {
      if (child.type === "string_content") {
        value += child.text;
      } else if (child.type === "escape_sequence") {
        if (child.text === '\\"')
          value += '"';
        else if (child.text === "\\'")
          value += "'";
        else if (child.text === "\\\\")
          value += "\\";
        else if (child.text === "\\n")
          value += "\n";
        else if (child.text === "\\r")
          value += "\r";
        else if (child.text === "\\t")
          value += "	";
        else if (child.text === "\\0")
          value += "\0";
      }
    }
    return value;
  }
  return node.text;
}
function emitKeyName(name) {
  if (BARE_ID_PATTERN.test(name)) {
    return name;
  }
  return quoteKeyName(name);
}
function quoteKeyName(name) {
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\0/g, "\\0");
  return `"${escaped}"`;
}
function isKeyNode(node) {
  return node.type === "id" || node.type === "string";
}
function getValueNodes(element) {
  return {
    blockValue: element.childForFieldName("block_value"),
    // expression is semantically a colinear value, just promoted due to inline rule
    colinearValue: element.childForFieldName("colinear_value") ?? element.childForFieldName("expression"),
    procedure: element.childForFieldName("procedure")
  };
}
function emitIndent(ctx) {
  return " ".repeat(ctx.indent * (ctx.tabSize ?? 4));
}
function leadingComments(node) {
  return node?.__comments?.filter((c) => c.attachment === "leading") ?? [];
}
function trailingComments(node) {
  return node?.__comments?.filter((c) => c.attachment === "trailing") ?? [];
}
function inlineComments(node) {
  return node?.__comments?.filter((c) => c.attachment === "inline") ?? [];
}
function emitSingleComment(c, ctx) {
  const indent = emitIndent(ctx);
  if (c.value.trim().length === 0)
    return `${indent}#`;
  const prefix2 = c.range ? "#" : "# ";
  return `${indent}${prefix2}${c.value}`;
}
function formatInlineComment(c) {
  if (c.value.trim().length === 0)
    return "#";
  const prefix2 = c.range ? "#" : "# ";
  return `${prefix2}${c.value}`;
}
function appendInlineToFirstLine(body, inlineComment) {
  const newlineIdx = body.indexOf("\n");
  if (newlineIdx === -1)
    return `${body} ${inlineComment}`;
  return `${body.slice(0, newlineIdx)} ${inlineComment}${body.slice(newlineIdx)}`;
}
function emitCommentList(comments, ctx) {
  if (!comments || comments.length === 0)
    return "";
  return comments.map((c) => emitSingleComment(c, ctx)).join("\n");
}
function wrapWithComments(body, node, ctx, trailingIndentOffset) {
  if (!node || !node.__comments?.length)
    return body;
  const leading = leadingComments(node);
  const inline = inlineComments(node);
  const trailing = trailingComments(node);
  const parts = [];
  const leadingText = emitCommentList(leading, ctx);
  if (leadingText)
    parts.push(leadingText);
  if (body) {
    if (inline.length > 0) {
      const inlineText = inline.map((c) => formatInlineComment(c)).join(" ");
      parts.push(appendInlineToFirstLine(body, inlineText));
    } else {
      parts.push(body);
    }
  }
  if (trailing.length > 0) {
    const trailingCtx = trailingIndentOffset != null ? { ...ctx, indent: ctx.indent + trailingIndentOffset } : ctx;
    const trailingText = trailing.map((c) => emitSingleComment(c, trailingCtx)).join("\n");
    if (trailingText)
      parts.push(trailingText);
  }
  return parts.join("\n");
}
var SymbolKind;
(function(SymbolKind2) {
  SymbolKind2[SymbolKind2["File"] = 1] = "File";
  SymbolKind2[SymbolKind2["Module"] = 2] = "Module";
  SymbolKind2[SymbolKind2["Namespace"] = 3] = "Namespace";
  SymbolKind2[SymbolKind2["Package"] = 4] = "Package";
  SymbolKind2[SymbolKind2["Class"] = 5] = "Class";
  SymbolKind2[SymbolKind2["Method"] = 6] = "Method";
  SymbolKind2[SymbolKind2["Property"] = 7] = "Property";
  SymbolKind2[SymbolKind2["Field"] = 8] = "Field";
  SymbolKind2[SymbolKind2["Constructor"] = 9] = "Constructor";
  SymbolKind2[SymbolKind2["Enum"] = 10] = "Enum";
  SymbolKind2[SymbolKind2["Interface"] = 11] = "Interface";
  SymbolKind2[SymbolKind2["Function"] = 12] = "Function";
  SymbolKind2[SymbolKind2["Variable"] = 13] = "Variable";
  SymbolKind2[SymbolKind2["Constant"] = 14] = "Constant";
  SymbolKind2[SymbolKind2["String"] = 15] = "String";
  SymbolKind2[SymbolKind2["Number"] = 16] = "Number";
  SymbolKind2[SymbolKind2["Boolean"] = 17] = "Boolean";
  SymbolKind2[SymbolKind2["Array"] = 18] = "Array";
  SymbolKind2[SymbolKind2["Object"] = 19] = "Object";
  SymbolKind2[SymbolKind2["Key"] = 20] = "Key";
  SymbolKind2[SymbolKind2["Null"] = 21] = "Null";
  SymbolKind2[SymbolKind2["EnumMember"] = 22] = "EnumMember";
  SymbolKind2[SymbolKind2["Struct"] = 23] = "Struct";
  SymbolKind2[SymbolKind2["Event"] = 24] = "Event";
  SymbolKind2[SymbolKind2["Operator"] = 25] = "Operator";
  SymbolKind2[SymbolKind2["TypeParameter"] = 26] = "TypeParameter";
})(SymbolKind || (SymbolKind = {}));
function isAstNodeLike(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasCstRange(value) {
  if (value == null || typeof value !== "object")
    return false;
  const cst = value.__cst;
  return cst != null && typeof cst === "object" && "range" in cst;
}
function parseResult(value, diagnostics) {
  return { value, diagnostics };
}
var WILDCARD_KEY = "__wildcardPrefixes__";
function attachWildcardPrefixes(schema2, prefixes) {
  Object.defineProperty(schema2, WILDCARD_KEY, {
    value: prefixes,
    enumerable: false,
    writable: false,
    configurable: false
  });
}
function getWildcardPrefixes(schema2) {
  return schema2[WILDCARD_KEY] ?? [];
}
function resolveWildcardField(schema2, fieldName) {
  for (const { prefix: prefix2, fieldType } of getWildcardPrefixes(schema2)) {
    if (fieldName.startsWith(prefix2) && fieldName.length > prefix2.length) {
      return fieldType;
    }
  }
  return void 0;
}
function keywordNames(keywords) {
  return keywords.map((k) => k.keyword);
}
function hasDiscriminant(value) {
  return !!value.discriminantField && !!value.resolveSchemaForDiscriminant;
}
var NAMED_MAP_BRAND = Symbol.for("agentscript.NamedMap");
function isNamedMap(value) {
  if (value == null || typeof value !== "object")
    return false;
  return Object.prototype.hasOwnProperty.call(value, NAMED_MAP_BRAND) && Reflect.get(value, NAMED_MAP_BRAND) === true;
}
function isSingularFieldType(_ft) {
  return true;
}
function isCollectionFieldType(ft) {
  return ft.__isCollection === true;
}
function isNamedCollectionFieldType(ft) {
  return "__isNamedCollection" in ft && ft.__isNamedCollection === true;
}
function buildKindToSchemaKey(schema2) {
  const map = /* @__PURE__ */ new Map();
  for (const [schemaKey, fieldType] of Object.entries(schema2)) {
    if ("kind" in fieldType && typeof fieldType.kind === "string") {
      map.set(fieldType.kind, schemaKey);
    }
    if (isCollectionFieldType(fieldType)) {
      const entryKind = fieldType.entryBlock.kind;
      if (entryKind) {
        map.set(entryKind, schemaKey);
      }
    }
  }
  return map;
}

// ../language/dist/core/children.js
var FieldChild = class {
  constructor(key, value, _fieldType, entryName, __keyRange) {
    __publicField(this, "key");
    __publicField(this, "_fieldType");
    __publicField(this, "entryName");
    __publicField(this, "__keyRange");
    __publicField(this, "__type", "field");
    __publicField(this, "_value");
    /** Original CST mapping_element text for verbatim emission. */
    __publicField(this, "__elementText");
    /** Column of the original CST mapping_element for verbatim emission. */
    __publicField(this, "__elementColumn");
    this.key = key;
    this._fieldType = _fieldType;
    this.entryName = entryName;
    this.__keyRange = __keyRange;
    this._value = value;
  }
  get value() {
    return this._value;
  }
  set value(newValue) {
    this._value = newValue;
    this.__elementText = void 0;
    this.__elementColumn = void 0;
  }
  __emit(ctx) {
    if (this.__elementText != null && this.__elementColumn != null) {
      return emitRawTextVerbatim(this.__elementText, this.__elementColumn, ctx);
    }
    const val = this.value;
    let emitted;
    const carrier = val;
    if (this.entryName && isNamedBlockValue(val)) {
      emitted = val.emitWithKey(this.key, ctx);
      return wrapWithComments(emitted, carrier, ctx, 1);
    }
    if (this._fieldType.emitField) {
      emitted = this._fieldType.emitField(this.key, val, ctx);
      return wrapWithComments(emitted, carrier, ctx, 1);
    }
    const indent = emitIndent(ctx);
    emitted = `${indent}${this.key}: ${this._fieldType.emit(val, ctx)}`;
    return wrapWithComments(emitted, carrier, ctx, 1);
  }
};
function attachElementText(child, elementNode) {
  child.__elementText = normalizeRawText(elementNode.text, elementNode.startPosition.column);
  child.__elementColumn = elementNode.startPosition.column;
}
var MapEntryChild = class {
  constructor(name, value) {
    __publicField(this, "name");
    __publicField(this, "__type", "map_entry");
    __publicField(this, "value");
    /** Original CST mapping_element text for verbatim emission. */
    __publicField(this, "__elementText");
    /** Column of the original CST mapping_element for verbatim emission. */
    __publicField(this, "__elementColumn");
    this.name = name;
    this.value = value;
  }
  __emit(ctx) {
    if (this.__elementText != null && this.__elementColumn != null) {
      return emitRawTextVerbatim(this.__elementText, this.__elementColumn, ctx);
    }
    const v = this.value;
    if (isEmittable(v)) {
      return wrapWithComments(v.__emit(ctx), v, ctx);
    }
    if (v != null) {
      console.warn(`MapEntryChild '${this.name}': value is non-null but missing __emit \u2014 entry will be dropped from emission`);
    }
    return "";
  }
};
var MapIndex = class {
  /** Build a fresh index from the current `children` array. */
  ensure(children) {
    const index = /* @__PURE__ */ new Map();
    for (const child of children) {
      if (child instanceof MapEntryChild) {
        index.set(child.name, child);
      }
    }
    return index;
  }
};
var SequenceItemChild = class {
  constructor(value) {
    __publicField(this, "__type", "sequence_item");
    __publicField(this, "value");
    this.value = value;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    const childIndent = emitIndent(childCtx);
    const item = this.value;
    if (isEmittable(item) && "__symbol" in item) {
      const rawOutput = item.__emit(childCtx);
      const lines = rawOutput.split("\n");
      lines[0] = `${indent}- ${lines[0].slice(childIndent.length)}`;
      const continuationIndent = indent + "  ";
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith(childIndent)) {
          lines[i] = continuationIndent + lines[i].slice(childIndent.length);
        }
      }
      return lines.join("\n");
    }
    if (isEmittable(item)) {
      return `${indent}- ${item.__emit({ ...ctx, indent: 0 })}`;
    }
    return "";
  }
};
function countLeadingWsChars(line) {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 32 || c === 9) {
      count++;
    } else {
      break;
    }
  }
  return count;
}
function normalizeRawText(rawText, baseIndent) {
  const lines = rawText.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length <= 1)
    return lines.join("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const wsChars = countLeadingWsChars(line);
    if (wsChars >= baseIndent) {
      lines[i] = line.slice(baseIndent);
    } else {
      lines[i] = line.trimStart();
    }
  }
  return lines.join("\n");
}
function emitRawTextVerbatim(rawText, _originalIndent, ctx) {
  const indent = emitIndent(ctx);
  const lines = rawText.split("\n");
  return lines.map((line, i) => {
    if (i === 0) {
      const stripped2 = line.replace(/^\s*/, "");
      return stripped2 ? indent + stripped2 : "";
    }
    const stripped = line.replace(/^\s*/, "");
    if (!stripped)
      return "";
    const lineIndent = line.length - line.trimStart().length;
    return indent + " ".repeat(lineIndent) + stripped;
  }).join("\n");
}
var ErrorBlock = class {
  constructor(rawText, originalIndent) {
    __publicField(this, "__type", "error");
    __publicField(this, "__kind", "ErrorBlock");
    __publicField(this, "__diagnostics", []);
    __publicField(this, "__cst");
    /** Normalized raw text with zero-based relative indentation. */
    __publicField(this, "rawText");
    __publicField(this, "originalIndent");
    this.rawText = normalizeRawText(rawText, originalIndent);
    this.originalIndent = originalIndent;
  }
  __emit(ctx) {
    return emitRawTextVerbatim(this.rawText, this.originalIndent, ctx);
  }
};
var UntypedBlock = class {
  constructor(key, name, rawText, originalIndent = 0) {
    __publicField(this, "key");
    __publicField(this, "__type", "untyped");
    __publicField(this, "__kind", "UntypedBlock");
    __publicField(this, "__diagnostics", []);
    __publicField(this, "__cst");
    __publicField(this, "__comments");
    /** Structured children for analysis (symbols, walkers, completions). */
    __publicField(this, "__children", []);
    /** Normalized raw text with zero-based relative indentation. */
    __publicField(this, "rawText");
    __publicField(this, "originalIndent");
    /**
     * The second key id (e.g., "billing" in "tpoic billing:").
     * Stored with __ prefix to avoid collision with defineFieldAccessors
     * which can create a `name` property accessor when a child has key "name".
     */
    __publicField(this, "__blockName");
    this.key = key;
    this.__blockName = name;
    this.rawText = rawText != null ? normalizeRawText(rawText, originalIndent) : void 0;
    this.originalIndent = originalIndent;
  }
  /**
   * Public accessor for the second key id.
   * NOTE: defineFieldAccessors may overwrite this with a getter for a child
   * named "name". Internal emission uses __blockName to avoid this.
   */
  get name() {
    return this.__blockName;
  }
  __emit(ctx) {
    if (this.rawText != null) {
      return emitRawTextVerbatim(this.rawText, this.originalIndent, ctx);
    }
    const indent = emitIndent(ctx);
    const header = this.__blockName ? `${this.key} ${this.__blockName}:` : `${this.key}:`;
    if (this.__children.length === 0)
      return `${indent}${header}`;
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    const body = this.__children.map((child) => child.__emit(childCtx)).filter(Boolean).join("\n");
    return body ? `${indent}${header}
${body}` : `${indent}${header}`;
  }
};
function untypedFieldType(rawText, originalIndent) {
  const normalizedText = normalizeRawText(rawText, originalIndent);
  return {
    __fieldKind: "Primitive",
    __accepts: [],
    parse: () => {
      throw new Error("UntypedFieldType cannot parse");
    },
    emit: (value, ctx) => {
      if (isEmittable(value)) {
        return value.__emit(ctx);
      }
      return String(value ?? "");
    },
    emitField: (_key, _value, ctx) => {
      return emitRawTextVerbatim(normalizedText, originalIndent, ctx);
    }
  };
}
var ValueChild = class {
  constructor(value) {
    __publicField(this, "__type", "value");
    __publicField(this, "value");
    this.value = value;
  }
  /** Value emission is handled inline by the parent; this is a no-op. */
  __emit(_ctx) {
    return "";
  }
};
var StatementChild = class {
  constructor(statement) {
    __publicField(this, "__type", "statement");
    __publicField(this, "value");
    this.value = statement;
  }
  __emit(ctx) {
    const v = this.value;
    if (isEmittable(v)) {
      return wrapWithComments(v.__emit(ctx), v, ctx);
    }
    return "";
  }
};
function isBlockChild(value) {
  return value != null && typeof value === "object" && "__type" in value;
}
function isNamedBlockValue(v) {
  return v != null && typeof v === "object" && "__kind" in v && "emitWithKey" in v && typeof v.emitWithKey === "function";
}
function isEmittable(value) {
  return value != null && typeof value === "object" && "__emit" in value && typeof value.__emit === "function";
}
function isSingularBlock(value) {
  return isEmittable(value) && "__kind" in value && typeof value.__kind === "string" && "__children" in value && !("__name" in value && typeof value.__name === "string");
}
function emitChildren(children, ctx, sep = "\n") {
  return children.map((c) => c.__emit(ctx)).filter(Boolean).join(sep);
}
function defineFieldAccessors(block, children) {
  const defined = /* @__PURE__ */ new Set();
  for (const child of children) {
    if (child.__type !== "field")
      continue;
    const fc = child;
    if (fc.entryName)
      continue;
    if (defined.has(fc.key))
      continue;
    defined.add(fc.key);
    Object.defineProperty(block, fc.key, {
      get() {
        return fc.value;
      },
      set(newValue) {
        fc.value = newValue;
      },
      enumerable: true,
      configurable: true
    });
  }
}
function wireBlockProperties(block, children, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (isNamedMap(value)) {
      block[key] = value;
    }
  }
  defineFieldAccessors(block, children);
}
function initChildren(block, parseChildren, fields, schema2) {
  if (parseChildren) {
    wireBlockProperties(block, parseChildren, fields);
    return parseChildren;
  }
  const children = [];
  for (const [key, fieldType] of Object.entries(schema2)) {
    const value = fields[key];
    if (value !== void 0) {
      children.push(new FieldChild(key, value, fieldType));
    }
  }
  wireBlockProperties(block, children, fields);
  return children;
}
function extractChildren(parsed) {
  const { __children, ...fields } = parsed;
  return { fields, children: __children };
}

// ../language/dist/core/expressions.js
var _StringLiteral = class _StringLiteral extends AstNodeBase {
  constructor(value) {
    super();
    __publicField(this, "value");
    __publicField(this, "__kind", _StringLiteral.kind);
    this.value = value;
  }
  __describe() {
    return `string "${this.value}"`;
  }
  __emit(_ctx) {
    const cstText = this.__cst?.node?.text;
    if (cstText) {
      const quote = cstText[0];
      if ((quote === '"' || quote === "'") && cstText.length > 1 && cstText.endsWith(quote)) {
        return cstText;
      }
    }
    const escaped = this.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
    return `"${escaped}"`;
  }
  static parse(node) {
    let value = "";
    for (const child of node.namedChildren) {
      if (child.type === "string_content") {
        value += child.text;
      } else if (child.type === "escape_sequence") {
        if (child.text === '\\"')
          value += '"';
        else if (child.text === "\\'")
          value += "'";
        else if (child.text === "\\\\")
          value += "\\";
        else if (child.text === "\\n")
          value += "\n";
        else if (child.text === "\\t")
          value += "	";
        else if (child.text === "\\r")
          value += "\r";
      }
    }
    const parsed = withCst(new _StringLiteral(value), node);
    const hasRawNewlines = node.startRow !== node.endRow;
    if (hasRawNewlines) {
      parsed.__diagnostics = [
        createDiagnostic(node, "String literals must not contain raw newlines. Use template syntax (| ...) for multi-line content.", DiagnosticSeverity.Error, "string-contains-newline")
      ];
    }
    return parsed;
  }
};
__publicField(_StringLiteral, "kind", "StringLiteral");
__publicField(_StringLiteral, "kindLabel", "a string");
var StringLiteral = _StringLiteral;
var _TemplateText = class _TemplateText extends AstNodeBase {
  constructor(value) {
    super();
    __publicField(this, "value");
    __publicField(this, "__kind", _TemplateText.kind);
    this.value = value;
  }
  __describe() {
    const preview = this.value.slice(0, 20);
    return `template text "${preview}${this.value.length > 20 ? "..." : ""}"`;
  }
  __emit(_ctx) {
    return this.value;
  }
};
__publicField(_TemplateText, "kind", "TemplateText");
__publicField(_TemplateText, "kindLabel", "template text");
var TemplateText = _TemplateText;
var _TemplateInterpolation = class _TemplateInterpolation extends AstNodeBase {
  constructor(expression) {
    super();
    __publicField(this, "expression");
    __publicField(this, "__kind", _TemplateInterpolation.kind);
    this.expression = expression;
  }
  __describe() {
    return `interpolation {!${this.expression.__describe()}}`;
  }
  __emit(ctx) {
    return `{!${this.expression.__emit(ctx)}}`;
  }
};
__publicField(_TemplateInterpolation, "kind", "TemplateInterpolation");
__publicField(_TemplateInterpolation, "kindLabel", "template interpolation");
var TemplateInterpolation = _TemplateInterpolation;
var ALL_TEMPLATE_PART_CLASSES = [
  TemplateText,
  TemplateInterpolation
];
var TEMPLATE_PART_KINDS = new Set(ALL_TEMPLATE_PART_CLASSES.map((C) => C.kind));
var TEMPLATE_PART_KIND_STRINGS = TEMPLATE_PART_KINDS;
function isTemplatePartKind(kind) {
  return TEMPLATE_PART_KIND_STRINGS.has(kind);
}
function parseTemplateParts(node, parseExpr) {
  const parts = [];
  const diagnostics = [];
  for (const child of node.namedChildren) {
    if (child.type === "template_content") {
      parts.push(withCst(new TemplateText(child.text), child));
    } else if (child.type === "template_expression") {
      const exprNode = child.childForFieldName("expression");
      if (exprNode) {
        parts.push(withCst(new TemplateInterpolation(parseExpr(exprNode)), child));
      } else {
        diagnostics.push(createDiagnostic(child, "Malformed template interpolation: missing expression", DiagnosticSeverity.Warning, "malformed-interpolation"));
        parts.push(withCst(new TemplateText(child.text), child));
      }
    } else {
      diagnostics.push(createDiagnostic(child, `Unexpected node in template: ${child.type}`, DiagnosticSeverity.Warning, "unexpected-template-node"));
    }
  }
  dedentTemplateParts(parts, node);
  return { parts, diagnostics };
}
function dedentTemplateParts(parts, node) {
  const fullText = parts.map((p) => p instanceof TemplateText ? p.value : "X").join("");
  const firstNewline = fullText.indexOf("\n");
  if (firstNewline !== -1) {
    const lines = fullText.split("\n");
    const pipeColumn = node.startPosition?.column;
    let stripAmount;
    if (pipeColumn !== void 0) {
      const firstLineIndent = lines[0].match(/^(\s*)/)?.[1]?.length ?? 0;
      stripAmount = pipeColumn + 1 + firstLineIndent;
    } else {
      let minIndent = Infinity;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().length === 0)
          continue;
        const indent = lines[i].search(/\S/);
        if (indent >= 0)
          minIndent = Math.min(minIndent, indent);
      }
      stripAmount = minIndent === Infinity ? 0 : minIndent;
    }
    if (stripAmount > 0) {
      let globalLineIndex = 0;
      let atLineStart = true;
      for (const part of parts) {
        if (!(part instanceof TemplateText)) {
          atLineStart = false;
          continue;
        }
        const text = part.value;
        const partLines = text.split("\n");
        for (let i = 0; i < partLines.length; i++) {
          if (i > 0) {
            globalLineIndex++;
            atLineStart = true;
          }
          if (atLineStart && globalLineIndex > 0 && partLines[i].length > 0) {
            const lineIndent = partLines[i].search(/\S|$/);
            partLines[i] = partLines[i].slice(Math.min(lineIndent, stripAmount));
          }
        }
        atLineStart = partLines[partLines.length - 1].length === 0;
        part.value = partLines.join("\n");
      }
    }
  }
  cleanTemplateParts(parts);
}
function cleanTemplateParts(parts) {
  if (parts.length === 0)
    return;
  const firstText = parts.find((p) => p instanceof TemplateText);
  if (firstText) {
    firstText.value = stripLeadingNewlines(firstText.value);
    firstText.value = trimFirstLineWhitespace(firstText.value);
  }
  normalizeBlankLines(parts);
  trimTrailingTextWhitespace(parts);
}
function stripLeadingNewlines(value) {
  const leadingNewlines = value.match(/^\n+/)?.[0]?.length ?? 0;
  const stripped = value.replace(/^\n+/, "");
  return leadingNewlines >= 2 ? "\n" + stripped : stripped;
}
function trimFirstLineWhitespace(value) {
  const nlPos = value.indexOf("\n");
  if (nlPos === -1)
    return value.trimStart();
  return value.slice(0, nlPos).trimStart() + value.slice(nlPos);
}
function normalizeBlankLines(parts) {
  for (const part of parts) {
    if (!(part instanceof TemplateText))
      continue;
    const tp = part;
    const partLines = tp.value.split("\n");
    for (let i = 1; i < partLines.length; i++) {
      if (partLines[i].trim().length === 0) {
        partLines[i] = "";
      }
    }
    tp.value = partLines.join("\n");
  }
}
function trimTrailingTextWhitespace(parts) {
  const lastPart = parts[parts.length - 1];
  if (lastPart instanceof TemplateText) {
    lastPart.value = lastPart.value.trimEnd();
  }
}
var _TemplateExpression = class _TemplateExpression extends AstNodeBase {
  constructor(parts) {
    super();
    __publicField(this, "parts");
    __publicField(this, "__kind", _TemplateExpression.kind);
    /**
     * When true, the `|` was on its own line with content on following lines.
     * Detected from CST text: `|` followed by only whitespace/newline before content.
     */
    __publicField(this, "barePipeMultiline", false);
    /**
     * When true, emit a space between `|` and the content (e.g. `| Hello`).
     * Detected from CST source text during parse; defaults to false for
     * programmatically constructed templates.
     */
    __publicField(this, "spaceAfterPipe", false);
    this.parts = parts;
  }
  get content() {
    return this.parts.map((p) => p.__emit({ indent: 0 })).join("");
  }
  __describe() {
    const c = this.content;
    const preview = c.slice(0, 20);
    return `template "${preview}${c.length > 20 ? "..." : ""}"`;
  }
  __emit(ctx) {
    const rawInner = this.parts.map((p) => p.__emit(ctx)).join("");
    const childIndent = emitIndent({ ...ctx, indent: ctx.indent + 1 });
    const lines = rawInner.split("\n");
    if (this.barePipeMultiline && lines.length > 0) {
      const allReindented = lines.map((line) => {
        if (line.trim().length === 0)
          return "";
        return childIndent + line;
      }).join("\n");
      return `|
${allReindented}`;
    }
    const sep = this.spaceAfterPipe ? " " : "";
    return lines.map((line, i) => {
      if (i === 0)
        return line.length > 0 ? `|${sep}${line}` : "|";
      if (line.trim().length === 0)
        return "";
      return `${childIndent}${line}`;
    }).join("\n");
  }
  static parse(node, parseExpr) {
    const { parts, diagnostics } = parseTemplateParts(node, parseExpr);
    const expr = withCst(new _TemplateExpression(parts), node);
    const nodeText = node.text;
    if (nodeText && parts.length > 0) {
      const afterPipe = nodeText.slice(1);
      const firstNonWs = afterPipe.search(/\S/);
      if (firstNonWs > 0 && afterPipe.slice(0, firstNonWs).includes("\n")) {
        expr.barePipeMultiline = true;
      }
      if (!expr.barePipeMultiline && afterPipe.length > 0 && afterPipe[0] === " ") {
        expr.spaceAfterPipe = true;
      }
    }
    expr.__diagnostics.push(...diagnostics);
    return expr;
  }
};
__publicField(_TemplateExpression, "kind", "TemplateExpression");
__publicField(_TemplateExpression, "kindLabel", "a template");
var TemplateExpression = _TemplateExpression;
var _NumberLiteral = class _NumberLiteral extends AstNodeBase {
  constructor(value) {
    super();
    __publicField(this, "value");
    __publicField(this, "__kind", _NumberLiteral.kind);
    this.value = value;
  }
  __describe() {
    return `number ${this.value}`;
  }
  __emit(_ctx) {
    if (this.__cst) {
      return this.__cst.node.text;
    }
    return String(this.value);
  }
  static parse(node) {
    return withCst(new _NumberLiteral(Number(node.text)), node);
  }
};
__publicField(_NumberLiteral, "kind", "NumberLiteral");
__publicField(_NumberLiteral, "kindLabel", "a number");
var NumberLiteral = _NumberLiteral;
var _BooleanLiteral = class _BooleanLiteral extends AstNodeBase {
  constructor(value) {
    super();
    __publicField(this, "value");
    __publicField(this, "__kind", _BooleanLiteral.kind);
    this.value = value;
  }
  __describe() {
    return this.value ? "True" : "False";
  }
  __emit(_ctx) {
    return this.value ? "True" : "False";
  }
  static parse(node) {
    return withCst(new _BooleanLiteral(node.text === "True"), node);
  }
};
__publicField(_BooleanLiteral, "kind", "BooleanLiteral");
__publicField(_BooleanLiteral, "kindLabel", "True or False");
var BooleanLiteral = _BooleanLiteral;
var _NoneLiteral = class _NoneLiteral extends AstNodeBase {
  constructor() {
    super(...arguments);
    __publicField(this, "__kind", _NoneLiteral.kind);
  }
  __describe() {
    return "None";
  }
  __emit(_ctx) {
    return "None";
  }
  static parse(node) {
    return withCst(new _NoneLiteral(), node);
  }
};
__publicField(_NoneLiteral, "kind", "NoneLiteral");
__publicField(_NoneLiteral, "kindLabel", "None");
var NoneLiteral = _NoneLiteral;
var _Identifier = class _Identifier extends AstNodeBase {
  constructor(name) {
    super();
    __publicField(this, "name");
    __publicField(this, "__kind", _Identifier.kind);
    this.name = name;
  }
  __describe() {
    return `identifier "${this.name}"`;
  }
  __emit(_ctx) {
    return this.name;
  }
  static parse(node) {
    return withCst(new _Identifier(node.text), node);
  }
};
__publicField(_Identifier, "kind", "Identifier");
__publicField(_Identifier, "kindLabel", "an identifier");
var Identifier = _Identifier;
var _ErrorValue = class _ErrorValue extends AstNodeBase {
  constructor(rawText) {
    super();
    __publicField(this, "rawText");
    __publicField(this, "__kind", _ErrorValue.kind);
    this.rawText = rawText;
  }
  __describe() {
    return `error value: ${this.rawText}`;
  }
  __emit(_ctx) {
    return this.rawText;
  }
};
__publicField(_ErrorValue, "kind", "ErrorValue");
__publicField(_ErrorValue, "kindLabel", "an error value");
var ErrorValue = _ErrorValue;
var _AtIdentifier = class _AtIdentifier extends AstNodeBase {
  constructor(name) {
    super();
    __publicField(this, "name");
    __publicField(this, "__kind", _AtIdentifier.kind);
    this.name = name;
  }
  __describe() {
    return `reference @${this.name}`;
  }
  __emit(_ctx) {
    return `@${this.name}`;
  }
  static parse(node) {
    const idNode = node.namedChildren.find((n) => n.type === "id");
    const name = idNode?.text ?? node.text.slice(1);
    return withCst(new _AtIdentifier(name), node);
  }
};
__publicField(_AtIdentifier, "kind", "AtIdentifier");
__publicField(_AtIdentifier, "kindLabel", "a reference (e.g., @Foo)");
var AtIdentifier = _AtIdentifier;
var _MemberExpression = class _MemberExpression extends AstNodeBase {
  constructor(object2, property) {
    super();
    __publicField(this, "object");
    __publicField(this, "property");
    __publicField(this, "__kind", _MemberExpression.kind);
    this.object = object2;
    this.property = property;
  }
  __describe() {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    return `${this.object.__emit(ctx)}.${this.property}`;
  }
  static parse(node, parseExpr) {
    const children = node.namedChildren;
    const objectNode = children[0];
    const propertyNode = children.find((n) => n.type === "id");
    const object2 = parseExpr(objectNode);
    const property = propertyNode?.text ?? "";
    return withCst(new _MemberExpression(object2, property), node);
  }
};
__publicField(_MemberExpression, "kind", "MemberExpression");
__publicField(_MemberExpression, "kindLabel", "a reference (e.g., @Foo.Bar)");
var MemberExpression = _MemberExpression;
var _SubscriptExpression = class _SubscriptExpression extends AstNodeBase {
  constructor(object2, index) {
    super();
    __publicField(this, "object");
    __publicField(this, "index");
    __publicField(this, "__kind", _SubscriptExpression.kind);
    this.object = object2;
    this.index = index;
  }
  __describe() {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    return `${this.object.__emit(ctx)}[${this.index.__emit(ctx)}]`;
  }
  static parse(node, parseExpr) {
    const children = node.namedChildren;
    const object2 = parseExpr(children[0]);
    const index = parseExpr(children[1]);
    return withCst(new _SubscriptExpression(object2, index), node);
  }
};
__publicField(_SubscriptExpression, "kind", "SubscriptExpression");
__publicField(_SubscriptExpression, "kindLabel", "a subscript expression");
var SubscriptExpression = _SubscriptExpression;
var _BinaryExpression = class _BinaryExpression extends AstNodeBase {
  constructor(left, operator, right) {
    super();
    __publicField(this, "left");
    __publicField(this, "operator");
    __publicField(this, "right");
    __publicField(this, "__kind", _BinaryExpression.kind);
    this.left = left;
    this.operator = operator;
    this.right = right;
  }
  __describe() {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    return `${this.left.__emit(ctx)} ${this.operator} ${this.right.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const children = node.namedChildren;
    const left = parseExpr(children[0]);
    const right = parseExpr(children[1]);
    const operators = ["+", "-", "*", "/", "and", "or"];
    let operator = "+";
    for (const child of node.children) {
      if (child.isNamed)
        continue;
      const matched = operators.find((op) => op === child.text);
      if (matched) {
        operator = matched;
        break;
      }
    }
    return withCst(new _BinaryExpression(left, operator, right), node);
  }
};
__publicField(_BinaryExpression, "kind", "BinaryExpression");
__publicField(_BinaryExpression, "kindLabel", "a binary expression");
var BinaryExpression = _BinaryExpression;
var _UnaryExpression = class _UnaryExpression extends AstNodeBase {
  constructor(operator, operand) {
    super();
    __publicField(this, "operator");
    __publicField(this, "operand");
    __publicField(this, "__kind", _UnaryExpression.kind);
    this.operator = operator;
    this.operand = operand;
  }
  __describe() {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    if (this.operator === "not") {
      return `not ${this.operand.__emit(ctx)}`;
    }
    return `${this.operator}${this.operand.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const children = node.namedChildren;
    const operand = parseExpr(children[0]);
    let operator = "not";
    if (node.text.startsWith("not "))
      operator = "not";
    else if (node.text.startsWith("-"))
      operator = "-";
    else if (node.text.startsWith("+"))
      operator = "+";
    return withCst(new _UnaryExpression(operator, operand), node);
  }
};
__publicField(_UnaryExpression, "kind", "UnaryExpression");
__publicField(_UnaryExpression, "kindLabel", "a unary expression");
var UnaryExpression = _UnaryExpression;
var _ComparisonExpression = class _ComparisonExpression extends AstNodeBase {
  constructor(left, operator, right) {
    super();
    __publicField(this, "left");
    __publicField(this, "operator");
    __publicField(this, "right");
    __publicField(this, "__kind", _ComparisonExpression.kind);
    this.left = left;
    this.operator = operator;
    this.right = right;
  }
  __describe() {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    return `${this.left.__emit(ctx)} ${this.operator} ${this.right.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const operands = node.namedChildren.filter((c) => !c.isError);
    const left = parseExpr(operands[0]);
    const right = operands.length > 1 ? parseExpr(operands[1]) : left;
    const opParts = [];
    for (const child of node.children) {
      if (child === operands[0] || child === operands[1])
        continue;
      if (child.isError) {
        opParts.push(child.text.trim());
      } else if (!child.isNamed) {
        opParts.push(child.text.trim());
      }
    }
    const opText = opParts.filter((p) => p.length > 0).join(" ");
    const operator = opText || "==";
    return withCst(new _ComparisonExpression(left, operator, right), node);
  }
};
__publicField(_ComparisonExpression, "kind", "ComparisonExpression");
__publicField(_ComparisonExpression, "kindLabel", "a comparison");
var ComparisonExpression = _ComparisonExpression;
var _ListLiteral = class _ListLiteral extends AstNodeBase {
  constructor(elements) {
    super();
    __publicField(this, "elements");
    __publicField(this, "__kind", _ListLiteral.kind);
    this.elements = elements;
  }
  __describe() {
    return `list ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    const items = this.elements.map((e) => e.__emit(ctx)).join(", ");
    return `[${items}]`;
  }
  static parse(node, parseExpr) {
    const elements = [];
    for (const child of node.namedChildren) {
      elements.push(parseExpr(child));
    }
    return withCst(new _ListLiteral(elements), node);
  }
};
__publicField(_ListLiteral, "kind", "ListLiteral");
__publicField(_ListLiteral, "kindLabel", "a list");
var ListLiteral = _ListLiteral;
var _DictLiteral = class _DictLiteral extends AstNodeBase {
  constructor(entries) {
    super();
    __publicField(this, "entries");
    __publicField(this, "__kind", _DictLiteral.kind);
    this.entries = entries;
  }
  __describe() {
    return `dictionary ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    const items = this.entries.map((e) => `${e.key.__emit(ctx)}: ${e.value.__emit(ctx)}`).join(", ");
    return `{${items}}`;
  }
  static parse(node, parseExpr) {
    const entries = [];
    for (const child of node.namedChildren) {
      if (child.type === "dictionary_pair") {
        const rawKeyNode = child.childForFieldName("key");
        const keyNode = rawKeyNode?.type === "key" && rawKeyNode.namedChildren.length > 0 ? rawKeyNode.namedChildren[0] : rawKeyNode;
        const valueNode = child.childForFieldName("value");
        if (keyNode && valueNode) {
          entries.push(withCst({ key: parseExpr(keyNode), value: parseExpr(valueNode) }, child));
        }
      }
    }
    return withCst(new _DictLiteral(entries), node);
  }
};
__publicField(_DictLiteral, "kind", "DictLiteral");
__publicField(_DictLiteral, "kindLabel", "a dictionary");
var DictLiteral = _DictLiteral;
var _CallExpression = class _CallExpression extends AstNodeBase {
  constructor(func, args) {
    super();
    __publicField(this, "func");
    __publicField(this, "args");
    __publicField(this, "__kind", _CallExpression.kind);
    this.func = func;
    this.args = args;
  }
  __describe() {
    return `call ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    const argsStr = this.args.map((a) => a.__emit(ctx)).join(", ");
    return `${this.func.__emit(ctx)}(${argsStr})`;
  }
  static parse(node, parseExpr) {
    const funcNode = node.childForFieldName("function");
    const func = funcNode ? parseExpr(funcNode) : new Identifier("");
    const args = [];
    for (const child of node.childrenForFieldName("argument")) {
      args.push(parseExpr(child));
    }
    return withCst(new _CallExpression(func, args), node);
  }
};
__publicField(_CallExpression, "kind", "CallExpression");
__publicField(_CallExpression, "kindLabel", "a function call");
var CallExpression = _CallExpression;
var _TernaryExpression = class _TernaryExpression extends AstNodeBase {
  constructor(consequence, condition, alternative) {
    super();
    __publicField(this, "consequence");
    __publicField(this, "condition");
    __publicField(this, "alternative");
    __publicField(this, "__kind", _TernaryExpression.kind);
    this.consequence = consequence;
    this.condition = condition;
    this.alternative = alternative;
  }
  __describe() {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
  __emit(ctx) {
    return `${this.consequence.__emit(ctx)} if ${this.condition.__emit(ctx)} else ${this.alternative.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const consequenceNode = node.childForFieldName("consequence");
    const conditionNode = node.childForFieldName("condition");
    const alternativeNode = node.childForFieldName("alternative");
    const consequence = consequenceNode ? parseExpr(consequenceNode) : new Identifier("");
    const condition = conditionNode ? parseExpr(conditionNode) : new Identifier("");
    const alternative = alternativeNode ? parseExpr(alternativeNode) : new Identifier("");
    return withCst(new _TernaryExpression(consequence, condition, alternative), node);
  }
};
__publicField(_TernaryExpression, "kind", "TernaryExpression");
__publicField(_TernaryExpression, "kindLabel", "a ternary expression");
var TernaryExpression = _TernaryExpression;
var _Ellipsis = class _Ellipsis extends AstNodeBase {
  constructor() {
    super(...arguments);
    __publicField(this, "__kind", _Ellipsis.kind);
  }
  __describe() {
    return "ellipsis (...)";
  }
  __emit(_ctx) {
    return "...";
  }
  static parse(node) {
    return withCst(new _Ellipsis(), node);
  }
};
__publicField(_Ellipsis, "kind", "Ellipsis");
__publicField(_Ellipsis, "kindLabel", "an ellipsis (...)");
var Ellipsis = _Ellipsis;
var _SpreadExpression = class _SpreadExpression extends AstNodeBase {
  constructor(expression) {
    super();
    __publicField(this, "expression");
    __publicField(this, "__kind", _SpreadExpression.kind);
    this.expression = expression;
  }
  __describe() {
    return `spread *${this.expression.__describe()}`;
  }
  __emit(ctx) {
    return `*${this.expression.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const exprNode = node.childForFieldName("expression");
    if (exprNode) {
      return withCst(new _SpreadExpression(parseExpr(exprNode)), node);
    }
    const inner = withCst(new ErrorValue(""), node);
    inner.__diagnostics.push(createDiagnostic(node, "Spread operator `*` requires an expression to unpack", DiagnosticSeverity.Error, "spread-missing-expression"));
    return withCst(new _SpreadExpression(inner), node);
  }
};
__publicField(_SpreadExpression, "kind", "SpreadExpression");
__publicField(_SpreadExpression, "kindLabel", "a spread expression");
var SpreadExpression = _SpreadExpression;
function isMemberExpression(expr) {
  return expr instanceof MemberExpression;
}
function isAtIdentifier(expr) {
  return expr instanceof AtIdentifier;
}
function decomposeMemberExpression(expr, knownNamespaces) {
  if (!isMemberExpression(expr))
    return null;
  if (!expr.property)
    return null;
  if (isAtIdentifier(expr.object)) {
    return { namespace: expr.object.name, property: expr.property };
  }
  if (knownNamespaces && expr.object instanceof Identifier && knownNamespaces.has(expr.object.name)) {
    return { namespace: expr.object.name, property: expr.property };
  }
  return null;
}
function decomposeAtMemberExpression(expr) {
  return decomposeMemberExpression(expr);
}
var ALL_EXPRESSION_CLASSES = [
  StringLiteral,
  TemplateExpression,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  TernaryExpression,
  CallExpression,
  ListLiteral,
  DictLiteral,
  Ellipsis,
  SpreadExpression
];
var EXPRESSION_KINDS = new Set(ALL_EXPRESSION_CLASSES.map((C) => C.kind));
var KIND_LABELS = new Map(ALL_EXPRESSION_CLASSES.map((C) => [C.kind, C.kindLabel]));
var EXPRESSION_KIND_STRINGS = EXPRESSION_KINDS;
function isExpressionKind(kind) {
  return EXPRESSION_KIND_STRINGS.has(kind);
}
var expressionParsers = {
  string: (node) => StringLiteral.parse(node),
  template: (node, parseExpr) => TemplateExpression.parse(node, parseExpr),
  number: (node) => NumberLiteral.parse(node),
  True: (node) => BooleanLiteral.parse(node),
  False: (node) => BooleanLiteral.parse(node),
  None: (node) => NoneLiteral.parse(node),
  ellipsis: (node) => Ellipsis.parse(node),
  id: (node) => Identifier.parse(node),
  at_id: (node) => AtIdentifier.parse(node),
  member_expression: (node, parseExpr) => MemberExpression.parse(node, parseExpr),
  subscript_expression: (node, parseExpr) => SubscriptExpression.parse(node, parseExpr),
  binary_expression: (node, parseExpr) => BinaryExpression.parse(node, parseExpr),
  unary_expression: (node, parseExpr) => UnaryExpression.parse(node, parseExpr),
  comparison_expression: (node, parseExpr) => ComparisonExpression.parse(node, parseExpr),
  ternary_expression: (node, parseExpr) => TernaryExpression.parse(node, parseExpr),
  call_expression: (node, parseExpr) => CallExpression.parse(node, parseExpr),
  list: (node, parseExpr) => ListLiteral.parse(node, parseExpr),
  dictionary: (node, parseExpr) => DictLiteral.parse(node, parseExpr),
  spread_expression: (node, parseExpr) => SpreadExpression.parse(node, parseExpr)
};

// ../language/dist/lint/lint-utils.js
var LINT_SOURCE = "agentscript-lint";
var SUGGESTION_THRESHOLD = 0.4;
function levenshtein(a, b) {
  if (a === b)
    return 0;
  if (a.length === 0)
    return b.length;
  if (b.length === 0)
    return a.length;
  if (a.length > b.length) {
    [a, b] = [b, a];
  }
  const aLen = a.length;
  const bLen = b.length;
  let prev = new Array(aLen + 1);
  let curr = new Array(aLen + 1);
  for (let j = 0; j <= aLen; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= bLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= aLen; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        // insertion
        prev[j] + 1,
        // deletion
        prev[j - 1] + cost
        // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[aLen];
}
function formatSuggestionHint(message, suggestion, prefix2 = "") {
  if (!suggestion)
    return message;
  return `${message}. Did you mean '${prefix2}${suggestion}'?`;
}
function findSuggestion(name, candidates) {
  if (candidates.length === 0)
    return void 0;
  let bestCandidate;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const dist = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDistance) {
      bestDistance = dist;
      bestCandidate = candidate;
    }
  }
  if (!bestCandidate)
    return void 0;
  const maxLen = Math.max(name.length, bestCandidate.length);
  if (bestDistance / maxLen > SUGGESTION_THRESHOLD)
    return void 0;
  if (bestDistance === 0) {
    return name === bestCandidate ? void 0 : bestCandidate;
  }
  return bestCandidate;
}
function resolveColinearAction(raBlock) {
  const decomposed = decomposeAtMemberExpression(raBlock.value);
  if (!decomposed || decomposed.namespace !== "actions")
    return null;
  return decomposed.property;
}
function lintDiagnostic(range, message, severity, code, options) {
  return {
    range,
    message,
    severity,
    code,
    source: LINT_SOURCE,
    ...options?.tags ? { tags: options.tags } : {},
    ...options?.suggestion ? { data: { suggestion: options.suggestion } } : {}
  };
}
function extractOutputRef(value) {
  const decomposed = decomposeAtMemberExpression(value);
  if (!decomposed || decomposed.namespace !== "outputs")
    return null;
  const cst = isAstNodeLike(value) ? value.__cst : void 0;
  return { name: decomposed.property, ...cst ? { cst } : {} };
}
function extractVariableRef(expr) {
  const decomposed = decomposeAtMemberExpression(expr);
  if (!decomposed || decomposed.namespace !== "variables")
    return null;
  return decomposed.property;
}

// ../language/dist/core/diagnostics.js
function createDiagnostic(rangeOrNode, message, severity = DiagnosticSeverity.Error, code, data) {
  let range;
  if (hasCstRange(rangeOrNode)) {
    range = rangeOrNode.__cst.range;
  } else if ("startPosition" in rangeOrNode) {
    range = toRange(rangeOrNode);
  } else if ("start" in rangeOrNode && "end" in rangeOrNode) {
    range = rangeOrNode;
  } else {
    throw new Error("createDiagnostic: expected Range, SyntaxNode, or Parsed node with __cst");
  }
  return {
    range,
    message,
    severity,
    code,
    source: "agentscript-schema",
    ...data ? { data } : {}
  };
}
function undefinedReferenceDiagnostic(range, message, referenceName, suggestion, expected) {
  const fullMessage = formatSuggestionHint(message, suggestion);
  return {
    range,
    message: fullMessage,
    severity: DiagnosticSeverity.Error,
    code: "undefined-reference",
    source: "agentscript-lint",
    data: {
      referenceName,
      ...suggestion ? { suggestion } : {},
      ...expected && expected.length > 0 ? { expected } : {}
    }
  };
}
function attachDiagnostic(node, diagnostic) {
  const arr = node.__diagnostics;
  if (Array.isArray(arr)) {
    arr.push(diagnostic);
    return;
  }
  throw new Error(`attachDiagnostic: target node lacks __diagnostics array (kind: ${node.__kind ?? "unknown"}). Ensure the node was created via withCst(), createNode(), or extends AstNodeBase.`);
}
function createParserDiagnostic(rangeOrNode, message, code) {
  const range = "startPosition" in rangeOrNode ? toRange(rangeOrNode) : rangeOrNode;
  return {
    range,
    message,
    severity: DiagnosticSeverity.Error,
    code,
    source: "parser"
  };
}
function typeMismatchDiagnostic(range, message, expectedType, actualType, source = "agentscript-schema") {
  return {
    range,
    message,
    severity: DiagnosticSeverity.Error,
    code: "type-mismatch",
    source,
    data: { expectedType, actualType }
  };
}
var DeprecatedFieldDiagnostic = class {
  constructor(range, message, replacement) {
    __publicField(this, "range");
    __publicField(this, "message");
    __publicField(this, "severity", DiagnosticSeverity.Warning);
    __publicField(this, "code", "deprecated-field");
    __publicField(this, "source", "agentscript");
    __publicField(this, "tags", [DiagnosticTag.Deprecated]);
    __publicField(this, "data");
    this.range = range;
    this.message = message;
    if (replacement) {
      this.data = { replacement };
    }
  }
};
var DiagnosticCollector = class {
  constructor() {
    __publicField(this, "all", []);
    __publicField(this, "own", []);
  }
  /** Record a diagnostic generated at this parse level. */
  add(diag) {
    this.all.push(diag);
    this.own.push(diag);
  }
  /** Incorporate diagnostics from a child parse result. */
  merge(result) {
    this.all.push(...result.diagnostics);
  }
  /** Incorporate an array of child diagnostics. */
  mergeAll(diags) {
    this.all.push(...diags);
  }
};

// ../language/dist/core/comment-attacher.js
var CommentAttacher = class {
  constructor() {
    __publicField(this, "_pending", []);
    __publicField(this, "_lastTarget");
  }
  /** Accumulate a parsed comment as a pending leading comment. */
  pushLeading(comment2) {
    this._pending.push(comment2);
  }
  /** Parse a CST comment node and accumulate it as pending leading. */
  pushLeadingNode(node) {
    this._pending.push(parseCommentNode(node, "leading"));
  }
  /**
   * Try to attach a comment node as inline on the last target
   * (same row as the target's CST end). Returns true if attached,
   * false if caller should handle it differently.
   */
  tryAttachInline(node, lastTarget) {
    if (!lastTarget?.__cst)
      return false;
    const { __cst: cst } = lastTarget;
    if (node.startRow === cst.range.end.line) {
      attach(lastTarget, [parseCommentNode(node, "inline")]);
      return true;
    }
    return false;
  }
  /**
   * Consume pending leading comments (plus optional extras) and attach
   * them to a target. Also updates the internal last-target for later flush.
   */
  consumeOnto(target, extraComments) {
    const comments = extraComments ? [...this._pending, ...extraComments] : this._pending;
    if (comments.length > 0) {
      attach(target, comments);
    }
    this._pending = [];
    this._lastTarget = target;
  }
  /**
   * Consume pending comments (plus optional extras) onto the first item
   * in an array of targets. Updates the last-target to the last item.
   */
  consumeOntoFirst(targets, extraComments) {
    if (targets.length === 0)
      return;
    const comments = extraComments ? [...this._pending, ...extraComments] : this._pending;
    if (comments.length > 0) {
      attach(targets[0], comments);
    }
    this._pending = [];
    this._lastTarget = targets[targets.length - 1];
  }
  /** Check if there are pending comments. */
  get hasPending() {
    return this._pending.length > 0;
  }
  /** Discard all pending comments without attaching them anywhere. */
  clearPending() {
    this._pending = [];
  }
  /**
   * Drain pending comments as ErrorBlock children into the given array.
   * Each comment becomes an ErrorBlock with its `# text` content preserved.
   * Used by unknown-field handling to preserve comments that would otherwise
   * be lost when UntypedBlock emits from structure instead of raw text.
   */
  drainAsErrorBlocks(target) {
    for (const comment2 of this._pending) {
      const prefix2 = comment2.range ? "#" : "# ";
      const text = `${prefix2}${comment2.value}`;
      target.push(new ErrorBlock(text, 0));
    }
    this._pending = [];
  }
  /** Replace pending with new comments (e.g., dedented comments for next field).
   *  Callers must pass an owned array (not reused after this call). */
  setPending(comments) {
    this._pending = comments;
  }
  /** Get the last target that received comments. */
  get lastTarget() {
    return this._lastTarget;
  }
  /** Set the last target manually. */
  set lastTarget(target) {
    this._lastTarget = target;
  }
  /**
   * Flush any remaining pending comments as trailing on the last target.
   * Call this at the end of a parse loop.
   */
  flush() {
    if (this._pending.length > 0 && this._lastTarget) {
      const asTrailing = this._pending.map((c) => ({
        ...c,
        attachment: "trailing"
      }));
      attach(this._lastTarget, asTrailing);
      this._pending = [];
    }
  }
};
function attach(node, comments) {
  if (!node || comments.length === 0)
    return;
  node.__comments = [...node.__comments ?? [], ...comments];
}

// ../language/dist/core/statements.js
var Template = class _Template extends AstNodeBase {
  constructor(parts) {
    super();
    __publicField(this, "parts");
    __publicField(this, "__kind", "Template");
    /**
     * When true, the `|` was on its own line with content on following lines.
     * Detected from CST: `|` followed by only whitespace/newline before content.
     */
    __publicField(this, "barePipeMultiline", false);
    /**
     * When true, emit a space between `|` and the content (e.g. `| Hello`).
     * Detected from CST source text during parse; defaults to false for
     * programmatically constructed templates.
     */
    __publicField(this, "spaceAfterPipe", false);
    this.parts = parts;
  }
  get content() {
    return this.parts.map((p) => p.__emit({ indent: 0 })).join("");
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    const rawInner = this.parts.map((p) => p.__emit(ctx)).join("");
    const childIndent = emitIndent({ ...ctx, indent: ctx.indent + 1 });
    const lines = rawInner.split("\n");
    if (this.barePipeMultiline && lines.length > 0) {
      const allReindented = lines.map((line) => {
        if (line.trim().length === 0)
          return "";
        return childIndent + line;
      }).join("\n");
      return `${indent}|
${allReindented}`;
    }
    const continuationIndent = indent + (this.spaceAfterPipe ? "  " : " ");
    const reindented = lines.map((line, i) => {
      if (i === 0)
        return line;
      if (line.trim().length === 0)
        return "";
      return continuationIndent + line;
    }).join("\n");
    const sep = this.spaceAfterPipe ? " " : "";
    const prefix2 = reindented.length > 0 ? `${indent}|${sep}` : `${indent}|`;
    return `${prefix2}${reindented}`;
  }
  static parse(node, parseExpr) {
    const { parts, diagnostics } = parseTemplateParts(node, parseExpr);
    const stmt = withCst(new _Template(parts), node);
    const nodeText = node.text;
    if (nodeText && parts.length > 0) {
      const afterPipe = nodeText.slice(1);
      const firstNonWs = afterPipe.search(/\S/);
      if (firstNonWs > 0 && afterPipe.slice(0, firstNonWs).includes("\n")) {
        stmt.barePipeMultiline = true;
      }
      if (!stmt.barePipeMultiline && afterPipe.length > 0 && afterPipe[0] === " ") {
        stmt.spaceAfterPipe = true;
      }
    }
    stmt.__diagnostics.push(...diagnostics);
    return stmt;
  }
};
var WithClause = class _WithClause extends AstNodeBase {
  constructor(param, value) {
    super();
    __publicField(this, "param");
    __publicField(this, "value");
    __publicField(this, "__kind", "WithClause");
    __publicField(this, "__paramCstNode");
    this.param = param;
    this.value = value;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    if (this.value instanceof Ellipsis && !this.value.__cst && this.__cst) {
      return `${indent}with ${emitKeyName(this.param)}`;
    }
    const hasSpaces = this.__cst?.node?.text?.includes(" = ") ?? true;
    const eq = hasSpaces ? " = " : "=";
    return `${indent}with ${emitKeyName(this.param)}${eq}${this.value.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const paramNode = node.childForFieldName("param");
    const valueNode = node.childForFieldName("value");
    const param = paramNode ? getKeyText(paramNode) : "";
    const value = valueNode ? parseExpr(valueNode) : new Ellipsis();
    const clause = withCst(new _WithClause(param, value), node);
    if (paramNode)
      clause.__paramCstNode = paramNode;
    return clause;
  }
  /** Desugar comma-separated `with x=a,y=b` into separate WithClause nodes. */
  static parseAll(node, parseExpr) {
    const paramNodes = node.childrenForFieldName("param");
    const valueNodes = node.childrenForFieldName("value");
    if (paramNodes.length <= 1) {
      return [_WithClause.parse(node, parseExpr)];
    }
    const clauses = [];
    for (let i = 0; i < paramNodes.length; i++) {
      const paramNode = paramNodes[i];
      const valueNode = valueNodes[i];
      const param = paramNode ? getKeyText(paramNode) : "";
      const value = valueNode ? parseExpr(valueNode) : new Ellipsis();
      const clause = withCst(new _WithClause(param, value), node);
      clause.__paramCstNode = paramNode;
      if (paramNode && valueNode) {
        clause.__cst.range = {
          start: toRange(paramNode).start,
          end: toRange(valueNode).end
        };
      }
      clauses.push(clause);
    }
    return clauses;
  }
};
var SetClause = class _SetClause extends AstNodeBase {
  constructor(target, value) {
    super();
    __publicField(this, "target");
    __publicField(this, "value");
    __publicField(this, "__kind", "SetClause");
    this.target = target;
    this.value = value;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    if (!this.target || !this.value) {
      const cstText = this.__cst?.node?.text?.trim();
      return cstText ? `${indent}${cstText}` : `${indent}set`;
    }
    const hasSpaces = this.__cst?.node?.text?.includes(" = ") ?? true;
    const eq = hasSpaces ? " = " : "=";
    return `${indent}set ${this.target.__emit(ctx)}${eq}${this.value.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const targetNode = node.childForFieldName("target");
    const valueNode = node.childForFieldName("value");
    const target = targetNode ? parseExpr(targetNode) : null;
    const value = valueNode ? parseExpr(valueNode) : null;
    return withCst(new _SetClause(target, value), node);
  }
};
var ToClause = class _ToClause extends AstNodeBase {
  constructor(target) {
    super();
    __publicField(this, "target");
    __publicField(this, "__kind", "ToClause");
    this.target = target;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    return `${indent}to ${this.target.__emit(ctx)}`;
  }
  static parse(node, parseExpr) {
    const targetNode = node.childForFieldName("target");
    const target = targetNode ? parseExpr(targetNode) : null;
    return withCst(new _ToClause(target), node);
  }
};
var AvailableWhen = class _AvailableWhen extends AstNodeBase {
  constructor(condition) {
    super();
    __publicField(this, "condition");
    __publicField(this, "__kind", "AvailableWhen");
    this.condition = condition;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    const condText = this.condition ? this.condition.__emit(ctx) : this.__cst?.node?.childForFieldName("condition")?.text ?? "";
    return `${indent}available when ${condText}`;
  }
  static parse(node, parseExpr) {
    const conditionNode = node.childForFieldName("condition");
    const condition = conditionNode ? parseExpr(conditionNode) : null;
    return withCst(new _AvailableWhen(condition), node);
  }
};
var RunStatement = class _RunStatement extends AstNodeBase {
  constructor(target, body) {
    super();
    __publicField(this, "target");
    __publicField(this, "body");
    __publicField(this, "__kind", "RunStatement");
    this.target = target;
    this.body = body;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    const targetText = this.target ? this.target.__emit(ctx) : this.__cst?.node?.childForFieldName("target")?.text ?? "";
    if (!targetText.trim() && this.__cst?.node) {
      const cstText = this.__cst.node.text?.trim();
      if (cstText) {
        const lines = cstText.split("\n");
        return lines.map((line) => `${indent}${line.trim()}`).join("\n");
      }
    }
    let out = `${indent}run ${targetText}`;
    if (this.body.length > 0) {
      out += "\n";
      const bodyCtx = { ...ctx, indent: ctx.indent + 1 };
      out += this.body.map((s) => wrapWithComments(s.__emit(bodyCtx), s, bodyCtx)).join("\n");
    }
    return out;
  }
  static parse(node, parseExpr, parseStmt) {
    let targetNode = node.childForFieldName("target");
    const bodyNode = node.childForFieldName("block_value");
    const diagnostics = [];
    for (const child of node.children) {
      if (child.type !== "ERROR")
        continue;
      const hasWith = child.children.some((c) => c.type === "with");
      if (!hasWith)
        continue;
      for (const errChild of child.namedChildren) {
        if (errChild.type === "expression" || errChild.type === "member_expression" || errChild.type === "atom") {
          targetNode = errChild;
          break;
        }
      }
      const withNode = child.children.find((c) => c.type === "with");
      const errorIdx = node.children.indexOf(child);
      for (let i = errorIdx + 1; i < node.children.length; i++) {
        const sibling = node.children[i];
        if (sibling.type === "expression") {
          const rangeStart = withNode ? toRange(withNode).start : toRange(child).start;
          diagnostics.push(createDiagnostic({ start: rangeStart, end: toRange(sibling).end }, `Invalid \`with\` clause: \`with ${sibling.text}\`. \`with\` requires named arguments (e.g., \`with name=@variables.name\`).`, DiagnosticSeverity.Error, "syntax-error"));
          break;
        }
      }
      break;
    }
    const target = targetNode ? parseExpr(targetNode) : null;
    const body = [];
    const attacher = new CommentAttacher();
    const outerComments = node.children.filter((child) => child.type === "comment").map((c) => parseCommentNode(c, "leading"));
    if (bodyNode) {
      const preBodyComments = outerComments.filter((comment2) => {
        const line = comment2.range?.start.line;
        return line !== void 0 && line < bodyNode.startRow;
      });
      for (const c of preBodyComments) {
        attacher.pushLeading(c);
      }
      for (const child of bodyNode.children) {
        if (child.type === "comment") {
          if (!attacher.tryAttachInline(child, body[body.length - 1])) {
            attacher.pushLeadingNode(child);
          }
          continue;
        }
        const result = parseStmt(child);
        if (!result)
          continue;
        if (Array.isArray(result)) {
          const normalized = result.filter((stmt) => stmt !== null);
          if (normalized.length === 0)
            continue;
          attacher.consumeOntoFirst(normalized);
          body.push(...normalized);
        } else {
          attacher.consumeOnto(result);
          body.push(result);
        }
      }
      const postBodyComments = outerComments.filter((comment2) => {
        const line = comment2.range?.start.line;
        return line !== void 0 && line > bodyNode.endRow;
      }).map((c) => ({ ...c, attachment: "trailing" }));
      if (postBodyComments.length > 0 && body.length > 0) {
        attach(body[body.length - 1], postBodyComments);
      }
    }
    let pendingErrorText = "";
    let pendingErrorNode = null;
    for (const child of node.children) {
      if (child.isError) {
        const text = child.text?.trim();
        if (text) {
          if (pendingErrorNode && child.startRow === pendingErrorNode.startRow) {
            pendingErrorText += " " + text;
          } else {
            if (pendingErrorText && pendingErrorNode) {
              body.push(withCst(new UnknownStatement(pendingErrorText), pendingErrorNode));
            }
            pendingErrorText = text;
            pendingErrorNode = child;
          }
        }
      } else if (pendingErrorText && pendingErrorNode) {
        body.push(withCst(new UnknownStatement(pendingErrorText), pendingErrorNode));
        pendingErrorText = "";
        pendingErrorNode = null;
      }
    }
    if (pendingErrorText && pendingErrorNode) {
      body.push(withCst(new UnknownStatement(pendingErrorText), pendingErrorNode));
    }
    attacher.flush();
    const parsed = withCst(new _RunStatement(target, body), node);
    if (diagnostics.length > 0) {
      parsed.__diagnostics.push(...diagnostics);
    }
    return parsed;
  }
};
var IfStatement = class _IfStatement extends AstNodeBase {
  constructor(condition, body, orelse = []) {
    super();
    __publicField(this, "condition");
    __publicField(this, "body");
    __publicField(this, "orelse");
    __publicField(this, "__kind", "IfStatement");
    this.condition = condition;
    this.body = body;
    this.orelse = orelse;
  }
  __emit(ctx) {
    return this.__emitConditional(ctx, "if");
  }
  __emitConditional(ctx, keyword) {
    const indent = emitIndent(ctx);
    if (this.body.length === 0 && this.orelse.length === 0 && this.__cst?.node) {
      const cstText = this.__cst.node.text?.trim();
      if (cstText) {
        const lines = cstText.split("\n");
        return lines.map((line) => `${indent}${line.trim()}`).join("\n");
      }
    }
    let condText = this.condition ? this.condition.__emit(ctx) : this.__cst?.node?.childForFieldName("condition")?.text ?? "";
    if (this.__cst?.node) {
      const firstLine = this.__cst.node.text?.split("\n")[0]?.trim() ?? "";
      const match = firstLine.match(/^(?:if|elif)\s+(.*?):\s*$/);
      if (match && match[1].length > condText.trim().length) {
        condText = match[1];
      }
    }
    let out = `${indent}${keyword} ${condText}:
`;
    const bodyCtx = { ...ctx, indent: ctx.indent + 1 };
    out += this.body.map((s) => wrapWithComments(s.__emit(bodyCtx), s, bodyCtx)).join("\n");
    if (this.orelse.length > 0) {
      if (this.orelse.length === 1 && this.orelse[0] instanceof _IfStatement) {
        out += "\n" + this.orelse[0].__emitConditional(ctx, "elif");
      } else {
        out += `
${indent}else:
`;
        out += this.orelse.map((s) => wrapWithComments(s.__emit(bodyCtx), s, bodyCtx)).join("\n");
      }
    }
    return out;
  }
  static parse(node, parseExpr, parseProcedure2) {
    const conditionNode = node.childForFieldName("condition");
    const consequenceNode = node.childForFieldName("consequence");
    const condition = conditionNode ? parseExpr(conditionNode) : null;
    const body = consequenceNode ? parseProcedure2(consequenceNode) : [];
    const alternatives = node.childrenForFieldName("alternative");
    let orelse = [];
    for (let i = alternatives.length - 1; i >= 0; i--) {
      const alt = alternatives[i];
      if (alt.type === "else_clause") {
        const elseConsequence = alt.childForFieldName("consequence");
        orelse = elseConsequence ? parseProcedure2(elseConsequence) : [];
      } else if (alt.type === "elif_clause") {
        const elifCondition = parseExpr(alt.childForFieldName("condition"));
        const elifConsequence = alt.childForFieldName("consequence");
        const elifBody = elifConsequence ? parseProcedure2(elifConsequence) : [];
        orelse = [
          withCst(new _IfStatement(elifCondition, elifBody, orelse), alt)
        ];
      }
    }
    return withCst(new _IfStatement(condition, body, orelse), node);
  }
};
var TransitionStatement = class _TransitionStatement extends AstNodeBase {
  constructor(clauses) {
    super();
    __publicField(this, "clauses");
    __publicField(this, "__kind", "TransitionStatement");
    this.clauses = clauses;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    const parts = this.clauses.map((c) => c.__emit({ ...ctx, indent: 0 }));
    return `${indent}transition ${parts.join(", ")}`;
  }
  static parse(node, parseExpr) {
    const clauses = [];
    const listNode = node.childForFieldName("with_to_statement_list");
    if (listNode) {
      for (const child of listNode.namedChildren) {
        if (child.type === "to_statement") {
          clauses.push(ToClause.parse(child, parseExpr));
        } else if (child.type === "with_statement") {
          const parsed = WithClause.parseAll(child, parseExpr);
          if (Array.isArray(parsed))
            clauses.push(...parsed);
          else
            clauses.push(parsed);
        }
      }
    }
    return withCst(new _TransitionStatement(clauses), node);
  }
};
var UnknownStatement = class extends AstNodeBase {
  constructor(text) {
    super();
    __publicField(this, "text");
    __publicField(this, "__kind", "UnknownStatement");
    this.text = text;
  }
  __emit(ctx) {
    const indent = emitIndent(ctx);
    const lines = this.text.split("\n");
    return lines.map((line) => `${indent}${line}`).join("\n");
  }
};
var statementParsers = {
  template: (node, parseExpr) => Template.parse(node, parseExpr),
  with_statement: (node, parseExpr) => WithClause.parseAll(node, parseExpr),
  set_statement: (node, parseExpr) => SetClause.parse(node, parseExpr),
  to_statement: (node, parseExpr) => ToClause.parse(node, parseExpr),
  available_when_statement: (node, parseExpr) => AvailableWhen.parse(node, parseExpr),
  transition_statement: (node, parseExpr) => TransitionStatement.parse(node, parseExpr),
  run_statement: (node, parseExpr, _parseProcedure, parseStmt) => RunStatement.parse(node, parseExpr, parseStmt),
  if_statement: (node, parseExpr, parseProcedure2) => IfStatement.parse(node, parseExpr, parseProcedure2)
};

// ../language/dist/core/field-builder.js
function assertFiniteNumber(value, method) {
  if (!Number.isFinite(value)) {
    throw new Error(`${method}() requires a finite number, got ${value}`);
  }
}
function assertNonNegativeInteger(value, method) {
  assertFiniteNumber(value, method);
  if (value < 0 || !Number.isInteger(value)) {
    throw new Error(`${method}() requires a non-negative integer, got ${value}`);
  }
}
function assertPositiveNumber(value, method) {
  assertFiniteNumber(value, method);
  if (value <= 0) {
    throw new Error(`${method}() requires a positive number, got ${value}`);
  }
}
var FieldBuilder = class {
  constructor(baseType, initialMetadata, constraintCategories) {
    __publicField(this, "baseType");
    __publicField(this, "__fieldKind");
    __publicField(this, "__metadata", {});
    __publicField(this, "__constraintCategories");
    __publicField(this, "emitField");
    this.baseType = baseType;
    this.__fieldKind = baseType.__fieldKind;
    this.emitField = baseType.emitField;
    if (initialMetadata) {
      Object.assign(this.__metadata, initialMetadata);
    }
    if (constraintCategories) {
      this.__constraintCategories = constraintCategories;
    }
    for (const [key, val] of Object.entries(baseType)) {
      if (!(key in this)) {
        Object.defineProperty(this, key, {
          value: val,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    }
  }
  // FieldType delegation — return types carry V for InferFieldType inference
  parse(node, dialect, extraElements) {
    return this.baseType.parse(node, dialect, extraElements);
  }
  emit(value, ctx) {
    return this.baseType.emit(value, ctx);
  }
  get schema() {
    return this.baseType.schema;
  }
};
function addBuilderMethods(fieldType, constraints) {
  const cats = constraints ?? [];
  function populateMethods(target, meta2, base) {
    const withMeta = (updates) => enhance({ ...meta2, ...updates }, base);
    const withConstraint = (updates) => enhance({ ...meta2, constraints: { ...meta2.constraints, ...updates } }, base);
    target.describe = (desc) => withMeta({ description: desc });
    target.example = (ex) => withMeta({ example: ex });
    target.minVersion = (v) => withMeta({ minVersion: v });
    target.deprecated = (msg, opts) => withMeta({ deprecated: { message: msg, ...opts } });
    target.experimental = () => withMeta({ experimental: true });
    target.hidden = () => withMeta({ hidden: true });
    target.required = () => withMeta({ required: true });
    target.omitArrow = () => {
      const noArrowBase = Object.create(base);
      noArrowBase.emitField = (key, value, ctx) => {
        const indent = emitIndent(ctx);
        const childCtx = { ...ctx, indent: ctx.indent + 1 };
        if (isEmittable(value)) {
          return `${indent}${key}:
${value.__emit(childCtx)}`;
        }
        return `${indent}${key}:
`;
      };
      return enhance({ ...meta2, omitArrow: true }, noArrowBase);
    };
    target.disallowTemplates = (suggestion) => {
      const noTemplateBase = Object.create(base);
      const originalParse = base.parse.bind(base);
      const errorMessage = "Template statements (|) are not allowed in this procedure block." + (suggestion ? ` ${suggestion}` : "");
      function collectTemplateDiagnostics(statements, diagnostics, fallbackRange) {
        for (const stmt of statements) {
          if (stmt.__kind === "Template") {
            const range = stmt.__cst?.range ?? fallbackRange;
            diagnostics.push(createDiagnostic(range, errorMessage, DiagnosticSeverity.Error, "template-in-deterministic-procedure"));
          }
          if (stmt instanceof IfStatement) {
            collectTemplateDiagnostics(stmt.body, diagnostics, fallbackRange);
            if (stmt.orelse.length > 0) {
              collectTemplateDiagnostics(stmt.orelse, diagnostics, fallbackRange);
            }
          }
          if (stmt instanceof RunStatement) {
            collectTemplateDiagnostics(stmt.body, diagnostics, fallbackRange);
          }
        }
      }
      noTemplateBase.parse = function(node, dialect, extraElements) {
        const result = originalParse(node, dialect, extraElements);
        const diagnostics = [...result.diagnostics];
        if (result.value && "statements" in result.value) {
          const procedureNode = result.value;
          const fallbackRange = procedureNode.__cst?.range ?? node;
          collectTemplateDiagnostics(procedureNode.statements, diagnostics, fallbackRange);
          return { value: result.value, diagnostics };
        }
        return result;
      };
      return enhance({ ...meta2, disallowTemplates: true }, noTemplateBase);
    };
    target.accepts = (kinds) => {
      const clone2 = Object.create(base);
      clone2.__accepts = [...kinds];
      return enhance(meta2, clone2);
    };
    target.allowedNamespaces = (namespaces) => withConstraint({ allowedNamespaces: namespaces });
    target.resolvedType = (type) => withConstraint({ resolvedType: type });
    target.crossBlockReferenceable = () => withMeta({ crossBlockReferenceable: true });
    target.pick = (keys) => {
      if ("pick" in base && typeof base.pick === "function") {
        return enhance(meta2, base.pick(keys));
      }
      throw new Error("Base type does not support pick()");
    };
    const baseAny = base;
    for (const method of [
      "extend",
      "omit",
      "withProperties",
      "extendProperties",
      "withKeyPattern"
    ]) {
      const orig = baseAny[method];
      if (typeof orig === "function") {
        target[method] = (...args) => {
          const applied = orig.apply(base, args);
          return enhance(meta2, applied);
        };
      } else {
        target[method] = () => {
          throw new Error(`Base type does not support ${method}()`);
        };
      }
    }
    target.clone = () => enhance({ ...meta2 }, base);
    if (cats.includes("number")) {
      target.min = (v) => {
        assertFiniteNumber(v, "min");
        return withConstraint({ minimum: v });
      };
      target.max = (v) => {
        assertFiniteNumber(v, "max");
        return withConstraint({ maximum: v });
      };
      target.exclusiveMin = (v) => {
        assertFiniteNumber(v, "exclusiveMin");
        return withConstraint({ exclusiveMinimum: v });
      };
      target.exclusiveMax = (v) => {
        assertFiniteNumber(v, "exclusiveMax");
        return withConstraint({ exclusiveMaximum: v });
      };
      target.multipleOf = (v) => {
        assertPositiveNumber(v, "multipleOf");
        return withConstraint({ multipleOf: v });
      };
    }
    if (cats.includes("string")) {
      target.minLength = (v) => {
        assertNonNegativeInteger(v, "minLength");
        return withConstraint({ minLength: v });
      };
      target.maxLength = (v) => {
        assertNonNegativeInteger(v, "maxLength");
        return withConstraint({ maxLength: v });
      };
      target.pattern = (regex) => withConstraint({
        pattern: regex instanceof RegExp ? regex.source : regex
      });
    }
    if (cats.includes("generic")) {
      target.enum = (values) => withConstraint({ enum: values });
      target.const = (value) => withConstraint({ const: value });
    }
    if (cats.includes("sequence")) {
      target.minItems = (v) => {
        assertNonNegativeInteger(v, "minItems");
        return withConstraint({ minItems: v });
      };
      target.maxItems = (v) => {
        assertNonNegativeInteger(v, "maxItems");
        return withConstraint({ maxItems: v });
      };
    }
  }
  function enhance(meta2, base = fieldType) {
    const builder = new FieldBuilder(base, meta2, cats.length > 0 ? cats : void 0);
    populateMethods(builder, meta2, base);
    return builder;
  }
  populateMethods(fieldType, {}, fieldType);
  return fieldType;
}

// ../language/dist/core/primitives-constants.js
var AGENTSCRIPT_PRIMITIVE_TYPES = [
  {
    keyword: "string",
    description: "A text value, such as a name, message, or ID."
  },
  {
    keyword: "number",
    description: "A numeric value that can include decimals (e.g., 3.14)."
  },
  { keyword: "boolean", description: "A True or False value." },
  {
    keyword: "object",
    description: "A collection of named values (key-value pairs)."
  },
  { keyword: "currency", description: "A monetary amount." },
  {
    keyword: "date",
    description: "A calendar date without a time (e.g., 2025-03-15)."
  },
  {
    keyword: "datetime",
    description: "A date and time with timezone (e.g., 2025-03-15T10:30:00Z)."
  },
  {
    keyword: "time",
    description: "A time of day without a date (e.g., 14:30)."
  },
  {
    keyword: "timestamp",
    description: "A point in time represented as a Unix epoch value."
  },
  { keyword: "id", description: "A unique record identifier." },
  {
    keyword: "integer",
    description: "A whole number with no decimal part (e.g., 42)."
  },
  {
    keyword: "long",
    description: "A large whole number for values that may exceed normal integer range."
  }
];
var VARIABLE_MODIFIERS = [
  {
    keyword: "mutable",
    description: "A variable that can be changed during the conversation. Use `set` to update its value."
  },
  {
    keyword: "linked",
    description: "A variable whose value comes from an external system (e.g., a CRM record). Cannot be changed directly."
  }
];
var ALLOWED_STRING_VALUE_KINDS = /* @__PURE__ */ new Set([
  "StringLiteral",
  "TemplateExpression"
]);
var STRING_VALUE_DEFAULT = Array.from(ALLOWED_STRING_VALUE_KINDS);

// ../language/dist/core/primitives.js
function withCstGuard(expr, node) {
  if (expr.__cst) {
    return expr;
  }
  return withCst(expr, node);
}
function validateExpression(node, dialect, accepts) {
  if (node.type === "template" && accepts.includes("TemplateExpression")) {
    return {
      expr: TemplateExpression.parse(node, (n) => dialect.parseExpression(n)),
      diagnostics: []
    };
  }
  const expr = dialect.parseExpression(node);
  const acceptsSet = new Set(accepts);
  if (!acceptsSet.has(expr.__kind)) {
    const expected = accepts.map((k) => KIND_LABELS.get(k) ?? k).join(" or ");
    return {
      expr: withCstGuard(expr, node),
      diagnostics: [
        typeMismatchDiagnostic(toRange(node), `Expected ${expected}, got ${expr.__describe()}`, accepts.join(" | "), expr.__kind)
      ]
    };
  }
  return { expr: withCstGuard(expr, node), diagnostics: [] };
}
var _stringValueFieldType = {
  __fieldKind: "Primitive",
  __accepts: [...STRING_VALUE_DEFAULT],
  parse(node, dialect) {
    const acceptsArr = this.__accepts ?? STRING_VALUE_DEFAULT;
    const allowedSet = ALLOWED_STRING_VALUE_KINDS;
    const accepted = acceptsArr.filter((el) => allowedSet.has(el));
    const { expr, diagnostics } = validateExpression(node, dialect, accepted);
    if (diagnostics.length > 0) {
      return parseResult(withCst(new StringLiteral(""), node), diagnostics);
    }
    return parseResult(expr, []);
  },
  emit: (value, ctx) => value.__emit(ctx)
};
var StringValue = addBuilderMethods(_stringValueFieldType, [
  "string",
  "generic"
]);
var _NumberValueNode = class _NumberValueNode extends AstNodeBase {
  constructor(value) {
    super();
    __publicField(this, "value");
    __publicField(this, "__kind", "NumberValue");
    this.value = value;
  }
  __emit(_ctx) {
    return String(this.value);
  }
  static parse(node, dialect) {
    const { expr, diagnostics } = validateExpression(node, dialect, [
      "NumberLiteral"
    ]);
    if (diagnostics.length > 0) {
      return parseResult(withCst(new _NumberValueNode(0), node), diagnostics);
    }
    const numValue = expr instanceof NumberLiteral ? expr.value : 0;
    return parseResult(withCst(new _NumberValueNode(numValue), node), []);
  }
  static emit(value, ctx) {
    return value.__emit(ctx);
  }
};
__publicField(_NumberValueNode, "__fieldKind", "Primitive");
__publicField(_NumberValueNode, "__accepts", ["NumberLiteral"]);
var NumberValueNode = _NumberValueNode;
var NumberValue = addBuilderMethods(NumberValueNode, [
  "number",
  "generic"
]);
var _BooleanValueNode = class _BooleanValueNode extends AstNodeBase {
  constructor(value) {
    super();
    __publicField(this, "value");
    __publicField(this, "__kind", "BooleanValue");
    this.value = value;
  }
  __emit(_ctx) {
    return this.value ? "True" : "False";
  }
  static parse(node, dialect) {
    const { expr, diagnostics } = validateExpression(node, dialect, [
      "BooleanLiteral"
    ]);
    if (diagnostics.length > 0) {
      if (expr instanceof StringLiteral) {
        const upper = expr.value.toUpperCase();
        if (upper === "TRUE" || upper === "FALSE") {
          return parseResult(withCst(new _BooleanValueNode(upper === "TRUE"), node), []);
        }
      }
      return parseResult(withCst(new _BooleanValueNode(false), node), diagnostics);
    }
    const boolValue = expr instanceof BooleanLiteral ? expr.value : false;
    return parseResult(withCst(new _BooleanValueNode(boolValue), node), []);
  }
  static emit(value, ctx) {
    return value.__emit(ctx);
  }
};
__publicField(_BooleanValueNode, "__fieldKind", "Primitive");
__publicField(_BooleanValueNode, "__accepts", ["BooleanLiteral"]);
var BooleanValueNode = _BooleanValueNode;
var BooleanValue = addBuilderMethods(BooleanValueNode, ["generic"]);
var _ProcedureValueNode = class _ProcedureValueNode extends AstNodeBase {
  constructor(statements) {
    super();
    __publicField(this, "statements");
    __publicField(this, "__kind", "ProcedureValue");
    this.statements = statements;
  }
  __emit(ctx) {
    return this.statements.map((statement) => wrapWithComments(statement.__emit(ctx), statement, ctx)).join("\n");
  }
  static parse(node, dialect) {
    const validTypes = /* @__PURE__ */ new Set(["procedure", "mapping", "template"]);
    const dc = new DiagnosticCollector();
    if (!validTypes.has(node.type)) {
      dc.add(createDiagnostic(node, `Expected procedure (->) or template (|) syntax, got '${node.text}'`, DiagnosticSeverity.Error, "invalid-procedure-value"));
    }
    const statements = dialect.parseProcedure(node);
    return parseResult(withCst(new _ProcedureValueNode(statements), node), dc.all);
  }
  static emit(value, ctx) {
    return value.__emit(ctx);
  }
  static emitField(key, value, ctx) {
    const indent = emitIndent(ctx);
    if (value.statements.length === 1 && value.statements[0].__kind === "Template") {
      const cstType = value.__cst?.node?.type;
      if (cstType === "template") {
        const raw = value.statements[0].__emit({ ...ctx, indent: 0 });
        const lines = raw.split("\n");
        const childIndent = emitIndent({ ...ctx, indent: ctx.indent + 1 });
        const reindented = lines.map((line, i) => {
          if (i === 0)
            return line;
          if (line.trim().length === 0)
            return "";
          return `${childIndent}${line}`;
        }).join("\n");
        return `${indent}${key}: ${reindented}`;
      }
      if (cstType === "mapping") {
        const childCtx2 = { ...ctx, indent: ctx.indent + 1 };
        return `${indent}${key}:
${value.statements[0].__emit(childCtx2)}`;
      }
    }
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    const body = value.__emit(childCtx);
    if (!body)
      return `${indent}${key}: ->`;
    return `${indent}${key}: ->
${body}`;
  }
};
__publicField(_ProcedureValueNode, "__fieldKind", "Primitive");
var ProcedureValueNode = _ProcedureValueNode;
var ProcedureValue = addBuilderMethods(ProcedureValueNode);
var ExpressionValue = addBuilderMethods({
  __fieldKind: "Primitive",
  parse: (node, dialect) => {
    const expr = dialect.parseExpression(node);
    const parsed = expr.__cst ? expr : withCst(expr, node);
    return parseResult(parsed, []);
  },
  emit: (value, ctx) => {
    if (value == null)
      return "";
    return value.__emit(ctx);
  }
});
var ReferenceValue = addBuilderMethods({
  __fieldKind: "Primitive",
  __accepts: ["MemberExpression"],
  parse: (node, dialect) => {
    const { expr, diagnostics } = validateExpression(node, dialect, [
      "MemberExpression"
    ]);
    if (diagnostics.length > 0) {
      return parseResult(withCst(new MemberExpression(new AtIdentifier(""), ""), node), diagnostics);
    }
    if (expr instanceof MemberExpression && expr.__cst) {
      return parseResult(expr, []);
    }
    return parseResult(withCst(new MemberExpression(new AtIdentifier(""), ""), node), []);
  },
  emit: (value, ctx) => value.__emit(ctx)
});
function union(...types) {
  const expressionKindSet = EXPRESSION_KINDS;
  const allAccepts = [...new Set(types.flatMap((t) => t.__accepts ?? []))];
  const accepts = allAccepts.filter((k) => expressionKindSet.has(k));
  return {
    __fieldKind: "Primitive",
    __accepts: accepts,
    parse: (node, dialect) => {
      const { expr, diagnostics } = validateExpression(node, dialect, accepts);
      return parseResult(expr, diagnostics);
    },
    emit: (value, ctx) => value.__emit(ctx)
  };
}

// ../language/dist/core/sequence.js
var SequenceNode = class extends AstNodeBase {
  constructor(items) {
    super();
    __publicField(this, "__kind", "Sequence");
    __publicField(this, "__children", []);
    if (items) {
      this.__children = items.map((item) => new SequenceItemChild(item));
    }
  }
  get items() {
    const result = [];
    for (const c of this.__children) {
      if (c instanceof SequenceItemChild) {
        result.push(c.value);
      }
    }
    return result;
  }
  set items(newItems) {
    this.__children = newItems.map((item) => new SequenceItemChild(item));
  }
  __emit(ctx) {
    return emitChildren(this.__children, ctx);
  }
};
function collectMappingElements(child) {
  const elements = [];
  const colinearME = child.childForFieldName("colinear_mapping_element");
  if (colinearME)
    elements.push(colinearME);
  const blockValue = child.childForFieldName("block_value");
  if (blockValue) {
    for (const bvChild of blockValue.namedChildren) {
      if (bvChild.type === "mapping_element")
        elements.push(bvChild);
    }
  }
  return elements;
}
function hasMappingContent(child) {
  return !!(child.childForFieldName("colinear_mapping_element") || child.childForFieldName("block_value"));
}
function createSequenceFieldType(blockType) {
  const fieldType = {
    __fieldKind: "Sequence",
    schema: blockType?.schema,
    parse(node, dialect) {
      const items = [];
      const dc = new DiagnosticCollector();
      for (const child of node.namedChildren) {
        if (child.type !== "sequence_element")
          continue;
        if (hasMappingContent(child)) {
          if (blockType) {
            const allElements = collectMappingElements(child);
            const result = dialect.parseMappingElements(allElements, blockType.schema, child);
            const { fields, children } = extractChildren(result.value);
            const blockResult = blockType.fromParsedFields(
              // SAFETY: fields parsed against blockType.schema, structurally matches InferFields<T>
              fields,
              child,
              result.diagnostics,
              children
            );
            items.push(blockResult.value);
            dc.merge(result);
          } else {
            dc.add(createDiagnostic(child, 'Mapping elements are not supported in expression-only sequences. Use simple values (e.g., - "value").', DiagnosticSeverity.Error, "invalid-sequence-element"));
            const cv = child.childForFieldName("colinear_value");
            if (cv) {
              items.push(dialect.parseExpression(cv));
            }
          }
          continue;
        }
        const colinearValue = child.childForFieldName("colinear_value");
        if (colinearValue) {
          items.push(dialect.parseExpression(colinearValue));
        }
      }
      return parseResult(withCst(new SequenceNode(items), node), dc.all);
    },
    emit(value, ctx) {
      return value.__emit(ctx);
    },
    emitField(key, value, ctx) {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      return `${indent}${key}:
${value.__emit(childCtx)}`;
    }
  };
  return addBuilderMethods(fieldType, ["sequence"]);
}
function Sequence(blockType) {
  return createSequenceFieldType(blockType);
}
function ExpressionSequence() {
  return createSequenceFieldType();
}

// ../language/dist/core/named-map.js
var BlockBase = class {
  constructor() {
    __publicField(this, "__symbol");
    /** @internal See {@link BlockCore.__children}. */
    __publicField(this, "__children", []);
    __publicField(this, "__diagnostics", []);
    __publicField(this, "__cst");
    __publicField(this, "__comments");
  }
};
function collectionLabel(key) {
  return `${key}Collection`;
}
var _a;
var NamedMap = class _NamedMap {
  constructor(kind, options) {
    /** @internal Brand for `isNamedMap` type guard. */
    __publicField(this, _a, true);
    __publicField(this, "__kind");
    __publicField(this, "__symbol");
    __publicField(this, "__children", []);
    __publicField(this, "__diagnostics", []);
    __publicField(this, "__cst");
    __publicField(this, "__comments");
    /** @internal Lazily-derived O(1) lookup index — keys → MapEntryChild. */
    __publicField(this, "_mapIndex", new MapIndex());
    this.__kind = kind;
    this.__symbol = options?.symbol;
    if (options?.entries) {
      for (const [key, value] of options.entries) {
        this.set(key, value);
      }
    }
  }
  /** Create a NamedMap with the canonical collection label for the given key. */
  static forCollection(key, options) {
    return new _NamedMap(collectionLabel(key), options);
  }
  get size() {
    return this._mapIndex.ensure(this.__children).size;
  }
  get(key) {
    return this._mapIndex.ensure(this.__children).get(key)?.value;
  }
  has(key) {
    return this._mapIndex.ensure(this.__children).has(key);
  }
  set(key, value) {
    const index = this._mapIndex.ensure(this.__children);
    const existing = index.get(key);
    if (existing) {
      existing.value = value;
    } else {
      const child = new MapEntryChild(key, value);
      this.__children.push(child);
    }
    return this;
  }
  delete(key) {
    const index = this._mapIndex.ensure(this.__children);
    const entry = index.get(key);
    if (!entry)
      return false;
    const idx2 = this.__children.indexOf(entry);
    if (idx2 !== -1)
      this.__children.splice(idx2, 1);
    return true;
  }
  clear() {
    this.__children = [];
  }
  // __children is the authoritative ordered list — iteration always follows
  // CST insertion order, not the _index Map. The _index is only for O(1) lookups.
  *_entries() {
    for (const child of this.__children) {
      if (child instanceof MapEntryChild) {
        yield child;
      }
    }
  }
  *entries() {
    for (const entry of this._entries()) {
      yield [entry.name, entry.value];
    }
  }
  *keys() {
    for (const entry of this._entries()) {
      yield entry.name;
    }
  }
  *values() {
    for (const entry of this._entries()) {
      yield entry.value;
    }
  }
  forEach(callbackfn) {
    for (const entry of this._entries()) {
      callbackfn(entry.value, entry.name, this);
    }
  }
  [(_a = NAMED_MAP_BRAND, Symbol.iterator)]() {
    return this.entries();
  }
  toJSON() {
    const obj = {};
    for (const [k, v] of this) {
      obj[k] = v;
    }
    return obj;
  }
  __emit(ctx) {
    return emitChildren(this.__children, ctx);
  }
};

// ../language/dist/core/typed-declarations.js
var TypedDeclarationBase = class extends AstNodeBase {
  constructor(data) {
    super();
    __publicField(this, "type");
    __publicField(this, "defaultValue");
    __publicField(this, "properties");
    __publicField(this, "__children", []);
    this.type = data.type;
    this.defaultValue = data.defaultValue;
    this.properties = data.properties;
  }
};
var VariableDeclarationNode = class extends TypedDeclarationBase {
  constructor(data) {
    super(data);
    __publicField(this, "__kind", "VariableDeclaration");
    __publicField(this, "__symbol", {
      kind: SymbolKind.Variable,
      noRecurse: true
    });
    __publicField(this, "modifier");
    this.modifier = data.modifier;
  }
};
var ParameterDeclarationNode = class extends TypedDeclarationBase {
  constructor(data) {
    super(data);
    __publicField(this, "__kind", "ParameterDeclaration");
    __publicField(this, "__symbol", { kind: SymbolKind.Field, noRecurse: true });
  }
};

// ../language/dist/core/factory-utils.js
function overrideFactoryBuilderMethods(factory) {
  const f = factory;
  const applyMeta = (updates) => {
    f.__metadata = {
      ...f.__metadata,
      ...updates
    };
    return f;
  };
  f.describe = (desc) => applyMeta({ description: desc });
  f.example = (ex) => applyMeta({ example: ex });
  f.required = () => applyMeta({ required: true });
  f.minVersion = (v) => applyMeta({ minVersion: v });
  f.deprecated = (msg, opts) => applyMeta({ deprecated: { message: msg, ...opts } });
  f.experimental = () => applyMeta({ experimental: true });
  f.crossBlockReferenceable = () => applyMeta({ crossBlockReferenceable: true });
  f.singular = () => applyMeta({ singular: true });
  f.clone = () => {
    const cloneFn = f.__clone;
    if (typeof cloneFn !== "function") {
      throw new Error("Factory does not support clone()");
    }
    const result = cloneFn();
    if (f.__metadata) {
      result.__metadata = { ...f.__metadata };
    }
    return result;
  };
  for (const method of [
    "extend",
    "omit",
    "pick",
    "withProperties",
    "extendProperties",
    "withKeyPattern"
  ]) {
    const orig = f[method];
    if (typeof orig !== "function")
      continue;
    f[method] = (...args) => {
      const result = orig.apply(f, args);
      if (result != null && f.__metadata) {
        const r = result;
        r.__metadata = {
          ...f.__metadata,
          ...r.__metadata
        };
      }
      return result;
    };
  }
}
function stripDiscriminantIfMissing(newSchema, opts) {
  if (opts?.discriminant && !(opts.discriminant in newSchema)) {
    const { discriminant: _discriminant, variants: _variants, ...rest } = opts;
    return rest;
  }
  return opts;
}
function normalizeSchema(schema2) {
  const result = {};
  for (const [key, value] of Object.entries(schema2)) {
    result[key] = Array.isArray(value) ? union(...value) : value;
  }
  return result;
}
function validateSchemaFields(schema2) {
  for (const key of Object.keys(schema2)) {
    if (key.startsWith("__")) {
      throw new Error(`Field name '${key}' is invalid - field names cannot start with '__' (reserved for internal properties)`);
    }
  }
}

// ../language/dist/core/block-factory.js
function Block(kind, inputSchema, options) {
  const rawSchema = inputSchema ?? {};
  const normalizedSchema = normalizeSchema(rawSchema);
  if (options?.wildcardPrefixes?.length) {
    attachWildcardPrefixes(normalizedSchema, options.wildcardPrefixes);
  }
  const schema2 = Object.freeze(normalizedSchema);
  validateSchemaFields(schema2);
  const discriminantField = options?.discriminant;
  const rawVariantsBlock = options?.variants;
  let discriminantConfig;
  let blockVariants;
  if (discriminantField) {
    if (!schema2[discriminantField]) {
      throw new Error(`Block '${kind}': discriminant field '${discriminantField}' not found in base schema`);
    }
    if (rawVariantsBlock && Object.keys(rawVariantsBlock).length > 0) {
      blockVariants = Object.fromEntries(Object.entries(rawVariantsBlock).map(([name, variantSchema]) => {
        const merged = Object.freeze({
          ...schema2,
          ...normalizeSchema(variantSchema)
        });
        validateSchemaFields(merged);
        return [name, merged];
      }));
      discriminantConfig = {
        field: discriminantField,
        variants: blockVariants,
        validValues: Object.keys(blockVariants)
      };
    }
  }
  const symbol = options?.symbol ?? { kind: SymbolKind.Object };
  const _BlockNode = class _BlockNode extends BlockBase {
    constructor(fields, parseChildren) {
      super();
      __publicField(this, "__kind", kind);
      __publicField(this, "__symbol", symbol);
      this.__children = initChildren(this, parseChildren, fields, schema2);
    }
    static fromParsedFields(fields, cstNode, diagnostics, children, ownDiagnostics) {
      const instance = new _BlockNode(fields, children);
      const parsed = withCst(instance, cstNode);
      parsed.__diagnostics = ownDiagnostics ?? diagnostics;
      return parseResult(parsed, diagnostics);
    }
    static parse(node, dialect, extraElements) {
      const result = dialect.parseMapping(node, schema2, extraElements, {
        discriminant: discriminantConfig
      });
      const ownDiags = result.value.__diagnostics;
      const { fields, children } = extractChildren(result.value);
      return _BlockNode.fromParsedFields(fields, node, result.diagnostics, children, ownDiags);
    }
    static emit(value, ctx) {
      return value.__emit(ctx);
    }
    static emitField(key, value, ctx) {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = value.__emit(childCtx);
      return body ? `${indent}${key}:
${body}` : `${indent}${key}:`;
    }
    __emit(ctx) {
      return emitChildren(this.__children, ctx);
    }
  };
  __publicField(_BlockNode, "__fieldKind", "Block");
  __publicField(_BlockNode, "kind", kind);
  __publicField(_BlockNode, "schema", schema2);
  __publicField(_BlockNode, "isNamed", false);
  __publicField(_BlockNode, "capabilities", options?.capabilities);
  let BlockNode = _BlockNode;
  const base = addBuilderMethods(BlockNode);
  if (options?.description) {
    Object.defineProperty(base, "__metadata", {
      value: { description: options.description },
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  Object.defineProperty(base, "extend", {
    value: (additionalFields, overrideOptions) => {
      const mergedOpts = overrideOptions ? { ...options, ...overrideOptions } : options;
      return Block(kind, { ...schema2, ...additionalFields }, mergedOpts);
    },
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(base, "omit", {
    value: (...keys) => {
      const remaining = { ...schema2 };
      for (const k of keys)
        delete remaining[k];
      return Block(kind, remaining, stripDiscriminantIfMissing(remaining, options));
    },
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(base, "pick", {
    value: (keys) => {
      const picked = {};
      const nested = /* @__PURE__ */ new Map();
      for (const key of keys) {
        const dotIdx = key.indexOf(".");
        if (dotIdx === -1) {
          if (key in schema2)
            picked[key] = schema2[key];
        } else {
          const first = key.slice(0, dotIdx);
          const rest = key.slice(dotIdx + 1);
          if (!nested.has(first))
            nested.set(first, []);
          nested.get(first).push(rest);
        }
      }
      for (const [first, restKeys] of nested) {
        const field = schema2[first];
        if (field && "pick" in field && typeof field.pick === "function") {
          picked[first] = field.pick(restKeys);
        }
      }
      return Block(kind, picked, stripDiscriminantIfMissing(picked, options));
    },
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(base, "__clone", {
    value: () => Block(kind, { ...schema2 }, options),
    writable: true,
    configurable: true,
    enumerable: true
  });
  const dp = (key, value) => Object.defineProperty(base, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true
  });
  dp("discriminantField", discriminantField);
  dp("resolveSchemaForDiscriminant", (value) => blockVariants?.[value] ?? schema2);
  dp("discriminant", (fieldName) => {
    return Block(kind, inputSchema ?? {}, {
      ...options,
      discriminant: fieldName
    });
  });
  dp("variant", (name, variantSchema) => {
    const currentVariants = options?.variants ?? {};
    const newVariants = { ...currentVariants, [name]: variantSchema };
    return Block(kind, inputSchema ?? {}, {
      ...options,
      variants: newVariants
    });
  });
  overrideFactoryBuilderMethods(base);
  return base;
}

// ../language/dist/core/named-block-factory.js
function NamedBlock(kind, inputSchema, opts) {
  const rawSchema = inputSchema ?? {};
  const schema2 = Object.freeze(normalizeSchema(rawSchema));
  validateSchemaFields(schema2);
  const colinear = opts?.colinear;
  const body = opts?.body;
  const symbol = opts?.symbol ?? { kind: SymbolKind.Class };
  const scopeLevel = opts?.scopeAlias;
  const rawVariants = opts?.variants;
  const variants = rawVariants ? Object.fromEntries(Object.entries(rawVariants).map(([name, variantSchema]) => {
    const merged = Object.freeze({
      ...schema2,
      ...normalizeSchema(variantSchema)
    });
    validateSchemaFields(merged);
    return [name, merged];
  })) : void 0;
  const validVariantNames = variants ? Object.keys(variants) : void 0;
  const discriminantField = opts?.discriminant;
  let namedDiscriminantConfig;
  if (discriminantField) {
    if (!schema2[discriminantField]) {
      throw new Error(`NamedBlock '${kind}': discriminant field '${discriminantField}' not found in base schema`);
    }
    if (variants && Object.keys(variants).length > 0) {
      namedDiscriminantConfig = {
        field: discriminantField,
        variants,
        validValues: validVariantNames
      };
    }
  }
  function resolveVariant(name, cstNode) {
    if (namedDiscriminantConfig) {
      return {
        effectiveSchema: schema2,
        discriminantConfig: namedDiscriminantConfig,
        earlyDiagnostics: []
      };
    }
    if (!variants) {
      return {
        effectiveSchema: schema2,
        discriminantConfig: void 0,
        earlyDiagnostics: []
      };
    }
    const variantSchema = variants[name];
    if (variantSchema) {
      return {
        effectiveSchema: variantSchema,
        discriminantConfig: void 0,
        earlyDiagnostics: []
      };
    }
    return {
      effectiveSchema: schema2,
      discriminantConfig: void 0,
      earlyDiagnostics: [
        createDiagnostic(cstNode, `Unknown variant '${name}'. Valid variants: ${validVariantNames.join(", ")}`, DiagnosticSeverity.Error, "unknown-variant")
      ]
    };
  }
  const _NamedBlockNode = class _NamedBlockNode extends BlockBase {
    constructor(name, fields, parseChildren) {
      super();
      __publicField(this, "__kind", kind);
      __publicField(this, "__symbol", symbol);
      __publicField(this, "__name");
      __publicField(this, "__scope", scopeLevel);
      /** @internal Direct reference to the ValueChild, avoiding linear scan. Non-enumerable. */
      __publicField(this, "_valueChild");
      Object.defineProperty(this, "_valueChild", {
        value: void 0,
        writable: true,
        enumerable: false,
        configurable: true
      });
      this.__name = name;
      this.__children = initChildren(this, parseChildren, fields, schema2);
    }
    /** Colinear expression (e.g., `@actions.send_email`). Backed by __children. */
    get value() {
      return this._valueChild?.value;
    }
    set value(val) {
      if (this._valueChild) {
        this._valueChild.value = val;
      } else {
        const vc = new ValueChild(val);
        this._valueChild = vc;
        this.__children.unshift(vc);
      }
    }
    /** Procedure statements (with/set/to clauses, body). Backed by __children. */
    get statements() {
      const stmts = [];
      for (const c of this.__children) {
        if (c instanceof StatementChild) {
          stmts.push(c.value);
        }
      }
      return stmts.length > 0 ? stmts : void 0;
    }
    set statements(stmts) {
      this.__children = this.__children.filter((c) => c.__type !== "statement");
      if (stmts) {
        for (const s of stmts) {
          this.__children.push(new StatementChild(s));
        }
      }
    }
    static fromParsedFields(name, fields, cstNode, diagnostics, children, ownDiagnostics) {
      const instance = new _NamedBlockNode(name, fields, children);
      const parsed = withCst(instance, cstNode);
      parsed.__diagnostics = ownDiagnostics ?? diagnostics;
      return parseResult(parsed, diagnostics);
    }
    static parse(node, name, dialect, adoptedSiblings) {
      if (colinear || body) {
        return _NamedBlockNode.parseColinear(node, name, dialect, adoptedSiblings);
      }
      return _NamedBlockNode.parseMapping(node, name, dialect, adoptedSiblings);
    }
    static parseMapping(node, name, dialect, adoptedSiblings) {
      const { effectiveSchema, discriminantConfig, earlyDiagnostics } = resolveVariant(name, node);
      if (earlyDiagnostics.length > 0) {
        return _NamedBlockNode.fromParsedFields(name, {}, node, earlyDiagnostics);
      }
      const result = dialect.parseMapping(node, effectiveSchema, adoptedSiblings, discriminantConfig ? { discriminant: discriminantConfig } : void 0);
      const ownDiags = result.value.__diagnostics;
      const { fields, children } = extractChildren(result.value);
      return _NamedBlockNode.fromParsedFields(name, fields, node, result.diagnostics, children, ownDiags);
    }
    static parseColinear(node, name, dialect, adoptedSiblings) {
      const { effectiveSchema, discriminantConfig, earlyDiagnostics } = resolveVariant(name, node);
      if (earlyDiagnostics.length > 0) {
        return _NamedBlockNode.fromParsedFields(name, {}, node, earlyDiagnostics);
      }
      const parentNode = node.parent;
      const colinearNode = parentNode?.childForFieldName("colinear_value") ?? parentNode?.childForFieldName("expression");
      const bodyNode = parentNode?.childForFieldName("block_value") ?? parentNode?.childForFieldName("procedure");
      const dc = new DiagnosticCollector();
      let colinearValue;
      if (colinear && colinearNode) {
        const exprNode = colinearNode.childForFieldName("expression") ?? colinearNode;
        const colinearResult = colinear.parse(exprNode, dialect);
        colinearValue = colinearResult.value;
        dc.merge(colinearResult);
      }
      let statements;
      let mappingFields = {};
      let bodyChildren;
      let bodyOwnDiags = [];
      const discOpt = discriminantConfig ? { discriminant: discriminantConfig } : void 0;
      if (bodyNode) {
        const content = dialect.parseBlockContent(bodyNode, effectiveSchema, discOpt);
        const extracted = extractChildren(content.fields);
        mappingFields = extracted.fields;
        bodyChildren = extracted.children;
        if (content.statements.length > 0)
          statements = content.statements;
        dc.mergeAll(content.diagnostics);
        bodyOwnDiags = content.fields.__diagnostics ?? [];
      } else if (adoptedSiblings && adoptedSiblings.length > 0) {
        const adoptedResult = dialect.parseMappingElements(adoptedSiblings, effectiveSchema, node, discriminantConfig);
        const extracted = extractChildren(adoptedResult.value);
        mappingFields = extracted.fields;
        bodyChildren = extracted.children;
        dc.merge(adoptedResult);
        bodyOwnDiags = adoptedResult.value.__diagnostics ?? [];
        const adoptedStatements = dialect.parseStatementNodes(adoptedSiblings);
        if (adoptedStatements.length > 0) {
          statements = [...statements ?? [], ...adoptedStatements];
        }
      }
      const extraNodes = [
        ...colinearNode?.childForFieldName("with_to_statement_list")?.namedChildren ?? [],
        ...parentNode?.children.filter((c) => c.type === "ERROR").flatMap((c) => c.namedChildren) ?? []
      ];
      if (extraNodes.length > 0) {
        const posKey = (n) => `${n.startRow}:${n.startCol}-${n.endRow}:${n.endCol}`;
        const bodyPositions = new Set((statements ?? []).filter((s) => s.__cst?.node).map((s) => posKey(s.__cst.node)));
        const extraStatements = dialect.parseStatementNodes(extraNodes).filter((s) => {
          if (!s.__cst?.node)
            return true;
          return !bodyPositions.has(posKey(s.__cst.node));
        });
        if (extraStatements.length > 0) {
          statements = [...statements ?? [], ...extraStatements];
        }
      }
      const instance = new _NamedBlockNode(name, mappingFields, bodyChildren);
      if (colinearValue !== void 0)
        instance.value = colinearValue;
      if (statements)
        instance.statements = statements;
      const parsed = withCst(instance, node);
      parsed.__diagnostics = bodyOwnDiags;
      return parseResult(parsed, dc.all);
    }
    __emit(ctx) {
      if (colinear && this.value != null) {
        return this.emitColinear(ctx);
      }
      return this.emitAsEntry(ctx);
    }
    /** Emit as a top-level entry with schema key prefix (e.g., `topic main:`). */
    emitWithKey(schemaKey, ctx) {
      const indent = emitIndent(ctx);
      const header = `${indent}${schemaKey} ${emitKeyName(this.__name)}:`;
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body2 = emitChildren(this.__children, childCtx);
      return body2 ? `${header}
${body2}` : header;
    }
    /** Emit as a nested entry with just the name (e.g., `fetch_data:` inside `actions:`). */
    emitAsEntry(ctx) {
      const indent = emitIndent(ctx);
      const header = `${indent}${emitKeyName(this.__name)}:`;
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body2 = emitChildren(this.__children, childCtx);
      return body2 ? `${header}
${body2}` : header;
    }
    static emit(value, ctx) {
      return value.__emit(ctx);
    }
    static emitField(key, value, ctx) {
      if (!value.__children || value.__children.length === 0) {
        if (value.__cst) {
          return `${emitIndent(ctx)}${key}:`;
        }
        return "";
      }
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body2 = emitChildren(value.__children, childCtx);
      if (!body2)
        return "";
      return `${indent}${key}:
${body2}`;
    }
    emitColinear(ctx) {
      const indent = emitIndent(ctx);
      let out = `${indent}${emitKeyName(this.__name)}: ${colinear.emit(this.value, ctx)}`;
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const bodyParts = [];
      for (const child of this.__children) {
        if (child.__type === "value") {
          continue;
        }
        if (child instanceof StatementChild) {
          const stmt = child.value;
          if (stmt.__kind === "ToClause") {
            const val = this.value;
            const colinearRow = val instanceof AstNodeBase ? val.__cst?.node?.endPosition?.row : void 0;
            const toRow = stmt.__cst?.node?.startPosition?.row;
            if (colinearRow != null && toRow != null && toRow > colinearRow) {
              bodyParts.push(stmt.__emit(childCtx));
            } else {
              out += " " + stmt.__emit({ indent: 0 });
            }
          } else {
            bodyParts.push(stmt.__emit(childCtx));
          }
          continue;
        }
        const emitted = child.__emit(childCtx);
        if (emitted)
          bodyParts.push(emitted);
      }
      if (bodyParts.length > 0) {
        out += "\n" + bodyParts.join("\n");
      }
      return out;
    }
  };
  __publicField(_NamedBlockNode, "kind", kind);
  __publicField(_NamedBlockNode, "schema", schema2);
  __publicField(_NamedBlockNode, "isNamed", true);
  __publicField(_NamedBlockNode, "allowAnonymous", opts?.allowAnonymous ?? false);
  __publicField(_NamedBlockNode, "scopeAlias", scopeLevel);
  __publicField(_NamedBlockNode, "colinearType", colinear);
  __publicField(_NamedBlockNode, "hasColinear", !!colinear);
  __publicField(_NamedBlockNode, "hasBody", !!body);
  __publicField(_NamedBlockNode, "capabilities", opts?.capabilities);
  let NamedBlockNode = _NamedBlockNode;
  const base = addBuilderMethods(NamedBlockNode);
  const dp = (key, value) => Object.defineProperty(base, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true
  });
  if (opts?.description) {
    dp("__metadata", { description: opts.description });
  }
  dp("resolveSchemaForName", (name) => variants?.[name] ?? schema2);
  if (variants) {
    dp("__variantNames", Object.keys(variants));
  }
  dp("extend", (additionalFields, overrideOpts) => {
    const mergedOpts = overrideOpts ? { ...opts, ...overrideOpts } : opts;
    return NamedBlock(kind, { ...schema2, ...additionalFields }, mergedOpts);
  });
  dp("omit", (...keys) => {
    const remaining = { ...schema2 };
    for (const k of keys)
      delete remaining[k];
    return NamedBlock(kind, remaining, stripDiscriminantIfMissing(remaining, opts));
  });
  dp("pick", (keys) => {
    const picked = {};
    const nested = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const dotIdx = key.indexOf(".");
      if (dotIdx === -1) {
        if (key in schema2)
          picked[key] = schema2[key];
      } else {
        const first = key.slice(0, dotIdx);
        const rest = key.slice(dotIdx + 1);
        if (!nested.has(first))
          nested.set(first, []);
        nested.get(first).push(rest);
      }
    }
    for (const [first, restKeys] of nested) {
      const field = schema2[first];
      if (field && "pick" in field && typeof field.pick === "function") {
        picked[first] = field.pick(restKeys);
      }
    }
    return NamedBlock(kind, picked, stripDiscriminantIfMissing(picked, opts));
  });
  dp("variant", (name, variantSchema) => {
    const currentVariants = opts?.variants ?? {};
    const newVariants = { ...currentVariants, [name]: variantSchema };
    return NamedBlock(kind, inputSchema ?? {}, {
      ...opts,
      variants: newVariants
    });
  });
  dp("discriminant", (fieldName) => {
    return NamedBlock(kind, inputSchema ?? {}, {
      ...opts,
      discriminant: fieldName
    });
  });
  dp("discriminantField", discriminantField);
  dp("resolveSchemaForDiscriminant", (value) => variants?.[value] ?? schema2);
  dp("__clone", () => NamedBlock(kind, { ...schema2 }, opts));
  overrideFactoryBuilderMethods(base);
  return base;
}

// ../language/dist/core/error-recovery.js
function detectSameRowSplit(elements, currentIndex, colinearNode, rawDeclType) {
  if (currentIndex + 1 >= elements.length)
    return void 0;
  const nextEl = elements[currentIndex + 1];
  const nextKeyNode = nextEl.childForFieldName("key");
  const nextKeyChildren = nextKeyNode?.namedChildren.filter(isKeyNode) ?? [];
  if (nextKeyChildren.length < 1 || nextKeyChildren[0].startRow !== colinearNode.startRow) {
    return void 0;
  }
  const errorPrefix = rawDeclType instanceof Identifier ? rawDeclType.name : colinearNode.text;
  const declType = withCst(new Identifier(getKeyText(nextKeyChildren[0])), nextKeyChildren[0]);
  return {
    errorPrefix,
    declType,
    mergedElement: nextEl,
    mergedKeyRemainder: nextKeyChildren.length >= 2 ? getKeyText(nextKeyChildren[1]) : void 0
  };
}
function captureErrorPrefix(element, colinearNode) {
  const errorParts = [];
  let firstErrorNode;
  const colinearRow = colinearNode.startRow;
  const colinearCol = colinearNode.startCol;
  for (const child of element.namedChildren) {
    if (child.type === "ERROR" && (child.startRow < colinearRow || child.startRow === colinearRow && child.startCol < colinearCol)) {
      errorParts.push(child.text);
      if (!firstErrorNode) {
        firstErrorNode = child;
      }
    }
  }
  return errorParts.length > 0 ? { text: errorParts.join(" "), errorNode: firstErrorNode } : void 0;
}
function detectInlineErrorSuffix(element, colinearNode, rawDeclType) {
  const colinearRow = colinearNode.startRow;
  const colinearCol = colinearNode.startCol;
  for (const child of element.namedChildren) {
    if (child.type === "ERROR" && child.startRow === colinearRow && child.startCol > colinearCol) {
      const firstId = child.namedChildren.find((c) => c.type === "id");
      const typeText = firstId ? firstId.text : child.text?.trim();
      if (!typeText)
        continue;
      const errorPrefix = rawDeclType instanceof Identifier ? rawDeclType.name : colinearNode.text;
      const typeNode = firstId ?? child;
      const declType = withCst(new Identifier(typeText), typeNode);
      return { errorPrefix, declType, errorNode: child };
    }
  }
  return void 0;
}
function errorBlockFromNode(node) {
  const text = node.text?.trim();
  if (!text)
    return void 0;
  return new ErrorBlock(node.text, node.startCol);
}
function mergeProperties(parsed, element, mergedElement, mergedKeyRemainder, propertiesBlock, dialect, dc) {
  let blockNode = element.childForFieldName("block_value");
  if (!blockNode) {
    blockNode = element.namedChildren.find((c) => c.type === "mapping") ?? null;
  }
  const mergedBlock = mergedElement.childForFieldName("block_value") ?? mergedElement.namedChildren.find((c) => c.type === "mapping") ?? null;
  const propBlockNode = blockNode ?? mergedBlock;
  if (propBlockNode) {
    if (!isSingularFieldType(propertiesBlock))
      return;
    const propResult = propertiesBlock.parse(propBlockNode, dialect);
    if (propResult.value && typeof propResult.value === "object") {
      parsed.properties = propResult.value;
      parsed.__children.push(new FieldChild("properties", propResult.value, propertiesBlock));
    }
    dc.merge(propResult);
  }
  if (mergedKeyRemainder && parsed.properties) {
    const mergedColinear = mergedElement.childForFieldName("colinear_value") ?? mergedElement.childForFieldName("expression");
    if (mergedColinear) {
      const exprNode = mergedColinear.childForFieldName("expression") ?? mergedColinear;
      const propValue = dialect.parseExpression(exprNode);
      const props = parsed.properties;
      const propSchema = propertiesBlock.schema;
      const rawFieldType = propSchema ? propSchema[mergedKeyRemainder] : void 0;
      const fieldType = (Array.isArray(rawFieldType) ? rawFieldType[0] : rawFieldType) ?? ExpressionValue;
      const children = props.__children;
      if (children) {
        const fc = new FieldChild(mergedKeyRemainder, propValue, fieldType);
        children.unshift(fc);
        defineFieldAccessors(props, [fc]);
      }
    }
  }
}

// ../language/dist/core/collection-block-factory.js
function CollectionBlock(entryBlock, opts) {
  const kind = `Collection<${entryBlock.kind}>`;
  const _CollectionBlockNode = class _CollectionBlockNode extends NamedMap {
    constructor(entries) {
      super(kind, { entries });
    }
    // -- Parsing --
    static parse(node, dialect) {
      const instance = new _CollectionBlockNode();
      const dc = new DiagnosticCollector();
      let lastEntryValue;
      for (const child of node.children) {
        if (child.type === "comment")
          continue;
        if (child.type === "ERROR") {
          const errBlock = errorBlockFromNode(child);
          if (errBlock && lastEntryValue) {
            (lastEntryValue.__children ?? (lastEntryValue.__children = [])).push(errBlock);
          }
          continue;
        }
        if (child.type !== "mapping_element")
          continue;
        const [typeId, nameId] = dialect.getKeyIds(child);
        const entryName = typeId;
        if (!entryName)
          continue;
        if (nameId !== void 0) {
          const keyNode = child.childForFieldName("key");
          dc.add(createDiagnostic(keyNode ?? child, `Composite key '${keyNode?.text ?? `${typeId} ${nameId}`}' is not allowed; expected a single name`, DiagnosticSeverity.Error, "composite-key"));
        }
        const { blockValue, colinearValue, procedure } = getValueNodes(child);
        const valueNode = blockValue ?? colinearValue ?? procedure ?? child;
        const result = entryBlock.parse(valueNode, entryName, dialect);
        if (instance.has(entryName)) {
          const keyNode = child.childForFieldName("key");
          const dupDiag = createDiagnostic(keyNode ?? child, `Duplicate key '${keyNode?.text ?? entryName}'`, DiagnosticSeverity.Warning, "duplicate-key");
          dc.add(dupDiag);
        }
        instance.set(entryName, result.value);
        lastEntryValue = result.value;
        dc.merge(result);
        const hasErrorChildren = child.children.some((c) => c.isError);
        if (hasErrorChildren) {
          const lastChild = instance.__children[instance.__children.length - 1];
          if (lastChild instanceof MapEntryChild) {
            attachElementText(lastChild, child);
          }
        }
      }
      instance.__diagnostics = dc.own;
      const parsed = withCst(instance, node);
      return parseResult(parsed, dc.all);
    }
    // -- Emission --
    static emit(value, ctx) {
      return value.__emit(ctx);
    }
    static emitField(key, value, ctx) {
      if (!value.__children || value.__children.length === 0) {
        if (value.__cst) {
          return `${emitIndent(ctx)}${key}:`;
        }
        return "";
      }
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = emitChildren(value.__children, childCtx);
      if (!body)
        return "";
      return `${indent}${key}:
${body}`;
    }
  };
  __publicField(_CollectionBlockNode, "__fieldKind", "Collection");
  __publicField(_CollectionBlockNode, "kind", kind);
  __publicField(_CollectionBlockNode, "isNamed", false);
  __publicField(_CollectionBlockNode, "entryBlock", entryBlock);
  let CollectionBlockNode = _CollectionBlockNode;
  const base = addBuilderMethods(CollectionBlockNode);
  const dp = (key, value) => Object.defineProperty(base, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true
  });
  const entryMeta = entryBlock.__metadata;
  const collectionMeta = {};
  if (entryMeta?.example)
    collectionMeta.example = entryMeta.example;
  if (entryMeta?.description)
    collectionMeta.description = entryMeta.description;
  if (opts?.description)
    collectionMeta.description = opts.description;
  if (Object.keys(collectionMeta).length > 0) {
    dp("__metadata", collectionMeta);
  }
  dp("schema", entryBlock.schema);
  dp("scopeAlias", entryBlock.scopeAlias);
  dp("capabilities", entryBlock.capabilities);
  dp("colinearType", entryBlock.colinearType);
  dp("__isCollection", true);
  dp("__clone", () => CollectionBlock(entryBlock, opts));
  overrideFactoryBuilderMethods(base);
  return base;
}
function NamedCollectionBlock(entryBlock, opts) {
  const base = CollectionBlock(entryBlock, opts);
  const dp = (key, value) => Object.defineProperty(base, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true
  });
  dp("__isNamedCollection", true);
  dp("__clone", () => NamedCollectionBlock(entryBlock, opts));
  overrideFactoryBuilderMethods(base);
  return base;
}

// ../language/dist/core/typed-map-factory.js
function TypedMap(kind, propertiesBlock, options = {}) {
  const modifiers = options.modifiers ?? [];
  const primitiveTypes2 = options.primitiveTypes ?? [];
  const hasModifier = modifiers.length > 0;
  const blockLabel = kind.replace(/Block$/, "").toLowerCase();
  const symbol = options.symbol ?? { kind: SymbolKind.Namespace };
  const _TypedMapNode = class _TypedMapNode extends NamedMap {
    constructor(entries) {
      super(kind, { symbol, entries });
    }
    static emit(value, ctx) {
      return value.__emit(ctx);
    }
    static emitField(key, value, ctx) {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = value.__emit(childCtx);
      return body ? `${indent}${key}:
${body}` : `${indent}${key}:`;
    }
    static withProperties(newPropsBlock) {
      return TypedMap(kind, newPropsBlock, options);
    }
    static extendProperties(additionalFields) {
      if ("extend" in propertiesBlock && typeof propertiesBlock.extend === "function") {
        return TypedMap(kind, propertiesBlock.extend(additionalFields), options);
      }
      throw new Error(`Properties block for '${kind}' does not support extend(). Use withProperties() instead.`);
    }
    static withKeyPattern(pattern) {
      return TypedMap(kind, propertiesBlock, {
        ...options,
        keyPattern: pattern
      });
    }
    static parse(node, dialect) {
      const instance = new _TypedMapNode();
      const dc = new DiagnosticCollector();
      let pendingComments = [];
      let lastParsed;
      const elements = [];
      for (const child of node.namedChildren) {
        if (child.type === "comment") {
          pendingComments.push(parseCommentNode(child, "leading"));
          continue;
        }
        if (child.type === "mapping_element") {
          elements.push({
            node: child,
            leadingComments: pendingComments
          });
          pendingComments = [];
          continue;
        }
        pendingComments = [];
      }
      const elementNodes = elements.map((entry) => entry.node);
      const skipIndices = /* @__PURE__ */ new Set();
      for (let i = 0; i < elements.length; i++) {
        if (skipIndices.has(i))
          continue;
        const elementEntry = elements[i];
        const element = elementEntry.node;
        const leadingComments2 = elementEntry.leadingComments;
        const keyNode = element.childForFieldName("key");
        const keyChildren = keyNode?.namedChildren.filter(isKeyNode) ?? [];
        const name = keyChildren[0] ? getKeyText(keyChildren[0]) : "";
        const inlineComments2 = element.namedChildren.filter((c) => c.type === "comment").map((c) => parseCommentNode(c, "inline"));
        if (keyChildren.length > 1) {
          const keyRange = keyNode ?? element;
          dc.add(createDiagnostic(keyRange, `Composite key '${keyRange.text?.replace(/:$/, "") ?? name}' is not allowed; expected a single name`, DiagnosticSeverity.Error, "composite-key"));
        }
        if (!name && keyChildren.length > 0) {
          const keyRange = keyNode ?? element;
          const emptyDiag = createDiagnostic(keyRange, "Empty field name is not allowed", DiagnosticSeverity.Error, "empty-field-name");
          dc.add(emptyDiag);
        }
        if (name && options.keyPattern) {
          try {
            const pattern = new RegExp(options.keyPattern);
            if (!pattern.test(name)) {
              const keyRange = keyChildren[0] ?? keyNode ?? element;
              dc.add(createDiagnostic(keyRange, `'${name}' does not match required pattern /${options.keyPattern}/`, DiagnosticSeverity.Error, "invalid-key-pattern"));
            }
          } catch {
          }
        }
        const colinearNode = element.childForFieldName("colinear_value") ?? element.childForFieldName("expression");
        if (colinearNode) {
          const rawDecl = dialect.parseVariableDeclaration(colinearNode);
          const reservedNames = [
            ...keywordNames(primitiveTypes2),
            ...keywordNames(modifiers),
            "list"
          ];
          const isQuotedKey = keyChildren[0]?.type === "string";
          if (name && !isQuotedKey && reservedNames.includes(name)) {
            const reservedDiag = createDiagnostic(keyChildren[0], `'${name}' is a reserved keyword and cannot be used as a variable name. Reserved: ${reservedNames.join(", ")}`, DiagnosticSeverity.Error, "reserved-name", {
              found: name,
              expected: reservedNames
            });
            dc.add(reservedDiag);
          }
          let declType = rawDecl.type;
          let errorPrefix;
          let errorPrefixNode;
          let mergedElement;
          let mergedKeyRemainder;
          const captured = captureErrorPrefix(element, colinearNode);
          let innerErrorPrefix;
          if (colinearNode.type === "variable_declaration") {
            const innerParts = [];
            for (const child of colinearNode.children) {
              if (child.type === "ERROR") {
                const text = child.text?.trim();
                if (text)
                  innerParts.push(text);
              }
            }
            if (innerParts.length > 0) {
              innerErrorPrefix = innerParts.join(" ");
            }
          }
          const split = detectSameRowSplit(elementNodes, i, colinearNode, rawDecl.type);
          if (split) {
            errorPrefix = captured ? `${captured.text}${split.errorPrefix}` : split.errorPrefix;
            if (captured)
              errorPrefixNode = captured.errorNode;
            declType = split.declType;
            mergedElement = split.mergedElement;
            mergedKeyRemainder = split.mergedKeyRemainder;
            skipIndices.add(i + 1);
          } else {
            const suffix = detectInlineErrorSuffix(element, colinearNode, rawDecl.type);
            if (suffix) {
              errorPrefix = captured ? `${captured.text}${suffix.errorPrefix}` : suffix.errorPrefix;
              errorPrefixNode = suffix.errorNode;
              declType = suffix.declType;
            } else if (captured) {
              errorPrefix = captured.text;
              errorPrefixNode = captured.errorNode;
            }
          }
          if (innerErrorPrefix) {
            errorPrefix = errorPrefix ? `${errorPrefix} ${innerErrorPrefix}` : innerErrorPrefix;
          }
          if (hasModifier && rawDecl.modifier) {
            const modifierText = rawDecl.modifier.name;
            const modifierNames = keywordNames(modifiers);
            if (!modifierNames.includes(modifierText)) {
              const suggestion = findSuggestion(modifierText, modifierNames);
              const hint = suggestion ? `Did you mean '${suggestion}'?` : `Valid modifiers: ${modifierNames.join(", ")}`;
              const modDiag = createDiagnostic(colinearNode, `Unknown modifier '${modifierText}' for ${blockLabel} ${name}. ${hint}`, DiagnosticSeverity.Error, "invalid-modifier", {
                found: modifierText,
                expected: modifierNames
              });
              dc.add(modDiag);
            }
          }
          if (primitiveTypes2.length > 0 && declType instanceof Identifier) {
            const typeName = declType.name;
            const typeNames = keywordNames(primitiveTypes2);
            if (!typeNames.includes(typeName)) {
              const suggestion = findSuggestion(typeName, typeNames);
              const hint = suggestion ? `Did you mean '${suggestion}'?` : `Valid types: ${typeNames.join(", ")}`;
              const typeDiag = createDiagnostic(declType.__cst ? declType.__cst.range : colinearNode, `Unknown type '${typeName}' for ${blockLabel} ${name}. ${hint}`, DiagnosticSeverity.Error, "unknown-type", {
                found: typeName,
                expected: typeNames
              });
              dc.add(typeDiag);
            }
          } else if (primitiveTypes2.length > 0 && declType instanceof SubscriptExpression) {
            const obj = declType.object;
            const idx2 = declType.index;
            if (!(obj instanceof Identifier) || obj.name !== "list") {
              const typeName = obj instanceof Identifier ? obj.name : obj.__emit({ indent: 0 });
              const paramDiag = createDiagnostic(obj, `'${typeName}' does not support type parameters. Only 'list' supports type parameters (e.g., list[string]).`, DiagnosticSeverity.Error, "invalid-type-parameter", { found: typeName });
              dc.add(paramDiag);
            } else if (idx2 instanceof SubscriptExpression) {
              const nestedDiag = createDiagnostic(idx2, `Nested list types are not supported (e.g., list[list[string]]). Use a flat list type like list[string].`, DiagnosticSeverity.Error, "nested-list-type");
              dc.add(nestedDiag);
            } else if (idx2 instanceof Identifier) {
              const elemType = idx2.name;
              const elemTypeNames = keywordNames(primitiveTypes2);
              if (!elemTypeNames.includes(elemType)) {
                const suggestion = findSuggestion(elemType, elemTypeNames);
                const hint = suggestion ? `Did you mean '${suggestion}'?` : `Valid element types: ${elemTypeNames.join(", ")}`;
                const elemDiag = createDiagnostic(idx2, `Unknown list element type '${elemType}' for ${blockLabel} ${name}. ${hint}`, DiagnosticSeverity.Error, "unknown-type", {
                  found: elemType,
                  expected: elemTypeNames
                });
                dc.add(elemDiag);
              }
            }
          }
          const decl = hasModifier && rawDecl.modifier ? new VariableDeclarationNode({
            type: declType,
            defaultValue: rawDecl.defaultValue,
            modifier: rawDecl.modifier
          }) : new ParameterDeclarationNode({
            type: declType,
            defaultValue: rawDecl.defaultValue
          });
          const parsed2 = withCst(decl, element);
          const declComments = [
            ...leadingComments2.map((c) => ({
              ...c,
              attachment: "leading"
            })),
            ...inlineComments2.map((c) => ({
              ...c,
              attachment: "inline"
            }))
          ];
          if (declComments.length > 0) {
            parsed2.__comments = declComments;
          }
          if (mergedElement) {
            mergeProperties(parsed2, element, mergedElement, mergedKeyRemainder, propertiesBlock, dialect, dc);
          } else {
            let blockNode = element.childForFieldName("block_value");
            if (!blockNode) {
              blockNode = element.namedChildren.find((c) => c.type === "mapping") ?? null;
            }
            if (blockNode && isSingularFieldType(propertiesBlock)) {
              const propResult = propertiesBlock.parse(blockNode, dialect);
              if (propResult.value && typeof propResult.value === "object") {
                parsed2.properties = propResult.value;
                parsed2.__children.push(new FieldChild("properties", propResult.value, propertiesBlock));
              }
              dc.merge(propResult);
            }
          }
          if (errorPrefix) {
            const errorBlock = new ErrorBlock(errorPrefix, colinearNode.startCol);
            parsed2.__children.unshift(errorBlock);
            if (hasModifier) {
              const modNames = keywordNames(modifiers);
              const suggestion = findSuggestion(errorPrefix, modNames);
              const hint = suggestion ? `Did you mean '${suggestion}'?` : `Valid modifiers: ${modNames.join(", ")}`;
              const errModDiag = createDiagnostic(errorPrefixNode ?? colinearNode, `Unknown modifier '${errorPrefix}' for ${blockLabel} ${name}. ${hint}`, DiagnosticSeverity.Error, "invalid-modifier", {
                found: errorPrefix,
                expected: modNames
              });
              dc.add(errModDiag);
            }
          }
          instance.set(name, parsed2);
          lastParsed = parsed2;
        } else if (name && element.children.some((c) => c.type === "ERROR")) {
          const rawElementText = element.text;
          const colonIdx = rawElementText.indexOf(":");
          const rawValueText = colonIdx >= 0 ? rawElementText.substring(colonIdx + 1).trimStart() : "";
          if (rawValueText) {
            const errorType = withCst(new ErrorValue(rawValueText), element);
            const decl = hasModifier ? new VariableDeclarationNode({ type: errorType }) : new ParameterDeclarationNode({ type: errorType });
            const parsed2 = withCst(decl, element);
            const declComments = [
              ...leadingComments2.map((c) => ({
                ...c,
                attachment: "leading"
              })),
              ...inlineComments2.map((c) => ({
                ...c,
                attachment: "inline"
              }))
            ];
            if (declComments.length > 0) {
              parsed2.__comments = declComments;
            }
            instance.set(name, parsed2);
            lastParsed = parsed2;
          }
        } else if (name) {
          const typeNames = keywordNames(primitiveTypes2);
          const hint = typeNames.length > 0 ? `Expected a type after ':' (${typeNames.slice(0, 5).join(", ")}, ...)` : `Expected a type after ':'`;
          dc.add(createDiagnostic(element, `Missing type for ${blockLabel} '${name}'. ${hint}`, DiagnosticSeverity.Error, "missing-type", { expected: typeNames }));
        }
      }
      if (pendingComments.length > 0 && lastParsed) {
        const asTrailing = pendingComments.map((c) => ({
          ...c,
          attachment: "trailing"
        }));
        lastParsed.__comments = [
          ...lastParsed.__comments ?? [],
          ...asTrailing
        ];
      }
      instance.__diagnostics = dc.own;
      const parsed = withCst(instance, node);
      return parseResult(parsed, dc.all);
    }
    __emit(ctx) {
      const indent = emitIndent(ctx);
      const lines = [];
      const reservedEntryNames = /* @__PURE__ */ new Set([
        ...keywordNames(primitiveTypes2),
        ...keywordNames(modifiers),
        "list"
      ]);
      for (const [name, decl] of this.entries()) {
        if (!decl)
          continue;
        const allComments = decl.__comments ?? [];
        const leading = allComments.filter((c) => c.attachment === "leading");
        const inline = allComments.filter((c) => c.attachment === "inline");
        const trailing = allComments.filter((c) => c.attachment === "trailing");
        const leadingOutput = emitCommentList(leading, ctx);
        if (leadingOutput) {
          lines.push(leadingOutput);
        }
        const keyChild = decl.__cst?.node?.childForFieldName("key")?.namedChildren.find(isKeyNode);
        const wasQuoted = keyChild ? keyChild.type === "string" : reservedEntryNames.has(name);
        const emittedKey = wasQuoted ? quoteKeyName(name) : emitKeyName(name);
        let line = `${indent}${emittedKey}: `;
        if (hasModifier && "modifier" in decl && decl.modifier instanceof Identifier) {
          line += `${decl.modifier.__emit(ctx)} `;
        }
        for (const dc of decl.__children) {
          if (dc instanceof ErrorBlock) {
            line += `${dc.rawText} `;
            break;
          }
        }
        line += decl.type.__emit(ctx);
        if (decl.defaultValue) {
          line += ` = ${decl.defaultValue.__emit(ctx)}`;
        } else if (decl.__cst?.node?.text?.trimEnd().endsWith("=")) {
          line += " =";
        }
        if (inline.length > 0) {
          const inlineText = inline.map((c) => {
            if (c.value.trim().length === 0)
              return "#";
            const prefix2 = c.range ? "#" : "# ";
            return `${prefix2}${c.value}`;
          }).join(" ");
          line += ` ${inlineText}`;
        }
        lines.push(line);
        const trailingOutput = emitCommentList(trailing, {
          ...ctx,
          indent: ctx.indent + 1
        });
        if (trailingOutput) {
          lines.push(trailingOutput);
        }
        if (isEmittable(decl.properties)) {
          const propsOutput = decl.properties.__emit({
            ...ctx,
            indent: ctx.indent + 1
          });
          if (propsOutput) {
            lines.push(propsOutput);
          }
        }
      }
      return lines.join("\n");
    }
  };
  __publicField(_TypedMapNode, "__fieldKind", "TypedMap");
  __publicField(_TypedMapNode, "kind", kind);
  __publicField(_TypedMapNode, "isNamed", false);
  __publicField(_TypedMapNode, "__isTypedMap", true);
  __publicField(_TypedMapNode, "propertiesSchema", propertiesBlock.schema);
  __publicField(_TypedMapNode, "__modifiers", modifiers);
  __publicField(_TypedMapNode, "__primitiveTypes", primitiveTypes2);
  __publicField(_TypedMapNode, "propertiesBlock", propertiesBlock);
  let TypedMapNode = _TypedMapNode;
  const base = addBuilderMethods(TypedMapNode);
  if (options.description) {
    Object.defineProperty(base, "__metadata", {
      value: { description: options.description },
      writable: true,
      configurable: true,
      enumerable: true
    });
  }
  Object.defineProperty(base, "__clone", {
    value: () => TypedMap(kind, propertiesBlock, options),
    writable: true,
    configurable: true,
    enumerable: true
  });
  overrideFactoryBuilderMethods(base);
  return base;
}

// ../language/dist/core/guards.js
function isTemplateText(node) {
  return node instanceof TemplateText;
}
function isTemplateInterpolation(node) {
  return node instanceof TemplateInterpolation;
}
function isMemberExpression2(node) {
  return node instanceof MemberExpression;
}
function isIdentifier(node) {
  return node instanceof Identifier;
}
function isStringLiteral(node) {
  return node instanceof StringLiteral;
}
function isSubscriptExpression(node) {
  return node instanceof SubscriptExpression;
}
function isAtIdentifier2(node) {
  return node instanceof AtIdentifier;
}
function isIfStatement(node) {
  return node instanceof IfStatement;
}
function isTransitionStatement(node) {
  return node instanceof TransitionStatement;
}
function isToClause(node) {
  return node instanceof ToClause;
}
function isSetClause(node) {
  return node instanceof SetClause;
}
function isWithClause(node) {
  return node instanceof WithClause;
}

// ../language/dist/core/dialect.js
function hasRange(c) {
  return c.range !== void 0;
}
function prescanDiscriminantValue(elements, fieldName) {
  for (const element of elements) {
    if (element.type !== "mapping_element")
      continue;
    const keyNode = element.childForFieldName("key");
    if (!keyNode)
      continue;
    if (getKeyText(keyNode) !== fieldName)
      continue;
    const { colinearValue } = getValueNodes(element);
    if (!colinearValue)
      continue;
    const exprNode = colinearValue.childForFieldName("expression") ?? colinearValue;
    const text = exprNode.text?.trim();
    if (!text)
      continue;
    if (text.startsWith('"') && text.endsWith('"') || text.startsWith("'") && text.endsWith("'")) {
      return { value: text.slice(1, -1), cstNode: exprNode };
    }
    return { value: text, cstNode: exprNode };
  }
  return void 0;
}
function collectAdoptedSiblings(elements, startIndex, parentColumn) {
  let lookahead = startIndex + 1;
  while (lookahead < elements.length) {
    const next = elements[lookahead];
    if (next.startCol <= parentColumn)
      break;
    lookahead++;
  }
  if (lookahead > startIndex + 1) {
    return {
      adopted: elements.slice(startIndex + 1, lookahead),
      newIndex: lookahead - 1
    };
  }
  return void 0;
}
function hasProcedureStatements(value) {
  return value != null && typeof value === "object" && "statements" in value && Array.isArray(value.statements);
}
function getElementKeyRange(element) {
  const keyNode = element.childForFieldName("key");
  const keyChild = keyNode?.namedChildren.find(isKeyNode);
  if (keyChild)
    return toRange(keyChild);
  if (keyNode)
    return toRange(keyNode);
  return void 0;
}
function collectAllCstDiagnostics(root) {
  const diagnostics = [];
  collectCstDiagnosticsInner(root, diagnostics);
  return diagnostics;
}
function missingNodeRange(node) {
  const range = toRange(node);
  const prev = node.previousSibling;
  if (prev && range.start.line === range.end.line && range.start.character === range.end.character && prev.endPosition.row < node.startPosition.row) {
    const end = prev.endPosition;
    return {
      start: { line: end.row, character: end.column },
      end: { line: end.row, character: end.column }
    };
  }
  return range;
}
function collectCstDiagnosticsInner(node, diagnostics) {
  for (const child of node.children) {
    if (child.isMissing) {
      diagnostics.push(createParserDiagnostic(missingNodeRange(child), `Missing ${child.type}`, "missing-token"));
    } else if (child.isError) {
      if (node.type !== "run_statement") {
        const text = child.text?.trim();
        diagnostics.push(createParserDiagnostic(child, text ? `Syntax error: unexpected \`${text.length > 40 ? text.slice(0, 40) + "\u2026" : text}\`` : "Syntax error", "syntax-error"));
      }
      collectCstDiagnosticsInner(child, diagnostics);
    } else {
      collectCstDiagnosticsInner(child, diagnostics);
    }
  }
}
var Dialect = class {
  parse(node, schema2) {
    const docComments = [];
    let mappingNode = null;
    for (const child of node.namedChildren) {
      if (child.type === "comment") {
        const attachment = mappingNode ? "trailing" : "leading";
        docComments.push(this.parseComment(child, attachment));
      } else if (child.type === "mapping") {
        mappingNode = child;
      } else if (child.namedChildren.some((c) => c.type === "mapping_element")) {
        mappingNode = child;
      }
    }
    if (!mappingNode && node.namedChildren.some((c) => c.type === "mapping_element")) {
      mappingNode = node;
    }
    const effectiveNode = mappingNode ?? node;
    let elements = effectiveNode.namedChildren;
    if (mappingNode && mappingNode !== node) {
      const extra = [];
      for (const child of node.namedChildren) {
        if (child === mappingNode || child.type === "comment")
          continue;
        extra.push(child);
      }
      if (extra.length > 0) {
        elements = [...elements, ...extra];
      }
    }
    const result = this.parseMappingElements(elements, schema2, effectiveNode);
    const resultChildren = result.value.__children;
    const childArr = Array.isArray(resultChildren) ? resultChildren : [];
    const hasSchemaContent = Object.keys(schema2).some((k) => result.value[k] !== void 0);
    const allErrorBlocks = childArr.length > 0 && childArr.every((c) => c instanceof ErrorBlock);
    if (!hasSchemaContent && (node.isError || childArr.length === 0 || allErrorBlocks)) {
      const hasNonCommentContent = node.namedChildren.some((c) => c.type !== "comment");
      if (hasNonCommentContent) {
        const text = node.text?.trim();
        if (text) {
          result.value.__children = [
            new ErrorBlock(node.text, node.startCol)
          ];
        }
      }
    }
    const cstDiagnostics = collectAllCstDiagnostics(node);
    if (cstDiagnostics.length > 0) {
      result.value.__diagnostics.push(...cstDiagnostics);
      result.diagnostics.push(...cstDiagnostics);
    }
    if (docComments.length > 0) {
      const finalChildren = result.value.__children;
      const finalAllErrors = Array.isArray(finalChildren) && finalChildren.length > 0 && finalChildren.every((c) => c instanceof ErrorBlock);
      if (!finalAllErrors) {
        attach(result.value, docComments);
      }
    }
    return result;
  }
  parseComment(node, attachment = "leading") {
    return parseCommentNode(node, attachment);
  }
  /** Build the schema path by walking up the CST to the document root. */
  buildContextPath(node) {
    const path = [];
    let current = node;
    while (current && current.type !== "document") {
      if (current.type === "mapping_element") {
        const keyNode = current.childForFieldName("key");
        const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
        const ids = keyChildren?.map((n) => getKeyText(n)) ?? [];
        if (ids.length > 0) {
          path.unshift(...ids);
        }
      }
      current = current.parent;
    }
    return path;
  }
  /**
   * Build a human-readable location string for diagnostics in statement context.
   * e.g. `" in topic 'test' before_reasoning"` from path [topic, test, before_reasoning].
   */
  formatStatementContext(node) {
    const ctx = this.buildContextPath(node.parent ?? node);
    if (ctx.length === 0)
      return "";
    if (ctx.length >= 3) {
      const fieldName = ctx[ctx.length - 1];
      const blockKind = ctx[0];
      const blockName = ctx.slice(1, ctx.length - 1).join(" ");
      return ` in ${blockKind} '${blockName}' ${fieldName}`;
    }
    if (ctx.length === 2) {
      return ` in ${ctx[0]} '${ctx[1]}'`;
    }
    return ` in ${ctx[0]}`;
  }
  /**
   * Parse a mapping block using the given schema.
   * Infers cardinality from key structure (1 id = singular, 2 ids = map).
   */
  parseMapping(node, schema2, extraElements, options) {
    const elements = extraElements ? [...node.namedChildren, ...extraElements] : node.namedChildren;
    const result = this.parseMappingElements(elements, schema2, node, options?.discriminant);
    if (options?.preserveOrphanedStatements !== false) {
      const childArr = result.value.__children;
      if (Array.isArray(childArr)) {
        for (const element of elements) {
          if (element.type in statementParsers) {
            const errBlock = errorBlockFromNode(element);
            if (errBlock)
              childArr.push(errBlock);
          }
        }
      }
    }
    return result;
  }
  /**
   * Core parsing engine used by parseMapping() and Sequence.
   * Accepts an explicit list of elements so callers can merge elements
   * from different CST locations.
   */
  parseMappingElements(elements, schema2, cstNode, discriminant) {
    let effectiveSchema = schema2;
    const discriminantDiags = [];
    if (discriminant) {
      const scan = prescanDiscriminantValue(elements, discriminant.field);
      if (scan) {
        const variantSchema = discriminant.variants[scan.value];
        if (variantSchema) {
          effectiveSchema = variantSchema;
        } else {
          discriminantDiags.push(createDiagnostic(scan.cstNode, `Unknown variant '${scan.value}' for discriminant '${discriminant.field}'. Valid values: ${discriminant.validValues.join(", ")}`, DiagnosticSeverity.Error, "unknown-variant"));
        }
      }
    }
    schema2 = effectiveSchema;
    const fields = {};
    const collections = {};
    const dc = new DiagnosticCollector();
    for (const d of discriminantDiags)
      dc.add(d);
    const children = [];
    const anonymousCounts = {};
    const attacher = new CommentAttacher();
    function resolveEntryInfo(ft, _tid) {
      if (!ft)
        return void 0;
      if (isNamedCollectionFieldType(ft)) {
        return {
          entryBlock: ft.entryBlock,
          parentFieldType: ft,
          createContainer: () => new ft()
        };
      }
      return void 0;
    }
    const insideError = cstNode.type === "ERROR";
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
      const element = elements[elementIndex];
      if (element.type === "comment") {
        attacher.pushLeadingNode(element);
        continue;
      }
      if (element.isMissing) {
        continue;
      }
      if (element.type === "ERROR") {
        const errorResult = this.parseMapping(element, schema2);
        for (const key of Object.keys(schema2)) {
          if (key in errorResult.value)
            fields[key] = errorResult.value[key];
        }
        const errorRecord = errorResult.value;
        const errorChildren = Array.isArray(errorRecord.__children) ? errorRecord.__children : [];
        const recoveredSchemaFields = Object.keys(schema2).some((k) => k in errorResult.value && errorResult.value[k] !== void 0);
        if (errorChildren.length > 0 && recoveredSchemaFields) {
          children.push(...errorChildren);
        } else {
          const errBlock = errorBlockFromNode(element);
          if (errBlock)
            children.push(errBlock);
        }
        if (!insideError) {
          const recoveredSchemaContent = Object.keys(schema2).some((k) => k in errorResult.value && errorResult.value[k] !== void 0);
          if (!recoveredSchemaContent) {
            const text = element.text?.trim();
            if (text) {
              dc.add(createParserDiagnostic(element, `Unrecognized syntax: ${text.length > 40 ? text.slice(0, 40) + "\u2026" : text}`, "syntax-error"));
            }
          }
        }
        dc.merge(errorResult);
        continue;
      }
      if (element.type !== "mapping_element") {
        if (element.type in statementParsers || element.type === "comment" || element.type === "key" || element.type === "expression_with_to" || element.type === "expression" || element.type === "variable_declaration" || element.type === "procedure") {
          continue;
        }
        const errBlock = errorBlockFromNode(element);
        if (errBlock)
          children.push(errBlock);
        continue;
      }
      const dedentedCommentsForNextField = [];
      const [typeId, nameId] = this.getKeyIds(element);
      const rawFieldType = schema2[typeId];
      let fieldType = Array.isArray(rawFieldType) ? rawFieldType[0] : rawFieldType;
      if (!fieldType) {
        fieldType = resolveWildcardField(schema2, typeId);
      }
      const inlineComments2 = this.parseInlineComments(element);
      const elementComments = this.parseElementComments(element);
      if (!fieldType) {
        if (!insideError) {
          const keyNode = element.childForFieldName("key");
          const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
          const keyRange = keyChildren?.[0] ? toRange(keyChildren[0]) : toRange(element);
          const parentPath = this.buildContextPath(element.parent ?? element);
          const isRootLevel = parentPath.length === 0;
          const schemaKeys = Object.keys(schema2);
          const suggestion = findSuggestion(typeId, schemaKeys);
          const baseMessage = isRootLevel ? `Unknown block: ${typeId}` : `Unknown field \`${typeId}\` in ${parentPath.join(" ")}`;
          const message = formatSuggestionHint(baseMessage, suggestion);
          const code = isRootLevel ? "unknown-block" : "unknown-field";
          const ownDiag = createDiagnostic(keyRange, message, DiagnosticSeverity.Warning, code, {
            ...suggestion ? { suggestion } : {},
            expected: schemaKeys
          });
          dc.add(ownDiag);
        }
        const { blockValue: blockValue2, colinearValue: colinearValue2, procedure: procedure2 } = getValueNodes(element);
        const mappingNode = blockValue2?.type === "mapping" ? blockValue2 : null;
        if (colinearValue2) {
          const expr = this.parseExpression(colinearValue2);
          const ft = untypedFieldType(element.text, element.startCol);
          const fc = new FieldChild(typeId, expr, ft);
          attachElementText(fc, element);
          if (attacher.hasPending) {
            attacher.drainAsErrorBlocks(children);
          }
          children.push(fc);
        } else {
          const untypedBlock = new UntypedBlock(typeId, nameId, element.text, element.startCol);
          untypedBlock.__cst = { node: element, range: toRange(element) };
          attacher.consumeOnto(untypedBlock);
          if (mappingNode) {
            const keyRow = element.startPosition.row;
            const preBlockComments = [];
            const postBlockComments = [];
            let seenMapping = false;
            for (const child of element.namedChildren) {
              if (child === mappingNode) {
                seenMapping = true;
                continue;
              }
              if (child.type === "comment" && child.startPosition.row !== keyRow) {
                const target = seenMapping ? postBlockComments : preBlockComments;
                target.push(new ErrorBlock(`# ${parseCommentNode(child, "leading").value}`, 0));
              }
            }
            const innerResult = this.parseMappingElements(mappingNode.namedChildren, {}, mappingNode);
            const innerRecord = innerResult.value;
            const innerChildren = Array.isArray(innerRecord.__children) ? innerRecord.__children : [];
            untypedBlock.__children = [
              ...preBlockComments,
              ...innerChildren,
              ...postBlockComments
            ];
            untypedBlock.__diagnostics.push(...innerResult.diagnostics);
          } else if (procedure2 && procedure2.type === "procedure") {
            const statements = this.parseProcedure(procedure2);
            for (const stmt of statements) {
              untypedBlock.__children.push(new StatementChild(stmt));
            }
          }
          defineFieldAccessors(untypedBlock, untypedBlock.__children);
          children.push(untypedBlock);
        }
        continue;
      }
      if (fieldType.__metadata?.deprecated) {
        const keyNode = element.childForFieldName("key");
        const keyIds = keyNode?.namedChildren.filter((n) => n.type === "id");
        const keyRange = keyIds?.[0] ? toRange(keyIds[0]) : toRange(element);
        const dep = fieldType.__metadata.deprecated;
        const msg = dep.message ? `'${typeId}' is deprecated: ${dep.message}` : `'${typeId}' is deprecated`;
        const depDiag = new DeprecatedFieldDiagnostic(keyRange, msg, dep.replacement);
        dc.add(depDiag);
      }
      const { blockValue, colinearValue, procedure } = getValueNodes(element);
      const valueNode = blockValue ?? colinearValue ?? procedure;
      const entryInfo = resolveEntryInfo(fieldType, typeId);
      if (nameId && entryInfo) {
        const hasBody = !!(blockValue || colinearValue || procedure);
        let adoptedSiblings;
        if (!hasBody) {
          const result = collectAdoptedSiblings(elements, elementIndex, element.startCol);
          if (result) {
            adoptedSiblings = result.adopted;
            elementIndex = result.newIndex;
          }
        }
        const { entryBlock, parentFieldType, createContainer } = entryInfo;
        collections[typeId] ?? (collections[typeId] = createContainer());
        const { value: parsedValue, extraComments, diagnostics: entryDiagnostics } = this.parseNamedEntry(entryBlock, element, nameId, inlineComments2, adoptedSiblings);
        attacher.consumeOnto(parsedValue, extraComments);
        collections[typeId].set(nameId, parsedValue);
        const namedFc = new FieldChild(typeId, parsedValue, parentFieldType, nameId, getElementKeyRange(element));
        children.push(namedFc);
        dc.mergeAll(entryDiagnostics);
      } else if (nameId && isSingularFieldType(fieldType)) {
        const keyNode = element.childForFieldName("key");
        const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
        const nameKeyNode = keyChildren?.[1];
        const nameRange = nameKeyNode ? toRange(nameKeyNode) : getElementKeyRange(element);
        if (nameRange) {
          dc.add(createDiagnostic(nameRange, `Unexpected name \`${nameId}\` on \`${typeId}\` \u2014 this field does not take a name`, DiagnosticSeverity.Error, "unexpected-block-name"));
        }
        const singularField = fieldType;
        if (valueNode) {
          const result = singularField.parse(valueNode, this);
          attacher.consumeOnto(result.value, inlineComments2);
          fields[typeId] = result.value;
          const singularFc = new FieldChild(typeId, result.value, fieldType, void 0, getElementKeyRange(element));
          children.push(singularFc);
          dc.merge(result);
        }
      } else if (entryInfo && entryInfo.entryBlock.allowAnonymous) {
        if (valueNode) {
          const keyNode = element.childForFieldName("key");
          const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
          const keyRange = keyChildren?.[0] ? toRange(keyChildren[0]) : toRange(element);
          const anonDiag = createDiagnostic(keyRange, `Anonymous ${typeId} name is not allowed`, DiagnosticSeverity.Warning, "anonymous-named-block");
          dc.add(anonDiag);
          const idx2 = anonymousCounts[typeId] = (anonymousCounts[typeId] ?? 0) + 1;
          const syntheticName = `ILLEGAL_anonymous_${typeId}_${idx2}`;
          const { entryBlock: anonEntryBlock, parentFieldType: anonParentFt, createContainer } = entryInfo;
          collections[typeId] ?? (collections[typeId] = createContainer());
          const { value: parsedValue, extraComments, diagnostics: entryDiagnostics } = this.parseNamedEntry(anonEntryBlock, element, syntheticName, inlineComments2);
          attacher.consumeOnto(parsedValue, extraComments);
          collections[typeId].set(syntheticName, parsedValue);
          const anonFc = new FieldChild(typeId, parsedValue, anonParentFt, syntheticName, getElementKeyRange(element));
          children.push(anonFc);
          dc.mergeAll(entryDiagnostics);
        }
      } else if (isSingularFieldType(fieldType)) {
        let adoptedElements;
        if (fieldType.__fieldKind === "Block" && valueNode) {
          const result2 = collectAdoptedSiblings(elements, elementIndex, element.startCol);
          if (result2) {
            const bodyColumn = valueNode.startCol;
            const adopted = result2.adopted.filter((c) => c.startCol >= bodyColumn);
            if (adopted.length > 0) {
              adoptedElements = adopted;
              elementIndex = result2.newIndex;
            }
          }
        }
        const result = this.parseSingularField(fieldType, typeId, element, valueNode, inlineComments2, elementComments, attacher, adoptedElements);
        if (result) {
          fields[typeId] = result.value;
          const singularFc = new FieldChild(typeId, result.value, fieldType, void 0, getElementKeyRange(element));
          children.push(singularFc);
          dc.mergeAll(result.diagnostics);
          dedentedCommentsForNextField.push(...result.dedentedComments);
          for (const child of element.children) {
            if (child.isError) {
              const errBlock = errorBlockFromNode(child);
              if (errBlock)
                children.push(errBlock);
            }
          }
        } else {
          const errBlock = errorBlockFromNode(element);
          if (errBlock)
            children.push(errBlock);
          if (!valueNode) {
            dc.add(createDiagnostic(element, `Missing value for '${typeId}'`, DiagnosticSeverity.Error, "missing-value"));
          }
        }
      }
      attacher.setPending(dedentedCommentsForNextField);
    }
    attacher.flush();
    for (const map of Object.values(collections)) {
      if (!map.__cst) {
        map.__cst = { node: cstNode, range: toRange(cstNode) };
      }
    }
    const value = {
      ...fields,
      ...collections,
      __children: children
    };
    const parsed = withCst(value, cstNode);
    parsed.__diagnostics = dc.own;
    return parseResult(parsed, dc.all);
  }
  /**
   * Parse a singular field value (Block, TypedMap, or Primitive).
   * Handles comment splitting (before/after body), dedented comment detection,
   * and key-only fallbacks for empty blocks and typed maps.
   */
  parseSingularField(singularField, typeId, element, valueNode, inlineComments2, elementComments, attacher, extraElements) {
    const dedentedComments = [];
    if (valueNode) {
      const result = singularField.parse(valueNode, this, extraElements);
      const containerOnlyComments = elementComments.filter((c) => c.range?.start.line !== element.startRow);
      const { beforeBody, afterBody } = this.splitContainerComments(containerOnlyComments, valueNode);
      if (singularField.__fieldKind === "TypedMap" || singularField.__fieldKind === "Collection") {
        this.attachToFirstTypedMapEntry(result.value, beforeBody);
      } else if (singularField.__fieldKind === "Primitive") {
        this.attachToFirstProcedureStatement(result.value, beforeBody);
      } else if (singularField.__fieldKind === "Block" && beforeBody.length > 0) {
        const blockObj = result.value;
        const firstChildKey = Object.keys(blockObj).find((k) => !k.startsWith("__") && blockObj[k] && typeof blockObj[k] === "object");
        if (firstChildKey) {
          attach(blockObj[firstChildKey], beforeBody);
        }
      }
      let remainingAfterBody = afterBody;
      if (singularField.__fieldKind === "Primitive") {
        const nestedAfterBody = afterBody.filter((c) => c.range.start.character > element.startCol);
        const dedentedAfterBody = afterBody.filter((c) => c.range.start.character <= element.startCol);
        const attachedToLastStmt = this.attachToLastProcedureStatement(result.value, nestedAfterBody);
        remainingAfterBody = attachedToLastStmt ? [] : nestedAfterBody;
        if (dedentedAfterBody.length > 0) {
          dedentedComments.push(...dedentedAfterBody);
        }
      }
      attacher.consumeOnto(result.value, [
        ...inlineComments2,
        ...remainingAfterBody
      ]);
      if (singularField.__fieldKind === "Primitive" && result.diagnostics.length > 0) {
        const parsed = result.value;
        if (parsed.__diagnostics) {
          parsed.__diagnostics.push(...result.diagnostics);
        }
      }
      return {
        value: result.value,
        dedentedComments,
        diagnostics: result.diagnostics
      };
    }
    if (singularField.__fieldKind === "Block") {
      const blockType = singularField;
      const result = blockType.fromParsedFields({}, element, []);
      attacher.consumeOnto(result.value);
      return { value: result.value, dedentedComments, diagnostics: [] };
    }
    if (singularField.__fieldKind === "TypedMap") {
      const entries = NamedMap.forCollection(typeId);
      entries.__cst = { node: element, range: toRange(element) };
      attacher.consumeOnto(entries);
      return { value: entries, dedentedComments, diagnostics: [] };
    }
    if (singularField.__fieldKind === "Collection") {
      const result = singularField.parse(element, this);
      attacher.consumeOnto(result.value);
      return { value: result.value, dedentedComments, diagnostics: [] };
    }
    return null;
  }
  /** Extract comments on the same line as an element (inline comments). */
  parseInlineComments(element) {
    return element.children.filter((c) => c.type === "comment" && c.startRow === element.startRow).map((c) => this.parseComment(c, "inline"));
  }
  /** Extract all comment children from an element. */
  parseElementComments(element) {
    return element.children.filter((c) => c.type === "comment").map((c) => this.parseComment(c));
  }
  /**
   * Split comments into those before and after a value node's range.
   *
   * Comments without source range info (programmatic comments) are always
   * placed in `beforeBody`. The `afterBody` array is guaranteed to contain
   * only comments with range info, since only comments whose source line
   * falls after the value node can land there.
   */
  splitContainerComments(comments, valueNode) {
    if (!valueNode) {
      return { beforeBody: comments, afterBody: [] };
    }
    const beforeBody = [];
    const afterBody = [];
    for (const c of comments) {
      const line = c.range?.start.line;
      if (line === void 0) {
        beforeBody.push(c);
        continue;
      }
      if (line < valueNode.startRow) {
        beforeBody.push(c);
        continue;
      }
      if (line > valueNode.endRow) {
        const trailing = { ...c, attachment: "trailing" };
        if (hasRange(trailing)) {
          afterBody.push(trailing);
        }
        continue;
      }
      beforeBody.push(c);
    }
    return { beforeBody, afterBody };
  }
  /** Attach comments to the first entry of a TypedMap-like value. */
  attachToFirstTypedMapEntry(value, comments) {
    if (comments.length === 0)
      return;
    if (!isNamedMap(value))
      return;
    const iterator = value.entries();
    const first = iterator.next();
    if (first.done)
      return;
    attach(first.value[1], comments);
  }
  /** Attach comments to the first statement in a procedure-like value. */
  attachToFirstProcedureStatement(value, comments) {
    if (comments.length === 0)
      return;
    if (!hasProcedureStatements(value))
      return;
    attach(value.statements[0], comments);
  }
  /** Attach comments as trailing to the last statement in a procedure-like value. */
  attachToLastProcedureStatement(value, comments) {
    if (comments.length === 0)
      return false;
    if (!hasProcedureStatements(value))
      return false;
    const lastStmt = value.statements[value.statements.length - 1];
    const tagged = comments.map((c) => ({
      ...c,
      attachment: "trailing"
    }));
    attach(lastStmt, tagged);
    return true;
  }
  parseNamedEntry(FieldType, element, nameId, inlineComments2, adoptedSiblings) {
    const { blockValue, colinearValue, procedure } = getValueNodes(element);
    const valueNode = blockValue ?? colinearValue ?? procedure;
    const dc = new DiagnosticCollector();
    const nonInlineElementComments = element.children.filter((c) => c.type === "comment").filter((c) => c.startRow !== element.startRow).map((c) => this.parseComment(c, "trailing"));
    let parsedValue;
    if (valueNode) {
      const result = FieldType.parse(valueNode, nameId, this);
      parsedValue = result.value;
      dc.merge(result);
    } else {
      const result = FieldType.parse(element, nameId, this, adoptedSiblings);
      parsedValue = result.value;
      dc.merge(result);
    }
    return {
      value: parsedValue,
      extraComments: [...inlineComments2, ...nonInlineElementComments],
      diagnostics: dc.all
    };
  }
  /** Returns [typeId, nameId?] where nameId is present for 2-id keys. */
  getKeyIds(element) {
    const keyNode = element.childForFieldName("key");
    if (!keyNode)
      return ["", void 0];
    const keyChildren = keyNode.namedChildren.filter(isKeyNode);
    if (keyChildren.length === 2) {
      return [getKeyText(keyChildren[0]), getKeyText(keyChildren[1])];
    }
    return [keyChildren[0] ? getKeyText(keyChildren[0]) : "", void 0];
  }
  /** Parse an expression from CST, dispatching by node type. */
  parseExpression(node) {
    if (!node) {
      return new Identifier("");
    }
    if (node.isMissing) {
      const expr = withCst(new ErrorValue(""), node);
      expr.__diagnostics.push(createParserDiagnostic(missingNodeRange(node), `Missing ${node.type}`, "missing-token"));
      return expr;
    }
    if (node.isError) {
      const text = node.text?.trim();
      const expr = withCst(new Identifier(text || ""), node);
      expr.__diagnostics.push(createParserDiagnostic(node, text ? `Syntax error: unexpected \`${text.length > 40 ? text.slice(0, 40) + "\u2026" : text}\`` : "Syntax error", "syntax-error"));
      return expr;
    }
    if (node.type === "atom" || node.type === "expression") {
      return this.unwrapExpression(node);
    }
    if (node.type === "expression_with_to") {
      const exprNode = node.childForFieldName("expression");
      if (exprNode)
        return this.parseExpression(exprNode);
    }
    if (node.type === "parenthesized_expression") {
      if (node.namedChildren.length > 0) {
        return this.parseExpression(node.namedChildren[0]);
      }
    }
    const expressionParserMap = expressionParsers;
    const parser = expressionParserMap[node.type];
    if (parser) {
      const result = parser(node, (n) => this.parseExpression(n));
      return result;
    }
    const fallback = withCst(new Identifier(node.text), node);
    return fallback;
  }
  /** Unwrap atom/expression wrapper nodes that delegate to children. */
  unwrapExpression(node) {
    if (node.namedChildren.length > 0) {
      return this.parseExpression(node.namedChildren[0]);
    }
    const text = node.text;
    if (text === "True" || text === "False") {
      return withCst(new BooleanLiteral(text === "True"), node);
    }
    if (text === "None") {
      return withCst(new NoneLiteral(), node);
    }
    if (text === "...") {
      return withCst(new Ellipsis(), node);
    }
    return this.parseExpression(node.children[0]);
  }
  parseProcedure(node) {
    const children = node.type === "procedure" || node.type === "mapping" ? node.namedChildren : [node];
    return this.parseStatementNodes(children, true);
  }
  /**
   * Parse both mapping fields and statements from a block body node.
   * Works uniformly for procedure, mapping, or mixed block bodies.
   */
  parseBlockContent(node, blockSchema, options) {
    const mappingResult = this.parseMapping(node, blockSchema, void 0, {
      preserveOrphanedStatements: false,
      discriminant: options?.discriminant
    });
    const statements = this.parseStatementNodes(node.namedChildren);
    return {
      fields: mappingResult.value,
      statements,
      diagnostics: mappingResult.diagnostics
    };
  }
  /**
   * Parse an array of CST nodes as statements.
   * @param procedureContext When true, mapping_element nodes are flagged as
   *   invalid (procedures should only contain statements). When false
   *   (default), mapping_element and comment nodes are silently skipped
   *   because they are handled by parseMapping in parseBlockContent.
   */
  parseStatementNodes(nodes, procedureContext = false) {
    const statements = [];
    const attacher = new CommentAttacher();
    for (const node of nodes) {
      if (node.type === "comment") {
        if (!attacher.tryAttachInline(node, statements[statements.length - 1])) {
          attacher.pushLeadingNode(node);
        }
        continue;
      }
      if (node.isMissing) {
        const missing = withCst(new UnknownStatement(""), node);
        missing.__diagnostics.push(createParserDiagnostic(missingNodeRange(node), `Missing ${node.type}`, "missing-token"));
        statements.push(missing);
        continue;
      }
      if (node.type === "ERROR") {
        const text = node.text.trim();
        if (text) {
          const unknown2 = withCst(new UnknownStatement(text), node);
          unknown2.__diagnostics.push(createParserDiagnostic(node, `Unrecognized syntax${this.formatStatementContext(node)}: ${text.length > 40 ? text.slice(0, 40) + "\u2026" : text}`, "syntax-error"));
          statements.push(unknown2);
        }
        continue;
      }
      const result = this.parseStatement(node, procedureContext);
      if (!result)
        continue;
      if (Array.isArray(result)) {
        attacher.consumeOntoFirst(result);
        statements.push(...result);
      } else {
        attacher.consumeOnto(result);
        statements.push(result);
      }
    }
    attacher.flush();
    return statements;
  }
  /**
   * Parse a single statement from CST.
   * May return an array for desugared nodes (e.g. comma-separated with clauses).
   * Returns an UnknownStatement with a diagnostic for unrecognized node types
   * in procedure context, so content is never silently dropped.
   */
  parseStatement(node, procedureContext = false) {
    const parser = statementParsers[node.type];
    if (!parser) {
      if (node.type === "comment") {
        return null;
      }
      if (!procedureContext && node.type === "mapping_element") {
        return null;
      }
      const text = node.text.trim();
      if (!text)
        return null;
      const unknown2 = withCst(new UnknownStatement(text), node);
      unknown2.__diagnostics.push(createParserDiagnostic(node, `Unrecognized syntax${this.formatStatementContext(node)}: ${text}`, "syntax-error"));
      return unknown2;
    }
    const parsed = parser(node, (n) => this.parseExpression(n), (n) => this.parseProcedure(n), (n) => this.parseStatement(n));
    const inlineComments2 = node.namedChildren.filter((c) => c.type === "comment" && c.startRow === node.startRow).map((c) => this.parseComment(c, "inline"));
    if (inlineComments2.length > 0) {
      if (Array.isArray(parsed)) {
        if (parsed.length > 0) {
          attach(parsed[parsed.length - 1], inlineComments2);
        }
      } else {
        attach(parsed, inlineComments2);
      }
    }
    return parsed;
  }
  parseVariableDeclaration(node) {
    let modifier;
    let typeExpr;
    let defaultValue;
    if (node.type === "variable_declaration") {
      const modifierNode = node.children.find((c) => c.type === "mutable" || c.type === "linked");
      if (modifierNode) {
        modifier = withCst(new Identifier(modifierNode.text), modifierNode);
      }
      const typeNode = node.childForFieldName("type");
      const defaultNode = node.childForFieldName("default");
      typeExpr = typeNode ? this.parseExpression(typeNode) : withCst(new Identifier("unknown"), node);
      defaultValue = defaultNode ? this.parseExpression(defaultNode) : void 0;
    } else if (node.type === "assignment_expression") {
      const leftNode = node.childForFieldName("left");
      const rightNode = node.childForFieldName("right");
      typeExpr = leftNode ? this.parseExpression(leftNode) : withCst(new Identifier("unknown"), node);
      defaultValue = rightNode ? this.parseExpression(rightNode) : void 0;
    } else {
      typeExpr = this.parseExpression(node);
    }
    return withCst(new VariableDeclarationNode({
      type: typeExpr,
      defaultValue,
      modifier
    }), node);
  }
  emit(value, indent = 0) {
    const ctx = { indent };
    if (isEmittable(value)) {
      return value.__emit(ctx);
    }
    if (typeof value === "string") {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
      return `"${escaped}"`;
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "True" : "False";
    }
    return String(value);
  }
};

// ../language/dist/core/emit.js
function isBlockChildArray(value) {
  return Array.isArray(value);
}
function emitDocument(parsed, schema2, options) {
  const ctx = { indent: 0, tabSize: options?.tabSize };
  const rawChildren = parsed.__children;
  if (isBlockChildArray(rawChildren) && rawChildren.length > 0) {
    const emitted2 = emitChildren(rawChildren, ctx, "\n\n");
    return wrapWithComments(emitted2, parsed, ctx);
  }
  const emitted = emitFromSchema(parsed, schema2, ctx);
  return wrapWithComments(emitted, parsed, ctx);
}
function emitFromSchema(parsed, schema2, ctx) {
  const parts = [];
  for (const [key, fieldType] of Object.entries(schema2)) {
    const value = parsed[key];
    if (value === void 0)
      continue;
    if (isNamedMap(value) && isNamedCollectionFieldType(fieldType)) {
      for (const [, entry] of value) {
        if (isNamedBlockValue(entry)) {
          parts.push(wrapWithComments(entry.emitWithKey(key, ctx), entry, ctx));
        }
      }
    } else if (fieldType.emitField) {
      const s = fieldType.emitField(key, value, ctx);
      if (s)
        parts.push(wrapWithComments(s, value, ctx));
    } else if (fieldType.emit) {
      const indent = emitIndent(ctx);
      parts.push(wrapWithComments(`${indent}${key}: ${fieldType.emit(value, ctx)}`, value, ctx));
    }
  }
  return parts.join("\n\n");
}

// ../language/dist/blocks.js
var VariablePropertiesBlock = Block("VariablePropertiesBlock", {
  description: StringValue.describe("Human-readable description."),
  label: StringValue.describe("Display label shown in the UI."),
  is_required: BooleanValue.describe("Whether this variable is required.")
}, { symbol: { kind: SymbolKind.Object, noRecurse: true } }).describe("Properties for a variable declaration.");
var InputPropertiesBlock = Block("InputPropertiesBlock", {
  label: StringValue.describe("Display label shown in the UI."),
  description: StringValue.describe("Human-readable description."),
  is_required: BooleanValue.describe("Whether this input is required.")
}, { symbol: { kind: SymbolKind.Object, noRecurse: true } }).describe("Properties for an action input parameter.");
var OutputPropertiesBlock = Block("OutputPropertiesBlock", {
  label: StringValue.describe("Display label shown in the UI."),
  description: StringValue.describe("Human-readable description.")
}, { symbol: { kind: SymbolKind.Object, noRecurse: true } }).describe("Properties for an action output parameter.");
var VariablesBlock = TypedMap("VariablesBlock", VariablePropertiesBlock, {
  modifiers: VARIABLE_MODIFIERS,
  primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES
}).describe("Global variable declarations with modifiers, types, and defaults.").example(`variables:
    # Mutable types with defaults
    user_name: mutable string = ""
        description: "The customer's name"
    request_count: mutable number = 0
        description: "Number of requests in this session"
    verified: mutable boolean = False
        description: "Whether identity has been verified"
    user_data: mutable object = {}
        description: "Arbitrary user profile data"
    order_items: mutable list[object] = []
        description: "List of items in the current order"
    join_date: mutable date
        description: "When the customer joined"

    # Mutable without default value
    order_id: mutable string
        description: "Current order ID"

    # Variable with display label
    loyalty_tier: mutable string = "basic"
        label: "Loyalty Tier"
        description: "The customer's loyalty program tier"

    # Linked variables (sourced from external context, read-only)
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId
        description: "The messaging end user ID"
    ContactId: linked string
        source: @MessagingEndUser.ContactId
        description: "The contact ID from messaging"`);
var InputsBlock = TypedMap("InputsBlock", InputPropertiesBlock, {
  modifiers: VARIABLE_MODIFIERS,
  primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES
}).describe("Action input parameter declarations.");
var OutputsBlock = TypedMap("OutputsBlock", OutputPropertiesBlock, {
  modifiers: VARIABLE_MODIFIERS,
  primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES
}).describe("Action output parameter declarations.").crossBlockReferenceable();
var ActionBlock = NamedBlock("ActionBlock", {
  description: StringValue.describe("Description of what the action does."),
  label: StringValue.describe("Display label shown in the UI."),
  inputs: InputsBlock,
  outputs: OutputsBlock,
  target: StringValue.describe('External implementation target URI (e.g., "flow://Action_Name").'),
  source: StringValue.describe("Global namespace function name or legacy action identifier.")
}, {
  symbol: { kind: SymbolKind.Method },
  scopeAlias: "action",
  capabilities: ["invocationTarget"]
}).describe("Action definition representing an external tool or flow.").example(`    actions:
        Lookup_Order:
            description: "Retrieve order details by order number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Order status"
            target: "flow://Lookup_Order"`);
var ActionsBlock = CollectionBlock(ActionBlock).describe("Collection of action definitions.");
var ReasoningActionBlock = NamedBlock("ReasoningActionBlock", {
  description: StringValue.describe("Description of the tool provided to the LLM. Overrides the action description."),
  label: StringValue.describe("Human-readable label for the tool. Not provided to the LLM.")
}, {
  colinear: ExpressionValue,
  body: ProcedureValue,
  symbol: { kind: SymbolKind.Method },
  scopeAlias: "action"
}).describe("Action made available to the agent to choose during reasoning.").example(`        actions:
            lookup: @actions.Lookup_Order
                with order_number=@variables.order_number
                set @variables.status = @outputs.status`);
var ReasoningActionsBlock = CollectionBlock(ReasoningActionBlock).describe("Collection of reasoning action bindings.");

// ../language/dist/core/analysis/scope.js
function createSchemaContext(info) {
  const scopedNamespaces = buildScopedNamespaces(info);
  const scopeNavigation = buildScopeNavigation(info);
  const namespaceMetadata = buildNamespaceMetadata(info, scopedNamespaces);
  const schemaNamespaces = new Set(Object.keys(info.schema));
  const reservedNamespaces = /* @__PURE__ */ new Set([
    ...schemaNamespaces,
    ...scopedNamespaces.keys(),
    ...Object.keys(info.aliases),
    ...Object.values(info.aliases)
  ]);
  const globalScopes = /* @__PURE__ */ new Map();
  if (info.globalScopes) {
    for (const [ns, scope] of Object.entries(info.globalScopes)) {
      if (reservedNamespaces.has(ns)) {
        throw new Error(`Global scope namespace '${ns}' collides with an existing namespace. Global scopes must use unique namespaces that don't overlap with schema keys, scoped namespaces, or aliases. This is a configuration error in the dialect's SchemaInfo.`);
      }
      globalScopes.set(ns, scope);
      if (!namespaceMetadata.has(ns)) {
        namespaceMetadata.set(ns, { kind: SymbolKind.Namespace });
      }
    }
  }
  const referenceableFields = collectReferenceableFields(info.schema);
  const colinearResolvedScopes = new Set([...scopedNamespaces.keys()].filter((ns) => referenceableFields.has(ns)));
  const capabilityNamespaces = buildCapabilityNamespaces(info);
  return {
    info,
    scopedNamespaces,
    scopeNavigation,
    namespaceMetadata,
    schemaNamespaces,
    globalScopes,
    colinearResolvedScopes,
    invocationTargetNamespaces: capabilityNamespaces.invocationTarget,
    transitionTargetNamespaces: capabilityNamespaces.transitionTarget
  };
}
function resolveNamespaceKeys(namespace, ctx) {
  const { aliases, extraNamespaceKeys } = ctx.info;
  let root = namespace;
  while (aliases[root]) {
    root = aliases[root];
  }
  const keys = /* @__PURE__ */ new Set([namespace, root]);
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (canonical === root) {
      keys.add(alias);
    }
  }
  if (extraNamespaceKeys?.[namespace]) {
    for (const extra of extraNamespaceKeys[namespace]) {
      keys.add(extra);
    }
  }
  return [...keys];
}
function getScopedNamespaces(ctx) {
  return ctx.scopedNamespaces;
}
function activeScopeForNamespace(scopesRequired, scope) {
  if (!scopesRequired || !scope)
    return void 0;
  for (const s of scopesRequired) {
    if (scope[s])
      return s;
  }
  return void 0;
}
function getScopeNavigation(ctx) {
  return ctx.scopeNavigation;
}
function getNamespaceMetadata(ctx) {
  return ctx.namespaceMetadata;
}
function getSchemaNamespaces(ctx) {
  return ctx.schemaNamespaces;
}
function getGlobalScopes(ctx) {
  return ctx.globalScopes;
}
function isTypedMapField(ft) {
  return ft.__fieldKind === "TypedMap";
}
function isCollectionField(ft) {
  return ft.__isCollection === true;
}
function resolveFieldType(ft) {
  return Array.isArray(ft) ? ft[0] : ft;
}
function buildScopedNamespaces(schemaInfo) {
  const result = /* @__PURE__ */ new Map();
  for (const [, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);
    const scopeAlias = fieldType.scopeAlias;
    const schema2 = fieldType.schema;
    if ((fieldType.isNamed || isCollectionField(fieldType)) && scopeAlias && schema2) {
      collectScopedFields(schema2, scopeAlias, result);
    }
  }
  return result;
}
function addScopedField(result, fieldName, scope) {
  let scopes = result.get(fieldName);
  if (!scopes) {
    scopes = /* @__PURE__ */ new Set();
    result.set(fieldName, scopes);
  }
  scopes.add(scope);
}
function collectScopedFields(schema2, parentScope, result) {
  for (const [fieldName, rawFt] of Object.entries(schema2)) {
    const fieldType = resolveFieldType(rawFt);
    if (fieldType.isNamed) {
      addScopedField(result, fieldName, parentScope);
      if (fieldType.scopeAlias && fieldType.schema) {
        collectScopedFields(fieldType.schema, fieldType.scopeAlias, result);
      }
    } else if (isCollectionField(fieldType)) {
      addScopedField(result, fieldName, parentScope);
      if (fieldType.scopeAlias && fieldType.schema) {
        collectScopedFields(fieldType.schema, fieldType.scopeAlias, result);
      }
    } else if (isTypedMapField(fieldType)) {
      addScopedField(result, fieldName, parentScope);
    } else if (fieldType.schema && !fieldType.isNamed) {
      collectScopedFields(fieldType.schema, parentScope, result);
    }
  }
}
function collectReferenceableFields(schema2) {
  const result = /* @__PURE__ */ new Set();
  walkForReferenceable(schema2, result);
  return result;
}
function walkForReferenceable(schema2, result) {
  for (const [fieldName, fieldType] of Object.entries(schema2)) {
    if (fieldType.__metadata?.crossBlockReferenceable) {
      result.add(fieldName);
    }
    if (fieldType.schema) {
      walkForReferenceable(fieldType.schema, result);
    }
  }
}
function buildCapabilityNamespaces(schemaInfo) {
  const result = {
    invocationTarget: /* @__PURE__ */ new Set(),
    transitionTarget: /* @__PURE__ */ new Set()
  };
  for (const [key, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);
    collectCapabilities(key, fieldType, result);
    if (fieldType.schema) {
      walkForCapabilities(fieldType.schema, result);
    }
  }
  return result;
}
function collectCapabilities(name, fieldType, result) {
  if (!fieldType.capabilities)
    return;
  for (const cap of fieldType.capabilities) {
    if (cap === "invocationTarget")
      result.invocationTarget.add(name);
    else if (cap === "transitionTarget")
      result.transitionTarget.add(name);
  }
}
function walkForCapabilities(schema2, result) {
  for (const [fieldName, rawFt] of Object.entries(schema2)) {
    const fieldType = resolveFieldType(rawFt);
    collectCapabilities(fieldName, fieldType, result);
    if (fieldType.schema) {
      walkForCapabilities(fieldType.schema, result);
    }
  }
}
function buildScopeNavigation(schemaInfo) {
  const registry2 = /* @__PURE__ */ new Map();
  for (const [key, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);
    if (!(fieldType.isNamed || isCollectionField(fieldType)) || !fieldType.scopeAlias)
      continue;
    const existing = registry2.get(fieldType.scopeAlias);
    if (existing) {
      if (!existing.rootKeys.includes(key))
        existing.rootKeys.push(key);
    } else {
      registry2.set(fieldType.scopeAlias, { rootKeys: [key] });
    }
    if (fieldType.schema) {
      walkSchemaForNavigation(fieldType.schema, fieldType.scopeAlias, registry2);
    }
  }
  return registry2;
}
function walkSchemaForNavigation(schema2, parentScope, registry2) {
  for (const [, rawFt] of Object.entries(schema2)) {
    const fieldType = resolveFieldType(rawFt);
    if ((fieldType.isNamed || isCollectionField(fieldType)) && fieldType.scopeAlias) {
      if (!registry2.has(fieldType.scopeAlias)) {
        registry2.set(fieldType.scopeAlias, {
          rootKeys: [],
          parentScope
        });
      }
      if (fieldType.schema) {
        walkSchemaForNavigation(fieldType.schema, fieldType.scopeAlias, registry2);
      }
    } else if (fieldType.schema && !fieldType.isNamed) {
      walkSchemaForNavigation(fieldType.schema, parentScope, registry2);
    }
  }
}
function buildNamespaceMetadata(schemaInfo, scopedNamespaces) {
  const { schema: schema2, aliases } = schemaInfo;
  const result = /* @__PURE__ */ new Map();
  for (const key of Object.keys(schema2)) {
    if (aliases[key])
      continue;
    result.set(key, { kind: SymbolKind.Namespace });
  }
  for (const [ns, scopesRequired] of scopedNamespaces) {
    result.set(ns, {
      kind: SymbolKind.Namespace,
      scopesRequired
    });
  }
  return result;
}
function updateScopeContext(obj, ctx) {
  if (obj.__scope && typeof obj.__name === "string") {
    return { ...ctx, [obj.__scope]: obj.__name };
  }
  return ctx;
}
function findScopeBlock(ast, targetScope, scope, ctx) {
  const info = getScopeNavigation(ctx).get(targetScope);
  if (!info)
    return null;
  const targetName = scope[targetScope];
  if (!targetName)
    return null;
  if (!info.parentScope) {
    for (const rootKey of info.rootKeys) {
      for (const key of resolveNamespaceKeys(rootKey, ctx)) {
        const map = ast[key];
        if (isNamedMap(map)) {
          const block = map.get(targetName);
          if (isAstNodeLike(block))
            return block;
        }
      }
    }
    return null;
  }
  const parentBlock = findScopeBlock(ast, info.parentScope, scope, ctx);
  if (!parentBlock)
    return null;
  return findNamedBlockInDescendants(parentBlock, targetName);
}
function findNamedBlockInDescendants(container, name) {
  let deferred;
  for (const [key, val] of Object.entries(container)) {
    if (key.startsWith("__") || !val || typeof val !== "object")
      continue;
    if (isNamedMap(val)) {
      const entry = val.get(name);
      if (isAstNodeLike(entry))
        return entry;
    } else if (isAstNodeLike(val)) {
      if (val.__kind && !val.__scope) {
        (deferred ?? (deferred = [])).push(val);
      }
    }
  }
  if (deferred) {
    for (const child of deferred) {
      const found = findNamedBlockInDescendants(child, name);
      if (found)
        return found;
    }
  }
  return null;
}
function collectNamespaceMaps(container, namespace, result = []) {
  const direct = container[namespace];
  if (isNamedMap(direct))
    result.push(direct);
  for (const [key, val] of Object.entries(container)) {
    if (key.startsWith("__") || !val || typeof val !== "object")
      continue;
    if (isNamedMap(val))
      continue;
    if (isAstNodeLike(val) && val.__kind && !val.__scope) {
      collectNamespaceMaps(val, namespace, result);
    }
  }
  return result;
}

// ../language/dist/core/analysis/ast-utils.js
function isPositionInRange(line, character, range) {
  if (line < range.start.line || line > range.end.line)
    return false;
  if (line === range.start.line && character < range.start.character)
    return false;
  if (line === range.end.line && character >= range.end.character)
    return false;
  return true;
}
var MAX_LINE_LENGTH = 1e6;
function rangeSize(range) {
  const lines = range.end.line - range.start.line;
  if (lines === 0)
    return range.end.character - range.start.character;
  return lines * MAX_LINE_LENGTH + (range.end.character - range.start.character);
}
function computeDetail(obj, kind, cst) {
  if (kind === "VariableDeclaration" || kind === "ParameterDeclaration") {
    const parts = [];
    const modifier = obj.modifier;
    if (isAstNodeLike(modifier) && modifier.__cst) {
      const text = modifier.__cst.node.text?.trim();
      if (text)
        parts.push(text);
    }
    const typeVal = obj.type;
    if (isAstNodeLike(typeVal) && typeVal.__cst) {
      const text = typeVal.__cst.node.text?.trim();
      if (text)
        parts.push(text);
    }
    const defaultValue = obj.defaultValue;
    if (isAstNodeLike(defaultValue) && defaultValue.__cst) {
      const text = defaultValue.__cst.node.text?.trim();
      if (text)
        parts.push("= " + text);
    }
    return parts.length > 0 ? parts.join(" ") : void 0;
  }
  if (kind === "StringLiteral") {
    const value = obj.value;
    if (typeof value === "string") {
      return value.length > 60 ? value.slice(0, 60) + "..." : value;
    }
    return void 0;
  }
  if (kind === "TemplateExpression") {
    return getValueText(cst);
  }
  if (kind === "BooleanValue") {
    const value = obj.value;
    return value === true ? "True" : value === false ? "False" : void 0;
  }
  if (kind === "NumberValue") {
    const value = obj.value;
    return value != null ? String(value) : void 0;
  }
  if (kind === "ProcedureValue") {
    return "->";
  }
  const label = obj.label;
  if (label instanceof StringLiteral) {
    return label.value;
  }
  return void 0;
}
function getValueText(cst) {
  const node = cst.node;
  if (node.type === "mapping_element") {
    const valueNode = node.childForFieldName("value");
    return valueNode?.text?.trim();
  }
  const text = node.text?.trim();
  if (text && text.length > 80)
    return text.slice(0, 80) + "...";
  return text || void 0;
}
function findMappingElement(node) {
  let current = node;
  while (current) {
    if (current.type === "mapping_element")
      return current;
    current = current.parent;
  }
  return null;
}

// ../language/dist/core/analysis/symbols.js
var SymbolTag;
(function(SymbolTag2) {
  SymbolTag2[SymbolTag2["Deprecated"] = 1] = "Deprecated";
})(SymbolTag || (SymbolTag = {}));
function getDocumentSymbols(ast) {
  const symbols = [];
  for (const [key, value] of Object.entries(ast)) {
    if (key.startsWith("__"))
      continue;
    if (value == null || typeof value !== "object")
      continue;
    if (isNamedMap(value)) {
      const mapSymbols = processMap(key, value, true);
      for (const sym of mapSymbols)
        symbols.push(sym);
      continue;
    }
    const symbol = extractSymbol(key, value);
    if (symbol)
      symbols.push(symbol);
  }
  const blockChildren = ast.__children;
  if (Array.isArray(blockChildren)) {
    for (const child of blockChildren) {
      if (isBlockChild(child) && child.__type === "untyped") {
        const sym = extractUntypedSymbol(child);
        if (sym)
          symbols.push(sym);
      }
    }
  }
  return symbols;
}
function processMap(key, map, isRoot) {
  const sym = map.__symbol;
  const cst = map.__cst;
  if (sym && cst) {
    const symbolKind = sym.kind;
    const { range, selectionRange } = computeRanges(cst);
    const detail = computeDetail(map, map.__kind, cst);
    if (sym.noRecurse) {
      return [
        {
          name: key,
          kind: symbolKind,
          range,
          selectionRange,
          ...detail ? { detail } : {}
        }
      ];
    }
    const children = [];
    for (const [entryName, entry] of map) {
      const entrySym = extractSymbol(entryName, entry);
      if (entrySym)
        children.push(entrySym);
    }
    return [
      {
        name: key,
        kind: symbolKind,
        range,
        selectionRange,
        ...detail ? { detail } : {},
        ...children.length > 0 ? { children } : {}
      }
    ];
  }
  if (isRoot) {
    const symbols = [];
    for (const [entryName, entry] of map) {
      const entrySym = extractSymbol(`${key} ${entryName}`, entry);
      if (entrySym)
        symbols.push(entrySym);
    }
    return symbols;
  }
  const containerSymbol = createMapContainerSymbol(key, map);
  return containerSymbol ? [containerSymbol] : [];
}
function extractSymbol(name, value) {
  if (!isAstNodeLike(value))
    return null;
  const obj = value;
  const sym = obj.__symbol;
  const cst = obj.__cst;
  if (!cst)
    return null;
  const symbolKind = sym?.kind ?? SymbolKind.Property;
  const { range, selectionRange } = computeRanges(cst);
  const detail = computeDetail(obj, obj.__kind, cst);
  if (!sym || sym.noRecurse) {
    return {
      name,
      kind: symbolKind,
      range,
      selectionRange,
      ...detail ? { detail } : {}
    };
  }
  const children = extractChildren2(obj);
  return {
    name,
    kind: symbolKind,
    range,
    selectionRange,
    ...detail ? { detail } : {},
    ...children.length > 0 ? { children } : {}
  };
}
function extractChildren2(obj) {
  const children = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("__"))
      continue;
    if (value == null || typeof value !== "object")
      continue;
    if (isNamedMap(value)) {
      const mapSymbols = processMap(key, value, false);
      for (const sym of mapSymbols)
        children.push(sym);
      continue;
    }
    const symbol = extractSymbol(key, value);
    if (symbol)
      children.push(symbol);
  }
  const blockChildren = obj.__children;
  if (Array.isArray(blockChildren)) {
    for (const child of blockChildren) {
      if (isBlockChild(child) && child.__type === "untyped") {
        const sym = extractUntypedSymbol(child);
        if (sym)
          children.push(sym);
      }
    }
  }
  return children;
}
function extractUntypedSymbol(block) {
  const cst = block.__cst;
  if (!cst)
    return null;
  const { range, selectionRange } = computeRanges(cst);
  const name = block.__blockName ? `${block.key} ${block.__blockName}` : block.key;
  const childSymbols = [];
  for (const child of block.__children) {
    if (isBlockChild(child)) {
      if (child.__type === "untyped") {
        const sym = extractUntypedSymbol(child);
        if (sym)
          childSymbols.push(sym);
      } else if (child.__type === "field") {
        const fc = child;
        const val = fc.value;
        const valCst = val && typeof val === "object" && "__cst" in val ? val.__cst : void 0;
        if (valCst) {
          const { range: r, selectionRange: sr } = computeRanges(valCst);
          childSymbols.push({
            name: fc.key,
            kind: SymbolKind.Property,
            range: r,
            selectionRange: sr
          });
        }
      }
    }
  }
  return {
    name,
    kind: SymbolKind.Property,
    range,
    selectionRange,
    ...childSymbols.length > 0 ? { children: childSymbols } : {}
  };
}
function createMapContainerSymbol(name, map) {
  const cst = map.__cst;
  const entryChildren = [];
  for (const [entryName, entry] of map) {
    const sym = extractSymbol(entryName, entry);
    if (sym)
      entryChildren.push(sym);
  }
  if (entryChildren.length === 0)
    return null;
  let range;
  let selectionRange;
  if (cst) {
    const ranges = computeRanges(cst);
    range = ranges.range;
    selectionRange = ranges.selectionRange;
  } else {
    range = {
      start: entryChildren[0].range.start,
      end: entryChildren[entryChildren.length - 1].range.end
    };
    selectionRange = range;
  }
  return {
    name,
    kind: SymbolKind.Namespace,
    range,
    selectionRange,
    children: entryChildren
  };
}
function computeRanges(cst) {
  const node = cst.node;
  if (node.type === "mapping_element") {
    const keyRange = getKeyRange(node);
    return {
      range: toRange(node),
      selectionRange: keyRange ?? toRange(node)
    };
  }
  const parent = node.parent;
  if (parent?.type === "mapping_element") {
    const keyRange = getKeyRange(parent);
    return {
      range: toRange(parent),
      selectionRange: keyRange ?? toRange(parent)
    };
  }
  return {
    range: cst.range,
    selectionRange: cst.range
  };
}
function getKeyRange(mappingElement) {
  const keyNode = mappingElement.childForFieldName("key");
  if (keyNode) {
    return toRange(keyNode);
  }
  return null;
}
function findNamespaceSymbol(children, namespace) {
  const direct = children.find((c) => c.name === namespace);
  if (direct)
    return direct;
  for (const child of children) {
    if (!child.children || child.kind !== SymbolKind.Namespace)
      continue;
    const found = findNamespaceSymbol(child.children, namespace);
    if (found)
      return found;
  }
  return void 0;
}
function resolveNamespace(symbols, namespace, ctx, scope) {
  if (scope) {
    const scopeChain = getScopeChain(scope, ctx);
    if (scopeChain.length > 0) {
      let currentChildren = symbols;
      for (const { level, info } of scopeChain) {
        const levelName = scope[level];
        let levelSym;
        if (!info.parentScope) {
          const keys = info.rootKeys.flatMap((k) => resolveNamespaceKeys(k, ctx));
          levelSym = currentChildren.find((s) => keys.some((k) => s.name === `${k} ${levelName}`));
        } else {
          for (const sym of currentChildren) {
            if (!sym.children)
              continue;
            const found = sym.children.find((c) => c.name === levelName);
            if (found) {
              levelSym = found;
              break;
            }
          }
        }
        if (!levelSym?.children)
          break;
        const nsSym = findNamespaceSymbol(levelSym.children, namespace);
        if (nsSym) {
          return (nsSym.children ?? []).map((c) => ({ name: c.name, symbol: c }));
        }
        currentChildren = levelSym.children;
      }
    }
  }
  const directSym = symbols.find((s) => s.name === namespace);
  if (directSym) {
    return (directSym.children ?? []).map((c) => ({ name: c.name, symbol: c }));
  }
  const prefixes = resolveNamespaceKeys(namespace, ctx).map((k) => k + " ");
  const promoted = [];
  for (const sym of symbols) {
    for (const prefix2 of prefixes) {
      if (sym.name.startsWith(prefix2)) {
        promoted.push({ name: sym.name.slice(prefix2.length), symbol: sym });
      }
    }
  }
  if (promoted.length > 0)
    return promoted;
  return null;
}
function getSymbolMembers(symbols, namespace, ctx, scope, position) {
  const entries = position ? resolveNamespaceBottomUp(symbols, namespace, position.line, position.character) : resolveNamespace(symbols, namespace, ctx, scope);
  return entries ? entries.map((e) => e.name) : null;
}
function getScopeChain(scope, ctx) {
  const nav = getScopeNavigation(ctx);
  const active = [];
  for (const [level, info] of nav) {
    if (!scope[level])
      continue;
    let depth = 0;
    let current = level;
    while (current) {
      const cur = nav.get(current);
      if (!cur?.parentScope)
        break;
      current = cur.parentScope;
      depth++;
    }
    active.push({ level, info, depth });
  }
  active.sort((a, b) => a.depth - b.depth);
  return active;
}
function getSymbolNamespaceEntries(symbols, namespace, ctx, scope, position) {
  if (position) {
    return resolveNamespaceBottomUp(symbols, namespace, position.line, position.character);
  }
  return resolveNamespace(symbols, namespace, ctx, scope);
}
function findSymbolEntry(symbols, namespace, name, ctx, scope, position) {
  const entries = getSymbolNamespaceEntries(symbols, namespace, ctx, scope, position);
  if (!entries)
    return null;
  return entries.find((e) => e.name === name)?.symbol ?? null;
}
function findContainingPath(symbols, line, character) {
  const path = [];
  let currentLevel = symbols;
  for (; ; ) {
    const containing = currentLevel.find((s) => isPositionInRange(line, character, s.range));
    if (!containing)
      break;
    path.push({ symbol: containing, siblings: currentLevel });
    if (!containing.children)
      break;
    currentLevel = containing.children;
  }
  return path;
}
function findNamespaceInLevel(siblings, namespace) {
  const nsSym = siblings.find((s) => s.name === namespace);
  if (nsSym) {
    return (nsSym.children ?? []).map((c) => ({ name: c.name, symbol: c }));
  }
  const prefix2 = namespace + " ";
  const promoted = [];
  for (const s of siblings) {
    if (s.name.startsWith(prefix2)) {
      promoted.push({ name: s.name.slice(prefix2.length), symbol: s });
    }
  }
  return promoted.length > 0 ? promoted : null;
}
function resolveNamespaceBottomUp(symbols, namespace, line, character) {
  const path = findContainingPath(symbols, line, character);
  for (let i = path.length - 1; i >= 0; i--) {
    const result = findNamespaceInLevel(path[i].siblings, namespace);
    if (result)
      return result;
  }
  if (path.length === 0) {
    return findNamespaceInLevel(symbols, namespace);
  }
  return null;
}

// ../language/dist/core/analysis/ast-walkers.js
function recurseAstChildren(value, recurse) {
  if (isNamedMap(value)) {
    for (const [k, v] of value) {
      recurse(k, v, value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      recurse("", item, value);
    }
    return;
  }
  if (!isAstNodeLike(value))
    return;
  const children = value.__children;
  if (Array.isArray(children)) {
    const yieldedKeys = /* @__PURE__ */ new Set();
    for (const item of children) {
      if (!isBlockChild(item))
        continue;
      const child = item;
      switch (child.__type) {
        case "field":
          if (child.entryName) {
            if (!yieldedKeys.has(child.key)) {
              yieldedKeys.add(child.key);
              const map = value[child.key];
              if (map !== void 0)
                recurse(child.key, map, value);
            }
          } else {
            recurse(child.key, child.value, value);
          }
          break;
        case "map_entry":
          recurse(child.name, child.value, value);
          break;
        case "sequence_item":
          recurse("", child.value, value);
          break;
        case "value":
          recurse("value", child.value, value);
          break;
        case "statement":
          recurse("", child.value, value);
          break;
        case "untyped":
          recurse(child.key, child, value);
          break;
        case "error":
          break;
        default: {
          const _exhaustive = child;
        }
      }
    }
    return;
  }
  for (const [k, val] of Object.entries(value)) {
    if (k.startsWith("__"))
      continue;
    recurse(k, val, value);
  }
}
function forEachExpressionChild(obj, callback) {
  const kind = obj.__kind;
  switch (kind) {
    case "MemberExpression":
      callback(obj.object, "object", obj);
      break;
    case "SubscriptExpression":
      callback(obj.object, "object", obj);
      callback(obj.index, "index", obj);
      break;
    case "BinaryExpression":
    case "ComparisonExpression":
      callback(obj.left, "left", obj);
      callback(obj.right, "right", obj);
      break;
    case "UnaryExpression":
      callback(obj.operand, "operand", obj);
      break;
    case "ListLiteral": {
      const elements = obj.elements;
      if (Array.isArray(elements)) {
        for (const el of elements) {
          callback(el, "", obj);
        }
      }
      break;
    }
    case "DictLiteral": {
      const entries = obj.entries;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (isAstNodeLike(entry)) {
            callback(entry.key, "key", entry);
            callback(entry.value, "value", entry);
          }
        }
      }
      break;
    }
    case "TernaryExpression":
      callback(obj.consequence, "consequence", obj);
      callback(obj.condition, "condition", obj);
      callback(obj.alternative, "alternative", obj);
      break;
    case "CallExpression":
      callback(obj.func, "func", obj);
      if (Array.isArray(obj.args)) {
        for (const arg of obj.args) {
          callback(arg, "", obj);
        }
      }
      break;
    case "TemplateExpression": {
      const parts = obj.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (isAstNodeLike(part) && part.__kind === "TemplateInterpolation") {
            callback(part.expression, "expression", part);
          }
        }
      }
      break;
    }
  }
}
function dispatchAstChildren(value, ctx, onExpression, recurse) {
  if (Array.isArray(value)) {
    for (const item of value) {
      recurse(item, ctx, "", value);
    }
    return ctx;
  }
  if (!isAstNodeLike(value))
    return ctx;
  const newCtx = updateScopeContext(value, ctx);
  if (value.__kind && isExpressionKind(value.__kind)) {
    onExpression?.(value, newCtx);
    forEachExpressionChild(value, (child, childKey, childParent) => {
      recurse(child, newCtx, childKey, childParent);
    });
  } else {
    recurseAstChildren(value, (k, v, p) => {
      recurse(v, newCtx, k, p);
    });
  }
  return newCtx;
}
function walkAstExpressions(value, callback, ctx = {}, visited = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object")
    return;
  if (visited.has(value))
    return;
  visited.add(value);
  dispatchAstChildren(value, ctx, callback, (child, newCtx) => {
    walkAstExpressions(child, callback, newCtx, visited);
  });
}
function collectDiagnostics(value) {
  const diagnostics = [];
  collectDiagnosticsInner(value, diagnostics, /* @__PURE__ */ new Set());
  return diagnostics;
}
function collectDiagnosticsInner(value, diagnostics, visited) {
  if (!value || typeof value !== "object")
    return;
  if (visited.has(value))
    return;
  visited.add(value);
  if (isAstNodeLike(value)) {
    const nodeDiags = value.__diagnostics;
    if (Array.isArray(nodeDiags)) {
      for (const diag of nodeDiags) {
        diagnostics.push(diag);
      }
    }
  }
  recurseAstChildren(value, (_key, child) => {
    collectDiagnosticsInner(child, diagnostics, visited);
  });
}

// ../language/dist/core/analysis/lint.js
function storeKey(name) {
  return name;
}
var PassStore = class {
  constructor() {
    __publicField(this, "data", /* @__PURE__ */ new Map());
  }
  set(key, value) {
    if (this.data.has(key)) {
      throw new Error(`PassStore key '${key}' already set \u2014 cannot overwrite`);
    }
    this.data.set(key, value);
  }
  get(key) {
    return this.data.get(key);
  }
  has(key) {
    return this.data.has(key);
  }
  update(key, fn) {
    const current = this.get(key);
    if (current === void 0) {
      throw new Error(`PassStore key '${key}' not set \u2014 cannot update`);
    }
    this.data.set(key, fn(current));
  }
};
function each(key, selector) {
  return { __each: true, key, ...selector ? { selector } : {} };
}
function isEachDep(dep) {
  return typeof dep === "object" && dep !== null && "__each" in dep;
}
function defineRule(config2) {
  const requires = [];
  let eachName;
  let eachStoreKey;
  let eachSelector;
  for (const [name, dep] of Object.entries(config2.deps)) {
    if (isEachDep(dep)) {
      if (eachName !== void 0) {
        throw new Error(`defineRule('${config2.id}'): only one each() dep allowed, found '${eachName}' and '${name}'`);
      }
      eachName = name;
      eachStoreKey = dep.key;
      eachSelector = dep.selector;
      requires.push(dep.key);
    } else {
      requires.push(dep);
    }
  }
  return {
    id: storeKey(config2.id),
    description: config2.description,
    requires,
    run(store, _root) {
      const resolved = {};
      for (const [name, dep] of Object.entries(config2.deps)) {
        if (!isEachDep(dep)) {
          resolved[name] = store.get(dep);
        }
      }
      if (eachName && eachStoreKey) {
        const raw = store.get(eachStoreKey);
        if (raw == null)
          return;
        const items = eachSelector ? eachSelector(raw) : Array.isArray(raw) ? raw : [];
        for (const item of items) {
          config2.run({ ...resolved, [eachName]: item });
        }
      } else {
        config2.run(resolved);
      }
    }
  };
}
var DependencyResolutionError = class extends Error {
  constructor(message, missingDependencies, cyclicDependencies) {
    super(message);
    __publicField(this, "missingDependencies");
    __publicField(this, "cyclicDependencies");
    this.missingDependencies = missingDependencies;
    this.cyclicDependencies = cyclicDependencies;
    this.name = "DependencyResolutionError";
  }
};
function partitionPasses(passes) {
  return {
    visitVariables: passes.filter((p) => p.visitVariables),
    visitExpression: passes.filter((p) => p.visitExpression),
    enterNode: passes.filter((p) => p.enterNode),
    exitNode: passes.filter((p) => p.exitNode)
  };
}
var schemaContextKey = storeKey("schema-context");
var LintEngine = class {
  constructor(options) {
    __publicField(this, "passes", /* @__PURE__ */ new Map());
    __publicField(this, "disabled", /* @__PURE__ */ new Set());
    __publicField(this, "source");
    this.source = options?.source ?? "lint";
    for (const p of options?.passes ?? [])
      this.addPass(p);
  }
  /** Register a pass. Throws on duplicate id. */
  addPass(pass) {
    if (this.passes.has(pass.id)) {
      throw new Error(`Duplicate lint id: '${pass.id}'`);
    }
    this.passes.set(pass.id, pass);
    return this;
  }
  /** Disable a pass by id. */
  disable(id) {
    if (!this.passes.has(id)) {
      throw new Error(`Cannot disable unknown lint id: '${id}'`);
    }
    this.disabled.add(id);
    return this;
  }
  /** Re-enable a previously disabled pass. */
  enable(id) {
    if (!this.passes.has(id)) {
      throw new Error(`Cannot enable unknown lint id: '${id}'`);
    }
    this.disabled.delete(id);
    return this;
  }
  /**
   * Run all enabled passes against the AST.
   *
   * Mutates the AST by clearing diagnostics with this engine's source tag
   * during the walk phase, ensuring re-runs produce fresh results.
   */
  run(root, ctx) {
    const store = new PassStore();
    store.set(schemaContextKey, ctx);
    const systemDiagnostics = [];
    const failed = /* @__PURE__ */ new Set();
    const enabled = [...this.passes.values()].filter((p) => !this.disabled.has(p.id));
    for (const pass of enabled) {
      if (pass.init) {
        try {
          pass.init();
        } catch (error) {
          failed.add(pass.id);
          systemDiagnostics.push(this.systemDiagnostic(`Pass '${pass.id}' init failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
        }
      }
    }
    const active = enabled.filter((p) => !failed.has(p.id));
    const sets = partitionPasses(active);
    this.dispatchTargetedHooks(root, sets, failed, systemDiagnostics);
    this.walkNode(root, sets, {}, "", void 0, /* @__PURE__ */ new Set(), failed, systemDiagnostics);
    const finalizePasses = active.filter((p) => p.finalize);
    const finalizeOrder = this.sortFinalize(finalizePasses, failed);
    for (const pass of finalizeOrder) {
      if (failed.has(pass.id))
        continue;
      const missingDep = pass.finalizeAfter?.find((dep) => !store.has(dep));
      if (missingDep) {
        failed.add(pass.id);
        systemDiagnostics.push(this.systemDiagnostic(`Pass '${pass.id}' skipped: required data '${missingDep}' not available`, "lint-pass-skipped"));
        continue;
      }
      try {
        pass.finalize(store, root);
      } catch (error) {
        failed.add(pass.id);
        systemDiagnostics.push(this.systemDiagnostic(`Pass '${pass.id}' finalize failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
      }
    }
    const runPasses = active.filter((p) => p.run);
    for (const pass of runPasses) {
      if (failed.has(pass.id))
        continue;
      const missingKey = pass.requires?.find((key) => !store.has(key));
      if (missingKey) {
        systemDiagnostics.push(this.systemDiagnostic(`Pass '${pass.id}' skipped: required data '${missingKey}' not available`, "lint-pass-skipped"));
        continue;
      }
      try {
        pass.run(store, root);
      } catch (error) {
        systemDiagnostics.push(this.systemDiagnostic(`Pass '${pass.id}' run failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
      }
    }
    const nodeDiagnostics = collectDiagnostics(root);
    return {
      diagnostics: [...nodeDiagnostics, ...systemDiagnostics],
      store
    };
  }
  /**
   * Dispatch targeted hooks (visitVariables) at root level.
   * Gives passes access to specific AST regions without enterNode/exitNode.
   */
  dispatchTargetedHooks(root, sets, failed, systemDiagnostics) {
    if (sets.visitVariables.length > 0) {
      const varsMap = root.variables;
      if (isNamedMap(varsMap)) {
        for (const p of sets.visitVariables) {
          if (failed.has(p.id))
            continue;
          try {
            p.visitVariables(varsMap);
          } catch (error) {
            failed.add(p.id);
            systemDiagnostics.push(this.systemDiagnostic(`Pass '${p.id}' visitVariables failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
          }
        }
      }
    }
  }
  /**
   * Recursive walk dispatching to all pass visitors.
   * Also clears lint diagnostics from previous runs.
   */
  walkNode(value, sets, ctx, key, parent, visited, failed, systemDiagnostics) {
    if (!value || typeof value !== "object")
      return;
    if (visited.has(value))
      return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        this.walkNode(item, sets, ctx, "", value, visited, failed, systemDiagnostics);
      }
      return;
    }
    if (!isAstNodeLike(value))
      return;
    const diags = value.__diagnostics;
    if (Array.isArray(diags)) {
      value.__diagnostics = diags.filter((d) => d.source !== this.source);
    }
    for (const p of sets.enterNode) {
      if (failed.has(p.id))
        continue;
      try {
        p.enterNode(key, value, parent);
      } catch (error) {
        failed.add(p.id);
        systemDiagnostics.push(this.systemDiagnostic(`Pass '${p.id}' enterNode failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
      }
    }
    dispatchAstChildren(value, ctx, (exprObj, exprCtx) => {
      for (const p of sets.visitExpression) {
        if (failed.has(p.id))
          continue;
        try {
          p.visitExpression(exprObj, exprCtx);
        } catch (error) {
          failed.add(p.id);
          systemDiagnostics.push(this.systemDiagnostic(`Pass '${p.id}' visitExpression failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
        }
      }
    }, (child, childCtx, childKey, childParent) => {
      this.walkNode(child, sets, childCtx, childKey, childParent, visited, failed, systemDiagnostics);
    });
    for (const p of sets.exitNode) {
      if (failed.has(p.id))
        continue;
      try {
        p.exitNode(key, value, parent);
      } catch (error) {
        failed.add(p.id);
        systemDiagnostics.push(this.systemDiagnostic(`Pass '${p.id}' exitNode failed: ${error instanceof Error ? error.message : String(error)}`, "lint-pass-error"));
      }
    }
  }
  /** Topologically sort passes for finalize() ordering using Kahn's algorithm. */
  sortFinalize(passes, failed) {
    const active = passes.filter((p) => !failed.has(p.id));
    if (active.length === 0)
      return [];
    const byId = /* @__PURE__ */ new Map();
    for (const p of active)
      byId.set(p.id, p);
    const inDegree = /* @__PURE__ */ new Map();
    const adjacency = /* @__PURE__ */ new Map();
    for (const p of active) {
      inDegree.set(p.id, 0);
      adjacency.set(p.id, /* @__PURE__ */ new Set());
    }
    for (const p of active) {
      for (const depKey of p.finalizeAfter ?? []) {
        if (byId.has(depKey)) {
          adjacency.get(depKey).add(p.id);
          inDegree.set(p.id, (inDegree.get(p.id) ?? 0) + 1);
        }
      }
    }
    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0)
        queue.push(id);
    }
    const sorted = [];
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      sorted.push(byId.get(id));
      for (const dependent of adjacency.get(id) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0)
          queue.push(dependent);
      }
    }
    if (sorted.length !== active.length) {
      const unsorted = active.filter((p) => !sorted.some((s) => s.id === p.id)).map((p) => p.id);
      throw new DependencyResolutionError(`Cyclic finalize dependencies among: ${unsorted.join(", ")}`, void 0, unsorted);
    }
    return sorted;
  }
  systemDiagnostic(message, code) {
    return {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      },
      message,
      severity: DiagnosticSeverity.Information,
      code,
      source: this.source
    };
  }
};

// ../language/dist/core/analysis/position-index.js
var positionIndexKey = storeKey("position-index");
function queryExpressionAtPosition(index, line, character) {
  let best = null;
  let bestSize = Infinity;
  for (const entry of index.expressions) {
    if (!isPositionInRange(line, character, entry.range))
      continue;
    const size = rangeSize(entry.range);
    if (size < bestSize) {
      best = entry;
      bestSize = size;
    }
  }
  return best;
}
function queryDefinitionAtPosition(index, line, character) {
  let best = null;
  let bestSize = Infinity;
  for (const entry of index.definitions) {
    if (!isPositionInRange(line, character, entry.keyRange))
      continue;
    const size = rangeSize(entry.keyRange);
    if (size < bestSize) {
      best = entry;
      bestSize = size;
    }
  }
  return best;
}
function queryScopeAtPosition(index, line, character) {
  let best = null;
  let bestSize = Infinity;
  for (const entry of index.scopes) {
    if (!isPositionInRange(line, character, entry.range))
      continue;
    const size = rangeSize(entry.range);
    if (size < bestSize) {
      best = entry;
      bestSize = size;
    }
  }
  return best?.scope ?? {};
}

// ../language/dist/core/analysis/references.js
function findDefinitionAtPosition(ast, line, character, ctx, symbols, index) {
  const ref = findRefExpressionAtPosition(ast, line, character, index);
  if (ref) {
    return resolveWithReason(ast, ref, ctx, symbols);
  }
  const def = findDefinitionKeyAtPosition(ast, line, character, index);
  if (def) {
    return resolveWithReason(ast, def, ctx, symbols);
  }
  return {
    definition: null,
    reason: "Cursor is not on a reference or definition key"
  };
}
function resolveWithReason(ast, ref, ctx, symbols) {
  const scopesRequired = getScopedNamespaces(ctx).get(ref.namespace);
  if (scopesRequired && !activeScopeForNamespace(scopesRequired, ref.scope)) {
    const list = [...scopesRequired].join(" or ");
    return {
      definition: null,
      reason: `'@${ref.namespace}.${ref.name}' requires ${list} scope (cursor is outside a ${list} block)`
    };
  }
  const definition = resolveReference(ast, ref.namespace, ref.name, ctx, ref.scope, symbols);
  if (!definition) {
    return {
      definition: null,
      reason: `'${ref.name}' is not defined in namespace '${ref.namespace}'`
    };
  }
  return { definition };
}
function findReferencesAtPosition(ast, line, character, includeDeclaration, ctx, symbols, index) {
  const ref = findRefExpressionAtPosition(ast, line, character, index);
  const def = ref ? null : findDefinitionKeyAtPosition(ast, line, character, index);
  const target = ref ?? def;
  if (!target)
    return [];
  return findAllReferences(ast, target.namespace, target.name, ctx, target.scope, includeDeclaration, symbols);
}
function resolveReference(ast, namespace, name, ctx, scope, symbols) {
  if (symbols) {
    const entry = findSymbolEntry(symbols, namespace, name, ctx, scope);
    if (entry) {
      return {
        namespace,
        name,
        symbolKind: entry.kind,
        definitionRange: entry.selectionRange,
        fullRange: entry.range
      };
    }
  }
  const scopesRequired = getScopedNamespaces(ctx).get(namespace);
  const activeScope = activeScopeForNamespace(scopesRequired, scope);
  if (activeScope && scope) {
    return resolveFromScopedChild(ast, namespace, name, activeScope, scope, ctx);
  }
  return resolveFromRoot(ast, namespace, name, ctx);
}
function findAllReferences(ast, namespace, name, ctx, scope, includeDeclaration = true, symbols) {
  const occurrences = [];
  const scopesRequired = getScopedNamespaces(ctx).get(namespace);
  const activeScope = activeScopeForNamespace(scopesRequired, scope);
  walkAstExpressions(ast, (expr, walkCtx) => {
    const decomposed = decomposeExpression(expr, walkCtx);
    if (!decomposed)
      return;
    if (decomposed.namespace !== namespace || decomposed.name !== name)
      return;
    if (activeScope && scope) {
      if (walkCtx[activeScope] !== scope[activeScope])
        return;
    }
    occurrences.push({
      range: decomposed.range,
      nameRange: decomposed.nameRange,
      isDefinition: false
    });
  });
  if (includeDeclaration) {
    const def = resolveReference(ast, namespace, name, ctx, scope, symbols);
    if (def) {
      occurrences.push({
        range: def.definitionRange,
        nameRange: def.definitionRange,
        isDefinition: true
      });
    }
  }
  return occurrences;
}
function findRefExpressionAtPosition(ast, line, character, index) {
  if (index) {
    let best2 = null;
    let bestSize2 = Infinity;
    for (const entry of index.expressions) {
      if (!isPositionInRange(line, character, entry.range))
        continue;
      const decomposed = decomposeExpression(entry.expr, entry.scope);
      if (!decomposed)
        continue;
      const size = rangeSize(entry.range);
      if (size < bestSize2) {
        best2 = decomposed;
        bestSize2 = size;
      }
    }
    return best2;
  }
  let best = null;
  let bestSize = Infinity;
  walkAstExpressions(ast, (expr, ctx) => {
    const cst = expr.__cst;
    if (!cst)
      return;
    if (!isPositionInRange(line, character, cst.range))
      return;
    const decomposed = decomposeExpression(expr, ctx);
    if (!decomposed)
      return;
    const size = rangeSize(cst.range);
    if (size < bestSize) {
      best = decomposed;
      bestSize = size;
    }
  });
  return best;
}
function findDefinitionKeyAtPosition(ast, line, character, index) {
  if (index) {
    const entry = queryDefinitionAtPosition(index, line, character);
    if (!entry)
      return null;
    return {
      namespace: entry.namespace,
      name: entry.name,
      range: entry.fullRange,
      nameRange: entry.keyRange,
      scope: entry.scope
    };
  }
  let best = null;
  let bestSize = Infinity;
  walkDefinitionKeys(ast, (namespace, name, keyRange, fullRange, ctx) => {
    if (!isPositionInRange(line, character, keyRange))
      return;
    const size = rangeSize(keyRange);
    if (size < bestSize) {
      best = {
        namespace,
        name,
        range: fullRange,
        nameRange: keyRange,
        scope: ctx
      };
      bestSize = size;
    }
  });
  return best;
}
function walkDefinitionKeys(ast, callback) {
  walkDefinitionKeysInner(ast, callback, {}, void 0, /* @__PURE__ */ new Set());
}
function walkDefinitionKeysInner(value, callback, ctx, parentNamespace, visited) {
  if (!value || typeof value !== "object")
    return;
  if (visited.has(value))
    return;
  visited.add(value);
  if (isNamedMap(value)) {
    for (const [entryName, entry] of value) {
      if (!isAstNodeLike(entry))
        continue;
      const entryCst = entry.__cst;
      if (!entryCst)
        continue;
      const entryCtx = updateScopeContext(entry, ctx);
      const ns = parentNamespace ?? "";
      if (ns) {
        const { range, selectionRange } = computeRanges(entryCst);
        callback(ns, entryName, selectionRange, range, entryCtx);
      }
      walkDefinitionKeysInner(entry, callback, entryCtx, void 0, visited);
    }
    return;
  }
  if (!isAstNodeLike(value))
    return;
  const newCtx = updateScopeContext(value, ctx);
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith("__"))
      continue;
    if (!val || typeof val !== "object")
      continue;
    if (isNamedMap(val)) {
      walkDefinitionKeysInner(val, callback, newCtx, key, visited);
    } else if (isAstNodeLike(val)) {
      if (!parentNamespace && val.__kind && val.__symbol) {
        walkDefinitionKeysInner(val, callback, newCtx, key, visited);
      } else if (parentNamespace) {
        const valCst = val.__cst;
        if (valCst) {
          const mappingNode = findMappingElement(valCst.node);
          const { range, selectionRange } = mappingNode ? computeRanges({ ...valCst, node: mappingNode }) : computeRanges(valCst);
          callback(parentNamespace, key, selectionRange, range, newCtx);
        }
        walkDefinitionKeysInner(val, callback, newCtx, void 0, visited);
      } else {
        walkDefinitionKeysInner(val, callback, newCtx, void 0, visited);
      }
    }
  }
}
function resolveFromRoot(ast, namespace, name, ctx) {
  for (const key of resolveNamespaceKeys(namespace, ctx)) {
    const container = astField(ast, key);
    if (!container)
      continue;
    if (isNamedMap(container)) {
      const entry = findMapEntry(container, name, namespace);
      if (entry)
        return entry;
    } else if (typeof container === "object") {
      const entry = findBlockProperty(container, name, namespace);
      if (entry)
        return entry;
    }
  }
  return null;
}
function resolveFromScopedChild(ast, namespace, name, targetScope, scope, ctx) {
  const scopeBlock = findScopeBlock(ast, targetScope, scope, ctx);
  if (!scopeBlock)
    return null;
  for (const map of collectNamespaceMaps(scopeBlock, namespace)) {
    const entry = findMapEntry(map, name, namespace);
    if (entry)
      return entry;
  }
  return null;
}
function findMapEntry(container, name, namespace) {
  if (!isNamedMap(container))
    return null;
  const entry = container.get(name);
  if (!isAstNodeLike(entry))
    return null;
  const cst = entry.__cst;
  if (!cst)
    return null;
  const sym = entry.__symbol;
  const symbolKind = sym?.kind ?? SymbolKind.Property;
  const { range, selectionRange } = computeRanges(cst);
  return {
    namespace,
    name,
    symbolKind,
    definitionRange: selectionRange,
    fullRange: range
  };
}
function findBlockProperty(container, name, namespace) {
  if (!isAstNodeLike(container) || isNamedMap(container))
    return null;
  if (name.startsWith("__"))
    return null;
  const field = container[name];
  if (!isAstNodeLike(field))
    return null;
  const cst = field.__cst;
  if (!cst)
    return null;
  const sym = field.__symbol;
  const symbolKind = sym?.kind ?? SymbolKind.Property;
  const mappingNode = findMappingElement(cst.node);
  const { range, selectionRange } = mappingNode ? computeRanges({ ...cst, node: mappingNode }) : computeRanges(cst);
  return {
    namespace,
    name,
    symbolKind,
    definitionRange: selectionRange,
    fullRange: range
  };
}
function decomposeExpression(expr, ctx) {
  const decomposed = decomposeAtMemberExpression(expr);
  if (!decomposed)
    return null;
  const cst = expr.__cst;
  if (!cst)
    return null;
  const { range } = cst;
  const propertyNode = cst.node.namedChildren.find((n) => n.type === "id");
  const nameRange = propertyNode ? toRange(propertyNode) : {
    start: {
      line: range.end.line,
      character: range.end.character - decomposed.property.length
    },
    end: range.end
  };
  return {
    namespace: decomposed.namespace,
    name: decomposed.property,
    range,
    nameRange,
    scope: ctx
  };
}

// ../language/dist/core/analysis/snippet-gen.js
function generateFieldSnippet(fieldName, fieldType, opts) {
  const ft = resolveFieldType2(fieldType);
  if (isSequence(ft))
    return void 0;
  if (isPrimitive(ft) && !isTypedMap(ft))
    return void 0;
  const tabSize = opts?.tabSize ?? 4;
  const counter = { value: 1 };
  if (isTypedMap(ft)) {
    return snippetForTypedMap(fieldName, ft, 0, counter, tabSize);
  }
  if (isCollection(ft)) {
    return snippetForCollection(fieldName, ft, 0, counter, tabSize);
  }
  if (ft.schema) {
    return snippetForBlock(fieldName, ft, 0, counter, 0, false, tabSize);
  }
  return void 0;
}
function snippetForBlock(name, ft, indent, counter, depth, namedEntryMode, tabSize) {
  const pad = " ".repeat(indent * tabSize);
  const lines = [`${pad}${name}:`];
  if (!ft.schema) {
    lines[0] = `${pad}${name}: \${${counter.value++}}`;
    return lines.join("\n") + "$0";
  }
  const childLines = generateChildLines(ft.schema, indent + 1, counter, depth + 1, namedEntryMode, tabSize);
  if (childLines.length === 0) {
    const childPad = " ".repeat((indent + 1) * tabSize);
    lines.push(`${childPad}\${${counter.value++}}`);
  } else {
    lines.push(...childLines);
  }
  return depth === 0 ? lines.join("\n") + "$0" : lines.join("\n");
}
function snippetForCollection(name, ft, indent, counter, tabSize) {
  const pad = " ".repeat(indent * tabSize);
  const entryBlock = getEntryBlock(ft);
  if (!entryBlock?.schema) {
    return `${pad}${name} \${${counter.value++}:Name}:
${pad}${" ".repeat(tabSize)}\${${counter.value++}}$0`;
  }
  const lines = [`${pad}${name} \${${counter.value++}:Name}:`];
  const childLines = generateChildLines(
    entryBlock.schema,
    indent + 1,
    counter,
    1,
    true,
    // namedEntryMode — only required fields
    tabSize
  );
  if (childLines.length === 0) {
    const childPad = " ".repeat((indent + 1) * tabSize);
    lines.push(`${childPad}\${${counter.value++}}`);
  } else {
    lines.push(...childLines);
  }
  return lines.join("\n") + "$0";
}
function snippetForTypedMap(name, ft, indent, counter, tabSize) {
  const pad = " ".repeat(indent * tabSize);
  const childPad = " ".repeat((indent + 1) * tabSize);
  const propPad = " ".repeat((indent + 2) * tabSize);
  const lines = [`${pad}${name}:`];
  const entryParts = [];
  entryParts.push(`\${${counter.value++}:name}:`);
  const modifiers = keywordNames(getTypedMapModifiers(ft));
  if (modifiers.length > 0) {
    entryParts.push(`\${${counter.value++}|${modifiers.join(",")}|}`);
  }
  const primitiveTypes2 = keywordNames(getTypedMapPrimitiveTypes(ft));
  if (primitiveTypes2.length > 0) {
    const types = primitiveTypes2.slice(0, 8);
    entryParts.push(`\${${counter.value++}|${types.join(",")}|}`);
  }
  lines.push(`${childPad}${entryParts.join(" ")}`);
  const propsSchema = getTypedMapPropertiesSchema(ft);
  if (propsSchema) {
    for (const [fieldName, childFt] of Object.entries(propsSchema)) {
      const resolved = resolveFieldType2(childFt);
      if (fieldName.startsWith("__"))
        continue;
      if (fieldName === "description" || resolved.__metadata?.required) {
        lines.push(`${propPad}${fieldName}: ${primitiveSnippetValue(resolved, counter)}`);
      }
    }
  }
  return lines.join("\n") + "$0";
}
function generateChildLines(schema2, indent, counter, depth, namedEntryMode, tabSize) {
  const lines = [];
  for (const [fieldName, rawFt] of Object.entries(schema2)) {
    if (fieldName.startsWith("__"))
      continue;
    const ft = resolveFieldType2(rawFt);
    if (!shouldIncludeField(ft, depth, namedEntryMode))
      continue;
    if (isSequence(ft) || isCollection(ft) || isTypedMap(ft)) {
      continue;
    }
    if (ft.schema) {
      lines.push(snippetForBlock(fieldName, ft, indent, counter, depth, namedEntryMode, tabSize));
    } else if (isPrimitive(ft)) {
      lines.push(primitiveSnippetLine(fieldName, ft, indent, counter, tabSize));
    }
  }
  return lines;
}
function shouldIncludeField(ft, depth, namedEntryMode) {
  const required2 = ft.__metadata?.required === true;
  if (required2 && depth <= 2)
    return true;
  if (namedEntryMode)
    return false;
  if (depth === 1) {
    if (isPrimitive(ft))
      return true;
    if (ft.schema && hasRequiredChild(ft))
      return true;
    return false;
  }
  return false;
}
function hasRequiredChild(ft) {
  if (!ft.schema)
    return false;
  for (const childFt of Object.values(ft.schema)) {
    const resolved = resolveFieldType2(childFt);
    if (resolved.__metadata?.required)
      return true;
  }
  return false;
}
function primitiveSnippetLine(name, ft, indent, counter, tabSize) {
  const pad = " ".repeat(indent * tabSize);
  if (isProcedureValue(ft)) {
    const childPad = " ".repeat((indent + 1) * tabSize);
    const placeholder = placeholderFromMeta(ft) ?? "instructions";
    if (ft.__metadata?.omitArrow) {
      return `${pad}${name}:
${childPad}\${${counter.value++}:${escapeSnippetText(placeholder)}}`;
    }
    return `${pad}${name}: ->
${childPad}\${${counter.value++}:${escapeSnippetText(placeholder)}}`;
  }
  return `${pad}${name}: ${primitiveSnippetValue(ft, counter)}`;
}
function primitiveSnippetValue(ft, counter) {
  if (isStringValue(ft)) {
    const placeholder2 = placeholderFromMeta(ft) ?? "value";
    return `"\${${counter.value++}:${escapeSnippetText(placeholder2)}}"`;
  }
  if (isBooleanValue(ft)) {
    return `\${${counter.value++}:True}`;
  }
  if (isNumberValue(ft)) {
    return `\${${counter.value++}:0}`;
  }
  const placeholder = placeholderFromMeta(ft) ?? "value";
  return `\${${counter.value++}:${escapeSnippetText(placeholder)}}`;
}
function resolveFieldType2(ft) {
  return Array.isArray(ft) ? ft[0] : ft;
}
function isPrimitive(ft) {
  return ft.__fieldKind === "Primitive";
}
function isSequence(ft) {
  return ft.__fieldKind === "Sequence";
}
function isStringValue(ft) {
  return ft.__fieldKind === "Primitive" && Array.isArray(ft.__accepts) && ft.__accepts.includes("StringLiteral");
}
function isBooleanValue(ft) {
  return ft.__fieldKind === "Primitive" && Array.isArray(ft.__accepts) && ft.__accepts.includes("BooleanLiteral");
}
function isNumberValue(ft) {
  return ft.__fieldKind === "Primitive" && Array.isArray(ft.__accepts) && ft.__accepts.includes("NumberLiteral");
}
function isProcedureValue(ft) {
  return ft.__fieldKind === "Primitive" && !ft.__accepts?.length;
}
function isTypedMap(ft) {
  return ft.__isTypedMap === true;
}
function isCollection(ft) {
  return ft.__isCollection === true;
}
function getEntryBlock(ft) {
  const rec = ft;
  if ("entryBlock" in rec && rec.entryBlock != null) {
    const eb = rec.entryBlock;
    if (typeof eb === "function" || typeof eb === "object") {
      return eb;
    }
  }
  return void 0;
}
function getTypedMapModifiers(ft) {
  return ft.__modifiers ?? [];
}
function getTypedMapPrimitiveTypes(ft) {
  return ft.__primitiveTypes ?? [];
}
function getTypedMapPropertiesSchema(ft) {
  return ft.propertiesSchema ?? void 0;
}
function escapeSnippetText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}").replace(/"/g, "'");
}
function placeholderFromMeta(ft) {
  const desc = ft.__metadata?.description;
  if (!desc)
    return void 0;
  const firstSentence = desc.split(/\.\s/)[0];
  if (firstSentence.length <= 50)
    return firstSentence.replace(/\.$/, "");
  return firstSentence.slice(0, 47) + "...";
}

// ../language/dist/core/analysis/completions.js
function findEnclosingScope(ast, line, character, index) {
  if (index) {
    return queryScopeAtPosition(index, line, character);
  }
  const scope = {};
  walkScopeBlocks(ast, line, character, scope, /* @__PURE__ */ new Set());
  return scope;
}
function walkScopeBlocks(value, line, character, scope, visited) {
  if (!value || typeof value !== "object")
    return;
  if (visited.has(value))
    return;
  visited.add(value);
  if (isNamedMap(value)) {
    for (const [name, entry] of value) {
      if (!isAstNodeLike(entry))
        continue;
      const cst2 = entry.__cst;
      if (!cst2 || !isPositionInRange(line, character, cst2.range))
        continue;
      const blockScope = entry.__scope;
      if (blockScope && typeof entry.__name === "string") {
        scope[blockScope] = name;
      }
      recurseAstChildren(entry, (_k, child) => {
        walkScopeBlocks(child, line, character, scope, visited);
      });
      return;
    }
    return;
  }
  if (!isAstNodeLike(value))
    return;
  const cst = value.__cst;
  if (cst && !isPositionInRange(line, character, cst.range))
    return;
  recurseAstChildren(value, (_k, child) => {
    walkScopeBlocks(child, line, character, scope, visited);
  });
}
function getAvailableNamespaces(ctx, scope) {
  const candidates = [];
  for (const [ns, meta2] of getNamespaceMetadata(ctx)) {
    if (meta2.scopesRequired && !activeScopeForNamespace(meta2.scopesRequired, scope)) {
      continue;
    }
    candidates.push({
      name: ns,
      kind: meta2.kind,
      detail: meta2.scopesRequired ? `(scoped to ${[...meta2.scopesRequired].join(" or ")})` : void 0
    });
  }
  return candidates;
}
function getCompletionCandidates(ast, namespace, ctx, scope, symbols, line, character) {
  let effectiveScope = scope;
  if (line !== void 0 && character !== void 0 && ctx.scopedNamespaces.has(namespace) && ctx.colinearResolvedScopes.has(namespace)) {
    const scopesRequired2 = ctx.scopedNamespaces.get(namespace);
    const activeScope2 = activeScopeForNamespace(scopesRequired2, scope);
    const override = findNestedRunSetTarget(ast, line, character);
    if (activeScope2 && override !== void 0) {
      effectiveScope = { ...scope ?? {}, [activeScope2]: override };
    }
  }
  if (symbols) {
    const entries = getSymbolNamespaceEntries(symbols, namespace, ctx, effectiveScope);
    if (entries) {
      return entries.map(({ name, symbol }) => ({
        name,
        kind: symbol.kind,
        detail: symbol.detail
      }));
    }
  }
  const scopesRequired = getScopedNamespaces(ctx).get(namespace);
  const activeScope = activeScopeForNamespace(scopesRequired, effectiveScope);
  if (activeScope && effectiveScope) {
    return getScopedChildCandidates(ast, namespace, activeScope, effectiveScope, ctx);
  }
  const rootCandidates = getRootCandidates(ast, namespace, ctx);
  if (rootCandidates.length > 0)
    return rootCandidates;
  const globalMembers = ctx.globalScopes.get(namespace);
  if (globalMembers) {
    return [...globalMembers].map((member) => ({
      name: member,
      kind: SymbolKind.Property
    }));
  }
  return [];
}
function findNestedRunSetTarget(ast, line, character) {
  return walkForNestedRunSet(ast, line, character, void 0, /* @__PURE__ */ new Set());
}
function walkForNestedRunSet(value, line, character, enclosingRunTarget, visited) {
  if (!value || typeof value !== "object")
    return void 0;
  if (visited.has(value))
    return void 0;
  visited.add(value);
  if (isNamedMap(value)) {
    for (const [, entry] of value) {
      if (!isAstNodeLike(entry))
        continue;
      const cst2 = entry.__cst;
      if (!cst2 || !isPositionInRange(line, character, cst2.range))
        continue;
      const result2 = walkForNestedRunSet(entry, line, character, enclosingRunTarget, visited);
      if (result2 !== void 0)
        return result2;
    }
    return void 0;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result2 = walkForNestedRunSet(item, line, character, enclosingRunTarget, visited);
      if (result2 !== void 0)
        return result2;
    }
    return void 0;
  }
  if (!isAstNodeLike(value))
    return void 0;
  const cst = value.__cst;
  if (cst && !isPositionInRange(line, character, cst.range))
    return void 0;
  if (value.__kind === "SetClause" && enclosingRunTarget !== void 0) {
    return enclosingRunTarget;
  }
  let childRunTarget = enclosingRunTarget;
  if (value.__kind === "RunStatement") {
    const target = value.target;
    if (target && typeof target === "object") {
      const ref = decomposeAtMemberExpression(target);
      if (ref) {
        childRunTarget = ref.property;
      }
    }
  }
  let result;
  recurseAstChildren(value, (_k, child) => {
    if (result !== void 0)
      return;
    const sub = walkForNestedRunSet(child, line, character, childRunTarget, visited);
    if (sub !== void 0)
      result = sub;
  });
  return result;
}
function getRootCandidates(ast, namespace, ctx) {
  const candidates = [];
  for (const key of resolveNamespaceKeys(namespace, ctx)) {
    const container = astField(ast, key);
    if (isNamedMap(container)) {
      collectMapCandidates(container, candidates);
    } else if (container && typeof container === "object") {
      collectBlockCandidates(container, candidates);
    }
  }
  return candidates;
}
function getScopedChildCandidates(ast, namespace, targetScope, scope, ctx) {
  const scopeBlock = findScopeBlock(ast, targetScope, scope, ctx);
  if (!scopeBlock)
    return [];
  const candidates = [];
  for (const map of collectNamespaceMaps(scopeBlock, namespace)) {
    collectMapCandidates(map, candidates);
  }
  return candidates;
}
function collectMapCandidates(container, candidates) {
  if (!isNamedMap(container))
    return;
  for (const [name, entry] of container) {
    if (!isAstNodeLike(entry))
      continue;
    const sym = entry.__symbol;
    const symbolKind = sym?.kind ?? SymbolKind.Property;
    const cst = entry.__cst;
    const detail = cst ? computeDetail(entry, entry.__kind, cst) : void 0;
    const documentation = extractCandidateDocumentation(entry);
    candidates.push({ name, kind: symbolKind, detail, documentation });
  }
}
function collectBlockCandidates(container, candidates) {
  if (!isAstNodeLike(container) || isNamedMap(container))
    return;
  for (const [name, field] of Object.entries(container)) {
    if (name.startsWith("__"))
      continue;
    if (!isAstNodeLike(field))
      continue;
    const sym = field.__symbol;
    const symbolKind = sym?.kind ?? SymbolKind.Property;
    const cst = field.__cst;
    const detail = cst ? computeDetail(field, field.__kind, cst) : void 0;
    const documentation = extractCandidateDocumentation(field);
    candidates.push({ name, kind: symbolKind, detail, documentation });
  }
}
function getFieldCompletions(ast, line, character, ctx, source) {
  const rootSchema = ctx.info.schema;
  const aliases = ctx.info.aliases;
  let result = findEnclosingBlockWithSchema(ast, line, character, rootSchema);
  if (source) {
    const lines = source.split("\n");
    const currentLine = lines[line] ?? "";
    const isBlankLine = currentLine.trim() === "";
    if (!result || isBlankLine) {
      const inferred = inferBlockFromIndentation(ast, line, character, rootSchema, source);
      if (inferred)
        result = inferred;
    }
  }
  if (!result) {
    return Object.keys(rootSchema).filter((key) => !aliases[key]).filter((key) => {
      const ft = Array.isArray(rootSchema[key]) ? rootSchema[key][0] : rootSchema[key];
      if (ft.__metadata?.hidden)
        return false;
      return !(key in ast) || isNamedMap(astField(ast, key));
    }).map((key) => {
      const ft = Array.isArray(rootSchema[key]) ? rootSchema[key][0] : rootSchema[key];
      return {
        name: key,
        kind: fieldCompletionKind(ft),
        documentation: ft.__metadata?.description,
        snippet: generateFieldSnippet(key, ft)
      };
    });
  }
  const { block, schema: schema2 } = result;
  return Object.entries(schema2).filter(([name, ft]) => {
    const fieldType = Array.isArray(ft) ? ft[0] : ft;
    if (fieldType.__metadata?.hidden)
      return false;
    if (name in block)
      return false;
    const existing = block[name];
    return !existing || isNamedMap(existing);
  }).map(([name, ft]) => {
    const fieldType = Array.isArray(ft) ? ft[0] : ft;
    return {
      name,
      kind: fieldCompletionKind(fieldType),
      documentation: fieldType.__metadata?.description,
      snippet: generateFieldSnippet(name, fieldType)
    };
  });
}
function inferBlockFromIndentation(_ast, line, _character, rootSchema, source) {
  const lines = source.split("\n");
  const currentLine = lines[line] ?? "";
  const cursorIndent = currentLine.length - currentLine.trimStart().length;
  if (cursorIndent === 0)
    return null;
  const parents = [];
  let targetIndent = cursorIndent;
  for (let l = line - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim())
      continue;
    const indent = ln.length - ln.trimStart().length;
    if (indent >= targetIndent)
      continue;
    const m = ln.trimStart().match(/^([\w-]+)(?:\s+([\w-]+))?\s*:/);
    if (!m)
      continue;
    parents.unshift({ key: m[1], indent, line: l, hasEntryName: !!m[2] });
    targetIndent = indent;
    if (indent === 0)
      break;
  }
  if (parents.length === 0)
    return null;
  let schema2 = rootSchema;
  let mapLevel = "none";
  for (const { key, hasEntryName } of parents) {
    const fieldDef = schema2[key];
    if (fieldDef) {
      const ft = Array.isArray(fieldDef) ? fieldDef[0] : fieldDef;
      const isTypedMap2 = ft.__isTypedMap === true;
      const mapLike = ft.isNamed || ft.__isCollection || isTypedMap2;
      if (mapLike) {
        const entrySchema = ft.schema ?? ft.propertiesSchema;
        if (entrySchema) {
          schema2 = entrySchema;
          if (hasEntryName) {
            mapLevel = "none";
          } else {
            mapLevel = isTypedMap2 ? "typed" : "named";
          }
        }
      } else if (ft.schema) {
        schema2 = ft.schema;
        mapLevel = "none";
      } else {
        return {
          block: { __kind: "LeafField" },
          schema: {}
        };
      }
    } else {
      mapLevel = "none";
    }
  }
  if (schema2 === rootSchema)
    return null;
  if (mapLevel === "named") {
    return {
      block: { __kind: "NamedMapGap" },
      schema: {}
    };
  }
  const lastParent = parents[parents.length - 1];
  const presentKeys = { __kind: "Synthetic" };
  for (let l = lastParent.line + 1; l < lines.length; l++) {
    const ln = lines[l];
    if (!ln || !ln.trim())
      continue;
    const indent = ln.length - ln.trimStart().length;
    if (indent <= lastParent.indent)
      break;
    if (indent !== cursorIndent)
      continue;
    const km = ln.trimStart().match(/^([\w-]+)\s*:/);
    if (km && km[1] in schema2) {
      presentKeys[km[1]] = true;
    }
  }
  return {
    block: presentKeys,
    schema: schema2
  };
}
function fieldCompletionKind(ft) {
  const resolved = Array.isArray(ft) ? ft[0] : ft;
  if (resolved.isNamed)
    return SymbolKind.Namespace;
  if (resolved.__isCollection)
    return SymbolKind.Namespace;
  if (resolved.schema)
    return SymbolKind.Object;
  return SymbolKind.Property;
}
function findEnclosingBlockWithSchema(value, line, character, schema2, namedEntryType) {
  if (!value || typeof value !== "object")
    return null;
  if (isNamedMap(value)) {
    for (const [, entry] of value) {
      if (!isAstNodeLike(entry))
        continue;
      const cst = entry.__cst;
      if (!cst || !isPositionInRange(line, character, cst.range))
        continue;
      let entrySchema = schema2;
      if (namedEntryType && hasDiscriminant(namedEntryType)) {
        const discValue = extractDiscriminantValue(entry, namedEntryType.discriminantField);
        if (discValue) {
          entrySchema = namedEntryType.resolveSchemaForDiscriminant(discValue);
        }
      } else if (namedEntryType) {
        const name = typeof entry.__name === "string" ? entry.__name : void 0;
        if (name) {
          entrySchema = namedEntryType.resolveSchemaForName(name);
        }
      }
      return findDeeperBlock(entry, line, character, entrySchema) ?? {
        block: entry,
        schema: entrySchema
      };
    }
    return null;
  }
  if (!isAstNodeLike(value))
    return null;
  for (const [key, ft] of Object.entries(schema2)) {
    const fieldType = Array.isArray(ft) ? ft[0] : ft;
    const child = value[key];
    if (!child || typeof child !== "object")
      continue;
    if (isNamedMap(child)) {
      if (fieldType.schema) {
        const entryType = isCollectionFieldType(fieldType) ? fieldType.entryBlock : void 0;
        const mapResult = findEnclosingBlockWithSchema(child, line, character, fieldType.schema, entryType);
        if (mapResult)
          return mapResult;
      }
      continue;
    }
    if (!isAstNodeLike(child))
      continue;
    const cst = child.__cst;
    if (!cst || !isPositionInRange(line, character, cst.range))
      continue;
    if (fieldType.schema) {
      const deeper = findEnclosingBlockWithSchema(child, line, character, fieldType.schema);
      if (deeper)
        return deeper;
      return { block: child, schema: fieldType.schema };
    }
    return { block: child, schema: {} };
  }
  return null;
}
function findDeeperBlock(obj, line, character, schema2) {
  for (const [key, ft] of Object.entries(schema2)) {
    const fieldType = Array.isArray(ft) ? ft[0] : ft;
    const child = obj[key];
    if (!child || typeof child !== "object")
      continue;
    if (isNamedMap(child) && fieldType.schema) {
      const result = findEnclosingBlockWithSchema(child, line, character, fieldType.schema);
      if (result)
        return result;
      continue;
    }
    if (!isAstNodeLike(child))
      continue;
    const cst = child.__cst;
    if (!cst || !isPositionInRange(line, character, cst.range))
      continue;
    if (fieldType.schema) {
      const deeper = findEnclosingBlockWithSchema(child, line, character, fieldType.schema);
      if (deeper)
        return deeper;
      return { block: child, schema: fieldType.schema };
    }
  }
  return null;
}
function getValueCompletions(line, _character, ctx, source) {
  const lines = source.split("\n");
  const currentLine = lines[line] ?? "";
  const cursorIndent = currentLine.length - currentLine.trimStart().length;
  if (cursorIndent === 0)
    return [];
  const rootSchema = ctx.info.schema;
  const parents = [];
  let targetIndent = cursorIndent;
  for (let l = line - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim())
      continue;
    const indent = ln.length - ln.trimStart().length;
    if (indent >= targetIndent)
      continue;
    const m = ln.trimStart().match(/^([\w-]+)(?:\s+([\w-]+))?\s*:/);
    if (!m)
      continue;
    parents.unshift({ key: m[1], indent, hasEntryName: !!m[2] });
    targetIndent = indent;
    if (indent === 0)
      break;
  }
  if (parents.length === 0)
    return [];
  let schema2 = rootSchema;
  let typedMapField = null;
  for (const { key, hasEntryName } of parents) {
    const fieldDef = schema2[key];
    if (fieldDef) {
      const ft = Array.isArray(fieldDef) ? fieldDef[0] : fieldDef;
      const isTypedMap2 = ft.__isTypedMap === true;
      const mapLike = ft.isNamed || ft.__isCollection || isTypedMap2;
      if (mapLike) {
        if (isTypedMap2) {
          typedMapField = ft;
        } else {
          typedMapField = null;
        }
        const entrySchema = ft.schema ?? ft.propertiesSchema;
        if (entrySchema) {
          schema2 = entrySchema;
          if (hasEntryName) {
            typedMapField = null;
          }
        }
      } else if (ft.schema) {
        schema2 = ft.schema;
        typedMapField = null;
      } else {
        typedMapField = null;
      }
    } else {
      typedMapField = null;
    }
  }
  if (!typedMapField)
    return [];
  const candidates = [];
  const primitiveTypes2 = typedMapField.__primitiveTypes ?? [];
  for (const pt of primitiveTypes2) {
    candidates.push({
      name: pt.keyword,
      kind: SymbolKind.TypeParameter,
      documentation: pt.description
    });
  }
  return candidates;
}
function extractCandidateDocumentation(obj) {
  const description = obj.description;
  if (isAstNodeLike(description)) {
    if (description.__kind === "StringLiteral" && typeof description.value === "string") {
      return description.value;
    }
  }
  return void 0;
}

// ../language/dist/core/analysis/schema-hover.js
function resolveSchemaField(path, schema2) {
  let current = schema2;
  const resolvedPath = [];
  let lastField = null;
  let lastKey = "";
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const raw = current[key];
    const field = Array.isArray(raw) ? raw[0] : raw;
    if (!field)
      break;
    lastField = field;
    lastKey = key;
    resolvedPath.push(key);
    if ((field.isNamed || field.__isCollection) && i + 1 < path.length) {
      i++;
      resolvedPath.push(path[i]);
    }
    if (field.__isTypedMap && i + 1 < path.length) {
      i++;
      resolvedPath.push(path[i]);
      const propsSchema = field.propertiesSchema;
      if (propsSchema && i + 1 < path.length) {
        current = propsSchema;
        continue;
      }
      continue;
    }
    if (field.schema) {
      current = field.schema;
    } else {
      break;
    }
  }
  if (!lastField)
    return null;
  return { field: lastField, resolvedPath, lastKey };
}
function formatConstraints(metadata) {
  const c = metadata.constraints;
  if (!c)
    return void 0;
  const parts = [];
  if (c.minimum !== void 0 && c.maximum !== void 0) {
    parts.push(`${c.minimum} \u2264 value \u2264 ${c.maximum}`);
  } else if (c.minimum !== void 0) {
    parts.push(`\u2265 ${c.minimum}`);
  } else if (c.maximum !== void 0) {
    parts.push(`\u2264 ${c.maximum}`);
  }
  if (c.exclusiveMinimum !== void 0)
    parts.push(`> ${c.exclusiveMinimum}`);
  if (c.exclusiveMaximum !== void 0)
    parts.push(`< ${c.exclusiveMaximum}`);
  if (c.multipleOf !== void 0)
    parts.push(`multiple of ${c.multipleOf}`);
  if (c.minLength !== void 0 && c.maxLength !== void 0) {
    parts.push(`length ${c.minLength}\u2013${c.maxLength}`);
  } else if (c.minLength !== void 0) {
    parts.push(`min length ${c.minLength}`);
  } else if (c.maxLength !== void 0) {
    parts.push(`max length ${c.maxLength}`);
  }
  if (c.pattern !== void 0)
    parts.push(`pattern \`/${c.pattern}/\``);
  if (c.minItems !== void 0 && c.maxItems !== void 0) {
    parts.push(`${c.minItems}\u2013${c.maxItems} items`);
  } else if (c.minItems !== void 0) {
    parts.push(`min ${c.minItems} item(s)`);
  } else if (c.maxItems !== void 0) {
    parts.push(`max ${c.maxItems} item(s)`);
  }
  if (c.enum !== void 0) {
    const vals = c.enum.map((v) => JSON.stringify(v)).join(", ");
    parts.push(`one of: ${vals}`);
  }
  if (c.const !== void 0) {
    parts.push(`must be ${JSON.stringify(c.const)}`);
  }
  return parts.length > 0 ? parts.join(" \xB7 ") : void 0;
}
function formatSchemaHoverMarkdown(path, metadata, modifiers, primitiveTypes2) {
  const parts = [];
  parts.push(`**${path.join(".")}**`);
  if (metadata.description) {
    parts.push(`

${metadata.description}`);
  }
  if (metadata.deprecated) {
    const msg = metadata.deprecated.message || "This field is deprecated.";
    parts.push(`

**Deprecated:** ${msg}`);
  }
  if (metadata.minVersion) {
    parts.push(`

_Added in v${metadata.minVersion}_`);
  }
  if (metadata.experimental) {
    parts.push(`

_Experimental_`);
  }
  if (modifiers && modifiers.length > 0) {
    parts.push(`

**Modifiers:** \`${modifiers.map((m) => m.keyword).join("` | `")}\``);
  }
  if (primitiveTypes2 && primitiveTypes2.length > 0) {
    parts.push(`

**Types:** \`${primitiveTypes2.map((t) => t.keyword).join("` | `")}\``);
  }
  const constraints = formatConstraints(metadata);
  if (constraints) {
    parts.push(`

**Constraints:** ${constraints}`);
  }
  return parts.join("");
}
function formatKeywordHoverMarkdown(keyword, kind, info) {
  const label = kind === "modifier" ? "Modifier" : "Type";
  const parts = [];
  parts.push(`**${keyword}** \u2014 _${label}_`);
  if (info?.description) {
    parts.push(`

${info.description}`);
  }
  if (info?.metadata) {
    const m = info.metadata;
    if (m.deprecated) {
      const msg = m.deprecated.message || "This keyword is deprecated.";
      parts.push(`

**Deprecated:** ${msg}`);
    }
    if (m.minVersion) {
      parts.push(`

_Added in v${m.minVersion}_`);
    }
    if (m.experimental) {
      parts.push(`

_Experimental_`);
    }
  }
  return parts.join("");
}
function findKeywordInfo(keyword, keywords) {
  return keywords.find((k) => k.keyword === keyword);
}

// ../language/dist/core/analysis/hover-resolver.js
function resolveHover(root, line, character, schema2, accessor) {
  const target = findNodeAtPosition(root, line, character, accessor);
  if (!target)
    return null;
  const targetType = accessor.type(target);
  if (findAncestorContext(root, target, "variable_declaration", accessor)) {
    const result = tryResolveModifierHover(target, root, schema2, accessor);
    if (result)
      return result;
  }
  if (targetType === "id" || targetType === "string") {
    if (targetType === "id") {
      const typeResult = tryResolveTypeHover(target, root, schema2, accessor);
      if (typeResult)
        return typeResult;
    }
    const path = buildSchemaPath(root, target, accessor);
    if (path.length > 0) {
      const resolved = resolveSchemaField(path, schema2);
      if (resolved?.field.__metadata) {
        const targetText = getKeyTextGeneric(target, accessor);
        if (targetText === resolved.lastKey) {
          return {
            kind: "field",
            key: path[path.length - 1],
            path: resolved.resolvedPath,
            metadata: resolved.field.__metadata,
            range: nodeRange(target, accessor),
            modifiers: resolved.field.__modifiers,
            primitiveTypes: resolved.field.__primitiveTypes
          };
        }
      }
    }
  }
  return null;
}
function findNodeAtPosition(node, line, character, a) {
  if (line < a.startLine(node) || line > a.endLine(node) || line === a.startLine(node) && character < a.startColumn(node) || line === a.endLine(node) && character >= a.endColumn(node)) {
    return null;
  }
  for (const child of a.children(node)) {
    const found = findNodeAtPosition(child, line, character, a);
    if (found)
      return found;
  }
  return node;
}
function buildSchemaPath(root, target, a) {
  const path = [];
  function walk(node) {
    if (node === target)
      return true;
    for (const child of a.children(node)) {
      if (walk(child)) {
        if (a.type(node) === "mapping_element") {
          const keyNode = a.childByFieldName(node, "key");
          if (keyNode) {
            const keys = extractKeyTexts(keyNode, a);
            path.unshift(...keys);
          }
        }
        return true;
      }
    }
    return false;
  }
  walk(root);
  return path;
}
function collectAncestorMappingElements(node, target, result, a) {
  if (node === target)
    return true;
  for (const child of a.children(node)) {
    if (collectAncestorMappingElements(child, target, result, a)) {
      if (a.type(node) === "mapping_element") {
        result.unshift(node);
      }
      return true;
    }
  }
  return false;
}
function findAncestorContext(root, target, type, a) {
  let found = null;
  function walk(node) {
    if (node === target)
      return true;
    for (const child of a.children(node)) {
      if (walk(child)) {
        if (a.type(node) === type && !found) {
          found = node;
        }
        return true;
      }
    }
    return false;
  }
  walk(root);
  return found;
}
function containsNode(container, target, a) {
  const startOk = a.startLine(target) > a.startLine(container) || a.startLine(target) === a.startLine(container) && a.startColumn(target) >= a.startColumn(container);
  const endOk = a.endLine(target) < a.endLine(container) || a.endLine(target) === a.endLine(container) && a.endColumn(target) <= a.endColumn(container);
  return startOk && endOk;
}
function tryResolveModifierHover(target, root, schema2, a) {
  const typedMapField = findContainingTypedMapField(target, root, schema2, a);
  if (!typedMapField?.__modifiers)
    return null;
  const modifierNames = keywordNames(typedMapField.__modifiers);
  const text = a.text(target);
  if (!modifierNames.includes(text))
    return null;
  const info = findKeywordInfo(text, typedMapField.__modifiers);
  return {
    kind: "modifier",
    keyword: text,
    info,
    range: nodeRange(target, a)
  };
}
function tryResolveTypeHover(target, root, schema2, a) {
  const varDecl = findAncestorContext(root, target, "variable_declaration", a);
  if (!varDecl)
    return null;
  const typeField = a.childByFieldName(varDecl, "type");
  if (!typeField || !containsNode(typeField, target, a))
    return null;
  const typedMapField = findContainingTypedMapField(target, root, schema2, a);
  if (!typedMapField?.__primitiveTypes)
    return null;
  const typeNames = keywordNames(typedMapField.__primitiveTypes);
  if (!typeNames.includes(a.text(target)))
    return null;
  const info = findKeywordInfo(a.text(target), typedMapField.__primitiveTypes);
  return {
    kind: "type",
    keyword: a.text(target),
    info,
    range: nodeRange(target, a)
  };
}
function findContainingTypedMapField(target, root, schema2, a) {
  const mappingElements = [];
  collectAncestorMappingElements(root, target, mappingElements, a);
  if (mappingElements.length < 2)
    return null;
  const fieldElement = mappingElements[mappingElements.length - 2];
  const path = buildSchemaPath(root, fieldElement, a);
  const keyNode = a.childByFieldName(fieldElement, "key");
  if (keyNode) {
    path.push(...extractKeyTexts(keyNode, a));
  }
  if (path.length === 0)
    return null;
  const resolved = resolveSchemaField(path, schema2);
  if (!resolved?.field.__isTypedMap)
    return null;
  return resolved.field;
}
function extractKeyTexts(keyNode, a) {
  return a.namedChildren(keyNode).filter((c) => a.type(c) === "id" || a.type(c) === "string").map((c) => getKeyTextGeneric(c, a));
}
function getKeyTextGeneric(node, a) {
  if (a.type(node) === "id")
    return a.text(node);
  if (a.type(node) === "string") {
    let value = "";
    for (const child of a.namedChildren(node)) {
      if (a.type(child) === "string_content") {
        value += a.text(child);
      } else if (a.type(child) === "escape_sequence") {
        const t = a.text(child);
        if (t === '\\"')
          value += '"';
        else if (t === "\\'")
          value += "'";
        else if (t === "\\\\")
          value += "\\";
        else if (t === "\\n")
          value += "\n";
        else if (t === "\\r")
          value += "\r";
        else if (t === "\\t")
          value += "	";
        else if (t === "\\0")
          value += "\0";
      }
    }
    return value;
  }
  return a.text(node);
}
function nodeRange(node, a) {
  return {
    start: { line: a.startLine(node), character: a.startColumn(node) },
    end: { line: a.endLine(node), character: a.endColumn(node) }
  };
}

// ../language/dist/lint/symbol-table.js
var symbolTableKey = storeKey("symbol-table");
var SymbolTablePass = class {
  constructor() {
    __publicField(this, "id", symbolTableKey);
    __publicField(this, "description", "Extracts LSP DocumentSymbol tree from the parsed AST");
  }
  finalize(store, root) {
    store.set(symbolTableKey, getDocumentSymbols(root));
  }
};
function symbolTableAnalyzer() {
  return new SymbolTablePass();
}

// ../language/dist/lint/schema-walker.js
function resolveSchemaEntry(rawFt) {
  const fieldType = Array.isArray(rawFt) ? rawFt[0] : rawFt;
  return { fieldType, innerSchema: fieldType.schema };
}
function isSchema(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function checkInstance(instance, schema2, visitor) {
  for (const [fieldName, rawFt] of Object.entries(schema2)) {
    const { fieldType, innerSchema } = resolveSchemaEntry(rawFt);
    const value = instance[fieldName];
    visitor.visitField?.(value, fieldType, fieldName, instance);
    if (value !== void 0) {
      checkFieldValue(value, fieldType, innerSchema, visitor);
    }
  }
}
function checkFieldValue(value, fieldType, innerSchema, visitor) {
  if (fieldType.__fieldKind === "TypedMap" && isNamedMap(value)) {
    const typedMapProps = "propertiesSchema" in fieldType && isSchema(fieldType.propertiesSchema) ? fieldType.propertiesSchema : void 0;
    if (typedMapProps) {
      for (const [, entry] of value) {
        if (isAstNodeLike(entry)) {
          const props = entry.properties;
          if (isAstNodeLike(props)) {
            checkInstance(props, typedMapProps, visitor);
          }
        }
      }
    }
  }
  if (isCollectionFieldType(fieldType)) {
    if (isNamedMap(value)) {
      const colinearType = "colinearType" in fieldType ? fieldType.colinearType : void 0;
      for (const [, entry] of value) {
        if (isAstNodeLike(entry)) {
          const entryBlock = fieldType.entryBlock;
          let entrySchema = innerSchema;
          if (hasDiscriminant(entryBlock)) {
            const discValue = extractDiscriminantValue(entry, entryBlock.discriminantField);
            if (discValue) {
              entrySchema = entryBlock.resolveSchemaForDiscriminant(discValue);
            }
          } else {
            const name = typeof entry.__name === "string" ? entry.__name : void 0;
            if (name) {
              entrySchema = entryBlock.resolveSchemaForName(name);
            }
          }
          if (entrySchema) {
            checkInstance(entry, entrySchema, visitor);
          }
          if (colinearType && entry.value !== void 0) {
            visitor.visitField?.(entry.value, colinearType, "value", entry);
          }
        }
      }
    }
  } else if (innerSchema) {
    if (isAstNodeLike(value) && !(value instanceof SequenceNode)) {
      let blockSchema = innerSchema;
      if (hasDiscriminant(fieldType)) {
        const discValue = extractDiscriminantValue(value, fieldType.discriminantField);
        if (discValue) {
          blockSchema = fieldType.resolveSchemaForDiscriminant(discValue);
        }
      }
      checkInstance(value, blockSchema, visitor);
    }
  }
  if (value instanceof SequenceNode) {
    const items = value.items;
    if (innerSchema) {
      for (const item of items) {
        if (isAstNodeLike(item) && "__symbol" in item) {
          checkInstance(item, innerSchema, visitor);
        }
      }
    }
  }
}
function walkSchema(root, rootSchema, visitor) {
  for (const [key, rawFt] of Object.entries(rootSchema)) {
    const { fieldType, innerSchema } = resolveSchemaEntry(rawFt);
    const value = astField(root, key);
    visitor.visitField?.(value, fieldType, key, root);
    if (value !== void 0) {
      checkFieldValue(value, fieldType, innerSchema, visitor);
    }
  }
}

// ../language/dist/lint/constraint-validation.js
function getConstraints(fieldType) {
  return fieldType.__metadata?.constraints;
}
function extractStaticValue(value) {
  if (!isAstNodeLike(value))
    return void 0;
  const kind = value.__kind;
  if (kind === "NumberValue") {
    const v = value.value;
    if (typeof v === "number")
      return { kind: "number", raw: v };
  }
  if (kind === "BooleanValue") {
    const v = value.value;
    if (typeof v === "boolean")
      return { kind: "boolean", raw: v };
  }
  if (kind === "StringLiteral") {
    const v = value.value;
    if (typeof v === "string")
      return { kind: "string", raw: v };
  }
  return void 0;
}
var patternCache = /* @__PURE__ */ new Map();
var lastSchemaContext;
function getCompiledPattern(pattern) {
  if (patternCache.has(pattern)) {
    return patternCache.get(pattern);
  }
  try {
    const re = new RegExp(pattern);
    patternCache.set(pattern, re);
    return re;
  } catch {
    patternCache.set(pattern, null);
    return null;
  }
}
function resolveCapabilityNamespaces(resolvedType, ctx) {
  if (resolvedType === "invocationTarget") {
    return ctx.invocationTargetNamespaces;
  }
  if (resolvedType === "transitionTarget") {
    return ctx.transitionTargetNamespaces;
  }
  return void 0;
}
function resolvedTypeLabel(resolvedType) {
  if (resolvedType === "invocationTarget")
    return "invocation target";
  if (resolvedType === "transitionTarget")
    return "transition target";
  return resolvedType;
}
function validateConstraints(value, constraints, fieldName, validatedRefs, ctx) {
  if (!isAstNodeLike(value))
    return;
  const node = value;
  const range = node.__cst?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
  if (constraints.resolvedType && node instanceof MemberExpression && ctx) {
    const ref = decomposeAtMemberExpression(value);
    if (ref && !ctx.globalScopes.has(ref.namespace)) {
      const validNamespaces = resolveCapabilityNamespaces(constraints.resolvedType, ctx);
      if (validNamespaces && !validNamespaces.has(ref.namespace)) {
        validatedRefs?.add(node);
        const objectNode = isAstNodeLike(node.object) ? node.object : void 0;
        const nsRange = objectNode?.__cst?.range ?? range;
        const label = resolvedTypeLabel(constraints.resolvedType);
        const verb = constraints.resolvedType === "invocationTarget" ? "invoke" : "reference";
        attachDiagnostic(node, lintDiagnostic(nsRange, `Cannot ${verb} '@${ref.namespace}.${ref.property}' \u2014 '${ref.namespace}' is not a valid ${label}.`, DiagnosticSeverity.Error, "constraint-resolved-type"));
        return;
      }
    }
  }
  if (constraints.allowedNamespaces && node instanceof MemberExpression) {
    validatedRefs?.add(node);
    const ref = decomposeAtMemberExpression(value);
    if (ref && !constraints.allowedNamespaces.includes(ref.namespace)) {
      const objectNode = isAstNodeLike(node.object) ? node.object : void 0;
      const nsRange = objectNode?.__cst?.range ?? range;
      const suggestion = findSuggestion(ref.namespace, [
        ...constraints.allowedNamespaces
      ]);
      const allowed = constraints.allowedNamespaces.map((ns) => `@${ns}`).join(", ");
      const base = `'${fieldName}' must reference one of: ${allowed}. Got @${ref.namespace}`;
      const message = formatSuggestionHint(base, suggestion, "@");
      attachDiagnostic(node, lintDiagnostic(nsRange, message, DiagnosticSeverity.Error, "constraint-allowed-namespaces"));
    }
    return;
  }
  if (node instanceof SequenceNode) {
    const items = node.items;
    const count = items.length;
    if (constraints.minItems !== void 0 && count < constraints.minItems) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must have at least ${constraints.minItems} item(s), got ${count}`, DiagnosticSeverity.Error, "constraint-min-items"));
    }
    if (constraints.maxItems !== void 0 && count > constraints.maxItems) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must have at most ${constraints.maxItems} item(s), got ${count}`, DiagnosticSeverity.Error, "constraint-max-items"));
    }
    return;
  }
  const extracted = extractStaticValue(value);
  if (!extracted)
    return;
  const { kind, raw } = extracted;
  if (constraints.enum !== void 0 && !constraints.enum.includes(raw)) {
    const allowed = constraints.enum.map((v) => JSON.stringify(v)).join(", ");
    attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be one of: ${allowed}. Got ${JSON.stringify(raw)}`, DiagnosticSeverity.Error, "constraint-enum"));
  }
  if (constraints.const !== void 0 && raw !== constraints.const) {
    attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be ${JSON.stringify(constraints.const)}. Got ${JSON.stringify(raw)}`, DiagnosticSeverity.Error, "constraint-const"));
  }
  if (kind === "number" && typeof raw === "number") {
    if (constraints.minimum !== void 0 && raw < constraints.minimum) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be >= ${constraints.minimum}, got ${raw}`, DiagnosticSeverity.Error, "constraint-minimum"));
    }
    if (constraints.maximum !== void 0 && raw > constraints.maximum) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be <= ${constraints.maximum}, got ${raw}`, DiagnosticSeverity.Error, "constraint-maximum"));
    }
    if (constraints.exclusiveMinimum !== void 0 && raw <= constraints.exclusiveMinimum) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be > ${constraints.exclusiveMinimum}, got ${raw}`, DiagnosticSeverity.Error, "constraint-exclusive-minimum"));
    }
    if (constraints.exclusiveMaximum !== void 0 && raw >= constraints.exclusiveMaximum) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be < ${constraints.exclusiveMaximum}, got ${raw}`, DiagnosticSeverity.Error, "constraint-exclusive-maximum"));
    }
    if (constraints.multipleOf !== void 0) {
      const remainder = Math.abs(raw % constraints.multipleOf);
      const epsilon = Number.EPSILON * Math.max(1, Math.abs(raw), Math.abs(constraints.multipleOf));
      if (remainder > epsilon && Math.abs(remainder - constraints.multipleOf) > epsilon) {
        attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be a multiple of ${constraints.multipleOf}, got ${raw}`, DiagnosticSeverity.Error, "constraint-multiple-of"));
      }
    }
  }
  if (kind === "string" && typeof raw === "string") {
    if (constraints.minLength !== void 0 && raw.length < constraints.minLength) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be at least ${constraints.minLength} character(s) long, got ${raw.length}`, DiagnosticSeverity.Error, "constraint-min-length"));
    }
    if (constraints.maxLength !== void 0 && raw.length > constraints.maxLength) {
      attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must be at most ${constraints.maxLength} character(s) long, got ${raw.length}`, DiagnosticSeverity.Error, "constraint-max-length"));
    }
    if (constraints.pattern !== void 0) {
      const re = getCompiledPattern(constraints.pattern);
      if (re === null) {
        attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' has invalid constraint pattern: /${constraints.pattern}/`, DiagnosticSeverity.Warning, "constraint-invalid-pattern"));
      } else if (!re.test(raw)) {
        attachDiagnostic(node, lintDiagnostic(range, `'${fieldName}' must match pattern /${constraints.pattern}/`, DiagnosticSeverity.Error, "constraint-pattern"));
      }
    }
  }
}
var constraintValidationKey = storeKey("constraint-validation");
var ConstraintValidationPass = class {
  constructor() {
    __publicField(this, "id", constraintValidationKey);
    __publicField(this, "description", "Validates field values against JSON Schema-style constraints (min, max, pattern, enum, etc.)");
    __publicField(this, "requires", [schemaContextKey]);
  }
  run(store, root) {
    const ctx = store.get(schemaContextKey);
    if (!ctx)
      return;
    if (lastSchemaContext !== ctx) {
      patternCache.clear();
      lastSchemaContext = ctx;
    }
    const validatedRefs = /* @__PURE__ */ new Set();
    walkSchema(root, ctx.info.schema, {
      visitField(value, fieldType, fieldName) {
        if (value === void 0)
          return;
        const constraints = getConstraints(fieldType);
        if (constraints) {
          validateConstraints(value, constraints, fieldName, validatedRefs, ctx);
        }
      }
    });
    store.set(constraintValidationKey, validatedRefs);
  }
};
function constraintValidationPass() {
  return new ConstraintValidationPass();
}

// ../language/dist/lint/undefined-reference.js
function resolveInAncestors(ancestors, namespace, name, schemaCtx) {
  const scopesRequired = schemaCtx.scopedNamespaces.get(namespace);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj))
      continue;
    if (scopesRequired) {
      if (!obj.__scope || !scopesRequired.has(obj.__scope))
        continue;
    }
    const map = obj[namespace];
    if (isNamedMap(map) && map.has(name)) {
      return true;
    }
  }
  return false;
}
function findReferencedBlock(ancestors, startIndex, ref, schemaCtx) {
  const scopesRequired = schemaCtx.scopedNamespaces.get(ref.namespace);
  for (let j = startIndex - 1; j >= 0; j--) {
    const parent = ancestors[j];
    if (!isAstNodeLike(parent) || isNamedMap(parent))
      continue;
    if (scopesRequired) {
      if (!parent.__scope || !scopesRequired.has(parent.__scope))
        continue;
    }
    const refMap = parent[ref.namespace];
    if (!isNamedMap(refMap))
      continue;
    const refBlock = refMap.get(ref.property);
    if (isAstNodeLike(refBlock))
      return refBlock;
  }
  return void 0;
}
function isRunTransparentForOutputs(ancestors, runIdx) {
  const next = ancestors[runIdx + 1];
  return isAstNodeLike(next) && next.__kind === "WithClause";
}
function resolveNestedRunOverride(ancestors, namespace, schemaCtx) {
  const scopesRequired = schemaCtx.scopedNamespaces.get(namespace);
  if (!scopesRequired?.has("action"))
    return void 0;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj))
      continue;
    if (obj.__scope && scopesRequired.has(obj.__scope))
      return void 0;
    if (obj.__kind !== "RunStatement")
      continue;
    if (isRunTransparentForOutputs(ancestors, i))
      continue;
    const target = obj.target;
    if (!target || typeof target !== "object")
      continue;
    const ref = decomposeAtMemberExpression(target);
    if (!ref)
      continue;
    const refBlock = findReferencedBlock(ancestors, i, ref, schemaCtx);
    if (!refBlock)
      return void 0;
    const nsMap = refBlock[namespace];
    if (isNamedMap(nsMap)) {
      return [...nsMap.keys()];
    }
    return [];
  }
  return void 0;
}
function resolveColinearCandidates(ancestors, namespace, schemaCtx) {
  const scopesRequired = schemaCtx.scopedNamespaces.get(namespace);
  if (!scopesRequired || scopesRequired.size === 0)
    return void 0;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj))
      continue;
    const node = obj;
    if (node.__kind === "RunStatement" && scopesRequired.has("action") && !isRunTransparentForOutputs(ancestors, i)) {
      const target = node.target;
      if (!target || typeof target !== "object")
        continue;
      const ref2 = decomposeAtMemberExpression(target);
      if (!ref2)
        continue;
      const refBlock2 = findReferencedBlock(ancestors, i, ref2, schemaCtx);
      if (!refBlock2)
        return void 0;
      const nsMap2 = refBlock2[namespace];
      if (isNamedMap(nsMap2)) {
        return [...nsMap2.keys()];
      }
      return [];
    }
    if (!node.__scope || !scopesRequired.has(node.__scope))
      continue;
    const value = node.value;
    if (!value || typeof value !== "object")
      continue;
    const ref = decomposeAtMemberExpression(value);
    if (!ref)
      continue;
    const refBlock = findReferencedBlock(ancestors, i, ref, schemaCtx);
    if (!refBlock)
      return void 0;
    const nsMap = refBlock[namespace];
    if (isNamedMap(nsMap)) {
      return [...nsMap.keys()];
    }
    return [];
  }
  return void 0;
}
function isSelfReference(ancestors, namespace, property) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj))
      continue;
    const map = obj[namespace];
    if (isNamedMap(map) && map.has(property)) {
      if (i + 2 < ancestors.length && ancestors[i + 1] === map && isAstNodeLike(ancestors[i + 2]) && map.get(property) === ancestors[i + 2]) {
        return true;
      }
    }
  }
  return false;
}
function resolveCheck(check, rctx) {
  const { expr, namespace, property, ctx, ancestors } = check;
  const { symbols, schemaCtx, validatedRefs, root } = rctx;
  if (validatedRefs.has(expr))
    return { kind: "skip-validated" };
  if (schemaCtx.scopedNamespaces.has(namespace) && schemaCtx.colinearResolvedScopes.has(namespace)) {
    const runOverride = resolveNestedRunOverride(ancestors, namespace, schemaCtx);
    if (runOverride !== void 0) {
      if (runOverride.includes(property))
        return { kind: "resolved" };
      return { kind: "colinear-miss", members: runOverride };
    }
  }
  const candidates = getSymbolMembers(symbols, namespace, schemaCtx, ctx);
  const globalMembers = schemaCtx.globalScopes.get(namespace);
  const selfRef = isSelfReference(ancestors, namespace, property);
  if (candidates !== null) {
    if (resolveInAncestors(ancestors, namespace, property, schemaCtx)) {
      return { kind: "resolved" };
    }
    if (!selfRef) {
      const resolved = resolveReference(root, namespace, property, schemaCtx, ctx, symbols);
      if (resolved)
        return { kind: "resolved" };
    }
    if (globalMembers) {
      if (globalMembers.has(property) || globalMembers.has("*")) {
        return { kind: "resolved" };
      }
    }
    if (selfRef) {
      const filtered = candidates.filter((c) => c !== property);
      return { kind: "standard-miss", candidates: filtered };
    }
    return { kind: "standard-miss", candidates };
  }
  if (globalMembers) {
    if (globalMembers.has(property) || globalMembers.has("*")) {
      return { kind: "resolved" };
    }
    return { kind: "global-miss", members: [...globalMembers] };
  }
  const isSchemaKey = getSchemaNamespaces(schemaCtx).has(namespace);
  const isScopedNs = schemaCtx.scopedNamespaces.has(namespace);
  if (isScopedNs) {
    if (!schemaCtx.colinearResolvedScopes.has(namespace)) {
      return { kind: "non-referenceable-scope" };
    }
    const colinearMembers = resolveColinearCandidates(ancestors, namespace, schemaCtx);
    if (colinearMembers === void 0) {
      return { kind: "skip-colinear-unresolvable" };
    }
    if (colinearMembers.includes(property))
      return { kind: "resolved" };
    return { kind: "colinear-miss", members: colinearMembers };
  }
  if (!isSchemaKey) {
    const knownNamespaces = [
      ...getSchemaNamespaces(schemaCtx),
      ...schemaCtx.globalScopes.keys()
    ];
    return { kind: "unknown-namespace", knownNamespaces };
  }
  return { kind: "skip-schema-key" };
}
function formatResolutionDiagnostic(result, namespace, property, range) {
  const referenceName = `@${namespace}.${property}`;
  switch (result.kind) {
    case "resolved":
    case "skip-validated":
    case "skip-schema-key":
    case "skip-colinear-unresolvable":
      return void 0;
    case "global-miss": {
      const suggestion = findSuggestion(property, result.members);
      return undefinedReferenceDiagnostic(range, `'${property}' is not defined in ${namespace}`, referenceName, suggestion, result.members);
    }
    case "unknown-namespace": {
      const suggestion = findSuggestion(namespace, result.knownNamespaces);
      return undefinedReferenceDiagnostic(range, `'@${namespace}' is not a recognized namespace`, referenceName, suggestion, result.knownNamespaces);
    }
    case "non-referenceable-scope":
      return undefinedReferenceDiagnostic(range, `'@${namespace}' cannot be used as a reference. This namespace is scoped to its parent block and is not directly referenceable`, referenceName);
    case "colinear-miss": {
      const suggestion = findSuggestion(property, result.members);
      return undefinedReferenceDiagnostic(range, `'${property}' is not defined in ${namespace}`, referenceName, suggestion, result.members);
    }
    case "standard-miss": {
      const suggestion = findSuggestion(property, result.candidates);
      return undefinedReferenceDiagnostic(range, `'${property}' is not defined in ${namespace}`, referenceName, suggestion, result.candidates);
    }
  }
}
var UndefinedReferencePass = class {
  constructor() {
    __publicField(this, "id", storeKey("undefined-reference"));
    __publicField(this, "description", "Validates that @namespace.member references point to defined symbols");
    __publicField(this, "requires", [symbolTableKey, constraintValidationKey]);
    __publicField(this, "pendingChecks", []);
    __publicField(this, "ancestorStack", []);
  }
  init() {
    this.pendingChecks = [];
    this.ancestorStack = [];
  }
  enterNode(_key, value) {
    this.ancestorStack.push(value);
  }
  exitNode() {
    this.ancestorStack.pop();
  }
  visitExpression(expr, ctx) {
    const decomposed = decomposeAtMemberExpression(expr);
    if (!decomposed)
      return;
    this.pendingChecks.push({
      expr,
      namespace: decomposed.namespace,
      property: decomposed.property,
      ctx,
      ancestors: [...this.ancestorStack]
    });
  }
  run(store, root) {
    const symbols = store.get(symbolTableKey) ?? [];
    const schemaCtx = store.get(schemaContextKey);
    if (!schemaCtx)
      return;
    const validatedRefs = store.get(constraintValidationKey);
    if (!validatedRefs) {
      throw new Error("undefined-reference pass requires constraint-validation to run first. Ensure constraintValidationPass is included and listed before undefinedReferencePass.");
    }
    const rctx = { symbols, schemaCtx, validatedRefs, root };
    for (const check of this.pendingChecks) {
      const result = resolveCheck(check, rctx);
      const cst = check.expr.__cst;
      if (!cst)
        continue;
      const diagnostic = formatResolutionDiagnostic(result, check.namespace, check.property, cst.range);
      if (diagnostic) {
        attachDiagnostic(check.expr, diagnostic);
      }
    }
  }
};
function undefinedReferencePass() {
  return new UndefinedReferencePass();
}

// ../language/dist/lint/duplicate-keys.js
function getKeyRange2(child) {
  if (child.__keyRange)
    return child.__keyRange;
  const val = child.value;
  if (hasCstRange(val)) {
    return val.__cst.range;
  }
  return void 0;
}
var DuplicateKeyPass = class {
  constructor() {
    __publicField(this, "id", storeKey("duplicate-key"));
    __publicField(this, "description", "Detects duplicate keys within block fields");
    __publicField(this, "nodes", []);
  }
  init() {
    this.nodes = [];
  }
  enterNode(_key, value, _parent) {
    if (isAstNodeLike(value) && value.__children) {
      this.nodes.push(value);
    }
  }
  finalize(_store, _root) {
    for (const node of this.nodes) {
      this.checkForDuplicates(node);
    }
  }
  /**
   * Detect duplicates by walking __children (AST), not the CST.
   *
   * __children already reflects orphan adoption and ERROR recovery:
   * - Adopted elements are skipped during parsing (never pushed to children)
   * - ERROR-recovered elements have their inner __children merged
   * - Real duplicates (same field written twice) are both pushed unconditionally
   */
  checkForDuplicates(node) {
    if (!node.__children)
      return;
    const seenKeys = /* @__PURE__ */ new Map();
    for (const child of node.__children) {
      if (!(child instanceof FieldChild))
        continue;
      const dupKey = child.entryName ? `${child.key} ${child.entryName}` : child.key;
      if (seenKeys.has(dupKey)) {
        const keyRange = getKeyRange2(child);
        if (keyRange) {
          attachDiagnostic(node, lintDiagnostic(keyRange, `Duplicate key '${dupKey}'`, DiagnosticSeverity.Warning, "duplicate-key"));
        }
      } else {
        seenKeys.set(dupKey, child);
      }
    }
  }
};
function duplicateKeyPass() {
  return new DuplicateKeyPass();
}

// ../language/dist/lint/required-fields.js
function isRequired(fieldType) {
  return fieldType.__metadata?.required === true;
}
function blockHeaderRange(instance) {
  const fallback = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
  const cst = instance.__cst;
  if (!cst)
    return fallback;
  const node = cst.node;
  const mappingElement = node.type === "mapping_element" ? node : node.parent?.type === "mapping_element" ? node.parent : null;
  if (mappingElement) {
    const keyNode = mappingElement.childForFieldName("key");
    if (keyNode) {
      return toRange(keyNode);
    }
  }
  return {
    start: cst.range.start,
    end: { line: cst.range.start.line, character: cst.range.start.character }
  };
}
var RequiredFieldPass = class {
  constructor() {
    __publicField(this, "id", storeKey("required-fields"));
    __publicField(this, "description", "Validates that blocks contain all required fields from their schema");
    __publicField(this, "requires", [schemaContextKey]);
  }
  run(store, root) {
    const ctx = store.get(schemaContextKey);
    if (!ctx)
      return;
    walkSchema(root, ctx.info.schema, {
      visitField(value, fieldType, fieldName, instance) {
        if (isRequired(fieldType) && value === void 0) {
          attachDiagnostic(instance, lintDiagnostic(blockHeaderRange(instance), `Missing required field '${fieldName}'`, DiagnosticSeverity.Error, "missing-required-field"));
        }
      }
    });
  }
};
function requiredFieldPass() {
  return new RequiredFieldPass();
}

// ../language/dist/lint/singular-collection.js
var SingularCollectionPass = class {
  constructor() {
    __publicField(this, "id", storeKey("singular-collection"));
    __publicField(this, "description", "Enforces that collection fields marked singular contain at most one entry");
  }
  finalize(store, root) {
    const ctx = store.get(schemaContextKey);
    if (!ctx)
      return;
    const schema2 = ctx.info.schema;
    const rootObj = root;
    for (const [key, fieldType] of Object.entries(schema2)) {
      if (!isSingularField(fieldType))
        continue;
      const collection = rootObj[key];
      if (!isNamedMap(collection) || collection.size <= 1)
        continue;
      let index = 0;
      for (const [, entry] of collection) {
        if (index === 0) {
          index++;
          continue;
        }
        const range = getEntryRange(entry);
        if (range) {
          attachDiagnostic(root, lintDiagnostic(range, `Only one '${key}' is allowed, but found multiple entries`, DiagnosticSeverity.Error, "singular-collection"));
        }
        index++;
      }
    }
  }
};
function isSingularField(fieldType) {
  return fieldType.__metadata?.singular === true;
}
function getEntryRange(entry) {
  return hasCstRange(entry) ? entry.__cst.range : void 0;
}
function singularCollectionPass() {
  return new SingularCollectionPass();
}

// ../language/dist/lint/position-index.js
var PositionIndexPass = class {
  constructor() {
    __publicField(this, "id", positionIndexKey);
    __publicField(this, "description", "Builds a position index for fast cursor lookups");
    __publicField(this, "expressions", []);
  }
  init() {
    this.expressions = [];
  }
  visitExpression(expr, scope) {
    const cst = expr.__cst;
    if (!cst)
      return;
    this.expressions.push({ expr, range: cst.range, scope });
  }
  finalize(store, root) {
    const definitions = [];
    walkDefinitionKeys(root, (namespace, name, keyRange, fullRange, scope) => {
      definitions.push({ namespace, name, keyRange, fullRange, scope });
    });
    const scopes = [];
    walkScopeEntries(root, {}, /* @__PURE__ */ new Set(), scopes);
    store.set(positionIndexKey, {
      expressions: this.expressions,
      definitions,
      scopes
    });
  }
};
function walkScopeEntries(value, parentScope, visited, out) {
  if (!value || typeof value !== "object")
    return;
  if (visited.has(value))
    return;
  visited.add(value);
  if (isNamedMap(value)) {
    for (const [name, entry] of value) {
      if (!isAstNodeLike(entry))
        continue;
      const cst = entry.__cst;
      if (!cst)
        continue;
      const blockScope = entry.__scope;
      let scope = parentScope;
      if (blockScope && typeof entry.__name === "string") {
        scope = { ...parentScope, [blockScope]: name };
        out.push({ range: cst.range, scope });
      }
      recurseAstChildren(entry, (_k, child) => {
        walkScopeEntries(child, scope, visited, out);
      });
    }
    return;
  }
  recurseAstChildren(value, (_k, child) => {
    walkScopeEntries(child, parentScope, visited, out);
  });
}
function positionIndexPass() {
  return new PositionIndexPass();
}

// ../language/dist/lint/unreachable-code.js
function isTerminal(stmt) {
  if (stmt instanceof TransitionStatement)
    return true;
  if (stmt instanceof IfStatement) {
    if (stmt.orelse.length === 0)
      return false;
    return alwaysTerminates(stmt.body) && alwaysTerminates(stmt.orelse);
  }
  return false;
}
function alwaysTerminates(stmts) {
  return stmts.some(isTerminal);
}
function unreachableMessage(terminalStmt) {
  if (terminalStmt instanceof TransitionStatement) {
    return "Code will never execute after 'transition'. Move this code before the transition, or wrap the transition in a conditional block.";
  }
  return "Code will never execute because all branches of the preceding 'if' block transition away. Add an else branch without a transition, or move this code into one of the branches.";
}
function isStatement(value) {
  return isEmittable(value) && "__kind" in value && typeof value.__kind === "string";
}
function checkStatements(stmts) {
  let terminalStmt = null;
  for (const raw of stmts) {
    if (!isStatement(raw))
      continue;
    const stmt = raw;
    if (terminalStmt) {
      const range = stmt.__cst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      };
      if (!isAstNodeLike(stmt))
        continue;
      attachDiagnostic(stmt, lintDiagnostic(range, unreachableMessage(terminalStmt), DiagnosticSeverity.Warning, "unreachable-code", { tags: [DiagnosticTag.Unnecessary] }));
      continue;
    }
    if (isTerminal(stmt)) {
      terminalStmt = stmt;
    }
    if (stmt instanceof IfStatement) {
      checkStatements(stmt.body);
      checkStatements(stmt.orelse);
    } else if (stmt instanceof RunStatement) {
      checkStatements(stmt.body);
    }
  }
}
var UnreachableCodePass = class {
  constructor() {
    __publicField(this, "id", storeKey("unreachable-code"));
    __publicField(this, "description", "Detects unreachable code after terminal statements like transition");
    __publicField(this, "procedures", []);
  }
  init() {
    this.procedures = [];
  }
  enterNode(_key, value, _parent) {
    if (isAstNodeLike(value) && value.__kind === "ProcedureValue") {
      this.procedures.push(value);
    }
  }
  run(_store, _root) {
    for (const proc of this.procedures) {
      const stmts = proc.statements;
      if (Array.isArray(stmts) && stmts.length > 0) {
        checkStatements(stmts);
      }
    }
  }
};
function unreachableCodePass() {
  return new UnreachableCodePass();
}

// ../language/dist/lint/empty-block.js
var MUST_NOT_BE_EMPTY = /* @__PURE__ */ new Set(["inputs", "outputs"]);
var EmptyBlockPass = class {
  constructor() {
    __publicField(this, "id", storeKey("empty-block"));
    __publicField(this, "description", "Flags empty inputs/outputs blocks that should contain at least one entry");
    __publicField(this, "hits", []);
  }
  init() {
    this.hits = [];
  }
  enterNode(key, value, parent) {
    if (!MUST_NOT_BE_EMPTY.has(key))
      return;
    if (!parent || typeof parent !== "object")
      return;
    let node = null;
    if (isNamedMap(value)) {
      if (value.size > 0)
        return;
      node = value;
    } else if (value == null) {
      node = null;
    } else {
      return;
    }
    this.hits.push({
      key,
      node,
      parent
    });
  }
  finalize(_store, _root) {
    for (const { key, node, parent } of this.hits) {
      const cst = node?.__cst;
      const parentCst = parent.__cst;
      const range = cst?.range ?? parentCst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      };
      attachDiagnostic(node ?? parent, lintDiagnostic(range, `Empty '${key}' block \u2014 must contain at least one entry`, DiagnosticSeverity.Error, "empty-block"));
    }
  }
};
function emptyBlockPass() {
  return new EmptyBlockPass();
}

// ../language/dist/lint/spread-context.js
var SpreadContextPass = class {
  constructor() {
    __publicField(this, "id", storeKey("spread-context"));
    __publicField(this, "description", "Rejects spread expressions outside call arguments or list literals");
  }
  enterNode(key, value, parent) {
    if (!(value instanceof SpreadExpression))
      return;
    if (parent instanceof CallExpression && key !== "func")
      return;
    if (parent instanceof ListLiteral)
      return;
    const cst = value.__cst;
    if (!cst)
      return;
    attachDiagnostic(value, lintDiagnostic(cst.range, "Spread expression is only allowed as a call argument or list element", DiagnosticSeverity.Error, "invalid-spread-context"));
  }
};
function spreadContextPass() {
  return new SpreadContextPass();
}

// ../language/dist/lint/unused-variable.js
var UnusedVariablePass = class {
  constructor() {
    __publicField(this, "id", storeKey("unused-variable"));
    __publicField(this, "description", "Flags variables that are declared but never referenced");
    __publicField(this, "usedVariables", /* @__PURE__ */ new Set());
  }
  init() {
    this.usedVariables = /* @__PURE__ */ new Set();
  }
  visitExpression(expr, _ctx) {
    const name = extractVariableRef(expr);
    if (name) {
      this.usedVariables.add(name);
    }
  }
  run(_store, root) {
    const variables = root.variables;
    if (!isNamedMap(variables))
      return;
    for (const [name, decl] of variables) {
      if (this.usedVariables.has(name))
        continue;
      const node = isAstNodeLike(decl) ? decl : null;
      if (!node?.__cst)
        continue;
      const fullRange = node.__cst.range;
      attachDiagnostic(node, {
        range: fullRange,
        message: `Variable '${name}' is declared but never used`,
        severity: DiagnosticSeverity.Warning,
        code: "unused-variable",
        source: LINT_SOURCE,
        tags: [DiagnosticTag.Unnecessary],
        data: { removalRange: fullRange }
      });
    }
  }
};
function unusedVariablePass() {
  return new UnusedVariablePass();
}

// ../language/dist/lint/expression-validation.js
var BUILTIN_FUNCTIONS = /* @__PURE__ */ new Set([
  "len",
  "max",
  "min"
]);
var DEFAULT_SUPPORTED_OPERATORS = /* @__PURE__ */ new Set([
  "+",
  "-",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "and",
  "or",
  "not",
  "in",
  "not in"
]);
var ExpressionValidationPass = class {
  constructor(options = {}) {
    __publicField(this, "id", storeKey("expression-validation"));
    __publicField(this, "description", "Validates function calls and operators used in expressions");
    __publicField(this, "allowedFunctions");
    __publicField(this, "namespacedFunctions");
    __publicField(this, "allowedFunctionsList");
    __publicField(this, "supportedOperators");
    this.allowedFunctions = options.functions ?? BUILTIN_FUNCTIONS;
    this.namespacedFunctions = options.namespacedFunctions ?? {};
    this.supportedOperators = options.supportedOperators ?? DEFAULT_SUPPORTED_OPERATORS;
    this.allowedFunctionsList = [...this.allowedFunctions];
  }
  visitExpression(expr, _ctx) {
    if (expr instanceof CallExpression) {
      this.checkCallExpression(expr);
    } else if (expr instanceof BinaryExpression) {
      this.checkBinaryExpression(expr);
    }
  }
  checkCallExpression(expr) {
    const cst = expr.__cst;
    if (!cst)
      return;
    const func = expr.func;
    if (!func || typeof func !== "object" || !("__kind" in func))
      return;
    if (func instanceof MemberExpression) {
      const namespaceExpression = func.object;
      if (namespaceExpression instanceof Identifier) {
        const namespaceName = namespaceExpression.name;
        const allowedInNamespace = this.namespacedFunctions[namespaceName] ?? /* @__PURE__ */ new Set();
        if (!(namespaceName in this.namespacedFunctions)) {
          const knownNamespaces = Object.keys(this.namespacedFunctions);
          const suggestion = findSuggestion(namespaceName, knownNamespaces);
          const base = `'${namespaceName}' is not a recognized function. Available functions: ${[...this.allowedFunctionsList, ...knownNamespaces].join(", ")}`;
          const message = formatSuggestionHint(base, suggestion);
          attachDiagnostic(expr, lintDiagnostic(cst.range, message, DiagnosticSeverity.Error, "unknown-function", { suggestion }));
        } else if (!allowedInNamespace.has(func.property)) {
          const allowedList = [...allowedInNamespace];
          const suggestion = findSuggestion(func.property, allowedList);
          const base = `'${func.property}' is not a recognized function in namespace '${namespaceName}'. Available functions: ${allowedList.join(", ")}`;
          const message = formatSuggestionHint(base, suggestion);
          attachDiagnostic(expr, lintDiagnostic(cst.range, message, DiagnosticSeverity.Error, "unknown-function", { suggestion }));
        }
      } else {
        const allNamespacedFns = Object.entries(this.namespacedFunctions).flatMap(([ns, fns]) => [...fns].map((f) => `${ns}.${f}`));
        attachDiagnostic(expr, lintDiagnostic(cst.range, `Namespace function calls are not permitted. Only direct namespace function calls are allowed (${allNamespacedFns.join(", ")})`, DiagnosticSeverity.Error, "namespace-function-call"));
      }
    } else if (func instanceof Identifier) {
      this.validateIdentifier(func, expr, this.allowedFunctions, this.allowedFunctionsList);
    } else {
      attachDiagnostic(expr, lintDiagnostic(cst.range, `Indirect function calls are not permitted. Only direct calls to built-in functions are allowed (${this.allowedFunctionsList.join(", ")})`, DiagnosticSeverity.Error, "indirect-function-call"));
    }
  }
  validateIdentifier(func, expr, allowedFunctions, allowedFunctionList) {
    const cst = expr.__cst;
    if (!cst)
      return;
    const funcName = func.name;
    if (funcName.length === 0) {
      attachDiagnostic(expr, lintDiagnostic(cst.range, 'Unexpected Identifier node: missing "name" property', DiagnosticSeverity.Warning, "malformed-ast"));
    } else if (!allowedFunctions.has(funcName)) {
      const suggestion = findSuggestion(funcName, allowedFunctionList);
      const base = `'${funcName}' is not a recognized function. Available functions: ${allowedFunctionList.join(", ")}`;
      const message = formatSuggestionHint(base, suggestion);
      attachDiagnostic(expr, lintDiagnostic(cst.range, message, DiagnosticSeverity.Error, "unknown-function", { suggestion }));
    }
  }
  checkBinaryExpression(expr) {
    const op = expr.operator;
    if (typeof op !== "string")
      return;
    if (!this.supportedOperators.has(op)) {
      const cst = expr.__cst;
      if (!cst)
        return;
      attachDiagnostic(expr, lintDiagnostic(cst.range, `Operator '${op}' is not supported`, DiagnosticSeverity.Error, "unsupported-operator"));
    }
  }
};
function expressionValidationPass(options) {
  return new ExpressionValidationPass(options);
}

// ../language/dist/dialect-annotation.js
var DIALECT_PATTERN = /^#\s*@dialect:\s*(\w+)(?:=(\d+(?:\.\d+)?))?/im;
function parseDialectAnnotation(source) {
  const lines = source.split("\n", 10);
  for (let i = 0; i < lines.length; i++) {
    const match = DIALECT_PATTERN.exec(lines[i]);
    if (match) {
      const nameStart = match.index + match[0].indexOf(match[1]);
      const version2 = match[2] || void 0;
      let versionStart = -1;
      let versionLength = 0;
      if (version2) {
        versionStart = match.index + match[0].lastIndexOf(version2);
        versionLength = version2.length;
      }
      return {
        name: match[1].toLowerCase(),
        version: version2,
        line: i,
        nameStart,
        nameLength: match[1].length,
        versionStart,
        versionLength
      };
    }
  }
  return null;
}

// ../language/dist/dialect-resolution.js
function checkVersion(requested, available, dialectName) {
  const reqParts = requested.split(".").map(Number);
  const availParts = available.split(".").map(Number);
  const reqMajor = reqParts[0];
  const availMajor = availParts[0];
  if (reqMajor !== availMajor) {
    return {
      message: `Incompatible major version: requested ${dialectName}=${requested} but only v${available} is available`,
      severity: 1
    };
  }
  if (reqParts.length >= 2) {
    const reqMinor = reqParts[1];
    const availMinor = availParts[1] ?? 0;
    if (availMinor < reqMinor) {
      return {
        message: `Minimum minor version not met: requested ${dialectName}>=${reqMajor}.${reqMinor} but v${available} is available`,
        severity: 2
      };
    }
  }
  return null;
}
function resolveDialect(source, config2) {
  const annotation = parseDialectAnnotation(source);
  if (annotation) {
    const match = config2.dialects.find((d) => d.name.toLowerCase() === annotation.name);
    if (match) {
      if (annotation.version) {
        const versionIssue = checkVersion(annotation.version, match.version, annotation.name);
        if (versionIssue) {
          const availParts = match.version.split(".");
          const major = availParts[0];
          const majorMinor = `${availParts[0]}.${availParts[1] ?? 0}`;
          const suggestedVersions = major === majorMinor ? [major] : [major, majorMinor];
          return {
            dialect: match,
            versionDiagnostic: {
              message: versionIssue.message,
              severity: versionIssue.severity,
              line: annotation.line,
              versionStart: annotation.versionStart,
              versionLength: annotation.versionLength,
              suggestedVersions
            }
          };
        }
      }
      return { dialect: match };
    }
    const defaultName2 = config2.defaultDialect ?? config2.dialects[0]?.name;
    const defaultDialect2 = config2.dialects.find((d) => d.name === defaultName2);
    if (!defaultDialect2) {
      throw new Error(`No dialect available. Configure at least one dialect in DialectResolutionConfig.`);
    }
    return {
      dialect: defaultDialect2,
      unknownDialect: {
        name: annotation.name,
        line: annotation.line,
        nameStart: annotation.nameStart,
        nameLength: annotation.nameLength,
        availableNames: config2.dialects.map((d) => d.name)
      }
    };
  }
  const defaultName = config2.defaultDialect ?? config2.dialects[0]?.name;
  const defaultDialect = config2.dialects.find((d) => d.name === defaultName);
  if (!defaultDialect) {
    throw new Error(`No dialect available. Configure at least one dialect in DialectResolutionConfig.`);
  }
  return { dialect: defaultDialect };
}

// ../language/dist/semantic-tokens.js
var TOKEN_TYPES = [
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
var TOKEN_MODIFIERS = [
  "defaultLibrary",
  "modification",
  "readonly",
  "block",
  "blockName"
];
function idx(name) {
  const i = TOKEN_TYPES.indexOf(name);
  if (i === -1)
    throw new Error(`Unknown token type: ${name}`);
  return i;
}
function bit(name) {
  const i = TOKEN_MODIFIERS.indexOf(name);
  if (i === -1)
    throw new Error(`Unknown token modifier: ${name}`);
  return 1 << i;
}
var CAPTURE_MAP = {
  comment: { type: idx("comment"), modifiers: 0 },
  keyword: { type: idx("keyword"), modifiers: 0 },
  number: { type: idx("number"), modifiers: 0 },
  string: { type: idx("string"), modifiers: 0 },
  operator: { type: idx("operator"), modifiers: 0 },
  variable: { type: idx("variable"), modifiers: 0 },
  property: { type: idx("property"), modifiers: 0 },
  type: { type: idx("type"), modifiers: 0 },
  function: { type: idx("function"), modifiers: 0 },
  namespace: { type: idx("namespace"), modifiers: 0 },
  // Compound capture remappings
  "keyword.modifier": {
    type: idx("keyword"),
    modifiers: bit("modification")
  },
  "constant.builtin": {
    type: idx("keyword"),
    modifiers: 0
  },
  "string.escape": { type: idx("string"), modifiers: 0 },
  module: { type: idx("namespace"), modifiers: 0 },
  key: { type: idx("property"), modifiers: 0 },
  "keyword.block": { type: idx("keyword"), modifiers: bit("block") },
  "keyword.block.name": { type: idx("keyword"), modifiers: bit("blockName") },
  // Punctuation: use operator color so they always get an explicit token
  punctuation: { type: idx("operator"), modifiers: 0 },
  "punctuation.delimiter": { type: idx("operator"), modifiers: 0 },
  "punctuation.bracket": { type: idx("operator"), modifiers: 0 },
  // Special punctuation (|, ->) -> operator
  "punctuation.special": { type: idx("operator"), modifiers: 0 },
  // Template expression delimiters ({! }) -> keyword.modification
  "punctuation.template": {
    type: idx("keyword"),
    modifiers: bit("modification")
  },
  // @ prefix -> decorator
  decorator: { type: idx("decorator"), modifiers: 0 }
};
function mapCaptureToToken(captureName) {
  const name = captureName.replace(/^@/, "");
  if (name in CAPTURE_MAP) {
    return CAPTURE_MAP[name];
  }
  const baseType = name.split(".")[0];
  if (baseType in CAPTURE_MAP) {
    return CAPTURE_MAP[baseType];
  }
  return { type: idx("variable"), modifiers: 0 };
}
function dedupeOverlappingTokens(tokens) {
  if (tokens.length === 0)
    return [];
  const deduped = [];
  for (const current of tokens) {
    if (deduped.length === 0) {
      deduped.push(current);
      continue;
    }
    const prev = deduped[deduped.length - 1];
    const prevEnd = prev.startChar + prev.length;
    if (current.line === prev.line && current.startChar < prevEnd) {
      if (current.startChar === prev.startChar && current.length === prev.length) {
        deduped[deduped.length - 1] = current;
      }
      continue;
    }
    deduped.push(current);
  }
  return deduped;
}
function generateSemanticTokens(source, captures) {
  if (!source.trim())
    return [];
  const lines = source.split("\n");
  const tokens = [];
  for (const capture2 of captures) {
    const mapped = mapCaptureToToken(capture2.name);
    if (!mapped)
      continue;
    const { type, modifiers } = mapped;
    const startLine = capture2.startRow;
    const startChar = capture2.startCol;
    const endLine = capture2.endRow;
    const endChar = capture2.endCol;
    if (startLine === endLine) {
      const lineLength = lines[startLine]?.length ?? 0;
      const safeStart = Math.max(0, Math.min(startChar, lineLength));
      const safeEnd = Math.max(safeStart, Math.min(endChar, lineLength));
      if (safeEnd <= safeStart)
        continue;
      tokens.push({
        line: startLine,
        startChar: safeStart,
        length: safeEnd - safeStart,
        tokenType: type,
        tokenModifiers: modifiers
      });
    } else {
      for (let line = startLine; line <= endLine; line++) {
        const lineLength = lines[line]?.length ?? 0;
        const rawStart = line === startLine ? startChar : 0;
        const rawEnd = line === endLine ? endChar : lineLength;
        const safeStart = Math.max(0, Math.min(rawStart, lineLength));
        const safeEnd = Math.max(safeStart, Math.min(rawEnd, lineLength));
        if (safeEnd <= safeStart)
          continue;
        tokens.push({
          line,
          startChar: safeStart,
          length: safeEnd - safeStart,
          tokenType: type,
          tokenModifiers: modifiers
        });
      }
    }
  }
  tokens.sort((a, b) => {
    if (a.line !== b.line)
      return a.line - b.line;
    if (a.startChar !== b.startChar)
      return a.startChar - b.startChar;
    return b.length - a.length;
  });
  return dedupeOverlappingTokens(tokens);
}

// ../language/dist/service.js
var LanguageServiceImpl = class {
  constructor(config2) {
    __publicField(this, "schemaContext");
    __publicField(this, "dialectConfig");
    __publicField(this, "_ast", null);
    __publicField(this, "_diagnostics", []);
    __publicField(this, "_store", null);
    __publicField(this, "_symbols", null);
    __publicField(this, "dialect");
    __publicField(this, "source");
    this.dialectConfig = config2.dialect;
    this.source = config2.dialect.source ?? `${config2.dialect.name}-lint`;
    this.schemaContext = createSchemaContext(config2.dialect.schemaInfo);
    this.dialect = new Dialect();
  }
  update(cstNode) {
    const result = this.dialect.parse(cstNode, this.dialectConfig.schemaInfo.schema);
    this._ast = result.value;
    const engine = new LintEngine({
      passes: this.dialectConfig.createRules(),
      source: this.source
    });
    const engineResult = engine.run(this._ast, this.schemaContext);
    this._store = engineResult.store;
    this._diagnostics = engineResult.diagnostics;
    this._symbols = null;
  }
  get ast() {
    return this._ast;
  }
  get diagnostics() {
    return this._diagnostics;
  }
  get store() {
    return this._store;
  }
  getSymbols() {
    if (!this._ast)
      return [];
    if (this._symbols)
      return this._symbols;
    this._symbols = getDocumentSymbols(this._ast);
    return this._symbols;
  }
  getDefinition(line, char) {
    if (!this._ast)
      return null;
    const index = this._store?.get(positionIndexKey);
    return findDefinitionAtPosition(this._ast, line, char, this.schemaContext, this.getSymbols(), index);
  }
  getReferences(line, char, includeDeclaration = true) {
    if (!this._ast)
      return [];
    const index = this._store?.get(positionIndexKey);
    return findReferencesAtPosition(this._ast, line, char, includeDeclaration, this.schemaContext, this.getSymbols(), index);
  }
  getCompletions(line, char, namespace) {
    if (!this._ast)
      return [];
    const scope = this.getEnclosingScope(line, char);
    return getCompletionCandidates(this._ast, namespace, this.schemaContext, scope, this.getSymbols(), line, char);
  }
  getNamespaceCompletions(line, char) {
    const scope = this.getEnclosingScope(line, char);
    return getAvailableNamespaces(this.schemaContext, scope);
  }
  getFieldCompletions(line, char) {
    if (!this._ast)
      return [];
    return getFieldCompletions(this._ast, line, char, this.schemaContext);
  }
  getEnclosingScope(line, char) {
    if (!this._ast)
      return {};
    const index = this._store?.get(positionIndexKey);
    return findEnclosingScope(this._ast, line, char, index);
  }
};
function createLanguageService(config2) {
  return new LanguageServiceImpl(config2);
}

// ../language/dist/parse-and-lint.js
function parseAndLint(node, dialect, options) {
  const schemaCtx = createSchemaContext(dialect.schemaInfo);
  const source = dialect.source ?? `${dialect.name}-lint`;
  const parser = options?.dialectParser ?? new Dialect();
  const result = parser.parse(node, dialect.schemaInfo.schema);
  const ast = result.value;
  const engine = options?.engine ?? new LintEngine({
    passes: dialect.createRules(),
    source
  });
  const { diagnostics: lintDiagnostics, store } = engine.run(ast, schemaCtx);
  const seen = new Set(lintDiagnostics);
  const uniqueParseDiags = result.diagnostics.filter((d) => !seen.has(d));
  return {
    ast,
    diagnostics: [...uniqueParseDiags, ...lintDiagnostics],
    store
  };
}

// ../language/dist/core/indentation.js
var increaseIndentPattern = "^[^#]*(?::|->)\\s*(?:#.*)?$";
var decreaseIndentPattern = "^\\s*NEVERMATCH$";
var onEnterRules = [
  {
    // After a line ending with `:` (mapping key, if/elif/else, etc.)
    // e.g. "agent:", "  actions:", "if x > 5:", "else:"
    beforeText: "^[^#]*:\\s*(?:#.*)?$",
    action: "indent"
  },
  {
    // After a line ending with `->` (arrow/procedure syntax)
    // e.g. "instructions: ->"
    beforeText: "^[^#]*->\\s*(?:#.*)?$",
    action: "indent"
  }
];

// src/semantic-tokens.ts
function generateSemanticTokens2(source) {
  if (!source.trim()) return [];
  try {
    const captures = executeQuery2(source);
    return generateSemanticTokens(source, captures);
  } catch (error) {
    console.error("[SemanticTokens] Error generating tokens:", error);
    return [];
  }
}

// ../../dialect/agentscript/dist/schema.js
var MessagesBlock = Block("MessagesBlock", {
  welcome: StringValue.describe("Welcome message shown to the user."),
  error: StringValue.describe("Error message shown on failure.").required()
}).describe("Pre-defined message templates.").example(`messages:
    welcome: "Hello! How can I help you today?"
    error: "Sorry, something went wrong. Please try again."`);
var SystemBlock = Block("SystemBlock", {
  instructions: StringValue.describe("System-level instructions for the agent. Supports {!<expression>} interpolation with context variables."),
  messages: MessagesBlock.describe("Default messages for certain situations (e.g., welcome, error).")
}, { symbol: { kind: SymbolKind.Namespace } }).describe("System-level instructions and messages that interact with the user.").example(`system:
    instructions: |
        You are a helpful, professional assistant for customer support.
        Always be polite, concise, and reassuring.
    messages:
        welcome: "Hello! How can I help you today?"
        error: "Sorry, something went wrong. Please try again."`);
var ConfigBlock = Block("ConfigBlock", {
  description: StringValue.describe("Agent description. Defaults to label.")
}).describe("High-level agent configuration.").example(`config:
    agent_name: "My_Agent"
    description: "An AI assistant for customer support"`);
var LanguageBlock = Block("LanguageBlock", {
  default_locale: StringValue.describe('The primary locale for the agent (e.g., "en_US", "de", "fr").'),
  additional_locales: StringValue.describe("Comma-separated list of additional supported locales."),
  all_additional_locales: BooleanValue.describe("Whether to support all available locales.")
}).describe("Locale and language configuration.").example(`language:
    default_locale: "en_US"
    additional_locales: "fr, de"
    all_additional_locales: True`);
var DialectReasoningActionBlock = ReasoningActionBlock.extend({}, { colinear: ExpressionValue.resolvedType("invocationTarget") });
var DialectReasoningActionsBlock = CollectionBlock(DialectReasoningActionBlock).describe("Collection of reasoning action bindings.");
var ReasoningBlock = Block("ReasoningBlock", {
  instructions: ProcedureValue.describe("Procedural instructions for the reasoning loop. Supports templating and directives."),
  actions: DialectReasoningActionsBlock.describe("Actions available to the agent during the reasoning loop.")
}, { symbol: { kind: SymbolKind.Namespace } }).describe("Instructions and actions for the agent's reasoning loop.").example(`    reasoning:
        instructions: ->
            # Conditional logic can be embedded in instructions
            if @variables.checked_loyalty_tier == False:
                run @actions.Get_Loyalty_Tier
                    with member_email = @variables.member_email
                    set @variables.loyalty_tier = @outputs.loyalty_tier
                set @variables.checked_loyalty_tier = True
            if @variables.loyalty_tier != "Premium":
                | Basic members are not eligible for returns. Apologize and
                  explain alternatives like exchanges or store credit.
            else:
                | If the user wants a return, confirm which order and process
                  with {!@actions.create_return}.

            # Main instructions use {!@variables.x} and {!@actions.Name} for interpolation
            | Analyze the user's request. Use {!@actions.lookup_order} to retrieve
              order details. Current status: {! @variables.request_status }
        actions:
            # Bind an action \u2014 LLM can invoke during reasoning
            lookup_order: @actions.Lookup_Order
                with order_number=@variables.order_number
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id

            # LLM slot-filled input (... = LLM provides the value from conversation)
            search: @actions.Search_Products
                with query=...
                set @variables.results = @outputs.products

            # Conditional availability guard
            create_return: @actions.Create_Return
                available when @variables.return_eligible == True
                with order_id = @variables.order_id
                set @variables.rma_number = @outputs.rma_number

            # Chained run \u2014 execute a follow-up action after the first completes
            lookup_by_email: @actions.Lookup_Order_By_Email
                with email=@variables.member_email
                set @variables.order_number = @outputs.order_number
                run @actions.Lookup_Order
                    with order_number=@variables.order_number
                    set @variables.status = @outputs.status

            # Transition to another subagent
            go_to_returns: @utils.transition to @subagent.Return_Management
                description: "Route to returns when user wants to return items"
                available when @variables.verified is True

            # Set variables from conversation (LLM fills values)
            capture_info: @utils.setVariables
                description: "Capture customer information from conversation"
                with member_email=...
                with member_number=...

            # Escalate to a human agent
            escalate: @utils.escalate
                description: "Hand off to a live human agent"`);
var baseSubagentFields = {
  label: StringValue.describe("Display label shown in the UI.").accepts([
    "StringLiteral"
  ]),
  description: StringValue.describe("Block description. Influences transitions to this block.").required(),
  system: SystemBlock.pick(["instructions"]),
  actions: ActionsBlock.describe("Action definitions available to this block."),
  schema: StringValue.describe('URI identifying the subagent schema variant (e.g., "node://CustomSubagent"). When specified, enables custom field validation.').pattern(/^node:\/\/\S+$/).accepts(["StringLiteral"])
};
var defaultSubagentFields = {
  ...baseSubagentFields,
  before_reasoning: ProcedureValue.describe("Procedures that run before the reasoning loop starts, once per turn.").omitArrow().disallowTemplates("Templates are for LLM instructions and should only be used in reasoning.instructions."),
  after_reasoning: ProcedureValue.describe("Procedures that run after the reasoning loop completes, once per turn.").omitArrow().disallowTemplates("Templates are for LLM instructions and should only be used in reasoning.instructions."),
  reasoning: ReasoningBlock.describe("Reasoning block containing instructions and actions for the agent reasoning loop.")
};
var customSubagentFields = {
  ...baseSubagentFields,
  parameters: Block("ParametersBlock", {}).describe("Custom parameters for schema variants. Structure is defined by the schema variant."),
  on_init: ProcedureValue.describe("Procedures that run when the subagent is initialized.").omitArrow().disallowTemplates("Templates are for LLM instructions and should only be used in reasoning.instructions."),
  on_exit: ProcedureValue.describe("Procedures that run when the subagent is exited from.").omitArrow().disallowTemplates("Templates are for LLM instructions and should only be used in reasoning.instructions.")
};
var baseAgentOpts = {
  allowAnonymous: true,
  capabilities: ["invocationTarget", "transitionTarget"]
};
var SubagentBlock = NamedBlock("SubagentBlock", { ...defaultSubagentFields }, {
  scopeAlias: "subagent",
  ...baseAgentOpts
}).describe("A subagent defining agent logic with actions and reasoning.");
var StartAgentBlock = NamedBlock("StartAgentBlock", { ...defaultSubagentFields }, {
  scopeAlias: "subagent",
  ...baseAgentOpts
}).describe("The entry-point agent block.");
var ConnectedSubagentBlock = NamedBlock("ConnectedSubagentBlock", {
  target: StringValue.accepts(["StringLiteral"]).describe('URI identifying the connected agent (e.g., "agentforce://Agent_Name").').required().pattern(/^[a-zA-Z][a-zA-Z0-9_]*:\/\/\S+$/),
  label: StringValue.describe("Human-readable label for the connected agent."),
  description: StringValue.describe("Description of the connected agent's capabilities or when it should be called."),
  loading_text: StringValue.describe("Message to display while the connected agent is executing."),
  inputs: InputsBlock
}, { capabilities: ["invocationTarget", "transitionTarget"] });
var AgentScriptSchema = {
  system: SystemBlock,
  config: ConfigBlock,
  variables: VariablesBlock,
  language: LanguageBlock,
  connected_subagent: NamedCollectionBlock(ConnectedSubagentBlock),
  start_agent: NamedCollectionBlock(StartAgentBlock.clone().example(`# Exactly one start_agent is required as the entry point
start_agent topic_selector:
    label: "Topic Selector"
    description: "Welcome user and route to the right subagent"

    reasoning:
        instructions: ->
            | Welcome the user. Analyze their request and route accordingly:
              {!@actions.go_to_orders}: For order lookups and updates
              {!@actions.go_to_returns}: For return requests
              {!@actions.go_to_escalation}: When user is upset or asks for a person
        actions:
            go_to_orders: @utils.transition to @subagent.Order_Management
                description: "Handle order inquiries"
                available when @variables.verified == True
            go_to_returns: @utils.transition to @subagent.Return_Management
                description: "Handle return requests"
                available when @variables.verified == True
            go_to_escalation: @utils.transition to @subagent.escalation
                description: "Escalate to human agent"`)).singular(),
  subagent: NamedCollectionBlock(SubagentBlock.clone().example(`# Additional subagents handle specific conversation areas
subagent Order_Management:
    description: "Handles order lookups, updates, and summaries"

    # Optional subagent-level system instruction override
    system:
        instructions: "Focus on helping the user with their order. Never expose internal record IDs."

    # before_reasoning runs BEFORE the LLM reasoning loop on every turn
    before_reasoning:
        if @variables.verified is not True:
            transition to @subagent.Identity
        # Run an action and store results in variables
        run @actions.Check_Business_Hours
            set @variables.is_business_hours = @outputs.is_business_hours

    # Action definitions \u2014 external actions the agent can call
    actions:
        Lookup_Order:
            description: "Retrieve order details"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
                    is_user_input: True
            outputs:
                status: string
                    description: "Order status"
                items: string
                order_id: string
            target: "flow://Lookup_Order"

        Check_Business_Hours:
            description: "Check if it is currently business hours"
            inputs:
                query: string
            outputs:
                is_business_hours: boolean
                next_open_time: string
            target: "flow://Check_Business_Hours"

    reasoning:
        instructions: ->
            | Ask for the Order Number and call {!@actions.lookup_order}.
              Summarize: status, items, delivery info.
              Never show the Record ID: {!@variables.order_id}
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id

            go_to_return: @utils.transition to @subagent.Return_Management
                description: "If user wants to return items"

    # after_reasoning runs AFTER the LLM reasoning loop on every turn
    after_reasoning:
        if @variables.severe_weather_alert:
            transition to @subagent.severe_weather_alerts
        set @variables.request_count = @variables.request_count + 1`))
};
var AgentScriptSchemaAliases = {
  start_agent: "subagent"
};
var AgentScriptSchemaInfo = {
  schema: AgentScriptSchema,
  aliases: AgentScriptSchemaAliases,
  // TODO: globalScopes are just bags of member names with no type information.
  // Each member is an invokable with its own signature — e.g. transition takes a
  // transitionTarget argument, setVariables takes variable bindings, escalate takes
  // no arguments. These need to be promoted to typed declarations so they participate
  // in resolvedType validation instead of being silently skipped.
  globalScopes: {
    utils: /* @__PURE__ */ new Set(["transition", "setVariables", "escalate"]),
    system_variables: /* @__PURE__ */ new Set(["user_input"])
  }
};
var agentScriptSchemaContext = createSchemaContext(AgentScriptSchemaInfo);

// ../../dialect/agentscript/dist/lint/passes/type-map.js
function getTypeText(decl) {
  const type = decl.type;
  if (!type)
    return null;
  const cst = type.__cst;
  return cst?.node?.text?.trim() ?? null;
}
function extractBooleanField(node) {
  if (!node || typeof node !== "object")
    return void 0;
  const obj = node;
  if (obj.__kind !== "BooleanValue" || typeof obj.value !== "boolean")
    return void 0;
  const cst = obj.__cst;
  if (!cst)
    return void 0;
  const parent = cst.node.parent;
  let keyRange = cst.range;
  if (parent?.type === "mapping_element") {
    const keyNode = parent.childForFieldName("key");
    if (keyNode)
      keyRange = toRange(keyNode);
  }
  return { value: obj.value, keyRange, node: obj };
}
function extractStringField(node) {
  if (!node || typeof node !== "object")
    return void 0;
  const obj = node;
  if (obj.__kind !== "StringLiteral" || typeof obj.value !== "string")
    return void 0;
  const cst = obj.__cst;
  if (!cst)
    return void 0;
  const parent = cst.node.parent;
  let keyRange = cst.range;
  if (parent?.type === "mapping_element") {
    const keyNode = parent.childForFieldName("key");
    if (keyNode)
      keyRange = toRange(keyNode);
  }
  return { value: obj.value, keyRange, node: obj };
}
function extractParamMap(mapValue) {
  const result = /* @__PURE__ */ new Map();
  if (!mapValue || !isNamedMap(mapValue))
    return result;
  for (const [name, decl] of mapValue) {
    if (!decl || typeof decl !== "object")
      continue;
    const obj = decl;
    const typeText = getTypeText(obj);
    if (!typeText)
      continue;
    const info = {
      type: typeText,
      hasDefault: obj.defaultValue != null
    };
    const props = obj.properties;
    if (props) {
      const isRequired2 = extractBooleanField(props.is_required);
      if (isRequired2)
        info.isRequired = isRequired2.value;
    }
    result.set(name, info);
  }
  return result;
}
function extractOutputParamMap(mapValue) {
  const result = /* @__PURE__ */ new Map();
  if (!mapValue || !isNamedMap(mapValue))
    return result;
  for (const [name, decl] of mapValue) {
    if (!decl || typeof decl !== "object")
      continue;
    const obj = decl;
    const typeText = getTypeText(obj);
    if (!typeText)
      continue;
    const info = {
      type: typeText,
      hasDefault: obj.defaultValue != null
    };
    const props = obj.properties;
    if (props) {
      const isDisplayable = extractBooleanField(props.is_displayable);
      if (isDisplayable)
        info.isDisplayable = isDisplayable;
      const isUsedByPlanner = extractBooleanField(props.is_used_by_planner);
      if (isUsedByPlanner)
        info.isUsedByPlanner = isUsedByPlanner;
    }
    result.set(name, info);
  }
  return result;
}
var typeMapKey = storeKey("type-map");
var TypeMapAnalyzer = class {
  constructor() {
    __publicField(this, "id", typeMapKey);
    __publicField(this, "description", "Extracts structured type information for variables and action parameters");
    __publicField(this, "variables", /* @__PURE__ */ new Map());
  }
  init() {
    this.variables = /* @__PURE__ */ new Map();
  }
  visitVariables(varsMap) {
    for (const [name, decl] of varsMap) {
      if (!decl || typeof decl !== "object")
        continue;
      const obj = decl;
      const typeText = getTypeText(obj);
      if (!typeText)
        continue;
      const modifier = obj.modifier;
      this.variables.set(name, {
        type: typeText,
        modifier: modifier?.name
      });
    }
  }
  finalize(store, root) {
    const ctx = store.get(schemaContextKey);
    const actions = /* @__PURE__ */ new Map();
    const transitionTargets = /* @__PURE__ */ new Map();
    const rootObj = root;
    if (ctx) {
      const subagentKeys = /* @__PURE__ */ new Set([
        ...resolveNamespaceKeys("subagent", ctx),
        ...resolveNamespaceKeys("topic", ctx)
      ]);
      for (const topicKey of subagentKeys) {
        const topicMap = rootObj[topicKey];
        if (!topicMap || !isNamedMap(topicMap))
          continue;
        for (const [topicName, block] of topicMap) {
          if (!block || typeof block !== "object")
            continue;
          const topic = block;
          const actionsMap = topic.actions;
          if (actionsMap && isNamedMap(actionsMap)) {
            for (const [actName, actBlock] of actionsMap) {
              if (!actBlock || typeof actBlock !== "object")
                continue;
              const act = actBlock;
              const inputs = extractParamMap(act.inputs);
              const outputs = extractOutputParamMap(act.outputs);
              const requireUserConfirmation = extractBooleanField(act.require_user_confirmation);
              const sourceNode = act.source;
              const source = sourceNode && typeof sourceNode.value === "string" ? sourceNode.value : void 0;
              const target = extractStringField(act.target);
              if (!actions.has(topicName)) {
                actions.set(topicName, /* @__PURE__ */ new Map());
              }
              actions.get(topicName).set(actName, {
                inputs,
                outputs,
                requireUserConfirmation,
                source,
                target
              });
            }
          }
          collectTransitionTargets(topic.before_reasoning, transitionTargets);
          collectTransitionTargets(topic.after_reasoning, transitionTargets);
          const reasoning = topic.reasoning;
          const reasoningTools = reasoning?.actions;
          if (reasoningTools && isNamedMap(reasoningTools)) {
            for (const [, raBlock] of reasoningTools) {
              if (!raBlock || typeof raBlock !== "object")
                continue;
              collectTransitionTargets(raBlock, transitionTargets);
            }
          }
        }
      }
    }
    const connectedAgents = /* @__PURE__ */ new Map();
    const caMap = rootObj.connected_subagent;
    if (caMap && isNamedMap(caMap)) {
      for (const [agentName, block] of caMap) {
        if (!block || typeof block !== "object")
          continue;
        const node = block;
        const inputsMap = node.inputs;
        const inputs = /* @__PURE__ */ new Map();
        if (inputsMap && isNamedMap(inputsMap)) {
          for (const [inputName, paramDef] of inputsMap) {
            if (!paramDef || typeof paramDef !== "object")
              continue;
            const decl = paramDef;
            const typeText = getTypeText(decl);
            if (!typeText)
              continue;
            const defaultValue = decl.defaultValue;
            const defaultValueCst = defaultValue?.__cst;
            inputs.set(inputName, {
              type: typeText,
              hasDefault: defaultValue != null,
              decl,
              defaultValueNode: defaultValue,
              defaultValueCst: defaultValueCst ?? void 0
            });
          }
        }
        const targetNode = node.target;
        const target = targetNode && typeof targetNode.value === "string" ? targetNode.value : void 0;
        connectedAgents.set(agentName, { inputs, target, targetNode });
      }
    }
    store.set(typeMapKey, {
      variables: this.variables,
      actions,
      connectedAgents,
      transitionTargets
    });
  }
};
function collectTransitionTargets(block, targets) {
  if (!block || typeof block !== "object")
    return;
  const obj = block;
  const stmts = obj.statements;
  if (!stmts)
    return;
  for (const stmt of stmts) {
    collectTransitionTargetsFromStatement(stmt, obj, targets);
  }
}
function collectTransitionTargetsFromStatement(stmt, diagnosticParent, targets) {
  if (stmt.__kind === "ToClause") {
    collectToTarget(stmt, diagnosticParent, targets);
  } else if (stmt.__kind === "TransitionStatement") {
    const clauses = stmt.clauses;
    if (clauses) {
      for (const clause of clauses) {
        if (clause.__kind === "ToClause") {
          collectToTarget(clause, diagnosticParent, targets);
        }
      }
    }
  } else if (stmt.__kind === "IfStatement") {
    const body = stmt.body;
    if (body) {
      for (const s of body)
        collectTransitionTargetsFromStatement(s, diagnosticParent, targets);
    }
    const orelse = stmt.orelse;
    if (orelse) {
      for (const s of orelse)
        collectTransitionTargetsFromStatement(s, diagnosticParent, targets);
    }
  }
}
function collectToTarget(toClause, diagnosticParent, targets) {
  const target = toClause.target;
  if (!target || typeof target !== "object")
    return;
  const ref = decomposeAtMemberExpression(target);
  if (!ref)
    return;
  const targetCst = target.__cst;
  const range = targetCst?.range ?? toClause.__cst?.range;
  if (!range)
    return;
  const entry = {
    namespace: ref.namespace,
    property: ref.property,
    range,
    diagnosticParent
  };
  const list = targets.get(ref.namespace);
  if (list) {
    list.push(entry);
  } else {
    targets.set(ref.namespace, [entry]);
  }
}
function typeMapAnalyzer() {
  return new TypeMapAnalyzer();
}

// ../../dialect/agentscript/dist/lint/passes/reasoning-actions.js
var reasoningActionsKey = storeKey("reasoning-actions");
var ReasoningActionsAnalyzer = class {
  constructor() {
    __publicField(this, "id", reasoningActionsKey);
    __publicField(this, "description", "Pre-resolves reasoning action references and their action signatures");
    __publicField(this, "finalizeAfter", [typeMapKey]);
  }
  finalize(store, root) {
    const typeMap = store.get(typeMapKey);
    if (!typeMap)
      return;
    const ctx = store.get(schemaContextKey);
    if (!ctx)
      return;
    const raw = [];
    const rootObj = root;
    const subagentKeys = /* @__PURE__ */ new Set([
      ...resolveNamespaceKeys("subagent", ctx),
      ...resolveNamespaceKeys("topic", ctx)
    ]);
    for (const topicKey of subagentKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap))
        continue;
      for (const [topicName, block] of topicMap) {
        if (!block || typeof block !== "object")
          continue;
        const topic = block;
        const reasoning = topic.reasoning;
        if (!reasoning || typeof reasoning !== "object")
          continue;
        const reasoningObj = reasoning;
        const raActions = reasoningObj.actions;
        if (!raActions || !isNamedMap(raActions))
          continue;
        for (const [, raBlock] of raActions) {
          if (!raBlock || typeof raBlock !== "object")
            continue;
          const ra = raBlock;
          if (ra.__kind !== "ReasoningActionBlock")
            continue;
          if (!ra.value) {
            const raCst = ra.__cst;
            if (raCst) {
              attachDiagnostic(ra, lintDiagnostic(raCst.range, `Reasoning action is missing a target reference (e.g., @actions.Name, @utils.transition, @utils.setVariables)`, DiagnosticSeverity.Error, "missing-action-reference"));
            }
            continue;
          }
          const statements = ra.statements;
          const valueCst = ra.value?.__cst;
          const actionRefRange = valueCst?.range ?? ra.__cst?.range;
          const refActionName = resolveColinearAction(ra);
          if (refActionName) {
            raw.push({
              topicName,
              refActionName,
              namespace: "actions",
              ra,
              statements,
              actionRefRange
            });
            continue;
          }
          const decomposed = decomposeAtMemberExpression(ra.value);
          if (decomposed && decomposed.namespace === "connected_subagent") {
            raw.push({
              topicName,
              refActionName: decomposed.property,
              namespace: "connected_subagent",
              ra,
              statements,
              actionRefRange
            });
          }
        }
      }
    }
    const entries = [];
    for (const r of raw) {
      let sig;
      if (r.namespace === "actions") {
        sig = typeMap.actions.get(r.topicName)?.get(r.refActionName);
      } else if (r.namespace === "connected_subagent") {
        const agentInfo = typeMap.connectedAgents.get(r.refActionName);
        if (agentInfo) {
          sig = connectedAgentSignature(agentInfo);
        }
      }
      if (!sig)
        continue;
      entries.push({
        topicName: r.topicName,
        refActionName: r.refActionName,
        sig,
        ra: r.ra,
        statements: r.statements,
        actionRefRange: r.actionRefRange
      });
    }
    store.set(reasoningActionsKey, entries);
  }
};
function reasoningActionsAnalyzer() {
  return new ReasoningActionsAnalyzer();
}
function connectedAgentSignature(info) {
  const inputs = /* @__PURE__ */ new Map();
  for (const [name, inputInfo] of info.inputs) {
    inputs.set(name, {
      type: inputInfo.type,
      hasDefault: inputInfo.hasDefault
    });
  }
  return { inputs, outputs: /* @__PURE__ */ new Map() };
}

// ../../dialect/agentscript/dist/lint/passes/action-io.js
function actionIoRule() {
  return defineRule({
    id: "action-io",
    description: "Validates with/set clauses match action input/output definitions",
    deps: { entry: each(reasoningActionsKey) },
    run({ entry }) {
      const { refActionName, sig, statements, actionRefRange, ra } = entry;
      const inputNames = [...sig.inputs.keys()];
      const outputNames = [...sig.outputs.keys()];
      const providedInputs = /* @__PURE__ */ new Set();
      if (!statements) {
        for (const [inputName, info] of sig.inputs) {
          if (!info.hasDefault && info.isRequired !== false && actionRefRange) {
            attachDiagnostic(ra, lintDiagnostic(actionRefRange, `Missing required input '${inputName}' for action '${refActionName}'`, DiagnosticSeverity.Error, "action-missing-input"));
          }
        }
        return;
      }
      for (const stmt of statements) {
        if (stmt.__kind === "WithClause") {
          const param = stmt.param;
          if (!param)
            continue;
          providedInputs.add(param);
          if (!sig.inputs.has(param)) {
            const cst = stmt.__cst;
            if (cst) {
              const paramCstNode = stmt.__paramCstNode;
              const range = paramCstNode ? toRange(paramCstNode) : cst.range;
              const suggestion = findSuggestion(param, inputNames);
              const msg = `'${param}' is not a defined input of action '${refActionName}'`;
              attachDiagnostic(stmt, lintDiagnostic(range, msg, DiagnosticSeverity.Error, "action-unknown-input", { suggestion }));
            }
          }
        }
        if (stmt.__kind === "SetClause") {
          const outputRef = extractOutputRef(stmt.value);
          if (outputRef && !sig.outputs.has(outputRef.name)) {
            const cst = outputRef.cst;
            if (cst) {
              const suggestion = findSuggestion(outputRef.name, outputNames);
              const msg = `'${outputRef.name}' is not a defined output of action '${refActionName}'`;
              attachDiagnostic(stmt, lintDiagnostic(cst.range, msg, DiagnosticSeverity.Error, "action-unknown-output", { suggestion }));
            }
          }
        }
      }
      for (const [inputName, info] of sig.inputs) {
        if (!info.hasDefault && info.isRequired !== false && !providedInputs.has(inputName) && actionRefRange) {
          attachDiagnostic(ra, lintDiagnostic(actionRefRange, `Missing required input '${inputName}' for action '${refActionName}'`, DiagnosticSeverity.Error, "action-missing-input"));
        }
      }
    }
  });
}

// ../../dialect/agentscript/dist/lint/passes/action-type-check.js
function inferExpressionType(expr, typeMap) {
  if (!expr || typeof expr !== "object")
    return null;
  const obj = expr;
  const varName = extractVariableRef(expr);
  if (varName) {
    return typeMap.variables.get(varName)?.type ?? null;
  }
  switch (obj.__kind) {
    case "StringLiteral":
    case "TemplateExpression":
      return "string";
    case "NumberLiteral":
      return "number";
    case "BooleanLiteral":
      return "boolean";
    default:
      return null;
  }
}
function typesCompatible(expected, actual) {
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();
  if (e === a)
    return true;
  if (e === "object" || a === "object")
    return true;
  return false;
}
function actionTypeCheckRule() {
  return defineRule({
    id: "action-type-check",
    description: "Validates type compatibility in with/set clauses against action parameter types",
    deps: {
      typeMap: typeMapKey,
      entry: each(reasoningActionsKey)
    },
    run({ typeMap, entry }) {
      const { sig, statements } = entry;
      if (!statements)
        return;
      for (const stmt of statements) {
        if (stmt.__kind === "WithClause") {
          const param = stmt.param;
          if (!param)
            continue;
          const inputInfo = sig.inputs.get(param);
          if (!inputInfo)
            continue;
          const actualType = inferExpressionType(stmt.value, typeMap);
          if (actualType && !typesCompatible(inputInfo.type, actualType)) {
            const cst = stmt.__cst;
            if (cst) {
              const diag = typeMismatchDiagnostic(cst.range, `Type mismatch: input '${param}' expects '${inputInfo.type}' but got '${actualType}'`, inputInfo.type, actualType, LINT_SOURCE);
              diag.severity = DiagnosticSeverity.Warning;
              attachDiagnostic(stmt, diag);
            }
          }
        }
        if (stmt.__kind === "SetClause") {
          const outputRef = extractOutputRef(stmt.value);
          if (!outputRef)
            continue;
          const outputInfo = sig.outputs.get(outputRef.name);
          if (!outputInfo)
            continue;
          const targetVarName = extractVariableRef(stmt.target);
          if (!targetVarName)
            continue;
          const targetType = typeMap.variables.get(targetVarName)?.type;
          if (targetType && !typesCompatible(targetType, outputInfo.type)) {
            const cst = stmt.__cst;
            if (cst) {
              const diag = typeMismatchDiagnostic(cst.range, `Type mismatch: output '${outputRef.name}' is '${outputInfo.type}' but target '@variables.${targetVarName}' expects '${targetType}'`, targetType, outputInfo.type, LINT_SOURCE);
              diag.severity = DiagnosticSeverity.Warning;
              attachDiagnostic(stmt, diag);
            }
          }
        }
      }
    }
  });
}

// ../../dialect/agentscript/dist/lint/passes/index.js
function defaultRules() {
  return [
    // Base passes
    symbolTableAnalyzer(),
    duplicateKeyPass(),
    requiredFieldPass(),
    singularCollectionPass(),
    constraintValidationPass(),
    positionIndexPass(),
    unreachableCodePass(),
    emptyBlockPass(),
    unusedVariablePass(),
    expressionValidationPass(),
    spreadContextPass(),
    // AgentScript analyzers
    typeMapAnalyzer(),
    reasoningActionsAnalyzer(),
    // Validation
    undefinedReferencePass(),
    actionIoRule(),
    actionTypeCheckRule()
  ];
}

// ../../dialect/agentforce/dist/schema.js
var AFVariablesBlock = VariablesBlock.extendProperties({
  source: ReferenceValue.describe("Where the variable gets its value. Required for linked variables, not allowed for mutable variables (e.g., @MessagingSession.Id).").allowedNamespaces(["MessagingSession", "MessagingEndUser"]),
  visibility: StringValue.describe("Visibility level for the variable.").enum([
    "Internal",
    "External",
    "internal",
    "external"
  ]),
  is_displayable: BooleanValue.describe("Whether this variable is visible in the UI."),
  is_used_by_planner: BooleanValue.describe("Whether the planner can read this variable.")
}).withKeyPattern("^(?!.*__)[a-zA-Z][a-zA-Z0-9_]*$");
var AFInputsBlock = InputsBlock.extendProperties({
  complex_data_type_name: StringValue.describe('Complex data type name (e.g., "@apexClassType/c__RequestMetadata"). For object type, defaults to "lightning__objectType".'),
  schema: StringValue.describe('Schema URI for input validation (e.g., "schema://city_schema").'),
  is_user_input: BooleanValue.describe("Whether this input comes from the user."),
  filter_from_agent: BooleanValue.describe("Whether to filter this input from the agent context."),
  is_displayable: BooleanValue.describe("Whether this input can be shown to users."),
  is_used_by_planner: BooleanValue.describe("Whether the planner can use this input.")
});
var AFOutputsBlock = OutputsBlock.extendProperties({
  developer_name: StringValue.describe("Developer name identifier for the output field."),
  is_displayable: BooleanValue.describe("Whether this output can be shown to users."),
  is_used_by_planner: BooleanValue.describe("Whether the planner can read this output."),
  complex_data_type_name: StringValue.describe('Complex data type name. For object type, defaults to "lightning__objectType".'),
  filter_from_agent: BooleanValue.describe("Whether to filter this output from the agent context.")
});
var ModelConfigParamsBlock = Block("ModelConfigParamsBlock", {}).describe("Model parameters as key-value pairs. Accepts arbitrary parameters that vary by model (e.g., temperature, max_tokens, top_p). Values can be strings, numbers, booleans, or arrays. Parameters are dynamically extracted at compile time.");
var ModelConfigBlock = Block("ModelConfigBlock", {
  model: StringValue.describe('Model identifier URI (e.g., "model://...")'),
  params: ModelConfigParamsBlock.describe("Additional model parameters (e.g., temperature: 0.7, max_tokens: 2000)")
}).describe("Model selection and parameter configuration.");
var ContextMemoryBlock = Block("ContextMemoryBlock", {
  enabled: BooleanValue.describe("Whether memory is enabled for the agent.")
}).describe("Memory configuration for the agent.");
var ContextBlock = Block("ContextBlock", {
  memory: ContextMemoryBlock.describe("Memory configuration.")
}).describe("Context configuration for the agent.");
var AFConfigBlock = ConfigBlock.extend({
  developer_name: StringValue.describe("Agent identifier. Must follow standard name field requirements. Set this or agent_name (not both)."),
  agent_label: StringValue.describe("Display label for the agent. Defaults to normalized developer_name.").accepts(["StringLiteral"]),
  agent_description: StringValue.describe("Agent description used in prompts and routing. Distinct from description (internal documentation)."),
  agent_type: StringValue.describe('Agent type (e.g., "AgentforceServiceAgent", "AgentforceEmployeeAgent", "SalesEinsteinCoach").').enum([
    "AgentforceServiceAgent",
    "AgentforceEmployeeAgent",
    "SalesEinsteinCoach"
  ]),
  agent_id: StringValue.describe("Unique identifier for the agent."),
  agent_name: StringValue.describe("Internal name for the agent."),
  default_agent_user: StringValue.describe("Default user identity. Required for AgentforceServiceAgent type."),
  agent_version: StringValue.describe('Version identifier for the agent (e.g., "v1").'),
  enable_enhanced_event_logs: BooleanValue.describe("Whether to record enhanced event logs for debugging and analytics."),
  company: StringValue.describe("Company information. Can be embedded in subagent prompts for context."),
  role: StringValue.describe("Job description or role for the agent."),
  planner_type: StringValue.describe('Planner type (e.g., "AiCopilot__ReAct", "Atlas__ConcurrentMultiAgentOrchestration").'),
  additional_parameter__reset_to_initial_node: BooleanValue.describe("Whether to reset to the initial node between turns.").hidden(),
  additional_parameter__DISABLE_GROUNDEDNESS: BooleanValue.describe("Whether to disable groundedness checking.").hidden(),
  debug: BooleanValue.describe("Whether to enable debug mode."),
  max_tokens: NumberValue.describe("Maximum number of tokens for responses."),
  temperature: NumberValue.describe("Sampling temperature for model responses."),
  agent_template: StringValue.describe("Template name identifier for the agent."),
  outbound_flow: StringValue.describe("API name of the default outbound flow for escalation routing."),
  user_locale: StringValue.describe('User locale override (e.g., "en_US").').deprecated("Use the language block instead.")
}, {
  wildcardPrefixes: [
    { prefix: "additional_parameter__", fieldType: ExpressionValue }
  ]
}).example(`config:
    developer_name: "customer_support_agent"
    agent_label: "Customer Support Agent"
    description: "Assists customers with orders, returns, and account management"
    default_agent_user: "support@example.com"
    agent_type: "AgentforceServiceAgent"
    enable_enhanced_event_logs: True
    additional_parameter__reset_to_initial_node: True`);
var AFActionBlock = ActionBlock.extend({
  source: StringValue.describe('Source URI for the action (e.g., "custom://weather_api").'),
  require_user_confirmation: BooleanValue.describe("Whether to require user confirmation before executing."),
  include_in_progress_indicator: BooleanValue.describe("Whether to show a progress indicator during execution."),
  progress_indicator_message: StringValue.describe("Message shown during execution. Only used if include_in_progress_indicator is True."),
  inputs: AFInputsBlock,
  outputs: AFOutputsBlock
}).example(`    actions:
        Lookup_Order:
            description: "Retrieve order details by order number"
            label: "Lookup Order"
            require_user_confirmation: False
            include_in_progress_indicator: True
            progress_indicator_message: "Looking up your order..."
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
                    is_user_input: True
                email: string
                    description: "Customer email for verification"
                    is_required: False
                    is_user_input: False
            outputs:
                status: string
                    description: "Order status"
                    is_displayable: True
                order_id: string
                    description: "Internal order record ID"
                    is_displayable: False
                    filter_from_agent: True
                items: list[object]
                    description: "Items in the order"
                    is_displayable: True
            target: "flow://Lookup_Order_By_Number"

        # Target URI formats:
        #   flow://Flow_API_Name                        \u2014 Salesforce Flow
        #   apex://Apex_Class_Name                      \u2014 Apex invocable action
        #   externalService://endpoint_name             \u2014 External service
        #   standardInvocableAction://Action_Name       \u2014 Standard Salesforce invocable action`);
var AFActionsBlock = CollectionBlock(AFActionBlock);
var SecurityBlock = Block("SecurityBlock", {
  sharing_policy: Block("SharingPolicyBlock", {
    use_default_sharing_entities: BooleanValue.describe("Sharing policy for the agent."),
    custom_sharing_entities: ExpressionSequence().describe("Custom sharing entities for the agent.")
  }).describe("Sharing policy for the agent."),
  verified_customer_record_access: Block("VerifiedCustomerRecordAccessBlock", {
    use_default_objects: BooleanValue.describe("Whether to use default objects for record access filtering."),
    additional_objects: ExpressionSequence().describe("Additional objects for record access filtering.")
  }).describe("Verified customer record access configuration.")
}).describe("Agent security configuration");
var sharedBlockFields = {
  ...defaultSubagentFields,
  // Agentforce-specific fields
  model_config: ModelConfigBlock.describe("Model configuration for this block."),
  security: SecurityBlock
};
var sharedBlockOpts = {
  allowAnonymous: true,
  capabilities: ["invocationTarget", "transitionTarget"]
};
var AFTopicBlock = NamedBlock("TopicBlock", {
  ...sharedBlockFields,
  actions: AFActionsBlock
}, { scopeAlias: "topic", ...sharedBlockOpts }).describe("A topic defining agent logic with actions and reasoning.").discriminant("schema");
var AFSubagentBlock = NamedBlock("SubagentBlock", {
  ...sharedBlockFields,
  actions: AFActionsBlock
}, { scopeAlias: "subagent", ...sharedBlockOpts }).describe("A subagent defining agent logic with actions and reasoning.").discriminant("schema");
var AFStartAgentBlock = StartAgentBlock.extend({
  actions: AFActionsBlock,
  reasoning: ReasoningBlock,
  model_config: ModelConfigBlock.describe("Configuration for the model used by this block."),
  security: SecurityBlock
}, { scopeAlias: "topic" }).discriminant("schema");
var KnowledgeBlock = Block("KnowledgeBlock", {
  citations_url: StringValue.describe("URL prefix for citation links."),
  rag_feature_config_id: StringValue.describe("RAG feature configuration identifier. Typically a UUID-based identifier."),
  citations_enabled: BooleanValue.describe("Whether to include citations in responses.")
}).describe("Knowledge and citation configuration for RAG-based question answering.").example(`knowledge:
    citations_url: "https://help.example.com"
    rag_feature_config_id: "my_knowledge_base"
    citations_enabled: True`);
var ResponseActionsEntryBlock = NamedBlock("ResponseActionsBlock", {
  description: StringValue.describe("Description of the tool provided to the LLM. Overrides the action description."),
  label: StringValue.describe("Human-readable label for the tool. Not provided to the LLM.")
}, {
  colinear: ExpressionValue,
  body: ProcedureValue,
  symbol: { kind: SymbolKind.Method },
  scopeAlias: "action"
}).describe("Reasoning loop for connections.");
var ConnectionBlock = NamedBlock("ConnectionBlock", {
  adaptive_response_allowed: BooleanValue.describe("Whether adaptive responses are allowed for this connection."),
  escalation_message: StringValue.describe("Message to show for Escalation."),
  instructions: StringValue.describe("Instructions for the connection."),
  outbound_route_type: StringValue.describe("Type of outbound route. Currently gets defaulted to OmniChannelFlow"),
  outbound_route_name: StringValue.describe('Name of outbound route. Example: "flow://Route_to_ELL_Agent"'),
  response_actions: CollectionBlock(ResponseActionsEntryBlock)
}, { symbol: { kind: SymbolKind.Interface } }).describe("External connection configuration.").example(`connection messaging:
    adaptive_response_allowed: True`);
var ConnectionsBlock = NamedCollectionBlock(ConnectionBlock);
var PronunciationDictEntryBlock = Block("PronunciationDictEntryBlock", {
  grapheme: StringValue.required(),
  phoneme: StringValue.required(),
  type: StringValue.enum(["IPA", "CMU"])
});
var InboundKeywordsBlock = Block("InboundKeywordsBlock", {
  keywords: ExpressionSequence().describe("List of keywords for inbound speech detection.")
}).describe("Keyword detection configuration for inbound speech.");
var SpeakUpConfigBlock = Block("SpeakUpConfigBlock", {
  speak_up_first_wait_time_ms: NumberValue.describe("Time in milliseconds before first speak-up prompt.").min(1e4).max(3e5),
  speak_up_follow_up_wait_time_ms: NumberValue.describe("Time in milliseconds before follow-up speak-up prompts.").min(1e4).max(3e5),
  speak_up_message: StringValue.describe("Message to speak when prompting the user to speak up.")
}).describe("Configuration for speak-up behavior.");
var EndpointingConfigBlock = Block("EndpointingConfigBlock", {
  max_wait_time_ms: NumberValue.describe("Maximum wait time in milliseconds for endpointing detection.").min(500).max(6e4)
}).describe("Configuration for endpointing detection.");
var BeepBoopConfigBlock = Block("BeepBoopConfigBlock", {
  max_wait_time_ms: NumberValue.describe("Maximum wait time in milliseconds for beep-boop detection.").min(500).max(6e4)
}).describe("Configuration for beep-boop detection.");
var AdditionalConfigsBlock = Block("AdditionalConfigsBlock", {
  speak_up_config: SpeakUpConfigBlock.describe("Configuration for speak-up prompts."),
  endpointing_config: EndpointingConfigBlock.describe("Configuration for endpointing detection."),
  beepboop_config: BeepBoopConfigBlock.describe("Configuration for beep-boop detection.")
}).describe("Additional voice-related configurations.");
var FillerSentenceBlock = Block("FillerSentenceBlock", {
  waiting: ExpressionSequence().describe("List of waiting messages for this filler sentence entry.")
}).describe("A filler sentence configuration entry.");
var VoiceModalitySchema = {
  inbound_filler_words_detection: BooleanValue.describe("Whether to enable detection of filler words in inbound speech."),
  inbound_keywords: InboundKeywordsBlock.describe("Keyword detection configuration for inbound speech with boost values."),
  voice_id: StringValue.describe('Unique identifier for the voice (e.g., "EQx6HGDYjkDpcli6vorJ").'),
  outbound_speed: NumberValue.describe("Speech speed for outbound voice (e.g., 1.0 for normal speed).").min(0.5).max(2),
  outbound_style_exaggeration: NumberValue.describe("Style exaggeration level for outbound voice (0.0 to 1.0).").min(0).max(1),
  outbound_stability: NumberValue.describe("Voice stability for outbound speech."),
  outbound_similarity: NumberValue.describe("Voice similarity level for outbound speech."),
  pronunciation_dict: Sequence(PronunciationDictEntryBlock).describe("List of pronunciation dictionary entries for custom word pronunciations."),
  outbound_filler_sentences: Sequence(FillerSentenceBlock).describe("List of filler sentence entries to use during outbound speech pauses."),
  additional_configs: AdditionalConfigsBlock.describe("Additional voice-related configurations.")
};
var ModalityBlock = NamedBlock("ModalityBlock").variant("voice", VoiceModalitySchema);
var ModalitiesBlock = NamedCollectionBlock(ModalityBlock);
var AgentforceSchema = {
  ...AgentScriptSchema,
  config: AFConfigBlock,
  variables: AFVariablesBlock,
  model_config: ModelConfigBlock.describe("Default model configuration for the agent. Can be overridden at topic level.").example(`model_config:
    model: "model://sfdc_ai__DefaultGPT4"
    params:
        temperature: 0.7
        max_tokens: 2000`),
  knowledge: KnowledgeBlock,
  connection: ConnectionsBlock,
  connected_subagent: NamedCollectionBlock(ConnectedSubagentBlock),
  modality: ModalitiesBlock,
  security: SecurityBlock,
  context: ContextBlock,
  subagent: NamedCollectionBlock(AFSubagentBlock.clone().example(`subagent Order_Management:
    description: "Handles order lookups, updates, and summaries"

    system:
        instructions: "Focus on helping the user with their order. Never expose internal record IDs."

    before_reasoning:
        if @variables.verified is not True:
            transition to @subagent.Identity

    actions:
        Lookup_Order:
            description: "Retrieve order details"
            require_user_confirmation: False
            include_in_progress_indicator: True
            progress_indicator_message: "Looking up your order..."
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
                    is_user_input: True
            outputs:
                status: string
                    description: "Order status"
                    is_displayable: True
                order_id: string
                    description: "Internal order record ID"
                    is_displayable: False
                    filter_from_agent: True
            target: "flow://Lookup_Order"

    reasoning:
        instructions: ->
            | Ask for the Order Number and call {!@actions.lookup_order}.
              Summarize: status, items, delivery info.
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id

            go_to_return: @utils.transition to @subagent.Return_Management
                description: "If user wants to return items"

    after_reasoning:
        set @variables.request_count = @variables.request_count + 1`)),
  start_agent: NamedCollectionBlock(AFStartAgentBlock.clone().example(`start_agent topic_selector:
    label: "Topic Selector"
    description: "Welcome user and route to the right topic"
    reasoning:
        instructions: ->
            | Welcome the user. Analyze their request and route accordingly:
              {!@actions.go_to_orders}: For order lookups and updates
              {!@actions.go_to_returns}: For return requests
              {!@actions.go_to_escalation}: When user is upset or asks for a person
        actions:
            go_to_orders: @utils.transition to @subagent.Order_Management
                description: "Handle order inquiries"
                available when @variables.verified == True
            go_to_returns: @utils.transition to @subagent.Return_Management
                description: "Handle return requests"
                available when @variables.verified == True
            go_to_escalation: @utils.transition to @subagent.escalation
                description: "Escalate to human agent"`)).singular(),
  topic: NamedCollectionBlock(AFTopicBlock.clone().example(`topic Order_Management:
    description: "Handles order lookups, updates, and summaries"

    actions:
        Lookup_Order:
            description: "Retrieve order details"
            target: "flow://Lookup_Order"

    reasoning:
        instructions: ->
            | Help the user with their order.
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...`))
  // TODO: restore deprecated() call once migration is complete
  // .deprecated(
  //   'Replace topic with subagent, actions with tool_definitions and reasoning.actions with reasoning.tools.',
  //   { replacement: 'subagent' }
  // ),
};
var AgentforceKindToSchemaKey = buildKindToSchemaKey(AgentforceSchema);
var AgentforceSchemaAliases = {
  ...AgentScriptSchemaAliases
};
var AgentforceSchemaInfo = {
  schema: AgentforceSchema,
  aliases: AgentforceSchemaAliases,
  globalScopes: {
    ...AgentScriptSchemaInfo.globalScopes,
    MessagingSession: /* @__PURE__ */ new Set(["MessagingEndUserId", "Id", "EndUserLanguage"]),
    MessagingEndUser: /* @__PURE__ */ new Set(["ContactId"])
  },
  // start_agent blocks are reachable via both @topic.X and @subagent.X
  extraNamespaceKeys: {
    topic: ["start_agent"]
  }
};
var agentforceSchemaContext = createSchemaContext(AgentforceSchemaInfo);

// ../../dialect/agentforce/dist/lint/passes/action-target.js
var VALID_SCHEMES = [
  "api",
  "apex",
  "apexRest",
  "auraEnabled",
  "cdpMlPrediction",
  "createCatalogItemRequest",
  "executeIntegrationProcedure",
  "expressionSet",
  "externalConnector",
  "externalService",
  "flow",
  "generatePromptResponse",
  "integrationProcedureAction",
  "mcpTool",
  "namedQuery",
  "prompt",
  "quickAction",
  "retriever",
  "runExpressionSet",
  "serviceCatalog",
  "slack",
  "standardInvocableAction"
];
var VALID_SCHEME_SET = new Set(VALID_SCHEMES.map((scheme) => scheme.toLowerCase()));
function flattenActionsWithTarget(tm) {
  const result = [];
  for (const [, actionMap] of tm.actions) {
    for (const [actionName, sig] of actionMap) {
      if (sig.target)
        result.push({ actionName, sig });
    }
  }
  return result;
}
function actionTargetSchemeRule() {
  return defineRule({
    id: "invalid-action-target",
    description: "Action target URIs must use a supported scheme (flow://, apex://, externalService://, standardInvocableAction://, prompt://, generatePromptResponse://, etc.).",
    deps: { action: each(typeMapKey, flattenActionsWithTarget) },
    run({ action: action2 }) {
      const { actionName, sig } = action2;
      const target = sig.target;
      let parsed;
      try {
        parsed = new URL(target.value);
      } catch {
        attachDiagnostic(target.node, lintDiagnostic(target.keyRange, `Action '${actionName}' has an invalid target "${target.value}". Expected a URI with a supported scheme: ${VALID_SCHEMES.join(", ")}.`, DiagnosticSeverity.Error, "invalid-action-target"));
        return;
      }
      const scheme = parsed.protocol.slice(0, -1).toLowerCase();
      if (!scheme) {
        attachDiagnostic(target.node, lintDiagnostic(target.keyRange, `Action '${actionName}' has an invalid target "${target.value}". Expected a URI with a supported scheme: ${VALID_SCHEMES.join(", ")}.`, DiagnosticSeverity.Error, "invalid-action-target"));
        return;
      }
      if (!VALID_SCHEME_SET.has(scheme)) {
        attachDiagnostic(target.node, lintDiagnostic(target.keyRange, `Action '${actionName}' uses unsupported target scheme "${scheme}://". Supported schemes: ${VALID_SCHEMES.join(", ")}.`, DiagnosticSeverity.Error, "invalid-action-target"));
      }
    }
  });
}

// ../../dialect/agentforce/dist/lint/passes/hyperclassifier.js
var HYPERCLASSIFIER_MODEL = "model://sfdc_ai__DefaultEinsteinHyperClassifier";
var hyperclassifierTopicsKey = storeKey("hyperclassifier-topics");
function getModelString(block) {
  const modelConfig2 = block.model_config;
  if (!modelConfig2 || typeof modelConfig2 !== "object")
    return void 0;
  const model = modelConfig2.model;
  if (!model)
    return void 0;
  if (typeof model === "string")
    return model;
  if (typeof model === "object" && "value" in model) {
    const v = model.value;
    if (typeof v === "string")
      return v;
  }
  return void 0;
}
function hasStatements(value) {
  if (!value)
    return false;
  if (Array.isArray(value))
    return value.length > 0;
  if (typeof value === "object" && "statements" in value) {
    const stmts = value.statements;
    return Array.isArray(stmts) && stmts.length > 0;
  }
  return true;
}
var HyperclassifierExtractor = class {
  constructor() {
    __publicField(this, "id", hyperclassifierTopicsKey);
    __publicField(this, "description", "Identifies hyperclassifier/router topics");
  }
  finalize(store, root) {
    const ctx = store.get(schemaContextKey);
    if (!ctx)
      return;
    const results = [];
    const rootObj = root;
    const allKeys = /* @__PURE__ */ new Set([
      ...resolveNamespaceKeys("topic", ctx),
      ...resolveNamespaceKeys("subagent", ctx)
    ]);
    for (const topicKey of allKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap))
        continue;
      for (const [topicName, block] of topicMap) {
        if (!block || typeof block !== "object")
          continue;
        const topic = block;
        const modelStr = getModelString(topic);
        if (modelStr !== HYPERCLASSIFIER_MODEL)
          continue;
        results.push({ topicName, block: topic, model: modelStr });
      }
    }
    store.set(hyperclassifierTopicsKey, results);
  }
};
function hyperclassifierExtractor() {
  return new HyperclassifierExtractor();
}
function hyperclassifierConstraintsRule() {
  return defineRule({
    id: "hyperclassifier-constraints",
    description: "Validates constraints on hyperclassifier/router nodes",
    deps: { topic: each(hyperclassifierTopicsKey) },
    run({ topic }) {
      const { block, model } = topic;
      const reasoning = block.reasoning;
      if (reasoning && typeof reasoning === "object") {
        const reasoningObj = reasoning;
        const raActions = reasoningObj.tools ?? reasoningObj.actions;
        if (raActions && isNamedMap(raActions)) {
          for (const [, raBlock] of raActions) {
            if (!raBlock || typeof raBlock !== "object")
              continue;
            const ra = raBlock;
            const decomposed = decomposeAtMemberExpression(ra.value);
            const isTransition = decomposed?.namespace === "utils" && decomposed?.property === "transition";
            if (!isTransition) {
              const cst = ra.__cst;
              if (cst) {
                attachDiagnostic(ra, lintDiagnostic(cst.range, `Only @utils.transition reasoning actions are allowed when using model: ${model}`, DiagnosticSeverity.Error, "hyperclassifier-non-transition"));
              }
            }
          }
        }
      }
      if (hasStatements(block.before_reasoning)) {
        const br = block.before_reasoning;
        const cst = br?.__cst ?? block.__cst;
        if (cst) {
          attachDiagnostic(br ?? block, lintDiagnostic(cst.range, `before_reasoning directives are not allowed when using model: ${model}`, DiagnosticSeverity.Error, "hyperclassifier-before-reasoning"));
        }
      }
      if (hasStatements(block.after_reasoning)) {
        const ar = block.after_reasoning;
        const cst = ar?.__cst ?? block.__cst;
        if (cst) {
          attachDiagnostic(ar ?? block, lintDiagnostic(cst.range, `after_reasoning directives are not allowed when using model: ${model}`, DiagnosticSeverity.Error, "hyperclassifier-after-reasoning"));
        }
      }
    }
  });
}

// ../../dialect/agentforce/dist/lint/passes/connection-validation.js
var CONNECTION_FIELDS = [
  "adaptive_response_allowed",
  "escalation_message",
  "instructions",
  "outbound_route_type",
  "outbound_route_name",
  "response_actions"
];
function hasField(node, field) {
  return node[field] != null;
}
function hasAnyField(node) {
  return CONNECTION_FIELDS.some((f) => hasField(node, f));
}
function fieldError(node, connectionType, fieldName) {
  const cst = node.__cst;
  if (!cst)
    return;
  attachDiagnostic(node, lintDiagnostic(cst.range, `${connectionType} connections do not support ${fieldName}`, DiagnosticSeverity.Error, "connection-disallowed-field"));
}
function missingFieldsError(node, connectionType) {
  const cst = node.__cst;
  if (!cst)
    return;
  attachDiagnostic(node, lintDiagnostic(cst.range, `${connectionType} connections require configuration fields (e.g. escalation_message, outbound_route_type, outbound_route_name).`, DiagnosticSeverity.Error, "connection-missing-required-fields"));
}
function validateSlack(node) {
  if (hasField(node, "outbound_route_name")) {
    fieldError(node, "Slack", "outbound_route_name");
  }
  if (hasField(node, "outbound_route_type")) {
    fieldError(node, "Slack", "outbound_route_type");
  }
  if (hasField(node, "escalation_message")) {
    fieldError(node, "Slack", "escalation_message");
  }
}
function validateServiceEmail(node) {
  if (!hasAnyField(node)) {
    missingFieldsError(node, "service_email");
    return;
  }
  if (hasField(node, "escalation_message")) {
    fieldError(node, "Service email", "escalation_message");
  }
  const hasRouteName = hasField(node, "outbound_route_name");
  const hasRouteType = hasField(node, "outbound_route_type");
  if (hasRouteName !== hasRouteType) {
    const missing = hasRouteName ? "outbound_route_type" : "outbound_route_name";
    const cst = node.__cst;
    if (cst) {
      attachDiagnostic(node, lintDiagnostic(cst.range, `Service email connections require both outbound_route_name and outbound_route_type, but ${missing} is missing`, DiagnosticSeverity.Error, "connection-missing-paired-field"));
    }
  }
}
function validateMessaging(node) {
  if (!hasAnyField(node)) {
    missingFieldsError(node, "messaging");
    return;
  }
  const hasRouteName = hasField(node, "outbound_route_name");
  const hasRouteType = hasField(node, "outbound_route_type");
  if (hasRouteName !== hasRouteType) {
    const missing = hasRouteName ? "outbound_route_type" : "outbound_route_name";
    const cst = node.__cst;
    if (cst) {
      attachDiagnostic(node, lintDiagnostic(cst.range, `Messaging connections require both outbound_route_name and outbound_route_type, but ${missing} is missing`, DiagnosticSeverity.Error, "connection-missing-paired-field"));
    }
  }
}
function validateUnknown(node, name) {
  if (!hasAnyField(node)) {
    missingFieldsError(node, name);
  }
}
var CONNECTION_VALIDATORS = {
  slack: validateSlack,
  service_email: validateServiceEmail,
  messaging: validateMessaging
};
var ConnectionValidationPass = class {
  constructor() {
    __publicField(this, "id", storeKey("connection-validation"));
    __publicField(this, "description", "Validates per-connection-type field constraints");
    __publicField(this, "requires", []);
  }
  run(_store, root) {
    const rootObj = root;
    const connections = rootObj.connection;
    if (!connections || !isNamedMap(connections))
      return;
    for (const [name, block] of connections) {
      if (!block || typeof block !== "object")
        continue;
      const node = block;
      const key = name.toLowerCase();
      const validator = CONNECTION_VALIDATORS[key];
      if (validator) {
        validator(node);
      } else {
        validateUnknown(node, name);
      }
    }
  }
};
function connectionValidationRule() {
  return new ConnectionValidationPass();
}

// ../../dialect/agentforce/dist/lint/passes/system-message-variables.js
function extractVariableRefs(messageValue) {
  const refs = [];
  if (!messageValue || typeof messageValue !== "object")
    return refs;
  const obj = messageValue;
  if (obj.__kind !== "TemplateExpression" || !Array.isArray(obj.parts)) {
    return refs;
  }
  for (const part of obj.parts) {
    if (!part || typeof part !== "object")
      continue;
    const p = part;
    if (p.__kind !== "TemplateInterpolation")
      continue;
    const decomposed = decomposeAtMemberExpression(p.expression);
    if (decomposed?.namespace === "variables") {
      refs.push({
        name: decomposed.property,
        node: p.expression
      });
    }
  }
  return refs;
}
function checkMessage(messageValue, messageType2, typeMap) {
  for (const { name, node } of extractVariableRefs(messageValue)) {
    const info = typeMap.variables.get(name);
    if (info && info.modifier !== "linked") {
      const cst = node.__cst;
      if (!cst)
        continue;
      attachDiagnostic(node, lintDiagnostic(cst.range, `Variable '${name}' is ${info.modifier ?? "unmodified"} and cannot be used in ${messageType2} messages. Only linked variables are available as context variables at runtime.`, DiagnosticSeverity.Error, "system-message-mutable-variable"));
    }
  }
}
var SystemMessageVariablesPass = class {
  constructor() {
    __publicField(this, "id", storeKey("system-message-variables"));
    __publicField(this, "description", "Validates that system message templates only reference linked variables");
    __publicField(this, "requires", [typeMapKey]);
  }
  run(store, root) {
    const typeMap = store.get(typeMapKey);
    if (!typeMap)
      return;
    const system = root.system;
    if (!system)
      return;
    const messages = system.messages;
    if (!messages)
      return;
    checkMessage(messages.welcome, "welcome", typeMap);
    checkMessage(messages.error, "error", typeMap);
  }
};
function systemMessageVariablesRule() {
  return new SystemMessageVariablesPass();
}

// ../../dialect/agentforce/dist/lint/passes/connected-agents/bound-inputs.js
function isSimpleVariableReference(expr) {
  if (!expr || typeof expr !== "object")
    return void 0;
  const node = expr;
  if (node.__kind !== "MemberExpression")
    return void 0;
  const ref = decomposeAtMemberExpression(expr);
  if (!ref || ref.namespace !== "variables")
    return void 0;
  return ref.property;
}
function boundInputsRule() {
  return defineRule({
    id: "connected-agent/bound-inputs",
    description: "Connected agent input bindings must be simple linked variable references",
    deps: { typeMap: typeMapKey },
    run({ typeMap }) {
      for (const [, agentInfo] of typeMap.connectedAgents) {
        for (const [, inputInfo] of agentInfo.inputs) {
          if (!inputInfo.defaultValueNode || !inputInfo.defaultValueCst)
            continue;
          const varName = isSimpleVariableReference(inputInfo.defaultValueNode);
          if (!varName) {
            attachDiagnostic(inputInfo.decl, lintDiagnostic(inputInfo.defaultValueCst.range, `Bound input must be a simple variable reference (e.g. @variables.X).`, DiagnosticSeverity.Error, "bound-input-not-variable"));
            continue;
          }
          const varInfo = typeMap.variables.get(varName);
          if (varInfo && varInfo.modifier !== "linked") {
            attachDiagnostic(inputInfo.decl, lintDiagnostic(inputInfo.defaultValueCst.range, `Bound input must reference a linked variable \u2014 '${varName}' is ${varInfo.modifier ?? "unmodified"}.`, DiagnosticSeverity.Error, "bound-input-not-linked"));
          }
        }
      }
    }
  });
}

// ../../dialect/agentforce/dist/lint/passes/connected-agents/no-transition.js
function noTransitionRule() {
  return defineRule({
    id: "connected-agent/no-transition",
    description: "Connected agents cannot be transition targets (not yet supported)",
    deps: { typeMap: typeMapKey },
    run({ typeMap }) {
      for (const target of typeMap.transitionTargets.get("connected_subagent") ?? []) {
        attachDiagnostic(target.diagnosticParent, lintDiagnostic(target.range, `Transition to a connected agent is not yet supported. Use @connected_subagent.${target.property} as a tool invocation instead.`, DiagnosticSeverity.Error, "connected-agent-no-transition"));
      }
    }
  });
}

// ../../dialect/agentforce/dist/lint/passes/connected-agents/target-validation.js
var ALLOWED_SCHEMES = ["agentforce"];
function validateTargetName(targetName) {
  if (!/^[a-zA-Z]/.test(targetName)) {
    return `Target name '${targetName}' must start with a letter (a-z, A-Z).`;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(targetName)) {
    return `Target name '${targetName}' can only contain letters, numbers, and underscores.`;
  }
  if (targetName.endsWith("_")) {
    return `Target name '${targetName}' cannot end with an underscore.`;
  }
  if (targetName.includes("__")) {
    return `Target name '${targetName}' cannot contain consecutive underscores.`;
  }
  return null;
}
function extractTargetName(targetUri) {
  const match = targetUri.match(/^[a-zA-Z][a-zA-Z0-9_]*:\/\/(.+)$/);
  return match ? match[1] : null;
}
var connectedAgentTargetKey = storeKey("connected-agent-target");
var ConnectedAgentTargetPass = class {
  constructor() {
    __publicField(this, "id", connectedAgentTargetKey);
    __publicField(this, "description", "Validates connected agent target URIs (scheme and name)");
    __publicField(this, "requires", [typeMapKey]);
  }
  run(store) {
    const typeMap = store.get(typeMapKey);
    if (!typeMap)
      return;
    for (const [, agentInfo] of typeMap.connectedAgents) {
      const { target, targetNode } = agentInfo;
      if (!target || !targetNode)
        continue;
      const range = targetNode.__cst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      };
      const schemeMatch = target.match(/^([a-zA-Z][a-zA-Z0-9_]*):\/\//);
      if (!schemeMatch)
        continue;
      const scheme = schemeMatch[1];
      if (!ALLOWED_SCHEMES.includes(scheme)) {
        const allowed = ALLOWED_SCHEMES.map((s) => `${s}://`).join(", ");
        attachDiagnostic(targetNode, lintDiagnostic(range, `Unsupported connected agent target scheme '${scheme}://'. Only ${allowed} is currently supported.`, DiagnosticSeverity.Error, "connected-agent-unsupported-scheme"));
        continue;
      }
      const targetName = extractTargetName(target);
      if (!targetName)
        continue;
      const nameError = validateTargetName(targetName);
      if (nameError) {
        attachDiagnostic(targetNode, lintDiagnostic(range, nameError, DiagnosticSeverity.Error, "invalid-connected-subagent-target-name"));
      }
    }
  }
};
function connectedAgentTargetPass() {
  return new ConnectedAgentTargetPass();
}

// ../../dialect/agentforce/dist/lint/passes/connected-agents/template-reference.js
var templateReferenceValidationKey = storeKey("template-reference-validation");
var TemplateReferenceValidationPass = class {
  constructor() {
    __publicField(this, "id", templateReferenceValidationKey);
    __publicField(this, "description", "Validates that template interpolations in instructions use @actions.X for connected subagents");
    __publicField(this, "requires", []);
  }
  run(_store, root) {
    const visited = /* @__PURE__ */ new WeakSet();
    this.walkNode(root, null, visited);
  }
  walkNode(node, parentTopic, visited) {
    if (!node || typeof node !== "object")
      return;
    const astNode = node;
    if (visited.has(astNode))
      return;
    visited.add(astNode);
    let currentTopic = parentTopic;
    if (astNode.__kind === "SubagentBlock" || astNode.__kind === "StartAgentBlock") {
      currentTopic = astNode;
    }
    if (astNode.__kind === "TemplateInterpolation") {
      this.validateTemplateInterpolation(astNode, currentTopic);
    }
    if ("__children" in astNode && Array.isArray(astNode.__children)) {
      for (const child of astNode.__children) {
        this.walkNode(child, currentTopic, visited);
      }
    }
    for (const key in astNode) {
      if (!Object.hasOwn(astNode, key))
        continue;
      if (key.startsWith("__"))
        continue;
      const value = astNode[key];
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          for (const item of value) {
            this.walkNode(item, currentTopic, visited);
          }
        } else {
          this.walkNode(value, currentTopic, visited);
        }
      }
    }
  }
  validateTemplateInterpolation(node, parentTopic) {
    const expression = node.expression;
    if (!expression || typeof expression !== "object")
      return;
    const expr = expression;
    const decomposed = decomposeAtMemberExpression(expr);
    if (decomposed && decomposed.namespace === "connected_subagent") {
      const connectedSubagentName = decomposed.property;
      const actionAlias = this.findActionAlias(parentTopic, connectedSubagentName);
      const cst = expr.__cst;
      const range = cst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      };
      const suggestion = actionAlias ? `{!@actions.${actionAlias}}` : `{!@actions.<action_alias>}`;
      attachDiagnostic(node, lintDiagnostic(range, `Connected subagent '${connectedSubagentName}' cannot be referenced as {!@connected_subagent.${connectedSubagentName}} in template instructions. Use ${suggestion} instead.`, DiagnosticSeverity.Error, "invalid-connected-subagent-reference"));
    }
  }
  findActionAlias(parentTopic, connectedSubagentName) {
    if (!parentTopic)
      return null;
    const reasoning = parentTopic.reasoning;
    if (!reasoning || typeof reasoning !== "object")
      return null;
    const reasoningObj = reasoning;
    const actions = reasoningObj.actions;
    if (!actions || !isNamedMap(actions))
      return null;
    for (const [alias, actionBlock] of actions) {
      if (!actionBlock || typeof actionBlock !== "object")
        continue;
      const block = actionBlock;
      if (block.__kind !== "ReasoningActionBlock")
        continue;
      const decomposed = decomposeAtMemberExpression(block.value);
      if (decomposed && decomposed.namespace === "connected_subagent" && decomposed.property === connectedSubagentName) {
        return alias;
      }
    }
    return null;
  }
};
function templateReferenceValidationPass() {
  return new TemplateReferenceValidationPass();
}

// ../../dialect/agentforce/dist/lint/passes/config-validation.js
function getStringValue(node) {
  if (!node || typeof node !== "object")
    return void 0;
  const obj = node;
  if (obj.__kind !== "StringLiteral" && obj.__kind !== "TemplateExpression")
    return void 0;
  if (typeof obj.value !== "string" || obj.value.trim().length === 0)
    return void 0;
  return { value: obj.value, astNode: obj };
}
function getBlockRange(block) {
  const cst = block.__cst;
  return cst?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
}
var ConfigValidationPass = class {
  constructor() {
    __publicField(this, "id", storeKey("config-validation"));
    __publicField(this, "description", "Validates Agentforce config block constraints (agent name, default_agent_user)");
  }
  run(_store, root) {
    const config2 = root.config;
    if (!config2)
      return;
    const developerName = getStringValue(config2.developer_name);
    const agentName = getStringValue(config2.agent_name);
    if (!developerName && !agentName) {
      attachDiagnostic(config2, lintDiagnostic(getBlockRange(config2), "Config requires either 'developer_name' or 'agent_name'.", DiagnosticSeverity.Error, "config-missing-agent-name"));
    } else if (developerName && agentName) {
      attachDiagnostic(config2, lintDiagnostic(getBlockRange(config2), "Only one of 'developer_name' or 'agent_name' can be provided, not both.", DiagnosticSeverity.Error, "config-duplicate-agent-name"));
    }
    const agentTypeNode = config2.agent_type;
    if (!agentTypeNode || typeof agentTypeNode !== "object")
      return;
    const agentTypeValue = typeof agentTypeNode.value === "string" ? agentTypeNode.value : void 0;
    if (!agentTypeValue)
      return;
    const agentTypeLower = agentTypeValue.toLowerCase();
    const defaultAgentUser = getStringValue(config2.default_agent_user);
    if (agentTypeLower === "agentforceserviceagent" || agentTypeLower === "agentforce service agent") {
      if (!defaultAgentUser) {
        attachDiagnostic(config2, lintDiagnostic(getBlockRange(config2), `'default_agent_user' is required for ${agentTypeValue} type agents.`, DiagnosticSeverity.Error, "config-missing-default-agent-user"));
      }
    } else if (agentTypeLower === "agentforceemployeeagent" || agentTypeLower === "agentforce employee agent") {
      if (defaultAgentUser) {
        const dauNode = config2.default_agent_user;
        const dauCst = dauNode.__cst;
        const dauRange = dauCst?.range ?? getBlockRange(config2);
        attachDiagnostic(dauNode, lintDiagnostic(dauRange, `'default_agent_user' is ignored for ${agentTypeValue} type agents.`, DiagnosticSeverity.Warning, "config-ignored-default-agent-user"));
      }
    }
  }
};
function configValidationRule() {
  return new ConfigValidationPass();
}

// ../../dialect/agentforce/dist/lint/passes/variable-validation.js
function getDeclRange(decl) {
  const cst = decl.__cst;
  return cst?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
}
var VariableValidationPass = class {
  constructor() {
    __publicField(this, "id", storeKey("variable-validation"));
    __publicField(this, "description", "Validates variable names and linked variable constraints");
    __publicField(this, "requires", [typeMapKey]);
  }
  run(store, root) {
    const typeMap = store.get(typeMapKey);
    if (!typeMap)
      return;
    const varsMap = root.variables;
    if (!varsMap || !isNamedMap(varsMap))
      return;
    for (const [name, decl] of varsMap) {
      if (!decl || typeof decl !== "object")
        continue;
      const node = decl;
      const range = getDeclRange(node);
      const properties = node.properties;
      this.validateName(name, node, range);
      const info = typeMap.variables.get(name);
      this.validateSourceProperty(name, node, range, info?.modifier, properties);
      if (info?.modifier === "linked") {
        this.validateLinkedVariable(name, node, range, info.type);
      }
    }
  }
  validateName(name, node, range) {
    if (name.startsWith("_")) {
      attachDiagnostic(node, lintDiagnostic(range, `Variable name '${name}' cannot start with an underscore.`, DiagnosticSeverity.Error, "invalid-variable-name"));
    }
    const endsWith__c = name.endsWith("__c");
    if (name.endsWith("_") && !endsWith__c) {
      attachDiagnostic(node, lintDiagnostic(range, `Variable name '${name}' cannot end with an underscore (except __c suffix).`, DiagnosticSeverity.Error, "invalid-variable-name"));
    }
    if (name.includes("__")) {
      if (!endsWith__c) {
        attachDiagnostic(node, lintDiagnostic(range, `Variable name '${name}' cannot contain consecutive underscores (except __c suffix).`, DiagnosticSeverity.Error, "invalid-variable-name"));
      } else if (name.slice(0, -3).includes("__")) {
        attachDiagnostic(node, lintDiagnostic(range, `Variable name '${name}' cannot contain consecutive underscores (except __c suffix).`, DiagnosticSeverity.Error, "invalid-variable-name"));
      }
    }
  }
  validateSourceProperty(name, node, range, modifier, properties) {
    const hasSource = properties?.["source"] != null;
    if (modifier === "mutable" && hasSource) {
      attachDiagnostic(node, lintDiagnostic(range, `Mutable variable '${name}' cannot have a source property. Only linked variables can have a source.`, DiagnosticSeverity.Error, "mutable-variable-cannot-have-source"));
    }
    if (modifier === "linked" && !hasSource) {
      attachDiagnostic(node, lintDiagnostic(range, `Linked variable '${name}' must have a source property (e.g., source: @MessagingSession.Id).`, DiagnosticSeverity.Error, "linked-variable-missing-source"));
    }
  }
  validateLinkedVariable(name, node, range, typeText) {
    if (typeText.startsWith("list[") || typeText.startsWith("list(")) {
      attachDiagnostic(node, lintDiagnostic(range, `Context variable '${name}' cannot be a list.`, DiagnosticSeverity.Error, "linked-variable-cannot-be-list"));
    }
    if (typeText === "object") {
      attachDiagnostic(node, lintDiagnostic(range, `Context variable '${name}' cannot be an object.`, DiagnosticSeverity.Error, "linked-variable-cannot-be-object"));
    }
    const obj = node;
    if (obj.defaultValue != null) {
      attachDiagnostic(node, lintDiagnostic(range, `Context variable '${name}' cannot have a default value.`, DiagnosticSeverity.Error, "linked-variable-cannot-have-default"));
    }
  }
};
function variableValidationRule() {
  return new VariableValidationPass();
}

// ../../dialect/agentforce/dist/lint/passes/complex-data-type.js
function getTypeText2(decl) {
  const type = decl.type;
  if (!type)
    return null;
  const cst = type.__cst;
  return cst?.node?.text?.trim() ?? null;
}
function isObjectType(typeText) {
  return typeText === "object" || typeText === "list[object]";
}
function getDeclRange2(decl) {
  const cst = decl.__cst;
  return cst?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
}
function hasStringField(properties, fieldName) {
  if (!properties)
    return false;
  const field = properties[fieldName];
  if (!field || typeof field !== "object")
    return false;
  const obj = field;
  return typeof obj.value === "string" && obj.value.trim().length > 0;
}
var ComplexDataTypePass = class {
  constructor() {
    __publicField(this, "id", storeKey("complex-data-type-warning"));
    __publicField(this, "description", "Warns when object-type action inputs/outputs lack complex_data_type_name or schema");
    __publicField(this, "requires", [schemaContextKey]);
  }
  run(store, root) {
    const ctx = store.get(schemaContextKey);
    if (!ctx)
      return;
    const rootObj = root;
    const allKeys = /* @__PURE__ */ new Set([
      ...resolveNamespaceKeys("topic", ctx),
      ...resolveNamespaceKeys("subagent", ctx)
    ]);
    for (const topicKey of allKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap))
        continue;
      for (const [, block] of topicMap) {
        if (!block || typeof block !== "object")
          continue;
        const topic = block;
        const actionsMap = topic.actions;
        if (!actionsMap || !isNamedMap(actionsMap))
          continue;
        for (const [actionName, actBlock] of actionsMap) {
          if (!actBlock || typeof actBlock !== "object")
            continue;
          const act = actBlock;
          this.checkInputs(act.inputs, actionName);
          this.checkOutputs(act.outputs, actionName);
        }
      }
    }
  }
  checkInputs(inputs, actionName) {
    if (!inputs || !isNamedMap(inputs))
      return;
    for (const [paramName, decl] of inputs) {
      if (!decl || typeof decl !== "object")
        continue;
      const obj = decl;
      const typeText = getTypeText2(obj);
      if (!typeText || !isObjectType(typeText))
        continue;
      const props = obj.properties;
      if (!hasStringField(props, "complex_data_type_name") && !hasStringField(props, "schema")) {
        attachDiagnostic(obj, lintDiagnostic(getDeclRange2(obj), `Action input '${paramName}' in '${actionName}' has type '${typeText}' but lacks 'complex_data_type_name' or 'schema'. Consider specifying the object schema for better type validation.`, DiagnosticSeverity.Warning, "object-type-missing-schema"));
      }
    }
  }
  checkOutputs(outputs, actionName) {
    if (!outputs || !isNamedMap(outputs))
      return;
    for (const [outputName, decl] of outputs) {
      if (!decl || typeof decl !== "object")
        continue;
      const obj = decl;
      const typeText = getTypeText2(obj);
      if (!typeText || !isObjectType(typeText))
        continue;
      const props = obj.properties;
      if (!hasStringField(props, "complex_data_type_name")) {
        attachDiagnostic(obj, lintDiagnostic(getDeclRange2(obj), `Action output '${outputName}' in '${actionName}' has type '${typeText}' but lacks 'complex_data_type_name'. Consider specifying the object schema for better type validation.`, DiagnosticSeverity.Warning, "object-type-missing-schema"));
      }
    }
  }
};
function complexDataTypeWarningRule() {
  return new ComplexDataTypePass();
}

// ../../dialect/agentforce/dist/lint/passes/index.js
function defaultRules2() {
  return [
    ...defaultRules(),
    actionTargetSchemeRule(),
    hyperclassifierExtractor(),
    hyperclassifierConstraintsRule(),
    connectionValidationRule(),
    systemMessageVariablesRule(),
    boundInputsRule(),
    noTransitionRule(),
    connectedAgentTargetPass(),
    templateReferenceValidationPass(),
    configValidationRule(),
    variableValidationRule(),
    complexDataTypeWarningRule()
  ];
}

// ../../dialect/agentforce/dist/pkg-meta.js
var DIALECT_NAME2 = "agentforce";
var DIALECT_VERSION2 = "2.7.13";

// ../../dialect/agentforce/dist/index.js
var agentforceDialect = {
  name: DIALECT_NAME2,
  displayName: "Agentforce",
  description: "Agentforce dialect with Salesforce-specific blocks and rules",
  version: DIALECT_VERSION2,
  schemaInfo: AgentforceSchemaInfo,
  createRules: defaultRules2,
  source: "agentforce-lint"
};

// src/validate.ts
function isInternalKey(key) {
  return key.startsWith("__");
}
function getBlockSchema(block) {
  const ctor = block.constructor;
  const name = block.__name;
  if (name && ctor.resolveSchemaForName) {
    return ctor.resolveSchemaForName(name);
  }
  return ctor.schema;
}
function getBlockChildren(block) {
  if (!block.__children) {
    block.__children = [];
  }
  return block.__children;
}
function validateStrictSchema(block) {
  const schema2 = getBlockSchema(block);
  const record2 = block;
  for (const key of Object.keys(record2)) {
    if (isInternalKey(key)) continue;
    const value = record2[key];
    if (value === void 0 || isNamedMap(value)) continue;
    if (!schema2?.[key]) {
      throw new Error(
        `Strict mode: field "${key}" is not defined in the schema for ${block.__kind}`
      );
    }
  }
  const children = getBlockChildren(block);
  for (const child of children) {
    if (child.__type === "field" && !child.entryName) {
      const key = child.key;
      if (!schema2?.[key]) {
        throw new Error(
          `Strict mode: field "${key}" is not defined in the schema for ${block.__kind}`
        );
      }
    }
  }
}

// src/children-sync.ts
function upsertFieldChild(children, key, value, fieldType) {
  const idx2 = children.findIndex(
    (c) => c.__type === "field" && c.key === key && !c.entryName
  );
  if (value === void 0) {
    if (idx2 >= 0) children.splice(idx2, 1);
    return void 0;
  }
  if (idx2 >= 0) {
    const existing = children[idx2];
    existing.value = value;
    return existing;
  }
  if (!fieldType) return void 0;
  const fc = new FieldChild(key, value, fieldType);
  children.push(fc);
  return fc;
}
function upsertNamedFieldChild(children, key, name, value, fieldType) {
  const idx2 = children.findIndex(
    (c) => c.__type === "field" && c.key === key && c.entryName === name
  );
  if (idx2 >= 0) {
    children[idx2].value = value;
  } else {
    children.push(new FieldChild(key, value, fieldType, name));
  }
}
function removeNamedFieldChild(children, key, name) {
  const idx2 = children.findIndex(
    (c) => c.__type === "field" && c.key === key && c.entryName === name
  );
  if (idx2 >= 0) children.splice(idx2, 1);
}
var fallbackFieldType = {
  __fieldKind: "Primitive",
  parse: () => {
    throw new Error("fallbackFieldType does not support parsing");
  },
  emit: (value, ctx) => {
    if (isEmittable(value)) {
      return value.__emit(ctx);
    }
    return String(value ?? "");
  }
};
function syncBlockField(block, key, value, schema2) {
  const children = getBlockChildren(block);
  const fc = upsertFieldChild(
    children,
    key,
    value,
    schema2?.[key] ?? fallbackFieldType
  );
  if (value === void 0) {
    delete block[key];
    return;
  }
  if (fc && !Object.getOwnPropertyDescriptor(block, key)?.get) {
    defineFieldAccessors(block, [fc]);
  }
}
function collectFieldKeys(record2, schema2) {
  const keys = /* @__PURE__ */ new Set();
  for (const key of Object.keys(record2)) {
    if (!isInternalKey(key)) keys.add(key);
  }
  if (schema2) {
    for (const key of Object.keys(schema2)) {
      keys.add(key);
    }
  }
  return keys;
}
function syncBlockChildren(block) {
  const schema2 = getBlockSchema(block);
  const record2 = block;
  for (const key of collectFieldKeys(record2, schema2)) {
    const value = record2[key];
    if (value === void 0 || isNamedMap(value)) continue;
    syncBlockField(block, key, value, schema2);
  }
}
function getChildren(ast) {
  return ast.__children ?? [];
}
function syncSingularField(ast, key, value, schema2) {
  upsertFieldChild(getChildren(ast), key, value, schema2[key]);
}
function addNamedEntryChild(ast, key, name, value, schema2) {
  const fieldType = schema2[key];
  if (fieldType) {
    upsertNamedFieldChild(getChildren(ast), key, name, value, fieldType);
  }
}
function removeNamedEntryChild(ast, key, name) {
  removeNamedFieldChild(getChildren(ast), key, name);
}

// src/mutate-component.ts
function assertSchemaField(key, schema2, kind, strict) {
  if (strict && !schema2?.[key]) {
    throw new Error(
      `Strict mode: field "${key}" is not defined in the schema for ${kind ?? "unknown"}`
    );
  }
}
function buildMutationHelpers(target, schema2, sync, options) {
  const { strict, kind } = options ?? {};
  const record2 = target;
  return {
    setField(key, value) {
      assertSchemaField(key, schema2, kind, strict);
      record2[key] = value;
      sync.syncField(key, value);
    },
    removeField(key) {
      record2[key] = void 0;
      sync.syncField(key, void 0);
    },
    addEntry(key, name, value) {
      assertSchemaField(key, schema2, kind, strict);
      let map = record2[key];
      if (!isNamedMap(map)) {
        const ft = schema2?.[key];
        if (ft && isCollectionFieldType(ft)) {
          map = new ft();
        } else {
          map = NamedMap.forCollection(key);
        }
        record2[key] = map;
      }
      map.set(name, value);
      sync.addNamedChild(key, name, value);
    },
    removeEntry(key, name) {
      const map = record2[key];
      if (isNamedMap(map)) {
        map.delete(name);
      }
      sync.removeNamedChild(key, name);
    }
  };
}
function mutateComponent(block, fn, options) {
  const schema2 = getBlockSchema(block);
  const sync = {
    syncField: (key, value) => syncBlockField(block, key, value, schema2),
    addNamedChild: (key) => {
      const fieldType = schema2?.[key] ?? fallbackFieldType;
      upsertFieldChild(getBlockChildren(block), key, block[key], fieldType);
    },
    removeNamedChild: () => {
    }
  };
  const helpers = buildMutationHelpers(block, schema2, sync, {
    strict: options?.strict,
    kind: block.__kind
  });
  fn(block, helpers);
  syncBlockChildren(block);
  if (options?.strict) {
    validateStrictSchema(block);
  }
  return block;
}

// src/document.ts
var schema = AgentforceSchema;
var Document = class _Document {
  constructor(ast, diagnostics, _store, parser) {
    __publicField(this, "_ast");
    __publicField(this, "_diagnostics");
    __publicField(this, "_parser");
    __publicField(this, "_isDirty");
    __publicField(this, "_history");
    __publicField(this, "_historyIndex");
    __publicField(this, "_redoStack");
    this._ast = ast;
    this._diagnostics = diagnostics;
    this._parser = parser;
    this._isDirty = false;
    this._history = [];
    this._historyIndex = 0;
    this._redoStack = [];
  }
  /** @internal Factory used by `parse()`. */
  static create(ast, diagnostics, store, parser) {
    return new _Document(ast, diagnostics, store, parser);
  }
  /** @internal Factory for creating an empty document (used when parse fails). */
  static empty(diagnostics) {
    const emptyAst = {
      __cst: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 }
        }
      },
      __diagnostics: [...diagnostics],
      __children: []
    };
    const noopParser = {
      parse: () => ({
        rootNode: emptyAst
      })
    };
    return new _Document(emptyAst, diagnostics, new PassStore(), noopParser);
  }
  // ---------------------------------------------------------------------------
  // Read-only properties
  // ---------------------------------------------------------------------------
  get ast() {
    return this._ast;
  }
  get diagnostics() {
    return this._diagnostics;
  }
  get hasErrors() {
    return this._diagnostics.some((d) => d.severity === DiagnosticSeverity.Error);
  }
  get errors() {
    return this._diagnostics.filter(
      (d) => d.severity === DiagnosticSeverity.Error
    );
  }
  get warnings() {
    return this._diagnostics.filter(
      (d) => d.severity === DiagnosticSeverity.Warning
    );
  }
  // ---------------------------------------------------------------------------
  // Emission
  // ---------------------------------------------------------------------------
  emit(options) {
    return emitDocument(this._ast, schema, options);
  }
  // ---------------------------------------------------------------------------
  // Core mutation
  // ---------------------------------------------------------------------------
  /**
   * Apply a mutation to the AST in-place.
   *
   * Creates an undo point (source snapshot before the mutation).
   * After `fn` executes, auto-syncs document `__children` for singular
   * root-level property changes. For named entries, use the `helpers`.
   */
  mutate(fn, label) {
    const source = this.emit();
    this._history.splice(this._historyIndex);
    this._history.push({ source, label, timestamp: Date.now() });
    this._historyIndex = this._history.length;
    this._redoStack = [];
    const before = /* @__PURE__ */ new Map();
    for (const key of Object.keys(schema)) {
      before.set(key, this._ast[key]);
    }
    const astRoot = this._ast;
    const sync = {
      syncField: (key, value) => syncSingularField(astRoot, key, value, schema),
      addNamedChild: (key, name, value) => addNamedEntryChild(astRoot, key, name, value, schema),
      removeNamedChild: (key, name) => removeNamedEntryChild(astRoot, key, name)
    };
    const helpers = buildMutationHelpers(this._ast, schema, sync);
    fn(this._ast, helpers);
    for (const key of Object.keys(schema)) {
      const prev = before.get(key);
      const curr = this._ast[key];
      if (curr !== prev && !isNamedMap(curr)) {
        syncSingularField(this._ast, key, curr, schema);
      }
    }
    this._isDirty = true;
    return this;
  }
  // ---------------------------------------------------------------------------
  // Convenience mutations
  // ---------------------------------------------------------------------------
  /** Add/replace a singular root-level block. Handles `__children`. */
  setField(key, value, label) {
    return this.mutate((_ast, helpers) => helpers.setField(key, value), label);
  }
  /** Remove a singular root-level block. Handles `__children`. */
  removeField(key, label) {
    return this.mutate((_ast, helpers) => helpers.removeField(key), label);
  }
  /** Add a named entry (topic, connection, etc.). Handles NamedMap + document `__children`. */
  addEntry(key, name, value, label) {
    return this.mutate(
      (_ast, helpers) => helpers.addEntry(key, name, value),
      label
    );
  }
  /** Remove a named entry. Handles NamedMap + document `__children`. */
  removeEntry(key, name, label) {
    return this.mutate(
      (_ast, helpers) => helpers.removeEntry(key, name),
      label
    );
  }
  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------
  get canUndo() {
    return this._historyIndex > 0;
  }
  get canRedo() {
    return this._redoStack.length > 0;
  }
  get isDirty() {
    return this._isDirty;
  }
  undo() {
    if (!this.canUndo) return this;
    const currentSource = this.emit();
    const lastEntry = this._history[this._historyIndex - 1];
    this._redoStack.push({
      source: currentSource,
      label: lastEntry.label,
      timestamp: Date.now()
    });
    this._historyIndex--;
    const entry = this._history[this._historyIndex];
    this._parseFrom(entry.source);
    this._isDirty = false;
    return this;
  }
  redo() {
    if (!this.canRedo) return this;
    const currentSource = this.emit();
    const redoEntry = this._redoStack[this._redoStack.length - 1];
    this._history.splice(this._historyIndex);
    this._history.push({
      source: currentSource,
      label: redoEntry.label,
      timestamp: Date.now()
    });
    this._historyIndex = this._history.length;
    const entry = this._redoStack.pop();
    this._parseFrom(entry.source);
    this._isDirty = false;
    return this;
  }
  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  get history() {
    return this._history;
  }
  get historyIndex() {
    return this._historyIndex;
  }
  /**
   * Get before/after source for diffing.
   * Defaults to comparing the state before the last mutation to the current state.
   */
  getDiff(fromIndex, toIndex) {
    const from = fromIndex ?? Math.max(0, this._historyIndex - 1);
    const before = from < this._history.length ? this._history[from].source : "";
    const after = toIndex !== void 0 && toIndex < this._history.length ? this._history[toIndex].source : this.emit();
    return { before, after };
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  _parseFrom(source) {
    const tree = this._parser.parse(source);
    const result = parseAndLint(tree.rootNode, agentforceDialect);
    this._ast = result.ast;
    this._diagnostics = result.diagnostics;
  }
};

// src/parse.ts
function parse3(source) {
  try {
    const parser = getParser2();
    const tree = parser.parse(source);
    const result = parseAndLint(tree.rootNode, agentforceDialect);
    return Document.create(
      result.ast,
      result.diagnostics,
      result.store,
      parser
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      },
      message: `Parse failed: ${message}`,
      severity: DiagnosticSeverity.Error,
      code: "parse-error",
      source: "agentscript"
    };
    return Document.empty([diagnostic]);
  }
}

// src/component-kind.ts
var INDENT = "    ";
function indentSource(source) {
  return source.split("\n").map((line) => INDENT + line).join("\n");
}
var fullSchema = AgentforceSchema;
function extractNamedEntry(ast, key) {
  const map = ast[key];
  if (map && typeof map === "object" && isNamedMap(map)) {
    const entries = [...map];
    return entries.length > 0 ? entries[0][1] : void 0;
  }
  return void 0;
}
function identityStripCST(cst) {
  return cst;
}
function nestedStripWrapperCST(wrapLineOffset) {
  return (root) => {
    if (wrapLineOffset === 0 || !root.children) return root;
    const namedChildren = root.children.filter((c) => c.isNamed);
    if (namedChildren.length !== 1) return root;
    const wrapper = namedChildren[0];
    if (!wrapper.children) return root;
    const contentChildren = wrapper.children.filter(
      (c) => c.isNamed && c.range.start.line >= wrapLineOffset
    );
    if (contentChildren.length === 0) return root;
    return {
      ...root,
      children: contentChildren,
      range: {
        start: { ...contentChildren[0].range.start },
        end: { ...contentChildren[contentChildren.length - 1].range.end }
      }
    };
  };
}
function nestedParse(schema2) {
  return (rootNode) => {
    const dialectParser = new Dialect();
    const result = dialectParser.parse(rootNode, schema2);
    return {
      ast: result.value,
      diagnostics: result.diagnostics ?? []
    };
  };
}
function fullParse(rootNode) {
  const result = parseAndLint(rootNode, agentforceDialect);
  return {
    ast: result.ast,
    diagnostics: result.diagnostics ?? []
  };
}
var COMPONENT_KINDS = {
  action: {
    label: "action (single)",
    schema: { actions: AFActionsBlock },
    wrap: (src) => `actions:
${indentSource(src)}`,
    extract: (ast) => extractNamedEntry(ast, "actions"),
    parse: nestedParse({ actions: AFActionsBlock }),
    stripWrapperCST: nestedStripWrapperCST(1),
    wrapOffsets: { lines: 1, columns: INDENT.length }
  },
  actions: {
    label: "actions (collection)",
    schema: { actions: AFActionsBlock },
    wrap: (src) => `actions:
${indentSource(src)}`,
    extract: (ast) => ast["actions"],
    parse: nestedParse({ actions: AFActionsBlock }),
    stripWrapperCST: nestedStripWrapperCST(1),
    wrapOffsets: { lines: 1, columns: INDENT.length }
  },
  reasoning_actions: {
    label: "reasoning_actions (collection)",
    schema: {
      reasoning_actions: ReasoningActionsBlock
    },
    wrap: (src) => `reasoning_actions:
${indentSource(src)}`,
    extract: (ast) => ast["reasoning_actions"],
    parse: nestedParse({ reasoning_actions: ReasoningActionsBlock }),
    stripWrapperCST: nestedStripWrapperCST(1),
    wrapOffsets: { lines: 1, columns: INDENT.length }
  }
};
for (const [key, fieldType] of Object.entries(fullSchema)) {
  if (key in COMPONENT_KINDS) continue;
  if (isNamedCollectionFieldType(fieldType)) {
    COMPONENT_KINDS[key] = {
      label: `${key} (collection)`,
      schema: fullSchema,
      wrap: (src) => src,
      extract: (ast) => extractNamedEntry(ast, key),
      parse: fullParse,
      stripWrapperCST: identityStripCST,
      wrapOffsets: { lines: 0, columns: 0 }
    };
  } else {
    COMPONENT_KINDS[key] = {
      label: `${key} (singular block)`,
      schema: fullSchema,
      wrap: (src) => `${key}:
${indentSource(src)}`,
      extract: (ast) => ast[key],
      parse: fullParse,
      stripWrapperCST: nestedStripWrapperCST(1),
      wrapOffsets: { lines: 1, columns: INDENT.length }
    };
  }
}
function getComponentKindConfig(kind) {
  return COMPONENT_KINDS[kind];
}
function getComponentKindOptions() {
  return Object.entries(COMPONENT_KINDS).map(([key, cfg]) => ({
    value: key,
    label: cfg.label
  }));
}

// src/parse-component.ts
function countPrefixLines(prefix2) {
  return prefix2.split("\n").length - 1;
}
function parseComponentCore(source, kind) {
  const config2 = getComponentKindConfig(kind);
  if (!config2) return void 0;
  const parser = getParser2();
  const wrappedSource = config2.wrap(source);
  const { rootNode: adaptedRoot } = parser.parse(wrappedSource);
  const { ast, diagnostics } = config2.parse(adaptedRoot);
  const component = config2.extract(ast) ?? null;
  return { config: config2, parser, wrappedSource, component, diagnostics };
}
function adjustRange(range, lineOffset, columnOffset) {
  range.start.line = Math.max(0, range.start.line - lineOffset);
  range.start.character = Math.max(0, range.start.character - columnOffset);
  range.end.line = Math.max(0, range.end.line - lineOffset);
  range.end.character = Math.max(0, range.end.character - columnOffset);
}
function parseComponent(source, kind) {
  try {
    if (kind === "statement") {
      return parseStatementComponent(source);
    }
    if (kind === "expression") {
      return parseExpressionComponent(source);
    }
    const parsed = parseComponentCore(source, kind);
    return parsed?.component ?? void 0;
  } catch {
    return kind === "statement" ? [] : void 0;
  }
}
var STMT_PREFIX = `topic __agentforce_parse_wrapper__:
    reasoning:
        instructions: ->
`;
var STMT_PREFIX_LINES = countPrefixLines(STMT_PREFIX);
var STMT_INDENT = "            ";
function parseStatementComponent(source) {
  const parser = getParser2();
  const indentedLines = source.split("\n").map((line) => STMT_INDENT + line).join("\n");
  const wrappedSource = STMT_PREFIX + indentedLines;
  const tree = parser.parse(wrappedSource);
  const result = parseAndLint(tree.rootNode, agentforceDialect);
  const ast = result.ast;
  const topicMap = ast["topic"];
  if (!isNamedMap(topicMap)) return [];
  const entries = [...topicMap.entries()];
  if (entries.length === 0) return [];
  const topic = entries[0][1];
  const reasoning = topic["reasoning"];
  if (!reasoning) return [];
  const instructionsNode = reasoning["instructions"];
  if (!instructionsNode) return [];
  const statements = instructionsNode["statements"];
  if (!Array.isArray(statements)) return [];
  return adjustStatementPositions(
    statements,
    STMT_PREFIX_LINES,
    STMT_INDENT.length
  );
}
function adjustStatementPositions(statements, lineOffset, columnOffset) {
  for (const stmt of statements) {
    if (stmt.__cst?.range) {
      adjustRange(stmt.__cst.range, lineOffset, columnOffset);
    }
    if (stmt.__diagnostics) {
      for (const d of stmt.__diagnostics) {
        adjustRange(d.range, lineOffset, columnOffset);
      }
    }
  }
  return statements;
}
var EXPR_PREFIX = "variables:\n    __expr__: String = ";
var EXPR_PREFIX_LINE = countPrefixLines(EXPR_PREFIX);
var EXPR_PREFIX_COL = EXPR_PREFIX.length - EXPR_PREFIX.lastIndexOf("\n") - 1;
function parseExpressionComponent(source) {
  const parser = getParser2();
  const wrappedSource = EXPR_PREFIX + source;
  const tree = parser.parse(wrappedSource);
  const result = parseAndLint(tree.rootNode, agentforceDialect);
  const ast = result.ast;
  const variables = ast["variables"];
  if (!variables) return void 0;
  const children = variables.__children;
  if (!children || children.length === 0) return void 0;
  for (const child of children) {
    if (child.__type === "variable_declaration" || child.__type === "declaration") {
      const decl = child;
      const defaultValue = decl.defaultValue;
      if (defaultValue) {
        adjustExpressionPositions(
          defaultValue,
          EXPR_PREFIX_LINE,
          EXPR_PREFIX_COL
        );
        return defaultValue;
      }
    }
  }
  if (isNamedMap(variables)) {
    const entries = [...variables.entries()];
    if (entries.length > 0) {
      const varDecl = entries[0][1];
      const defaultValue = varDecl.defaultValue;
      if (defaultValue) {
        adjustExpressionPositions(
          defaultValue,
          EXPR_PREFIX_LINE,
          EXPR_PREFIX_COL
        );
        return defaultValue;
      }
    }
  }
  return void 0;
}
function adjustExpressionPositions(expr, lineOffset, columnOffset) {
  const cst = expr.__cst;
  if (cst?.range) {
    cst.range.start.line -= lineOffset;
    if (cst.range.start.line === 0) {
      cst.range.start.character -= columnOffset;
    }
    cst.range.end.line -= lineOffset;
    if (cst.range.end.line === 0) {
      cst.range.end.character -= columnOffset;
    }
  }
}
function adjustCSTNodePositions(node, lineOffset, columnOffset) {
  adjustRange(node.range, lineOffset, columnOffset);
  if (node.children) {
    for (const child of node.children) {
      adjustCSTNodePositions(child, lineOffset, columnOffset);
    }
  }
}
function adjustASTPositionsInPlace(value, lineOffset, columnOffset, visited = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  const obj = value;
  const cst = obj.__cst;
  if (cst?.range) {
    adjustRange(cst.range, lineOffset, columnOffset);
  }
  const diags = obj.__diagnostics;
  if (Array.isArray(diags)) {
    for (const d of diags) {
      adjustRange(d.range, lineOffset, columnOffset);
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      if (isNamedMap(val)) {
        val.forEach(
          (v) => adjustASTPositionsInPlace(v, lineOffset, columnOffset, visited)
        );
      } else if (Array.isArray(val)) {
        for (const item of val) {
          adjustASTPositionsInPlace(item, lineOffset, columnOffset, visited);
        }
      } else {
        adjustASTPositionsInPlace(val, lineOffset, columnOffset, visited);
      }
    }
  }
}
function serializeSyntaxNode(node) {
  const serialized = {
    type: node.type,
    text: node.children.length === 0 ? node.text : void 0,
    range: {
      start: {
        line: node.startRow,
        character: node.startCol
      },
      end: {
        line: node.endRow,
        character: node.endCol
      }
    },
    isNamed: node.isNamed ?? true,
    hasError: node.hasError ?? false,
    isMissing: node.isMissing ?? false
  };
  if (node.children.length > 0) {
    const fieldNameForChild = "fieldNameForChild" in node && typeof node.fieldNameForChild === "function" ? node.fieldNameForChild.bind(node) : null;
    serialized.children = node.children.map((child, i) => {
      const childSerialized = serializeSyntaxNode(child);
      const fieldName = fieldNameForChild?.(i) ?? null;
      if (fieldName) {
        childSerialized.fieldName = fieldName;
      }
      return childSerialized;
    });
  }
  return serialized;
}
function parseComponentDebug(source, kind) {
  try {
    const parsed = parseComponentCore(source, kind);
    if (!parsed) {
      return { component: void 0, cst: null, diagnostics: [] };
    }
    const { config: config2, parser, wrappedSource, component, diagnostics } = parsed;
    const { lines: lineOffset, columns: columnOffset } = config2.wrapOffsets;
    const rootNode = parser.parse(wrappedSource).rootNode;
    const cst = serializeSyntaxNode(rootNode);
    let adjustedCst = cst;
    if (lineOffset > 0 || columnOffset > 0) {
      if (adjustedCst) adjustedCst = config2.stripWrapperCST(adjustedCst);
      if (adjustedCst)
        adjustCSTNodePositions(adjustedCst, lineOffset, columnOffset);
      if (component)
        adjustASTPositionsInPlace(component, lineOffset, columnOffset);
      for (const d of diagnostics) {
        adjustRange(d.range, lineOffset, columnOffset);
      }
    }
    return { component, cst: adjustedCst, diagnostics };
  } catch (_e) {
    return {
      component: void 0,
      cst: null,
      diagnostics: []
    };
  }
}

// src/emit-component.ts
var kindToSchemaKey = AgentforceKindToSchemaKey;
function emitComponent(component, options) {
  if (component == null) return "";
  if (!Array.isArray(component) && "__kind" in component && "__children" in component) {
    if (options?.strict) {
      validateStrictSchema(component);
    }
    syncBlockChildren(component);
  }
  const ctx = { indent: 0, tabSize: options?.tabSize };
  if (Array.isArray(component)) {
    return component.filter(isEmittable).map((s) => s.__emit(ctx)).join("\n");
  }
  if (isNamedBlockValue(component)) {
    const schemaKey = kindToSchemaKey.get(component.__kind);
    if (schemaKey) {
      return component.emitWithKey(schemaKey, ctx);
    }
    return component.__emit(ctx);
  }
  if (isSingularBlock(component)) {
    const schemaKey = kindToSchemaKey.get(component.__kind) ?? component.__kind;
    const indent = emitIndent(ctx);
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    return `${indent}${schemaKey}:
${component.__emit(childCtx)}`;
  }
  if (isEmittable(component)) {
    return component.__emit(ctx);
  }
  return "";
}

// ../compiler/dist/diagnostics.js
var FALLBACK_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

// ../compiler/dist/sourced.js
var Sourced = class {
  constructor(value, range) {
    __publicField(this, "value");
    __publicField(this, "range");
    this.value = value;
    this.range = range;
  }
  toJSON() {
    return this.value;
  }
  toString() {
    return String(this.value);
  }
  valueOf() {
    return this.value;
  }
};
function sourced(value, range) {
  return new Sourced(value, range);
}

// ../compiler/dist/compiler-context.js
var CompilerContext = class {
  constructor() {
    __publicField(this, "diagnostics", []);
    /**
     * Script block paths: compiled output object → script-level path.
     * E.g., the langConfig object maps to "language".
     * Used by validation diagnostics to show human-readable paths.
     */
    __publicField(this, "scriptPaths", /* @__PURE__ */ new WeakMap());
    /** Context (linked) variables compiled from config. */
    __publicField(this, "contextVariables", []);
    /** State (mutable) variables compiled from the AST. */
    __publicField(this, "stateVariables", []);
    /** Knowledge block field values for eager resolution. */
    __publicField(this, "knowledgeFields", /* @__PURE__ */ new Map());
    /** Set of variable names that are "linked" (context) variables. */
    __publicField(this, "linkedVariableNames", /* @__PURE__ */ new Set());
    /** Set of variable names that are "mutable" (state) variables. */
    __publicField(this, "mutableVariableNames", /* @__PURE__ */ new Set());
    /**
     * Map from @actions reference names to their corresponding tool key names.
     * Built per-topic: maps action definition names and topic targets to the
     * reasoning action key that invokes them.
     */
    __publicField(this, "actionReferenceMap", /* @__PURE__ */ new Map());
    /**
     * Connected agent input signatures: agent developer name → set of input names.
     * Populated during connected agent node compilation for downstream validation
     * of `with` clauses on @connected_subagent.X tool invocations.
     */
    __publicField(this, "connectedAgentInputs", /* @__PURE__ */ new Map());
    /**
     * Source range storage: (output object, property key) → Range.
     * Populated automatically by track(). Read by the serializer.
     */
    __publicField(this, "ranges", /* @__PURE__ */ new WeakMap());
  }
  addDiagnostic(severity, message, range, code) {
    this.diagnostics.push({
      severity,
      message,
      range: range ?? FALLBACK_RANGE,
      code,
      source: "compiler"
    });
  }
  error(message, range, code) {
    this.addDiagnostic(DiagnosticSeverity.Error, message, range, code);
  }
  warning(message, range, code) {
    this.addDiagnostic(DiagnosticSeverity.Warning, message, range, code);
  }
  /**
   * Record the script block path for an output object.
   * Used to map compiled output paths back to script-level paths in diagnostics.
   */
  setScriptPath(target, scriptPath) {
    this.scriptPaths.set(target, scriptPath);
  }
  /**
   * Get the script block path for an output object.
   */
  getScriptPath(target) {
    return this.scriptPaths.get(target);
  }
  /**
   * Get the variable namespace for a given variable name.
   * Returns 'state' for mutable, 'context' for linked, undefined for unknown.
   */
  getVariableNamespace(name) {
    if (this.mutableVariableNames.has(name))
      return "state";
    if (this.linkedVariableNames.has(name))
      return "context";
    return void 0;
  }
  /**
   * Track an output object: unwrap all Sourced<T> values to plain primitives
   * and record their source ranges in this.ranges.
   *
   * This is the ONE function compiler authors call. No manual annotations,
   * no unwrap(), no type casts.
   *
   * @example
   *   return ctx.track<Tool>({
   *     type: 'action',
   *     description: extractSourcedDescription(def.description) ?? '',
   *     name: extractSourcedString(def.label) ?? name,
   *   });
   */
  track(obj) {
    this.unwrapSourced(obj);
    return obj;
  }
  unwrapSourced(obj) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val instanceof Sourced) {
        obj[key] = val.value;
        if (val.range) {
          let props = this.ranges.get(obj);
          if (!props) {
            props = /* @__PURE__ */ new Map();
            this.ranges.set(obj, props);
          }
          props.set(key, val.range);
        }
        if (val.value && typeof val.value === "object" && !Array.isArray(val.value)) {
          this.unwrapSourced(val.value);
        }
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object") {
            this.unwrapSourced(item);
          }
        }
      } else if (val && typeof val === "object") {
        this.unwrapSourced(val);
      }
    }
  }
};

// ../compiler/dist/constants.js
var SCHEMA_VERSION = "2.0";
var NEXT_TOPIC_VARIABLE = "AgentScriptInternal_next_topic";
var AGENT_INSTRUCTIONS_VARIABLE = "AgentScriptInternal_agent_instructions";
var RUNTIME_CONDITION_VARIABLE = "AgentScriptInternal_condition";
var EMPTY_TOPIC_VALUE = '"__EMPTY__"';
var NEXT_TOPIC_EMPTY_CONDITION = `state.${NEXT_TOPIC_VARIABLE}=="${EMPTY_TOPIC_VALUE.replace(/"/g, "")}"`;
var EMPTY_ESCALATION_NODE_VALUE = "'__human__'";
var ESCALATION_TARGET = "__human__";
var TRANSITION_TARGET_NAMESPACES = [
  "topic",
  "subagent",
  "start_agent",
  "connected_subagent"
];
var STATE_UPDATE_ACTION = "__state_update_action__";
var DEFAULT_PLANNER_TYPE = "Atlas__ConcurrentMultiAgentOrchestration";
var DEFAULT_AGENT_TYPE = "EinsteinServiceAgent";
var DEFAULT_REASONING_TYPE = "salesforce.default";
var HYPERCLASSIFIER_MODEL_PREFIX = "sfdc_ai__DefaultEinsteinHyperClassifier";
var ALWAYS_PRESENT_STATE_VARIABLES = [
  {
    developer_name: NEXT_TOPIC_VARIABLE,
    label: "Next Topic",
    description: "The next topic to be visited",
    data_type: "string",
    is_list: false,
    default: EMPTY_TOPIC_VALUE,
    visibility: "Internal"
  }
];
var INSTRUCTION_STATE_VARIABLE = {
  developer_name: AGENT_INSTRUCTIONS_VARIABLE,
  label: "Agent Instructions",
  description: "The agent instructions",
  data_type: "string",
  is_list: false,
  default: "''",
  visibility: "Internal"
};
var CONDITION_STATE_VARIABLE = {
  developer_name: RUNTIME_CONDITION_VARIABLE,
  label: "Runtime Condition",
  description: "Runtime condition evaluation for if statements",
  data_type: "boolean",
  is_list: false,
  visibility: "Internal"
};
var ALWAYS_PRESENT_STATE_VARIABLE_NAMES = new Set(ALWAYS_PRESENT_STATE_VARIABLES.map((v) => v.developer_name));

// ../compiler/dist/utils.js
function normalizeDeveloperName(name) {
  let spaced = name.replace(/_/g, " ");
  spaced = spaced.replace(/([a-z])([A-Z])/g, "$1 $2");
  spaced = spaced.replace(/([a-zA-Z])(\d)/g, "$1 $2");
  spaced = spaced.replace(/(\d)([a-zA-Z])/g, "$1 $2");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}
function parseUri(uri) {
  const match = uri.match(/^(\w+):\/\/(.+)$/);
  if (!match)
    return { scheme: "", path: uri };
  return { scheme: match[1], path: match[2] };
}
function deriveLabel(developerName, explicitLabel) {
  if (explicitLabel)
    return explicitLabel;
  return normalizeDeveloperName(developerName);
}
function dedent(text) {
  const leadingNewlines = text.match(/^\n+/)?.[0]?.length ?? 0;
  const preserveNewline = leadingNewlines >= 2;
  const result = text.replace(/^\n+/, "");
  const lines = result.split("\n");
  if (lines.length <= 1) {
    const trimmed = result.trimStart();
    return preserveNewline ? "\n" + trimmed : trimmed;
  }
  let minIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim().length === 0)
      continue;
    const indent = lines[i].match(/^(\s*)/)?.[1]?.length ?? 0;
    minIndent = Math.min(minIndent, indent);
  }
  if (minIndent === Infinity)
    minIndent = 0;
  lines[0] = lines[0].trimStart();
  if (minIndent > 0) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().length === 0) {
        lines[i] = "";
        continue;
      }
      const lineIndent = lines[i].match(/^(\s*)/)?.[1]?.length ?? 0;
      if (lineIndent >= minIndent) {
        lines[i] = lines[i].slice(minIndent);
      }
    }
  }
  let joined = lines.join("\n").trimEnd();
  if (preserveNewline) {
    joined = "\n" + joined;
  }
  return joined;
}

// ../compiler/dist/ast-helpers.js
function extractStringValue(value) {
  if (value === void 0 || value === null)
    return void 0;
  if (typeof value === "string")
    return value;
  if (typeof value === "object" && "value" in value) {
    const v = value.value;
    if (typeof v === "string")
      return v;
  }
  if (typeof value === "object" && "content" in value) {
    const c = value.content;
    if (typeof c === "string")
      return c;
  }
  return void 0;
}
function extractSourcedString(value) {
  const str = extractStringValue(value);
  if (str === void 0)
    return void 0;
  return sourced(str, getCstRange(value));
}
function extractDescriptionValue(value) {
  const str = extractStringValue(value);
  if (str === void 0)
    return void 0;
  if (isTemplateValue(value))
    return str;
  return dedent(str);
}
function extractSourcedDescription(value) {
  const str = extractStringValue(value);
  if (str === void 0)
    return void 0;
  const processed = isTemplateValue(value) ? str : dedent(str);
  return sourced(processed, getCstRange(value));
}
function isTemplateValue(value) {
  return typeof value === "object" && value !== null && "parts" in value && "content" in value;
}
function extractBooleanValue(value) {
  if (value === void 0 || value === null)
    return void 0;
  if (typeof value === "boolean")
    return value;
  if (typeof value === "object" && "value" in value) {
    const v = value.value;
    if (typeof v === "boolean")
      return v;
    if (typeof v === "string") {
      if (v.toUpperCase() === "TRUE")
        return true;
      if (v.toUpperCase() === "FALSE")
        return false;
    }
  }
  if (typeof value === "string") {
    if (value.toUpperCase() === "TRUE")
      return true;
    if (value.toUpperCase() === "FALSE")
      return false;
  }
  return void 0;
}
function extractSourcedBoolean(value) {
  const b = extractBooleanValue(value);
  if (b === void 0)
    return void 0;
  return sourced(b, getCstRange(value));
}
function extractNumberValue(value) {
  if (value === void 0 || value === null)
    return void 0;
  if (typeof value === "number")
    return value;
  if (typeof value === "object" && "value" in value) {
    const v = value.value;
    if (typeof v === "number")
      return v;
  }
  if (value instanceof UnaryExpression && value.operator === "-") {
    const inner = extractNumberValue(value.operand);
    if (inner !== void 0)
      return -inner;
  }
  return void 0;
}
function extractSourcedNumber(value) {
  const n = extractNumberValue(value);
  if (n === void 0)
    return void 0;
  return sourced(n, getCstRange(value));
}
function getCstRange(value) {
  if (!value || typeof value !== "object")
    return void 0;
  const cst = value.__cst;
  return cst?.range;
}
function iterateNamedMap(map) {
  if (!map)
    return [];
  return Array.from(map.entries());
}
function getExpressionName(expr) {
  if (expr instanceof Identifier)
    return expr.name;
  if (expr instanceof SubscriptExpression) {
    if (expr.index instanceof Identifier) {
      return expr.index.name;
    }
    if (expr.object instanceof Identifier) {
      return expr.object.name;
    }
  }
  return void 0;
}
function isListType(expr) {
  return expr instanceof SubscriptExpression;
}
function resolveAtReference(expr, namespaces, ctx, errorLabel) {
  const nsList = Array.isArray(namespaces) ? namespaces : [namespaces];
  const decomposed = decomposeAtMemberExpression(expr);
  if (decomposed && nsList.includes(decomposed.namespace)) {
    return decomposed.property;
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  if (expr instanceof AtIdentifier) {
    return expr.name;
  }
  ctx.error(`Cannot resolve ${errorLabel} from expression`, expr.__cst?.range);
  return void 0;
}
function extractDictExpression(expr) {
  if (!expr || expr.__kind !== "DictLiteral")
    return void 0;
  const dictExpr = expr;
  const result = {};
  for (const entry of dictExpr.entries) {
    const key = extractStringOrIdentifierValue(entry.key);
    const value = extractExpressionValue(entry.value);
    if (key !== void 0 && value !== void 0) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
function extractStringOrIdentifierValue(expr) {
  if (expr.__kind === "StringLiteral") {
    return expr.value;
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  return void 0;
}
function extractExpressionValue(value) {
  if (value === void 0 || value === null)
    return void 0;
  const str = extractStringValue(value);
  if (str !== void 0)
    return str;
  const num = extractNumberValue(value);
  if (num !== void 0)
    return num;
  const bool = extractBooleanValue(value);
  if (bool !== void 0)
    return bool;
  if (typeof value === "object") {
    const obj = value;
    if (obj.__kind === "DictLiteral") {
      return extractDictExpression(value);
    }
    if (obj.__kind === "ListLiteral" && Array.isArray(obj.elements)) {
      return obj.elements.map(extractExpressionValue).filter((v) => v !== void 0);
    }
    if (Array.isArray(value)) {
      return value.map(extractExpressionValue).filter((v) => v !== void 0);
    }
  }
  return void 0;
}

// ../compiler/dist/validation/validate-knowledge-refs.js
function validateKnowledgeReferences(knowledgeBlock, ctx) {
  if (!knowledgeBlock)
    return;
  for (const [key, value] of Object.entries(knowledgeBlock)) {
    if (key.startsWith("__"))
      continue;
    const strValue = extractStringValue(value);
    if (strValue !== void 0) {
      ctx.knowledgeFields.set(key, strValue);
      continue;
    }
    const boolValue = extractBooleanValue(value);
    if (boolValue !== void 0) {
      ctx.knowledgeFields.set(key, boolValue);
    }
  }
}

// ../compiler/dist/validation/validate-output.js
function validateOutput(output, schema2, ctx) {
  const result = schema2.safeParse(output);
  if (result.success)
    return;
  const leafIssues = flattenZodIssues(result.error.issues);
  for (const issue2 of leafIssues) {
    const path = issue2.path;
    const location = resolveLocation(output, path, ctx);
    const found = resolveInputValue(output, path);
    ctx.diagnostics.push(issueToDiagnostic(issue2, location, found));
  }
}
function issueToDiagnostic(issue2, location, found) {
  const expected = extractExpectedValues(issue2);
  const message = formatMessage(issue2, location.scriptPath, found);
  return {
    severity: DiagnosticSeverity.Error,
    message,
    range: location.range,
    code: "schema-validation",
    source: "compiler",
    data: {
      path: location.compiledPath,
      ...expected ? { expected } : {}
    }
  };
}
function formatMessage(issue2, scriptPath, found) {
  if (issue2.code === "invalid_value" && found !== void 0) {
    return `Invalid value "${found}" for ${scriptPath}`;
  }
  if (issue2.code === "invalid_type") {
    const typed = issue2;
    return `Expected ${typed.expected} for ${scriptPath}`;
  }
  const msg = issue2.message.replace(/: expected one of .*$/, "");
  return `${msg} for ${scriptPath}`;
}
function extractExpectedValues(issue2) {
  if (issue2.code === "invalid_value" && "values" in issue2) {
    const values = issue2.values;
    return values.map(String);
  }
  return void 0;
}
function resolveInputValue(root, path) {
  let current = root;
  for (const segment of path) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[segment];
  }
  if (current instanceof Sourced)
    current = current.value;
  if (typeof current === "string")
    return current;
  if (typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }
  return void 0;
}
function flattenZodIssues(issues) {
  const result = [];
  for (const issue2 of issues) {
    if (issue2.code === "invalid_union" && "errors" in issue2) {
      const unionIssue = issue2;
      let bestMember = [];
      let bestDepth = -1;
      for (const memberIssues of unionIssue.errors) {
        const maxDepth = memberIssues.reduce((d, i) => Math.max(d, i.path.length), 0);
        if (maxDepth > bestDepth) {
          bestDepth = maxDepth;
          bestMember = memberIssues;
        }
      }
      const childIssues = bestMember.map((child) => ({
        ...child,
        path: [...issue2.path, ...child.path]
      }));
      result.push(...flattenZodIssues(childIssues));
    } else {
      result.push(issue2);
    }
  }
  return result;
}
function resolveLocation(root, path, ctx) {
  let bestRange = FALLBACK_RANGE;
  let current = root;
  let scriptBlockPath;
  const scriptSuffix = [];
  for (const segment of path) {
    if (current === null || current === void 0 || typeof current !== "object") {
      break;
    }
    const blockPath = ctx.getScriptPath(current);
    if (blockPath !== void 0) {
      scriptBlockPath = blockPath;
      scriptSuffix.length = 0;
    }
    if (typeof segment === "string") {
      const propValue = current[segment];
      if (propValue instanceof Sourced && propValue.range) {
        bestRange = propValue.range;
        scriptSuffix.push(segment);
      }
    }
    current = current[segment];
  }
  const compiledPath = path.length > 0 ? path.join(".") : "root";
  let scriptPath;
  if (scriptBlockPath !== void 0 && scriptSuffix.length > 0) {
    scriptPath = `${scriptBlockPath}.${scriptSuffix.join(".")}`;
  } else if (scriptBlockPath !== void 0) {
    scriptPath = scriptBlockPath;
  } else {
    scriptPath = compiledPath;
  }
  return { range: bestRange, scriptPath, compiledPath };
}

// ../compiler/dist/config/agent-configuration.js
function configField(config2, key) {
  return config2[key];
}
function compileAgentConfiguration(config2, contextVariables, ctx) {
  if (!config2) {
    ctx.error("Missing config block");
    return {
      developer_name: "",
      label: "",
      description: "",
      enable_enhanced_event_logs: false,
      agent_type: DEFAULT_AGENT_TYPE,
      default_agent_user: "",
      context_variables: contextVariables
    };
  }
  const developerName = extractSourcedString(config2["developer_name"]) ?? extractSourcedString(config2["agent_name"]) ?? "";
  const enableEnhancedEventLogs = extractSourcedBoolean(config2["enable_enhanced_event_logs"]) ?? false;
  const rawAgentType = extractStringValue(config2["agent_type"]) ?? DEFAULT_AGENT_TYPE;
  const rawAgentTypeSourced = extractSourcedString(config2["agent_type"]) ?? DEFAULT_AGENT_TYPE;
  const agentType2 = rawAgentType === "AgentforceServiceAgent" ? "EinsteinServiceAgent" : rawAgentTypeSourced;
  const defaultAgentUser = extractSourcedString(config2["default_agent_user"]) ?? "";
  const templateName = extractSourcedString(configField(config2, "agent_template"));
  const developerNamePlain = extractStringValue(config2["developer_name"]) ?? extractStringValue(config2["agent_name"]) ?? "";
  const agentLabelPlain = extractStringValue(config2["agent_label"]) ?? "";
  const label = deriveLabel(developerNamePlain, agentLabelPlain || void 0);
  const description = extractSourcedString(config2["agent_description"]) ?? extractSourcedString(config2["description"]) ?? label;
  const result = {
    developer_name: developerName,
    label,
    description,
    enable_enhanced_event_logs: enableEnhancedEventLogs,
    agent_type: agentType2,
    context_variables: contextVariables
  };
  const defaultAgentUserPlain = extractStringValue(config2["default_agent_user"]) ?? "";
  if (defaultAgentUserPlain) {
    result.default_agent_user = defaultAgentUser;
  }
  if (templateName !== void 0) {
    result.template_name = templateName;
  }
  ctx.setScriptPath(result, "config");
  return result;
}
function extractAdditionalParameters(config2, knowledgeBlock) {
  const params = {};
  let hasParams = false;
  const ADDITIONAL_PARAM_PREFIX = "additional_parameter__";
  if (config2) {
    for (const key of Object.keys(config2)) {
      if (key.startsWith(ADDITIONAL_PARAM_PREFIX)) {
        const paramName = key.slice(ADDITIONAL_PARAM_PREFIX.length);
        const raw = configField(config2, key);
        const boolVal = extractBooleanValue(raw);
        if (boolVal !== void 0) {
          params[paramName] = boolVal;
          hasParams = true;
          continue;
        }
        const numVal = extractNumberValue(raw);
        if (numVal !== void 0) {
          params[paramName] = numVal;
          hasParams = true;
          continue;
        }
        const strVal = extractStringValue(raw);
        if (strVal !== void 0) {
          params[paramName] = strVal;
          hasParams = true;
        }
      }
    }
    const debug = extractBooleanValue(config2["debug"]);
    if (debug !== void 0) {
      params.debug = debug;
      hasParams = true;
    }
    const maxTokens = extractNumberValue(config2["max_tokens"]);
    if (maxTokens !== void 0) {
      params.max_tokens = maxTokens;
      hasParams = true;
    }
    const temperature = extractNumberValue(config2["temperature"]);
    if (temperature !== void 0) {
      params.temperature = temperature;
      hasParams = true;
    }
  }
  if (knowledgeBlock) {
    const ragFeatureConfigId = extractStringValue(knowledgeBlock["rag_feature_config_id"]);
    if (ragFeatureConfigId) {
      params.rag_feature_config_id = ragFeatureConfigId;
      hasParams = true;
    }
  }
  return hasParams ? params : void 0;
}
function extractCompanyAndRole(config2) {
  if (!config2)
    return { company: null, role: null };
  const company = extractSourcedString(config2["company"]) ?? null;
  const role = extractSourcedString(config2["role"]) ?? null;
  return { company, role };
}

// ../compiler/dist/variables/variable-utils.js
var SCALAR_TO_STATE_VARIABLE_TYPE = {
  string: "string",
  text: "string",
  number: "number",
  boolean: "boolean",
  object: "object",
  date: "date",
  datetime: "timestamp",
  timestamp: "timestamp",
  currency: "currency",
  id: "string"
};
function toStateVariableDataType(scalarType) {
  return SCALAR_TO_STATE_VARIABLE_TYPE[scalarType.toLowerCase()];
}
var SCALAR_TO_CONTEXT_VARIABLE_TYPE = {
  string: "string",
  text: "string",
  number: "number",
  boolean: "boolean",
  date: "date",
  datetime: "timestamp",
  timestamp: "timestamp",
  currency: "currency",
  id: "id"
};
function toContextVariableDataType(scalarType) {
  return SCALAR_TO_CONTEXT_VARIABLE_TYPE[scalarType.toLowerCase()];
}
var SCALAR_TO_PARAMETER_DATA_TYPE = {
  string: "String",
  text: "String",
  number: "Double",
  integer: "Integer",
  long: "Long",
  boolean: "Boolean",
  object: "LightningTypes",
  date: "Date",
  datetime: "DateTime",
  timestamp: "DateTime",
  currency: "Double",
  id: "ID"
};
function toParameterDataType(scalarType) {
  return SCALAR_TO_PARAMETER_DATA_TYPE[scalarType.toLowerCase()];
}
function resolveParameterTypeInfo(scalarType, _isList, complexDataTypeName) {
  const baseType = toParameterDataType(scalarType);
  if (!baseType) {
    return {
      dataType: "String",
      complexDataTypeName: complexDataTypeName ?? null
    };
  }
  if (baseType === "LightningTypes" && complexDataTypeName) {
    if (complexDataTypeName.startsWith("@apexClassType/")) {
      const strippedName = complexDataTypeName.substring("@apexClassType/".length);
      return {
        dataType: "ApexDefined",
        complexDataTypeName: strippedName
      };
    }
    return {
      dataType: "LightningTypes",
      complexDataTypeName
    };
  }
  if (baseType === "LightningTypes") {
    return {
      dataType: "LightningTypes",
      complexDataTypeName: "lightning__objectType"
    };
  }
  return {
    dataType: baseType,
    complexDataTypeName: complexDataTypeName ?? null
  };
}
var STATE_VAR_TO_PARAMETER_TYPE = {
  string: "String",
  number: "Double",
  boolean: "Boolean",
  object: "LightningTypes",
  date: "Date",
  timestamp: "DateTime",
  currency: "Double",
  id: "ID"
};
function stateVarToParameterDataType(stateVarType) {
  return STATE_VAR_TO_PARAMETER_TYPE[stateVarType] ?? "String";
}
var STRING_TYPES = /* @__PURE__ */ new Set(["string", "date", "timestamp", "id"]);
function isStringType(dataType) {
  return STRING_TYPES.has(dataType.toLowerCase());
}

// ../compiler/dist/config/context-variables.js
function compileContextVariables(variables, ctx) {
  if (!variables)
    return [];
  const result = [];
  for (const [name, def] of iterateNamedMap(variables)) {
    if (def.modifier?.name !== "linked")
      continue;
    const contextVar = compileContextVariable(name, def, ctx);
    if (contextVar) {
      result.push(contextVar);
      ctx.linkedVariableNames.add(name);
    }
  }
  return result;
}
function compileContextVariable(name, def, ctx) {
  const typeStr = getExpressionName(def.type);
  if (!typeStr) {
    ctx.error(`Variable '${name}' is missing a type`, def.__cst?.range);
    return void 0;
  }
  const dataType = toContextVariableDataType(typeStr);
  if (!dataType) {
    ctx.error(`Unsupported context variable type: '${typeStr}' for variable '${name}'`, def.__cst?.range);
    return void 0;
  }
  const properties = def.properties;
  const source = extractSourceField(properties?.["source"]);
  const label = extractSourcedString(properties?.["label"]) ?? normalizeDeveloperName(name);
  const description = extractSourcedDescription(properties?.["description"]) ?? name.replace(/(?:^|_)\w/g, (c) => c.toUpperCase());
  const contextVar = {
    developer_name: name,
    label,
    description,
    data_type: dataType
  };
  if (source) {
    contextVar.field_mapping = sourced(source, getCstRange(properties?.["source"]));
  }
  return contextVar;
}
function extractSourceField(value) {
  if (!value)
    return void 0;
  const str = extractStringValue(value);
  if (str)
    return str;
  if (value instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(value);
    if (decomposed) {
      return `${decomposed.namespace}.${decomposed.property}`;
    }
  }
  if (typeof value === "object") {
    const obj = value;
    if ("text" in obj && typeof obj.text === "string")
      return obj.text;
    if ("source" in obj && typeof obj.source === "string")
      return obj.source;
  }
  return void 0;
}

// ../compiler/dist/config/compile-security.js
function compileSecurity(securityBlock, ctx) {
  if (!securityBlock)
    return void 0;
  const result = {};
  if (securityBlock.verified_customer_record_access) {
    const vcra = securityBlock.verified_customer_record_access;
    const useDefault = extractBooleanValue(vcra.use_default_objects);
    if (useDefault === void 0) {
      ctx.error("verified_customer_record_access requires use_default_objects to be set to True or False", getCstRange(vcra));
    } else {
      result.verified_customer_record_access = {
        use_default_objects: useDefault
      };
      if (vcra.additional_objects) {
        const additionalObjects = extractObjectList(vcra.additional_objects, ctx);
        if (additionalObjects && additionalObjects.length > 0) {
          result.verified_customer_record_access.additional_objects = additionalObjects;
        }
      }
    }
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
function extractObjectList(sequence, ctx) {
  if (!sequence || sequence.__kind !== "Sequence")
    return void 0;
  const items = [];
  for (const item of sequence.items) {
    if (item.__kind === "StringLiteral") {
      const value = extractStringValue(item);
      if (value) {
        items.push(value);
      } else {
        ctx.error("Empty string in security object list", item.__cst?.range);
      }
    } else if (item instanceof MemberExpression) {
      const serialized = serializeMemberExpression(item);
      if (serialized) {
        items.push(serialized);
      } else {
        ctx.error("Failed to resolve member expression in security object list", item.__cst?.range);
      }
    } else {
      ctx.error(`Unsupported expression type in security object list: ${item.__kind}`, item.__cst?.range);
    }
  }
  return items.length > 0 ? items : void 0;
}
function serializeMemberExpression(expr) {
  if (expr instanceof MemberExpression) {
    const objectPart = serializeMemberExpression(expr.object);
    if (objectPart) {
      return `${objectPart}.${expr.property}`;
    }
    if (expr.object instanceof Identifier) {
      return `${expr.object.name}.${expr.property}`;
    }
    return void 0;
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  return void 0;
}

// ../compiler/dist/variables/state-variables.js
function compileStateVariables(variables, contextVariables, _blocks, ctx) {
  const result = [];
  for (const sv of ALWAYS_PRESENT_STATE_VARIABLES) {
    result.push({ ...sv });
  }
  result.push({ ...INSTRUCTION_STATE_VARIABLE });
  result.push({ ...CONDITION_STATE_VARIABLE });
  if (variables) {
    const contextVarNames = new Set(contextVariables.map((v) => v.developer_name));
    const internalNames = new Set(result.map((v) => v.developer_name));
    for (const [name, def] of iterateNamedMap(variables)) {
      if (def.modifier?.name === "linked")
        continue;
      if (contextVarNames.has(name) || internalNames.has(name))
        continue;
      const stateVar = compileStateVariable(name, def, ctx);
      if (stateVar) {
        result.push(stateVar);
        ctx.mutableVariableNames.add(name);
      }
    }
  }
  return result;
}
function compileStateVariable(name, def, ctx) {
  if (name.startsWith("_") || name.endsWith("_")) {
    ctx.warning(`Variable name '${name}' should not start or end with underscores`, def.__cst?.range);
  }
  if (name.includes("__")) {
    ctx.error(`Variable name '${name}' should not contain double underscores`, def.__cst?.range);
    return void 0;
  }
  const typeStr = getExpressionName(def.type);
  if (!typeStr) {
    ctx.error(`Variable '${name}' is missing a type`, def.__cst?.range);
    return void 0;
  }
  const dataType = toStateVariableDataType(typeStr);
  if (!dataType) {
    ctx.error(`Unsupported state variable type: '${typeStr}' for variable '${name}'`, def.__cst?.range);
    return void 0;
  }
  const isList = isListType(def.type);
  const defaultValue = extractDefaultValue(def.defaultValue, dataType, isList);
  const label = extractSourcedString(def.properties?.["label"]) ?? normalizeDeveloperName(name);
  const description = extractSourcedDescription(def.properties?.["description"]) ?? label;
  const rawVisibility = extractStringValue(def.properties?.["visibility"]);
  const visibility = mapVisibility(rawVisibility, name, ctx, def.__cst?.range);
  const stateVar = {
    developer_name: name,
    label,
    description,
    data_type: dataType,
    is_list: isList,
    visibility
  };
  if (defaultValue !== null) {
    stateVar.default = defaultValue;
  }
  return stateVar;
}
function mapVisibility(value, variableName, ctx, range) {
  if (!value)
    return "Internal";
  const normalized = value.trim().toLowerCase();
  if (normalized === "private" || normalized === "internal") {
    return "Internal";
  }
  if (normalized === "public" || normalized === "external") {
    return "External";
  }
  ctx.warning(`Unknown visibility "${value}" on variable '${variableName}'. Expected public/private (or External/Internal); defaulting to Internal.`, range);
  return "Internal";
}
function extractDefaultValue(defaultVal, dataType, isList) {
  if (defaultVal === void 0 || defaultVal === null)
    return null;
  if (defaultVal instanceof NoneLiteral) {
    return null;
  }
  if (isList) {
    if (defaultVal.__kind !== "ListLiteral")
      return null;
    const raw = extractExpressionValue(defaultVal);
    if (!Array.isArray(raw))
      return [];
    return raw;
  }
  if (dataType === "object") {
    if (defaultVal.__kind !== "DictLiteral")
      return {};
    const raw = extractExpressionValue(defaultVal);
    return raw ?? {};
  }
  const strVal = extractStringValue(defaultVal);
  if (strVal !== void 0) {
    if (isStringType(dataType)) {
      return `'${strVal}'`;
    }
    return strVal;
  }
  const numVal = extractNumberValue(defaultVal);
  if (numVal !== void 0)
    return numVal;
  const boolVal = extractBooleanValue(defaultVal);
  if (boolVal !== void 0)
    return boolVal;
  return null;
}

// ../compiler/dist/expressions/compile-expression.js
function compileExpression(expr, ctx, options = {}) {
  let compiled = compileExprNode(expr, ctx, options);
  compiled = compiled.replace(/@variables\.(\w+)/g, (_, varName) => {
    const ns = ctx.getVariableNamespace(varName);
    if (ns === "context")
      return `variables.${varName}`;
    if (ns === "state")
      return `state.${varName}`;
    ctx.warning(`Variable '${varName}' not found in known variables, defaulting to state namespace`, expr.__cst?.range);
    return `state.${varName}`;
  });
  return compiled;
}
function compileExprNode(expr, ctx, opts) {
  if (expr instanceof MemberExpression) {
    return compileMemberExpression(expr, ctx, opts);
  }
  if (expr instanceof AtIdentifier) {
    return compileAtIdentifier(expr, ctx);
  }
  if (expr instanceof SubscriptExpression) {
    return compileSubscriptExpression(expr, ctx, opts);
  }
  if (expr instanceof BinaryExpression) {
    return compileBinaryExpression(expr, ctx, opts);
  }
  if (expr instanceof UnaryExpression) {
    return compileUnaryExpression(expr, ctx, opts);
  }
  if (expr instanceof ComparisonExpression) {
    return compileComparisonExpression(expr, ctx, opts);
  }
  if (expr instanceof TernaryExpression) {
    return compileTernaryExpression(expr, ctx, opts);
  }
  if (expr instanceof CallExpression) {
    return compileCallExpression(expr, ctx, opts);
  }
  if (expr instanceof StringLiteral) {
    const escaped = expr.value.replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  if (expr instanceof NumberLiteral) {
    return String(expr.value);
  }
  if (expr instanceof BooleanLiteral) {
    return expr.value ? "True" : "False";
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  if (expr instanceof TemplateExpression) {
    return compileTemplateExpression(expr, ctx, opts);
  }
  if (expr instanceof Ellipsis) {
    return "...";
  }
  if (expr instanceof SpreadExpression) {
    return `*${compileExprNode(expr.expression, ctx, opts)}`;
  }
  if (expr instanceof NoneLiteral) {
    return "None";
  }
  ctx.error(`Unsupported expression kind: ${expr.__kind}`, expr.__cst?.range);
  return "";
}
function compileMemberExpression(expr, ctx, opts) {
  const decomposed = decomposeAtMemberExpression(expr);
  if (decomposed) {
    const { namespace, property } = decomposed;
    switch (namespace) {
      case "variables": {
        if (opts.isSystemMessage) {
          return `$Context.${property}`;
        }
        const ns = ctx.getVariableNamespace(property);
        if (ns === "context")
          return `variables.${property}`;
        if (ns === "state")
          return `state.${property}`;
        ctx.warning(`Variable '${property}' not found in known variables, defaulting to state namespace`, expr.__cst?.range);
        return `state.${property}`;
      }
      case "outputs":
        return `result.${property}`;
      case "actions": {
        if (!opts.allowActionReferences) {
          const where = opts.expressionContext ? ` in a ${opts.expressionContext}` : "";
          ctx.error(`@${namespace}.${property} cannot be used${where}. Use @${namespace} references inside instruction templates instead (e.g. | text {!@${namespace}.${property}}).`, expr.__cst?.range);
        }
        const toolKey = ctx.actionReferenceMap.get(property) ?? property;
        return `action.${toolKey}`;
      }
      case "system_variables": {
        if (property === "user_input") {
          return "state.__user_input__";
        }
        ctx.error(`Unknown system variable: ${property}`, expr.__cst?.range);
        return `state.${property}`;
      }
      case "knowledge": {
        const value = ctx.knowledgeFields.get(property);
        if (value !== void 0) {
          if (typeof value === "boolean") {
            return value ? "True" : "False";
          }
          return value;
        }
        ctx.error(`Unknown @knowledge field: '${property}'`, expr.__cst?.range);
        return "";
      }
      case "topic":
      case "subagent": {
        ctx.error(`@${namespace} cannot be referenced in LLM instructions; use transitions to switch between @${namespace}`, expr.__cst?.range);
        return "";
      }
      default: {
        const obj2 = compileExprNode(expr.object, ctx, opts);
        return `${obj2}.${property}`;
      }
    }
  }
  const obj = compileExprNode(expr.object, ctx, opts);
  if (expr.property === "length") {
    return `len(${obj})`;
  }
  return `${obj}.${expr.property}`;
}
function compileAtIdentifier(expr, ctx) {
  ctx.error(`Bare @${expr.name} reference requires a property (e.g., @${expr.name}.property)`, expr.__cst?.range);
  return `@${expr.name}`;
}
function compileSubscriptExpression(expr, ctx, opts) {
  if (expr.object instanceof AtIdentifier && expr.object.name === "outputs") {
    const index2 = compileExprNode(expr.index, ctx, opts);
    return `result[${index2}]`;
  }
  if (expr.object instanceof AtIdentifier && expr.object.name === "system_variables") {
    const index2 = compileExprNode(expr.index, ctx, opts);
    if (index2 === '"user_input"') {
      return 'state["__user_input__"]';
    }
    ctx.error(`Unknown system variable: ${index2}`, expr.__cst?.range);
    return `state[${index2}]`;
  }
  const obj = compileExprNode(expr.object, ctx, opts);
  const index = compileExprNode(expr.index, ctx, opts);
  return `${obj}[${index}]`;
}
function compileBinaryExpression(expr, ctx, opts) {
  const left = compileExprNode(expr.left, ctx, opts);
  const right = compileExprNode(expr.right, ctx, opts);
  const rightCst = expr.right.__cst?.node;
  const rightParenthesized = rightCst?.parent?.type === "parenthesized_expression" || rightCst?.parent?.parent?.type === "parenthesized_expression";
  if (rightParenthesized) {
    return `${left} ${expr.operator} (${right})`;
  }
  const leftCst = expr.left.__cst?.node;
  const leftParenthesized = leftCst?.parent?.type === "parenthesized_expression" || leftCst?.parent?.parent?.type === "parenthesized_expression";
  if (leftParenthesized) {
    return `(${left}) ${expr.operator} ${right}`;
  }
  return `${left} ${expr.operator} ${right}`;
}
function compileUnaryExpression(expr, ctx, opts) {
  const operand = compileExprNode(expr.operand, ctx, opts);
  if (expr.operator === "not") {
    return `not ${operand}`;
  }
  return `${expr.operator}${operand}`;
}
function compileComparisonExpression(expr, ctx, opts) {
  const left = compileExprNode(expr.left, ctx, opts);
  const right = compileExprNode(expr.right, ctx, opts);
  const cstText = expr.__cst?.node?.text;
  if (cstText) {
    const leftCst = expr.left.__cst?.node?.text;
    const rightCst = expr.right.__cst?.node?.text;
    if (leftCst && rightCst) {
      const leftEnd = cstText.indexOf(leftCst) + leftCst.length;
      const rightStart = cstText.lastIndexOf(rightCst);
      if (leftEnd >= 0 && rightStart > leftEnd) {
        const operatorWithSpace = cstText.slice(leftEnd, rightStart);
        return `${left}${operatorWithSpace}${right}`;
      }
    }
  }
  return `${left} ${expr.operator} ${right}`;
}
function compileTernaryExpression(expr, ctx, opts) {
  const consequence = compileExprNode(expr.consequence, ctx, opts);
  const condition = compileExprNode(expr.condition, ctx, opts);
  const alternative = compileExprNode(expr.alternative, ctx, opts);
  return `${consequence} if ${condition} else ${alternative}`;
}
function compileCallExpression(expr, ctx, opts) {
  const func = compileExprNode(expr.func, ctx, opts);
  const args = expr.args.map((a) => compileExprNode(a, ctx, opts)).join(", ");
  return `${func}(${args})`;
}
function compileTemplateExpression(expr, ctx, opts) {
  return expr.parts.map((part) => compileTemplatePart(part, ctx, opts)).join("");
}
function compileTemplatePart(part, ctx, opts) {
  if (part instanceof TemplateText) {
    return part.value;
  }
  if (part instanceof TemplateInterpolation) {
    const compiled = compileExprNode(part.expression, ctx, opts);
    if (opts.isSystemMessage) {
      return `{!${compiled}}`;
    }
    return `{{${compiled}}}`;
  }
  return "";
}

// ../compiler/dist/expressions/compile-template.js
function compileTemplate(parts, ctx, opts = {}) {
  return parts.map((part) => {
    const kind = part.__kind;
    if (part instanceof TemplateText || kind === "TemplateText") {
      return part.value;
    }
    if (part instanceof TemplateInterpolation || kind === "TemplateInterpolation") {
      const compiled = compileExpression(part.expression, ctx, opts);
      if (opts.isSystemMessage) {
        return `{!${compiled}}`;
      }
      if (compiled.startsWith("action.")) {
        return compiled;
      }
      return `{{${compiled}}}`;
    }
    return "";
  }).join("");
}
function compileTemplateValue(value, ctx, opts = {}) {
  if (typeof value === "string")
    return value;
  if (!value || typeof value !== "object")
    return "";
  const kind = value.__kind;
  if (value instanceof ProcedureValue || kind === "ProcedureValue") {
    const stmts = value.statements;
    if (stmts?.length > 0) {
      return stmts.map((stmt) => compileTemplateValue(stmt, ctx, opts)).filter(Boolean).join("\n");
    }
  }
  if (value instanceof Template || value instanceof TemplateExpression || kind === "Template" || kind === "TemplateExpression") {
    return compileTemplate(value.parts, ctx, opts);
  }
  if ("content" in value) {
    const c = value.content;
    if (typeof c === "string")
      return c;
  }
  if ("value" in value) {
    const v = value.value;
    if (typeof v === "string")
      return v;
  }
  return "";
}

// ../compiler/dist/system-messages/compile-system-messages.js
function compileSystemMessages(systemBlock, ctx) {
  if (!systemBlock)
    return [];
  const messages = systemBlock.messages;
  if (!messages)
    return [];
  const result = [];
  const welcome = messages.welcome;
  if (welcome) {
    const msg = compileMessageValue(welcome, ctx);
    if (msg !== void 0) {
      const systemMsg = {
        message: msg,
        message_type: "Welcome"
      };
      result.push(systemMsg);
    }
  }
  const error = messages.error;
  if (error) {
    const msg = compileMessageValue(error, ctx);
    if (msg !== void 0) {
      const systemMsg = {
        message: msg,
        message_type: "Error"
      };
      result.push(systemMsg);
    }
  }
  return result;
}
function serializeSystemMessagesForAdditionalParams(systemMessages) {
  if (systemMessages.length === 0)
    return void 0;
  const jsonArr = systemMessages.map((m) => ({
    message: m.message,
    messageType: m.message_type
  }));
  const parts = jsonArr.map((m) => {
    const msgEsc = JSON.stringify(m.message);
    const typeEsc = JSON.stringify(m.messageType);
    return `{"message": ${msgEsc}, "messageType": ${typeEsc}}`;
  });
  return `[${parts.join(", ")}]`;
}
function compileMessageValue(value, ctx) {
  if (value && typeof value === "object" && "parts" in value) {
    const parts = value.parts;
    return compileTemplate(parts, ctx, { isSystemMessage: true });
  }
  const str = extractSourcedString(value);
  if (str !== void 0)
    return str;
  return void 0;
}

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/core.js
var NEVER = Object.freeze({
  status: "aborted"
});
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init2(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: /* @__PURE__ */ new Set()
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a3;
    const inst = params?.Parent ? new Definition() : this;
    init2(inst, def);
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init2 });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
var globalConfig = {};
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  base64ToUint8Array: () => base64ToUint8Array2,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepString = step.toString();
  let stepDecCount = (stepString.split(".")[1] || "").length;
  if (stepDecCount === 0 && /\d?e-\d?/.test(stepString)) {
    const match = stepString.match(/\d?e-(\d?)/);
    if (match?.[1]) {
      stepDecCount = Number.parseInt(match[1]);
    }
  }
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var EVALUATING = Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema2) {
  return mergeDefs(schema2._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars2 = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars2[Math.floor(Math.random() * chars2.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = cached(() => {
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema2, mask) {
  const currDef = schema2._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema2._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema2, def);
}
function omit(schema2, mask) {
  const currDef = schema2._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema2._zod.def, {
    get shape() {
      const newShape = { ...schema2._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema2, def);
}
function extend(schema2, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema2._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema2._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema2._zod.def, {
    get shape() {
      const _shape = { ...schema2._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema2, def);
}
function safeExtend(schema2, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema2._zod.def, {
    get shape() {
      const _shape = { ...schema2._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema2, def);
}
function merge(a, b) {
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: []
    // delete existing checks
  });
  return clone(a, def);
}
function partial(Class2, schema2, mask) {
  const currDef = schema2._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema2._zod.def, {
    get shape() {
      const oldShape = schema2._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema2, def);
}
function required(Class2, schema2, mask) {
  const def = mergeDefs(schema2._zod.def, {
    get shape() {
      const oldShape = schema2._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema2, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array2(base642) {
  const binaryString = atob(base642);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url2) {
  const base642 = base64url2.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base642.length % 4) % 4);
  return base64ToUint8Array2(base642 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error2) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema2, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema2, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema2, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema2, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema2._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema2, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _parse(_Err)(schema2, value, ctx);
};
var _decode = (_Err) => (schema2, value, _ctx) => {
  return _parse(_Err)(schema2, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema2, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _parseAsync(_Err)(schema2, value, ctx);
};
var _decodeAsync = (_Err) => async (schema2, value, _ctx) => {
  return _parseAsync(_Err)(schema2, value, _ctx);
};
var _safeEncode = (_Err) => (schema2, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _safeParse(_Err)(schema2, value, ctx);
};
var _safeDecode = (_Err) => (schema2, value, _ctx) => {
  return _safeParse(_Err)(schema2, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema2, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _safeParseAsync(_Err)(schema2, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema2, value, _ctx) => {
  return _safeParseAsync(_Err)(schema2, value, _ctx);
};

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][^\s-]{8,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time3 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time3}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a3;
    (_a3 = inst2._zod.bag).multipleOf ?? (_a3.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
};

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 3,
  patch: 6
};

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error();
      const [address, prefix2] = parts;
      if (!prefix2)
        throw new Error();
      const prefixNum = Number(prefix2);
      if (`${prefixNum}` !== prefix2)
        throw new Error();
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalOut) {
  if (result.issues.length) {
    if (isOptionalOut && !(key in input)) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (result.value === void 0) {
    if (key in input) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema2 = shape[key];
      const isOptionalOut = schema2?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const single = def.options.length === 1;
  const first = def.options[0]._zod.run;
  inst._zod.parse = (payload, ctx) => {
    if (single) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[key] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[key] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (result.issues.length && input === void 0) {
    return { issues: [], value: void 0 };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, payload.value));
      return handleOptionalResult(result, payload.value);
    }
    if (payload.value === void 0) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema2, ..._meta) {
    const meta2 = _meta[0];
    this._map.set(schema2, meta2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.set(meta2.id, schema2);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema2) {
    const meta2 = this._map.get(schema2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.delete(meta2.id);
    }
    this._map.delete(schema2);
    return this;
  }
  get(schema2) {
    const p = schema2._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema2) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema2);
  }
  has(schema2) {
    return this._map.has(schema2);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix2, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix: prefix2
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema2 = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema2;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? void 0
  };
}
function process2(schema2, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema2._zod.def;
  const seen = ctx.seen.get(schema2);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema2);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema2, result);
  const overrideSchema = schema2._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema2],
      path: _params.path
    };
    if (schema2._zod.processJSONSchema) {
      schema2._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema2, ctx, _json, params);
    }
    const parent = schema2._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta2 = ctx.metadataRegistry.get(schema2);
  if (meta2)
    Object.assign(result.schema, meta2);
  if (ctx.io === "input" && isTransforming(schema2)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && result.schema._prefault)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema2);
  return _result.schema;
}
function extractDefs(ctx, schema2) {
  const root = ctx.seen.get(schema2);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema3 = seen.schema;
    for (const key in schema3) {
      delete schema3[key];
    }
    schema3.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema2 === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema2 !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema2) {
  const root = ctx.seen.get(schema2);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema3 = seen.def ?? seen.schema;
    const _cached = { ...schema3 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema3.allOf = schema3.allOf ?? [];
        schema3.allOf.push(refSchema);
      } else {
        Object.assign(schema3, refSchema);
      }
      Object.assign(schema3, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema3) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema3[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema3) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema3[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema3[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema3.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema3) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema3[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema3[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema3,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema2)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema2["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema2, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema2, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema2, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema2, ctx);
  extractDefs(ctx, schema2);
  return finalize(ctx, schema2);
};
var createStandardJSONSchemaMethod = (schema2, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema2, ctx);
  extractDefs(ctx, schema2);
  return finalize(ctx, schema2);
};

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var stringProcessor = (schema2, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema2._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema2, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema2._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  if (typeof exclusiveMinimum === "number") {
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  }
  if (typeof minimum === "number") {
    json.minimum = minimum;
    if (typeof exclusiveMinimum === "number" && ctx.target !== "draft-04") {
      if (exclusiveMinimum >= minimum)
        delete json.minimum;
      else
        delete json.exclusiveMinimum;
    }
  }
  if (typeof exclusiveMaximum === "number") {
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  }
  if (typeof maximum === "number") {
    json.maximum = maximum;
    if (typeof exclusiveMaximum === "number" && ctx.target !== "draft-04") {
      if (exclusiveMaximum <= maximum)
        delete json.maximum;
      else
        delete json.exclusiveMaximum;
    }
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var enumProcessor = (schema2, _ctx, json, _params) => {
  const def = schema2._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema2, ctx, json, _params) => {
  const def = schema2._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      } else {
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
  } else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const def = schema2._zod.def;
  const { minimum, maximum } = schema2._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, { ...params, path: [...params.path, "items"] });
};
var objectProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const def = schema2._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === void 0;
    } else {
      return v.optout === void 0;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var recordProcessor = (schema2, ctx, _json, params) => {
  const json = _json;
  const def = schema2._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      json.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = process2(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json.additionalProperties = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema2, ctx, _json, params) => {
  const def = schema2._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema2, ctx, _json, params) => {
  const def = schema2._zod.def;
  const innerType = ctx.io === "input" ? def.in._zod.def.type === "transform" ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = innerType;
};
var readonlyProcessor = (schema2, ctx, json, params) => {
  const def = schema2._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema2, ctx, _json, params) => {
  const def = schema2._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema2);
  seen.ref = def.innerType;
};

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
      // enumerable: false,
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
      // enumerable: false,
    },
    addIssue: {
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
      // enumerable: false,
    }
  });
};
var ZodError = $constructor("ZodError", initializer2);
var ZodRealError = $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/classic/parse.js
var parse5 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4/classic/schemas.js
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks) => {
    return inst.clone(util_exports.mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), {
      parent: true
    });
  };
  inst.with = inst.check;
  inst.clone = (def2, params) => clone(inst, def2, params);
  inst.brand = () => inst;
  inst.register = (reg, meta2) => {
    reg.add(inst, meta2);
    return inst;
  };
  inst.parse = (data, params) => parse5(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  inst.refine = (check, params) => inst.check(refine(check, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.exactOptional = () => exactOptional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union2([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def2) => _default(inst, def2);
  inst.prefault = (def2) => prefault(inst, def2);
  inst.catch = (params) => _catch(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(void 0).success;
  inst.isNullable = () => inst.safeParse(null).success;
  inst.apply = (fn) => fn(inst);
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  inst.regex = (...args) => inst.check(_regex(...args));
  inst.includes = (...args) => inst.check(_includes(...args));
  inst.startsWith = (...args) => inst.check(_startsWith(...args));
  inst.endsWith = (...args) => inst.check(_endsWith(...args));
  inst.min = (...args) => inst.check(_minLength(...args));
  inst.max = (...args) => inst.check(_maxLength(...args));
  inst.length = (...args) => inst.check(_length(...args));
  inst.nonempty = (...args) => inst.check(_minLength(1, ...args));
  inst.lowercase = (params) => inst.check(_lowercase(params));
  inst.uppercase = (params) => inst.check(_uppercase(params));
  inst.trim = () => inst.check(_trim());
  inst.normalize = (...args) => inst.check(_normalize(...args));
  inst.toLowerCase = () => inst.check(_toLowerCase());
  inst.toUpperCase = () => inst.check(_toUpperCase());
  inst.slugify = () => inst.check(_slugify());
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.int = (params) => inst.check(int(params));
  inst.safe = (params) => inst.check(int(params));
  inst.positive = (params) => inst.check(_gt(0, params));
  inst.nonnegative = (params) => inst.check(_gte(0, params));
  inst.negative = (params) => inst.check(_lt(0, params));
  inst.nonpositive = (params) => inst.check(_lte(0, params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  inst.step = (value, params) => inst.check(_multipleOf(value, params));
  inst.finite = () => inst;
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  util_exports.defineLazy(inst, "shape", () => {
    return def.shape;
  });
  inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
  inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
  inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
  inst.strip = () => inst.clone({ ...inst._zod.def, catchall: void 0 });
  inst.extend = (incoming) => {
    return util_exports.extend(inst, incoming);
  };
  inst.safeExtend = (incoming) => {
    return util_exports.safeExtend(inst, incoming);
  };
  inst.merge = (other) => util_exports.merge(inst, other);
  inst.pick = (mask) => util_exports.pick(inst, mask);
  inst.omit = (mask) => util_exports.omit(inst, mask);
  inst.partial = (...args) => util_exports.partial(ZodOptional, inst, args[0]);
  inst.required = (...args) => util_exports.required(ZodNonOptional, inst, args[0]);
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union2(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  return _superRefine(fn);
}

// ../compiler/dist/generated/agent-dsl.js
var agentType = _enum([
  "EinsteinServiceAgent",
  "AgentforceEmployeeAgent",
  "SalesEinsteinCoach"
]);
var beepBoopConfig = object({
  max_wait_time_ms: int().gte(500).lte(6e4).nullish()
});
var contextVariableType = _enum([
  "boolean",
  "number",
  "string",
  "date",
  "timestamp",
  "currency",
  "id"
]);
var contextVariable = object({
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*$/),
  label: string2(),
  description: string2().optional(),
  data_type: contextVariableType,
  field_mapping: string2().regex(/.+\..+/).nullish()
});
var endpointingConfig = object({
  max_wait_time_ms: int().gte(500).lte(6e4).nullish()
});
var inboundKeywords = object({
  keywords: array(string2())
});
var memoryConfiguration = object({
  enabled: boolean2()
});
var contextConfiguration = object({
  memory: memoryConfiguration.nullish()
});
var messageType = _enum(["Welcome", "Error", "Escalation"]);
var modelConfig = object({
  model_ref: string2().nullish(),
  configuration: record(string2(), unknown()).nullish()
});
var nodeReference = object({
  name: string2(),
  target: string2(),
  enabled: unknown().optional(),
  description: string2().nullish(),
  state_updates: array(record(string2(), unknown())).nullish()
});
var outboundFillerSentences = object({
  filler_sentences: record(string2(), array(string2()))
});
var outboundRouteType = _enum(["OmniChannelFlow"]);
var outboundRouteConfig = object({
  escalation_message: string2().nullish(),
  outbound_route_type: outboundRouteType.optional().default("OmniChannelFlow"),
  outbound_route_name: string2()
});
var parameterDataType = _enum([
  "String",
  "Boolean",
  "DateTime",
  "Double",
  "ID",
  "Integer",
  "Long",
  "Date",
  "Time",
  "SObject",
  "ApexDefined",
  "LightningTypes"
]);
var inputParameter = object({
  developer_name: string2(),
  label: string2(),
  description: string2().nullish(),
  data_type: parameterDataType,
  complex_data_type_name: string2().nullish(),
  is_list: boolean2().nullish(),
  required: boolean2().nullish(),
  is_user_input: boolean2().nullish(),
  constant_value: unknown().optional()
});
var outputParameter = object({
  developer_name: string2(),
  label: string2(),
  description: string2().nullish(),
  data_type: parameterDataType,
  complex_data_type_name: string2().nullish(),
  is_list: boolean2().nullish(),
  is_used_by_planner: boolean2().nullish(),
  is_displayable: boolean2().nullish()
});
var actionConfiguration = object({
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*(__(_?[A-Za-z0-9])*)?$/),
  source: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*(__(_?[A-Za-z0-9])*)?$/).nullish(),
  label: string2(),
  description: string2(),
  require_user_confirmation: boolean2().optional().default(false),
  include_in_progress_indicator: boolean2().optional().default(true),
  progress_indicator_message: string2().nullish(),
  invocation_target_type: string2(),
  invocation_target_name: string2(),
  input_type: array(inputParameter).optional().default([]),
  output_type: array(outputParameter).optional().default([])
});
var plannerType = _enum([
  "AiCopilot__ReAct",
  "Atlas__ConcurrentMultiAgentOrchestration",
  "Atlas__VoiceAgent",
  "SentOS__SearchAgent"
]);
var pronunciationType = _enum(["IPA", "CMU"]);
var pronunciationEntry = object({
  grapheme: string2(),
  phoneme: string2(),
  type: pronunciationType
});
var pronunciationDict = object({
  pronunciations: array(pronunciationEntry)
});
var retrieverConfiguration = object({
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*(__(_?[A-Za-z0-9])*)?$/),
  fully_qualified_name: string2(),
  namespace: string2().nullish(),
  dataspace: string2().nullish(),
  grounding_source_type: string2().nullish(),
  external_source: string2().nullish()
});
var adlConfiguration = object({
  ai_ground_library_label: string2(),
  ai_grounding_library_id: string2(),
  ai_grounding_library_name: string2(),
  ai_grounding_library_namespace: string2().nullish(),
  ai_grounding_library_fully_qualified_name: string2(),
  referenced_retrievers: array(retrieverConfiguration).nullish()
});
var knowledgeConfiguration = object({
  rag_feature_id: string2(),
  rag_feature_name: string2(),
  rag_feature_namespace: string2().nullish(),
  rag_feature_fully_qualified_name: string2(),
  adl_configuration: adlConfiguration
});
var speakUpConfig = object({
  speak_up_first_wait_time_ms: int().gte(1e4).lte(3e5).nullish(),
  speak_up_follow_up_wait_time_ms: int().gte(1e4).lte(3e5).nullish(),
  speak_up_message: string2().nullish()
});
var additionalVoiceConfigs = object({
  speak_up_config: speakUpConfig.nullish(),
  endpointing_config: endpointingConfig.nullish(),
  beepboop_config: beepBoopConfig.nullish()
});
var stateVariableType = _enum([
  "boolean",
  "number",
  "string",
  "date",
  "timestamp",
  "currency",
  "id",
  "object"
]);
var supportedLocale = _enum([
  "en_US",
  "en_GB",
  "en_AU",
  "fr",
  "fr_CA",
  "it",
  "de",
  "es",
  "es_MX",
  "ca",
  "nl_NL",
  "da",
  "no",
  "sv",
  "fi",
  "ja",
  "zh_CN",
  "zh_TW",
  "ko",
  "hi",
  "in",
  "id",
  "tl",
  "th",
  "vi",
  "ms",
  "pt_PT",
  "pt_BR",
  "iw",
  "he",
  "ar",
  "tr",
  "bg",
  "hr",
  "cs",
  "et",
  "el",
  "hu",
  "pl",
  "ro"
]);
var languageConfiguration = object({
  default_locale: supportedLocale.nullish(),
  additional_locales: array(supportedLocale).nullish(),
  all_additional_locales: boolean2().nullish()
});
var surface = object({
  surface_type: string2(),
  adaptive_response_allowed: boolean2().nullish(),
  outbound_route_configs: array(outboundRouteConfig).nullish()
});
var systemMessage = object({
  message: string2().nullish(),
  message_type: messageType.nullish()
});
var verifiedCustomerRecordAccessConfig = object({
  use_default_objects: boolean2(),
  additional_objects: array(string2()).nullish()
});
var securityConfiguration = object({
  verified_customer_record_access: verifiedCustomerRecordAccessConfig.nullish()
});
var globalAgentConfiguration = object({
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*$/),
  label: string2(),
  description: string2().nullish(),
  enable_enhanced_event_logs: boolean2().optional().default(false),
  agent_type: agentType,
  template_name: string2().nullish(),
  default_agent_user: string2().nullish(),
  default_outbound_routing: string2().nullish(),
  context_variables: array(contextVariable).nullish(),
  security: securityConfiguration.nullish()
});
var visibilityType = _enum(["Internal", "External"]);
var stateVariable = object({
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*$/),
  label: string2(),
  description: string2().optional(),
  data_type: stateVariableType,
  is_list: boolean2().optional().default(false),
  default: unknown().optional(),
  visibility: visibilityType.optional().default("Internal")
});
var voiceConfiguration = object({
  inbound_filler_words_detection: boolean2().nullish(),
  inbound_keywords: inboundKeywords.nullish(),
  voice_id: string2().nullish(),
  outbound_speed: number2().gte(0.5).lte(2).nullish(),
  outbound_style_exaggeration: number2().gte(0).lte(1).nullish(),
  outbound_filler_sentences: array(outboundFillerSentences).nullish(),
  outbound_stability: number2().nullish(),
  outbound_similarity: number2().nullish(),
  pronunciation_dict: pronunciationDict.nullish(),
  additional_configs: additionalVoiceConfigs.nullish()
});
var modalityParameters = object({
  voice: voiceConfiguration.nullish(),
  language: languageConfiguration.nullish()
});
var relatedAgentOrRouterOrSubagentTypeEnum = _enum([
  "related_agent",
  "router",
  "subagent"
]);
var actionOrHandoffTypeEnum = _enum(["action", "handoff"]);
var action = object({
  type: actionOrHandoffTypeEnum.optional().default("action"),
  target: string2(),
  bound_inputs: record(string2(), unknown()).nullish(),
  llm_inputs: array(string2()).nullish(),
  enabled: unknown().optional(),
  state_updates: array(record(string2(), unknown())).nullish()
});
var handOffAction = object({
  type: actionOrHandoffTypeEnum.optional().default("handoff"),
  target: string2(),
  enabled: unknown().optional(),
  state_updates: array(record(string2(), unknown())).nullish()
});
var postToolCall = object({
  target: string2(),
  actions: array(action)
});
var preToolCall = object({
  target: string2(),
  actions: array(action)
});
var actionOrHandoff = intersection(union2([
  object({
    type: literal("action")
  }).and(action),
  object({
    type: literal("handoff")
  }).and(handOffAction)
]), object({
  type: actionOrHandoffTypeEnum.optional()
}));
var relatedAgentNode = object({
  type: relatedAgentOrRouterOrSubagentTypeEnum.optional().default("related_agent"),
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*(__(_?[A-Za-z0-9])*)?$/),
  label: string2().nullish(),
  description: string2().nullish(),
  invocation_target_type: string2().nullish().default("agentforce"),
  invocation_target_name: string2().nullish(),
  loading_text: string2().nullish(),
  bound_inputs: record(string2(), unknown()).nullish(),
  on_init: array(actionOrHandoff).nullish(),
  on_exit: array(action).nullish(),
  action_definitions: array(actionConfiguration).nullish()
});
var routerNode = object({
  model_configuration: modelConfig.nullish(),
  before_reasoning_iteration: array(actionOrHandoff).nullish(),
  instructions: string2().nullish(),
  type: relatedAgentOrRouterOrSubagentTypeEnum.optional().default("router"),
  description: string2().nullish(),
  tools: array(nodeReference),
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*(__(_?[A-Za-z0-9])*)?$/),
  label: string2().nullish(),
  on_init: array(actionOrHandoff).nullish(),
  on_exit: array(action).nullish(),
  action_definitions: array(actionConfiguration).nullish()
});
var actionOrSupervisionTypeEnum = _enum(["action", "supervision"]);
var supervisionTool = object({
  type: actionOrSupervisionTypeEnum.optional().default("supervision"),
  target: string2(),
  name: string2(),
  description: string2().nullish(),
  forced: unknown().optional(),
  enabled: unknown().optional(),
  state_updates: array(record(string2(), unknown())).nullish()
});
var tool = object({
  type: actionOrSupervisionTypeEnum.optional().default("action"),
  target: string2(),
  bound_inputs: record(string2(), unknown()).nullish(),
  llm_inputs: array(string2()).nullish(),
  enabled: unknown().optional(),
  state_updates: array(record(string2(), unknown())).nullish(),
  name: string2(),
  description: string2().nullish(),
  input_parameters: array(inputParameter).nullish(),
  forced: unknown().optional()
});
var actionOrSupervision = intersection(union2([
  object({
    type: literal("action")
  }).and(tool),
  object({
    type: literal("supervision")
  }).and(supervisionTool)
]), object({
  type: actionOrSupervisionTypeEnum.optional()
}));
var subAgentNode = object({
  model_configuration: modelConfig.nullish(),
  before_reasoning_iteration: array(actionOrHandoff).nullish(),
  instructions: string2().optional(),
  type: relatedAgentOrRouterOrSubagentTypeEnum.optional().default("subagent"),
  reasoning_type: string2().optional().default("salesforce.default"),
  description: string2().nullish(),
  before_reasoning: array(actionOrHandoff).nullish(),
  focus_prompt: string2().nullish(),
  tools: array(actionOrSupervision).nullish(),
  pre_tool_call: array(preToolCall).nullish(),
  post_tool_call: array(postToolCall).nullish(),
  after_all_tool_calls: array(actionOrHandoff).nullish(),
  after_reasoning: array(actionOrHandoff).nullish(),
  source: string2().nullish(),
  developer_name: string2().max(80).regex(/^[A-Za-z](_?[A-Za-z0-9])*(__(_?[A-Za-z0-9])*)?$/),
  label: string2().nullish(),
  on_init: array(actionOrHandoff).nullish(),
  on_exit: array(action).nullish(),
  action_definitions: array(actionConfiguration).nullish()
});
var relatedAgentOrRouterOrSubagent = intersection(union2([
  object({
    type: literal("subagent")
  }).and(subAgentNode),
  object({
    type: literal("related_agent")
  }).and(relatedAgentNode),
  object({
    type: literal("router")
  }).and(routerNode)
]), object({
  type: relatedAgentOrRouterOrSubagentTypeEnum.optional()
}));
var agentVersion = object({
  developer_name: string2().max(80).regex(/^v[0-9]+$/).nullish(),
  planner_type: plannerType,
  system_messages: array(systemMessage).nullish(),
  modality_parameters: modalityParameters.nullish(),
  additional_parameters: record(string2(), unknown()).nullish(),
  company: string2().nullish(),
  role: string2().nullish(),
  state_variables: array(stateVariable).nullish(),
  initial_node: string2(),
  nodes: array(relatedAgentOrRouterOrSubagent),
  knowledge_definitions: array(knowledgeConfiguration).nullish(),
  legacy_knowledge_action: actionConfiguration.nullish(),
  surfaces: array(surface).nullish(),
  context: contextConfiguration.nullish()
});
var agentDslAuthoring = object({
  schema_version: string2(),
  global_configuration: globalAgentConfiguration,
  agent_version: union2([agentVersion, array(agentVersion)]),
  context: contextConfiguration.nullish()
});
var zPostAgentBody = unknown();

// ../compiler/dist/modality/extract-sequence.js
function extractSequenceBlocks(sequenceNode) {
  if (!sequenceNode) {
    return [];
  }
  const result = [];
  const children = sequenceNode.items || sequenceNode.__children || [];
  for (const item of children) {
    const itemObj = item;
    const value = itemObj._value || item;
    if (value) {
      result.push(value);
    }
  }
  return result;
}
function extractStringSequence(sequenceNode, fieldName, ctx) {
  if (!sequenceNode) {
    return [];
  }
  const result = [];
  const children = sequenceNode.__children || [];
  const items = sequenceNode.items || [];
  if (children.length > 0 || items.length > 0) {
    const source = items.length > 0 ? items : children;
    for (const item of source) {
      const itemObj = item;
      const value = itemObj._value || item;
      const str = extractStringValue(value);
      if (str) {
        result.push(str);
      }
    }
    if (result.length > 0) {
      return result;
    }
  }
  const cstNode = sequenceNode.__cst?.node;
  if (cstNode) {
    const extracted = extractFromInlineList(cstNode);
    if (extracted.length > 0) {
      return extracted;
    }
    if (cstNode.type === "expression_with_to" || cstNode.type === "list") {
      ctx.warning(`Unable to extract ${fieldName} from inline list syntax. CST structure may have changed.`, sequenceNode.__cst?.range);
    }
  }
  return result;
}
function extractFromInlineList(cstNode) {
  const result = [];
  let listNode = cstNode;
  if (cstNode.type === "expression_with_to" && cstNode.namedChildren?.[0]) {
    listNode = cstNode.namedChildren[0];
  }
  if (listNode.type === "expression" && listNode.namedChildren?.[0]) {
    listNode = listNode.namedChildren[0];
  }
  if (listNode.type === "atom" && listNode.namedChildren?.[0]) {
    listNode = listNode.namedChildren[0];
  }
  if (listNode.type === "list" && listNode.namedChildren) {
    for (const listItem of listNode.namedChildren) {
      if (listItem.type === "expression") {
        const str = extractStringFromExpression(listItem);
        if (str) {
          result.push(str);
        }
      }
    }
  }
  return result;
}
function extractStringFromExpression(expressionNode) {
  let node = expressionNode.namedChildren?.[0];
  if (!node || node.type !== "atom") {
    return null;
  }
  node = node.namedChildren?.[0];
  if (!node || node.type !== "string") {
    return null;
  }
  node = node.namedChildren?.[0];
  if (!node || node.type !== "string_content") {
    return null;
  }
  return node.text || null;
}

// ../compiler/dist/modality/compile-modality.js
function compileModalityParameters(languageBlock, modalityBlock, ctx) {
  const language = compileLanguageConfiguration(languageBlock, ctx);
  const voiceEntry = modalityBlock?.get("voice");
  const voice = compileVoiceConfiguration(voiceEntry, ctx);
  const result = {
    language
  };
  if (voice !== null) {
    result.voice = voice;
  }
  return result;
}
function compileLanguageConfiguration(languageBlock, ctx) {
  if (!languageBlock)
    return null;
  const defaultLocaleSourced = extractSourcedString(languageBlock.default_locale);
  const defaultLocale = extractStringValue(languageBlock.default_locale) ?? "";
  if (!defaultLocale) {
    ctx.error("Language block requires a default_locale", languageBlock.__cst?.range);
    return null;
  }
  let hasValidationErrors = false;
  if (!supportedLocale.safeParse(defaultLocale).success) {
    ctx.error(`Invalid default_locale '${defaultLocale}'. Must be a supported locale.`, languageBlock.__cst?.range, "schema-validation");
    hasValidationErrors = true;
  }
  const additionalLocalesStr = extractStringValue(languageBlock.additional_locales) ?? "";
  const additionalLocales = additionalLocalesStr ? additionalLocalesStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const locale of additionalLocales) {
    if (!supportedLocale.safeParse(locale).success) {
      ctx.error(`Invalid additional_locale '${locale}'. Must be a supported locale.`, languageBlock.__cst?.range, "schema-validation");
      hasValidationErrors = true;
    }
  }
  if (hasValidationErrors) {
    return null;
  }
  const allAdditionalLocales = extractSourcedBoolean(languageBlock.all_additional_locales) ?? false;
  const langConfig = {
    default_locale: defaultLocaleSourced ?? defaultLocale,
    additional_locales: additionalLocales,
    all_additional_locales: allAdditionalLocales
  };
  ctx.setScriptPath(langConfig, "language");
  return langConfig;
}
function compileVoiceConfiguration(voiceBlock, ctx) {
  if (!voiceBlock)
    return null;
  const voiceConfig = {};
  const inboundFillerWordsDetection = extractSourcedBoolean(voiceBlock.inbound_filler_words_detection);
  if (inboundFillerWordsDetection !== void 0) {
    voiceConfig.inbound_filler_words_detection = inboundFillerWordsDetection;
  }
  if (voiceBlock.inbound_keywords) {
    const keywordsBlock = voiceBlock.inbound_keywords;
    if (keywordsBlock.keywords) {
      const keywordsList = extractStringSequence(keywordsBlock.keywords, "inbound_keywords.keywords", ctx);
      if (keywordsList.length > 0) {
        const inboundKeywords2 = { keywords: keywordsList };
        voiceConfig.inbound_keywords = inboundKeywords2;
      }
    }
  }
  const voiceId = extractSourcedString(voiceBlock.voice_id);
  if (voiceId !== void 0) {
    voiceConfig.voice_id = voiceId;
  }
  const outboundSpeed = extractSourcedNumber(voiceBlock.outbound_speed);
  if (outboundSpeed !== void 0) {
    voiceConfig.outbound_speed = outboundSpeed;
  }
  const outboundStyleExaggeration = extractSourcedNumber(voiceBlock.outbound_style_exaggeration);
  if (outboundStyleExaggeration !== void 0) {
    voiceConfig.outbound_style_exaggeration = outboundStyleExaggeration;
  }
  const outboundStability = extractSourcedNumber(voiceBlock.outbound_stability);
  if (outboundStability !== void 0) {
    voiceConfig.outbound_stability = outboundStability;
  }
  const outboundSimilarity = extractSourcedNumber(voiceBlock.outbound_similarity);
  if (outboundSimilarity !== void 0) {
    voiceConfig.outbound_similarity = outboundSimilarity;
  }
  if (voiceBlock.pronunciation_dict) {
    const pronunciations = [];
    const entries = extractSequenceBlocks(voiceBlock.pronunciation_dict);
    for (const entry of entries) {
      const grapheme = extractSourcedString(entry.grapheme);
      const phoneme = extractSourcedString(entry.phoneme);
      const type = extractSourcedString(entry.type);
      if (grapheme && phoneme && type) {
        pronunciations.push({ grapheme, phoneme, type });
      }
    }
    if (pronunciations.length > 0) {
      const pronunciationDict2 = { pronunciations };
      voiceConfig.pronunciation_dict = pronunciationDict2;
    }
  }
  if (voiceBlock.outbound_filler_sentences) {
    const fillerSentences = [];
    const entries = extractSequenceBlocks(voiceBlock.outbound_filler_sentences);
    for (const entry of entries) {
      const waitingSequence = entry.waiting;
      if (waitingSequence) {
        const waiting = extractStringSequence(waitingSequence, "outbound_filler_sentences.waiting", ctx);
        if (waiting.length > 0) {
          fillerSentences.push({ filler_sentences: { waiting } });
        }
      }
    }
    if (fillerSentences.length > 0) {
      voiceConfig.outbound_filler_sentences = fillerSentences;
    }
  }
  if (voiceBlock.additional_configs) {
    const additionalConfigs = {};
    const configsBlock = voiceBlock.additional_configs;
    if (configsBlock.speak_up_config) {
      const speakUpConfig2 = {};
      const speakUpBlock = configsBlock.speak_up_config;
      const firstWait = extractSourcedNumber(speakUpBlock.speak_up_first_wait_time_ms);
      const followUpWait = extractSourcedNumber(speakUpBlock.speak_up_follow_up_wait_time_ms);
      const message = extractSourcedString(speakUpBlock.speak_up_message);
      if (firstWait !== void 0) {
        speakUpConfig2.speak_up_first_wait_time_ms = firstWait;
      }
      if (followUpWait !== void 0) {
        speakUpConfig2.speak_up_follow_up_wait_time_ms = followUpWait;
      }
      if (message !== void 0) {
        speakUpConfig2.speak_up_message = message;
      }
      if (Object.keys(speakUpConfig2).length > 0) {
        additionalConfigs.speak_up_config = speakUpConfig2;
      }
    }
    if (configsBlock.endpointing_config) {
      const endpointingConfig2 = {};
      const endpointingBlock = configsBlock.endpointing_config;
      const maxWait = extractSourcedNumber(endpointingBlock.max_wait_time_ms);
      if (maxWait !== void 0) {
        endpointingConfig2.max_wait_time_ms = maxWait;
      }
      if (Object.keys(endpointingConfig2).length > 0) {
        additionalConfigs.endpointing_config = endpointingConfig2;
      }
    }
    if (configsBlock.beepboop_config) {
      const beepboopConfig = {};
      const beepboopBlock = configsBlock.beepboop_config;
      const maxWait = extractSourcedNumber(beepboopBlock.max_wait_time_ms);
      if (maxWait !== void 0) {
        beepboopConfig.max_wait_time_ms = maxWait;
      }
      if (Object.keys(beepboopConfig).length > 0) {
        additionalConfigs.beepboop_config = beepboopConfig;
      }
    }
    if (Object.keys(additionalConfigs).length > 0) {
      voiceConfig.additional_configs = additionalConfigs;
    }
  }
  ctx.setScriptPath(voiceConfig, "voice");
  return voiceConfig;
}

// ../compiler/dist/config/model-config.js
function extractModelAndParams(modelValue, paramsValue, ctx, modelRange) {
  let modelRef = null;
  if (modelValue !== void 0) {
    const modelStr = extractStringValue(modelValue);
    if (modelStr) {
      const { scheme, path } = parseUri(modelStr);
      if (!scheme) {
        ctx.error(`Model URI must include a scheme (e.g., "model://..."). Got: "${modelStr}"`, modelRange);
        return void 0;
      }
      modelRef = path;
    }
  }
  let params;
  if (paramsValue !== void 0 && paramsValue !== null) {
    if (typeof paramsValue === "object" && paramsValue.__kind === "DictLiteral") {
      params = extractDictExpression(paramsValue);
    } else if (typeof paramsValue === "object") {
      params = extractBlockParams(paramsValue, ctx);
    }
  }
  return { modelRef, params };
}
function extractGlobalModelConfiguration(parsed, ctx) {
  if (!parsed.model_config)
    return void 0;
  const result = extractModelAndParams(parsed.model_config.model, parsed.model_config.params, ctx, parsed.model_config.model?.__cst?.range);
  if (!result)
    return void 0;
  if (!result.modelRef) {
    if (result.params) {
      ctx.warning('Global model_config has parameters but no model specified. Parameters will be ignored. Global model_config requires a model field (e.g., model: "model://gpt-4"). To apply parameters to specific topics, use topic-level model_config.', parsed.model_config.__cst?.range);
    }
    return void 0;
  }
  const modelConfig2 = { model_ref: result.modelRef };
  if (result.params) {
    modelConfig2.configuration = result.params;
  }
  return modelConfig2;
}
function extractBlockParams(paramsBlock, ctx) {
  if (!paramsBlock || typeof paramsBlock !== "object")
    return void 0;
  const result = {};
  const block = paramsBlock;
  for (const [key, value] of Object.entries(block)) {
    if (key.startsWith("__") || key === "description")
      continue;
    const extractedValue = extractExpressionValue(value);
    if (extractedValue !== void 0) {
      result[key] = extractedValue;
    } else if (ctx && value && typeof value === "object" && value.__kind) {
      ctx.warning(`Unsupported parameter value type "${value.__kind}" \u2014 this value will be ignored. Supported types are strings, numbers, booleans, arrays, and dicts.`, value.__cst?.range);
    }
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
function extractTopicModelConfiguration(topicBlock, ctx) {
  if (!topicBlock.model_config)
    return void 0;
  const result = extractModelAndParams(topicBlock.model_config.model, topicBlock.model_config.params, ctx, topicBlock.model_config.model?.__cst?.range);
  if (!result)
    return void 0;
  if (!result.modelRef && !result.params) {
    return void 0;
  }
  const config2 = { model_ref: result.modelRef };
  if (result.params) {
    config2.configuration = result.params;
  }
  return config2;
}
function mergeModelConfigurations(globalConfig2, topicConfig) {
  if (!topicConfig && !globalConfig2)
    return void 0;
  if (!globalConfig2)
    return topicConfig;
  if (!topicConfig)
    return globalConfig2;
  const merged = {
    model_ref: topicConfig.model_ref !== null && topicConfig.model_ref !== void 0 ? topicConfig.model_ref : globalConfig2.model_ref
  };
  if (globalConfig2.configuration || topicConfig.configuration) {
    merged.configuration = {
      ...globalConfig2.configuration,
      ...topicConfig.configuration
    };
  }
  return merged;
}

// ../compiler/dist/nodes/compile-actions.js
function compileActionDefinitions(actions, ctx) {
  if (!actions)
    return [];
  const result = [];
  for (const [name, def] of iterateNamedMap(actions)) {
    const actionConfig = compileActionDefinition(name, def, ctx);
    if (actionConfig) {
      result.push(actionConfig);
    }
  }
  return result;
}
function compileActionDefinition(name, def, ctx) {
  const description = extractSourcedDescription(def["description"]) ?? "";
  const label = extractSourcedString(def["label"]) ?? normalizeDeveloperName(name);
  const requireUserConfirmation = extractSourcedBoolean(def["require_user_confirmation"]) ?? false;
  const includeInProgressIndicator = extractSourcedBoolean(def["include_in_progress_indicator"]) ?? false;
  const progressIndicatorMessage = extractSourcedString(def["progress_indicator_message"]) ?? void 0;
  const targetUri = extractStringValue(def["target"]);
  let invocationTargetType = "externalService";
  let invocationTargetName = name;
  if (targetUri) {
    const { scheme, path } = parseUri(targetUri);
    if (scheme)
      invocationTargetType = scheme;
    if (path)
      invocationTargetName = path;
  }
  const inputType = compileInputParameters(def["inputs"], ctx);
  const outputType = compileOutputParameters(def["outputs"], ctx);
  const source = extractSourcedString(def["source"]) ?? void 0;
  const actionDef2 = {
    developer_name: name,
    label,
    description,
    require_user_confirmation: requireUserConfirmation,
    include_in_progress_indicator: includeInProgressIndicator,
    invocation_target_type: invocationTargetType,
    invocation_target_name: invocationTargetName,
    input_type: inputType,
    output_type: outputType
  };
  if (source !== void 0) {
    actionDef2.source = source;
  }
  if (progressIndicatorMessage !== void 0) {
    actionDef2.progress_indicator_message = progressIndicatorMessage;
  }
  return actionDef2;
}
function compileInputParameters(inputs, ctx) {
  if (!inputs)
    return [];
  const result = [];
  for (const [name, decl] of iterateNamedMap(inputs)) {
    const param = compileInputParameter(name, decl, ctx);
    if (param)
      result.push(param);
  }
  return result;
}
function compileInputParameter(name, decl, ctx) {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr)
    return void 0;
  const props = decl.properties;
  const isList = isListType(decl.type);
  const complexDataTypeName = extractStringValue(props?.["complex_data_type_name"]) ?? void 0;
  const { dataType, complexDataTypeName: resolvedComplexName } = resolveParameterTypeInfo(typeStr, isList, complexDataTypeName);
  const isUserInput = extractSourcedBoolean(props?.["is_user_input"]) ?? false;
  const required2 = extractSourcedBoolean(props?.["is_required"]) ?? false;
  const schemaUri = extractSourcedString(props?.["schema"]) ?? void 0;
  const constantValue = extractConstantValue(decl, ctx);
  const label = extractSourcedString(props?.["label"]) ?? normalizeDeveloperName(name);
  const param = {
    developer_name: name,
    label,
    description: extractSourcedDescription(props?.["description"]) ?? extractStringValue(props?.["label"]) ?? normalizeDeveloperName(name),
    data_type: dataType,
    is_list: isList,
    required: required2,
    is_user_input: isUserInput
  };
  if (resolvedComplexName != null) {
    const cdtRange = getCstRange(props?.["complex_data_type_name"]);
    param.complex_data_type_name = sourced(resolvedComplexName, cdtRange);
  }
  if (constantValue !== null) {
    param.constant_value = constantValue;
  }
  if (schemaUri !== void 0) {
    param.schema = schemaUri;
  }
  return param;
}
function compileOutputParameters(outputs, ctx) {
  if (!outputs)
    return [];
  const result = [];
  for (const [name, decl] of iterateNamedMap(outputs)) {
    const param = compileOutputParameter(name, decl, ctx);
    if (param)
      result.push(param);
  }
  return result;
}
function compileOutputParameter(name, decl, _ctx) {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr)
    return void 0;
  const props = decl.properties;
  const isList = isListType(decl.type);
  const complexDataTypeName = extractStringValue(props?.["complex_data_type_name"]) ?? void 0;
  const { dataType, complexDataTypeName: resolvedComplexName } = resolveParameterTypeInfo(typeStr, isList, complexDataTypeName);
  const filterFromAgent = extractBooleanValue(props?.["filter_from_agent"]);
  const explicitIsUsedByPlanner = extractSourcedBoolean(props?.["is_used_by_planner"]);
  const isDisplayable = extractSourcedBoolean(props?.["is_displayable"]) ?? false;
  const isUsedByPlanner = filterFromAgent === true ? false : explicitIsUsedByPlanner ?? true;
  const outLabel = extractSourcedString(props?.["label"]) ?? normalizeDeveloperName(name);
  const param = {
    developer_name: name,
    label: outLabel,
    description: extractSourcedDescription(props?.["description"]) ?? normalizeDeveloperName(name),
    data_type: dataType,
    is_list: isList,
    is_used_by_planner: isUsedByPlanner,
    is_displayable: isDisplayable
  };
  if (resolvedComplexName != null) {
    const cdtRange = getCstRange(props?.["complex_data_type_name"]);
    param.complex_data_type_name = sourced(resolvedComplexName, cdtRange);
  }
  return param;
}
function extractConstantValue(decl, ctx) {
  const dv = decl.defaultValue;
  if (!dv)
    return null;
  if (dv instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(dv);
    if (decomposed && decomposed.namespace === "knowledge") {
      const value = ctx.knowledgeFields.get(decomposed.property);
      if (value !== void 0) {
        return sourced(value, getCstRange(dv));
      }
      ctx.error(`Unknown @knowledge field: '${decomposed.property}'`, getCstRange(dv));
    }
    return null;
  }
  const sourcedStr = extractSourcedString(dv);
  if (sourcedStr !== void 0)
    return sourcedStr;
  const sourcedBool = extractSourcedBoolean(dv);
  if (sourcedBool !== void 0)
    return sourcedBool;
  return null;
}

// ../compiler/dist/nodes/compile-utils.js
function warnIfConnectedAgentTransition(targetExpr, ctx) {
  const decomposed = decomposeAtMemberExpression(targetExpr);
  if (decomposed && decomposed.namespace === "connected_subagent") {
    ctx.warning(`Transition to connected agent "${decomposed.property}" is not supported. Use @connected_subagent.${decomposed.property} as a tool invocation instead.`, targetExpr.__cst?.range);
    return true;
  }
  return false;
}

// ../compiler/dist/nodes/compile-directives.js
function compileDeterministicDirectives(directives, ctx, options = {}) {
  const { addNextTopicResetAction = true, gateOnNextTopicEmpty = true, agentInstructionsVariable, toolNames, actionDefinitionNames } = options;
  const conditionStack = new ConditionStack();
  const result = [];
  if (addNextTopicResetAction) {
    const resetAction = createStateUpdateAction([{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }], "True");
    result.push(resetAction);
  }
  for (const directive of directives) {
    const actions = compileDirective(directive, ctx, {
      conditionStack,
      gateOnNextTopicEmpty,
      agentInstructionsVariable,
      toolNames,
      actionDefinitionNames
    });
    result.push(...actions);
  }
  return result;
}
function compileDirective(stmt, ctx, dctx) {
  if (stmt instanceof RunStatement) {
    return compileRunDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof SetClause) {
    return compileSetDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof TransitionStatement) {
    return compileTransitionDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof IfStatement) {
    return compileIfDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof Template) {
    return compileTemplateDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof UnknownStatement) {
    return [];
  }
  ctx.warning(`Unsupported directive kind: ${stmt.__kind}`, stmt.__cst?.range);
  return [];
}
function compileRunDirective(stmt, ctx, dctx) {
  const target = resolveAtReference(stmt.target, "actions", ctx, "action target");
  if (!target)
    return [];
  const boundInputs = {};
  const stateUpdates = [];
  for (const child of stmt.body) {
    if (child instanceof WithClause) {
      const compiledValue = compileExpression(child.value, ctx, {
        expressionContext: "'with' clause"
      });
      boundInputs[child.param] = compiledValue;
    } else if (child instanceof SetClause) {
      const varName = resolveAtReference(child.target, "variables", ctx, "variable name");
      if (varName) {
        const compiledValue = compileExpression(child.value, ctx, {
          expressionContext: "'set' clause"
        });
        stateUpdates.push({ [varName]: compiledValue });
      }
    }
  }
  const enabled = buildEnabledCondition(dctx);
  const action2 = {
    type: "action",
    target,
    bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    llm_inputs: [],
    state_updates: stateUpdates
  };
  if (enabled) {
    action2.enabled = enabled;
  }
  return [action2];
}
function compileSetDirective(stmt, ctx, dctx) {
  const varName = resolveAtReference(stmt.target, "variables", ctx, "variable name");
  if (!varName)
    return [];
  const compiledValue = compileExpression(stmt.value, ctx, {
    expressionContext: "'set' clause"
  });
  const enabled = buildEnabledCondition(dctx);
  const action2 = createStateUpdateAction([{ [varName]: compiledValue }], enabled);
  return [action2];
}
function compileTransitionDirective(stmt, ctx, dctx) {
  const result = [];
  for (const clause of stmt.clauses) {
    if (clause instanceof ToClause) {
      if (warnIfConnectedAgentTransition(clause.target, ctx))
        continue;
      const targetName = resolveAtReference(clause.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
      if (!targetName)
        continue;
      const enabled = buildEnabledCondition(dctx);
      const stateAction = createStateUpdateAction([{ [NEXT_TOPIC_VARIABLE]: `"${targetName}"` }], enabled);
      result.push(stateAction);
      const handoff = {
        type: "handoff",
        target: targetName,
        enabled: `state.${NEXT_TOPIC_VARIABLE}=="${targetName}"`,
        state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }]
      };
      result.push(handoff);
    }
  }
  return result;
}
function compileIfDirective(stmt, ctx, dctx) {
  const result = [];
  const condition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' condition"
  });
  const condEnabled = buildEnabledCondition(dctx) ?? (dctx.agentInstructionsVariable ? "True" : null);
  const condAction = createStateUpdateAction([{ [RUNTIME_CONDITION_VARIABLE]: condition }], condEnabled);
  result.push(condAction);
  if (dctx.conditionStack.depth > 0 && stmt.orelse.length > 0) {
    const range = stmt.condition.__cst?.range ?? stmt.__cst?.range;
    ctx.warning("Nested if/else is not fully supported: the runtime uses a single condition variable, so the else branch may not evaluate correctly", range);
  }
  dctx.conditionStack.push(condition, "positive");
  for (const child of stmt.body) {
    result.push(...compileDirective(child, ctx, dctx));
  }
  dctx.conditionStack.pop();
  if (stmt.orelse.length > 0) {
    dctx.conditionStack.push(condition, "negative");
    for (const child of stmt.orelse) {
      result.push(...compileDirective(child, ctx, dctx));
    }
    dctx.conditionStack.pop();
  }
  return result;
}
function compileTemplateDirective(stmt, ctx, dctx) {
  const content = compileTemplateValue(stmt, ctx, {
    allowActionReferences: true
  });
  if (!content)
    return [];
  const varName = dctx.agentInstructionsVariable ?? AGENT_INSTRUCTIONS_VARIABLE;
  const enabled = buildEnabledCondition(dctx);
  const action2 = createStateUpdateAction([
    {
      [varName]: `template::{{state.${varName}}}
${content}`
    }
  ], enabled);
  return [action2];
}
var ConditionStack = class {
  constructor() {
    __publicField(this, "stack", []);
  }
  push(condition, type) {
    this.stack.push({ condition, type });
  }
  pop() {
    this.stack.pop();
  }
  get depth() {
    return this.stack.length;
  }
  /**
   * Get the combined current condition expression.
   * Returns undefined if no conditions are active.
   */
  get currentCondition() {
    if (this.stack.length === 0)
      return void 0;
    const parts = this.stack.map((entry) => {
      if (entry.type === "positive") {
        return `state.${RUNTIME_CONDITION_VARIABLE}`;
      }
      return `not (state.${RUNTIME_CONDITION_VARIABLE})`;
    });
    if (parts.length === 1)
      return parts[0];
    return parts.map((p) => `(${p})`).join(" and ");
  }
};
function createStateUpdateAction(stateUpdates, enabled) {
  const action2 = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    enabled: enabled ?? void 0,
    state_updates: stateUpdates
  };
  if (action2.enabled === void 0) {
    delete action2.enabled;
  }
  return action2;
}
function buildEnabledCondition(dctx) {
  const parts = [];
  if (dctx.gateOnNextTopicEmpty) {
    parts.push(NEXT_TOPIC_EMPTY_CONDITION);
  }
  const stackCondition = dctx.conditionStack.currentCondition;
  if (stackCondition) {
    parts.push(stackCondition);
  }
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1)
    return parts[0];
  return parts.map((p) => `(${p})`).join(" and ");
}

// ../compiler/dist/nodes/resolve-action-type.js
function resolveActionType(name, def) {
  const colinear = def.value;
  if (colinear instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(colinear);
    if (decomposed) {
      if (decomposed.namespace === "utils") {
        const utilName = decomposed.property;
        if (utilName === "transition")
          return "transition";
        if (utilName === "setVariables")
          return "setVariables";
        if (utilName === "escalate")
          return "escalate";
        if (utilName === "supervise")
          return "supervise";
      }
      if (decomposed.namespace === "topic" || decomposed.namespace === "subagent" || decomposed.namespace === "connected_subagent") {
        return "supervise";
      }
    }
  }
  if (name.startsWith("@utils.transition") || name === "transition") {
    return "transition";
  }
  if (name.startsWith("@utils.setVariables") || name === "setVariables") {
    return "setVariables";
  }
  if (name.startsWith("@utils.escalate") || name === "escalate") {
    return "escalate";
  }
  if (name.startsWith("@utils.supervise") || name === "supervise") {
    return "supervise";
  }
  return "tool";
}

// ../compiler/dist/nodes/compile-transition.js
function compileTransition(name, actionDef, body, _currentTopicName, topicDescriptions, ctx) {
  const tools = [];
  const handOffActions = [];
  const transitions = [];
  let availableWhenCondition;
  let lastAvailableWhenRange;
  for (const stmt of body) {
    if (stmt instanceof ToClause) {
      if (warnIfConnectedAgentTransition(stmt.target, ctx))
        continue;
      const targetName = resolveAtReference(stmt.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
      if (targetName) {
        transitions.push({
          targetName,
          condition: availableWhenCondition,
          toClauseRange: stmt.__cst?.range,
          availableWhenRange: lastAvailableWhenRange
        });
        availableWhenCondition = void 0;
        lastAvailableWhenRange = void 0;
      }
    } else if (stmt instanceof AvailableWhen) {
      availableWhenCondition = compileExpression(stmt.condition, ctx);
      lastAvailableWhenRange = stmt.__cst?.range;
    } else if (stmt instanceof TransitionStatement) {
      for (const clause of stmt.clauses) {
        if (clause instanceof ToClause) {
          if (warnIfConnectedAgentTransition(clause.target, ctx))
            continue;
          const targetName = resolveAtReference(clause.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
          if (targetName) {
            transitions.push({
              targetName,
              condition: availableWhenCondition,
              toClauseRange: clause.__cst?.range,
              availableWhenRange: lastAvailableWhenRange
            });
            availableWhenCondition = void 0;
            lastAvailableWhenRange = void 0;
          }
        }
      }
    }
  }
  if (transitions.length === 0) {
    const colinear = actionDef.value;
    if (colinear) {
      if (!warnIfConnectedAgentTransition(colinear, ctx)) {
        const targetName = resolveAtReference(colinear, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
        if (targetName) {
          transitions.push({ targetName, condition: void 0 });
        }
      }
    }
  }
  const alias = extractSourcedString(actionDef.label);
  const description = extractSourcedDescription(actionDef.description) ?? "";
  for (const trans of transitions) {
    const toolName = alias ?? name;
    const toolDescription = description || topicDescriptions[trans.targetName] || normalizeDeveloperName(trans.targetName);
    const tool2 = {
      type: "action",
      target: STATE_UPDATE_ACTION,
      state_updates: [{ [NEXT_TOPIC_VARIABLE]: `"${trans.targetName}"` }],
      name: toolName,
      description: toolDescription
    };
    if (trans.condition) {
      tool2.enabled = trans.condition;
    }
    tools.push(tool2);
    const handoff = {
      type: "handoff",
      target: trans.targetName,
      enabled: `state.${NEXT_TOPIC_VARIABLE}=="${trans.targetName}"`,
      state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }]
    };
    handOffActions.push(handoff);
  }
  return { tools, handOffActions };
}

// ../compiler/dist/nodes/compile-set-variables.js
function compileSetVariables(name, actionDef, body, ctx) {
  const alias = extractSourcedString(actionDef.label);
  const description = extractSourcedString(actionDef.description);
  const llmInputs = [];
  const stateUpdates = [];
  let hasWithClauses = false;
  for (const stmt of body) {
    if (stmt instanceof WithClause) {
      hasWithClauses = true;
      if (stmt.value instanceof Ellipsis) {
        llmInputs.push(stmt.param);
        stateUpdates.push({ [stmt.param]: `result.${stmt.param}` });
      } else {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'with' clause"
        });
        stateUpdates.push({ [stmt.param]: compiledValue });
      }
    } else if (stmt instanceof SetClause) {
      const varName = extractVariableName(stmt.target, ctx);
      if (varName) {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'set' clause"
        });
        stateUpdates.push({ [varName]: compiledValue });
      }
    }
  }
  const tool2 = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    state_updates: stateUpdates,
    name: alias ?? name
  };
  if (description !== void 0) {
    tool2.description = description;
  }
  if (hasWithClauses) {
    tool2.bound_inputs = {};
    tool2.llm_inputs = llmInputs;
    tool2.input_parameters = llmInputs.length > 0 ? llmInputs.map((inputName) => {
      const stateVar = ctx.stateVariables.find((v) => v.developer_name === inputName);
      const dataType = stateVar ? stateVarToParameterDataType(stateVar.data_type) : "String";
      return {
        developer_name: inputName,
        label: inputName,
        data_type: dataType
      };
    }) : [];
  }
  return tool2;
}
function extractVariableName(expr, ctx) {
  if (expr instanceof MemberExpression) {
    if (expr.object instanceof AtIdentifier && expr.object.name === "variables") {
      return expr.property;
    }
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  ctx.error("Cannot resolve variable name", expr.__cst?.range);
  return void 0;
}

// ../compiler/dist/nodes/compile-supervision.js
function compileSupervision(name, actionDef, body, topicDescriptions, ctx) {
  let targetName;
  let enabledCondition;
  for (const stmt of body) {
    if (stmt instanceof ToClause) {
      if (warnIfConnectedAgentTransition(stmt.target, ctx))
        continue;
      const resolved = resolveAtReference(stmt.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
      if (resolved)
        targetName = resolved;
    } else if (stmt instanceof TransitionStatement) {
      for (const clause of stmt.clauses) {
        if (clause instanceof ToClause) {
          if (warnIfConnectedAgentTransition(clause.target, ctx))
            continue;
          const resolved = resolveAtReference(clause.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
          if (resolved)
            targetName = resolved;
        }
      }
    } else if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx);
    }
  }
  if (!targetName) {
    const colinear = actionDef.value;
    if (colinear) {
      if (!warnIfConnectedAgentTransition(colinear, ctx)) {
        const resolved = resolveAtReference(colinear, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
        if (resolved)
          targetName = resolved;
      }
    }
  }
  const resolvedTarget = targetName ?? name;
  const alias = extractSourcedString(actionDef.label);
  const description = extractSourcedDescription(actionDef.description) ?? topicDescriptions[resolvedTarget] ?? "";
  const tool2 = {
    type: "supervision",
    target: resolvedTarget,
    name: alias ?? name,
    description
  };
  if (enabledCondition) {
    tool2.enabled = enabledCondition;
  }
  return { tool: tool2 };
}

// ../compiler/dist/nodes/compile-escalate.js
function compileEscalate(name, actionDef, body, ctx) {
  const alias = extractSourcedString(actionDef.label);
  const description = extractSourcedDescription(actionDef.description) ?? "Escalate to human agent";
  let enabledCondition;
  for (const stmt of body) {
    if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause"
      });
    }
  }
  const tool2 = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_ESCALATION_NODE_VALUE }],
    name: alias ?? name,
    description
  };
  if (enabledCondition) {
    tool2.enabled = enabledCondition;
  }
  const handoff = {
    type: "handoff",
    target: ESCALATION_TARGET,
    enabled: `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`,
    state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }]
  };
  return { tool: tool2, handOffAction: handoff };
}

// ../compiler/dist/nodes/compile-tool.js
function compileTool(name, actionDef, body, ctx) {
  let target = name;
  let isConnectedAgent = false;
  if (actionDef.value) {
    const decomposed = decomposeAtMemberExpression(actionDef.value);
    if (decomposed && (decomposed.namespace === "actions" || decomposed.namespace === "connected_subagent")) {
      target = decomposed.property;
      isConnectedAgent = decomposed.namespace === "connected_subagent";
    }
  }
  const description = extractSourcedDescription(actionDef.description) ?? normalizeDeveloperName(name);
  const alias = extractSourcedString(actionDef.label);
  const displayName = alias ?? name;
  const boundInputs = {};
  const llmInputs = [];
  const inputClauses = /* @__PURE__ */ new Map();
  const stateUpdates = [];
  const postActions = [];
  const handOffActions = [];
  let enabledCondition;
  for (const stmt of body) {
    if (stmt instanceof WithClause) {
      const compiledValue = compileExpression(stmt.value, ctx, {
        expressionContext: "'with' clause"
      });
      if (stmt.value instanceof Ellipsis) {
        llmInputs.push(stmt.param);
      } else {
        boundInputs[stmt.param] = compiledValue;
      }
      inputClauses.set(stmt.param, stmt);
    } else if (stmt instanceof SetClause) {
      const varName = resolveAtReference(stmt.target, ["variables", "outputs"], ctx, "variable name");
      if (varName) {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'set' clause"
        });
        stateUpdates.push({ [varName]: compiledValue });
      }
    } else if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause"
      });
    } else if (stmt instanceof RunStatement) {
      const postAction = compilePostToolAction(stmt, ctx);
      if (postAction) {
        postActions.push(postAction);
      }
    } else if (stmt instanceof IfStatement) {
      const result = compilePostActionConditional(stmt, ctx);
      postActions.push(...result.actions);
      handOffActions.push(...result.handOffs);
    }
  }
  if (actionDef.value) {
    const decomposed2 = decomposeAtMemberExpression(actionDef.value);
    if (decomposed2 && decomposed2.namespace === "connected_subagent") {
      const sig = ctx.connectedAgentInputs.get(target);
      if (sig) {
        const providedInputs = /* @__PURE__ */ new Set([
          ...Object.keys(boundInputs),
          ...llmInputs
        ]);
        for (const inputName of providedInputs) {
          if (!sig.allInputs.has(inputName)) {
            const clause = inputClauses.get(inputName);
            const range = (clause?.__paramCstNode ? toRange(clause.__paramCstNode) : clause?.__cst?.range) ?? actionDef.__cst?.range;
            ctx.warning(`Unknown input "${inputName}" on connected agent "${target}". Available inputs: ${[...sig.allInputs].join(", ") || "(none)"}`, range);
          }
        }
        for (const inputName of sig.allInputs) {
          if (!sig.inputsWithDefaults.has(inputName) && !providedInputs.has(inputName)) {
            const valueExpr = actionDef.value;
            const range = valueExpr?.__cst?.range ?? actionDef.__cst?.range;
            ctx.warning(`Missing required input "${inputName}" on connected agent "${target}". Provide it via a "with" clause or "..." for LLM-filled`, range);
          }
        }
      }
    }
  }
  const tool2 = {
    type: isConnectedAgent ? "supervision" : "action",
    target,
    // TODO: Add connected agent tools to have bound_inputs/llm_inputs in the supervision definition
    // once the runtime specification supports it.
    // bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    // llm_inputs: llmInputs,
    // Only include bound_inputs and llm_inputs for non-connected-agent tools
    ...isConnectedAgent ? {} : {
      bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
      llm_inputs: llmInputs
    },
    state_updates: stateUpdates,
    name: displayName,
    description
  };
  if (enabledCondition) {
    tool2.enabled = enabledCondition;
  }
  const postToolCall2 = postActions.length > 0 ? { target, actions: postActions } : void 0;
  return {
    tool: tool2,
    postToolCall: postToolCall2,
    handOffActions
  };
}
function compilePostToolAction(stmt, ctx) {
  const targetName = resolveAtReference(stmt.target, "actions", ctx, "action target");
  if (!targetName)
    return void 0;
  const boundInputs = {};
  const llmInputs = [];
  const stateUpdates = [];
  for (const child of stmt.body) {
    if (child instanceof WithClause) {
      if (child.value instanceof Ellipsis) {
        llmInputs.push(child.param);
      } else {
        boundInputs[child.param] = compileExpression(child.value, ctx, {
          expressionContext: "'with' clause"
        });
      }
    } else if (child instanceof SetClause) {
      const varName = resolveAtReference(child.target, ["variables", "outputs"], ctx, "variable name");
      if (varName) {
        stateUpdates.push({
          [varName]: compileExpression(child.value, ctx, {
            expressionContext: "'set' clause"
          })
        });
      }
    }
  }
  const action2 = {
    type: "action",
    target: targetName,
    bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    llm_inputs: llmInputs,
    state_updates: stateUpdates
  };
  return action2;
}
function compilePostActionConditional(stmt, ctx) {
  const actions = [];
  const handOffs = [];
  const compiledCondition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' statement condition"
  });
  const condAction = {
    type: "action",
    target: "__state_update_action__",
    enabled: "True",
    state_updates: [
      {
        AgentScriptInternal_condition: compiledCondition
      }
    ]
  };
  actions.push(condAction);
  const bodyResult = compileConditionalBody(stmt.body, "state.AgentScriptInternal_condition", ctx);
  actions.push(...bodyResult.actions);
  handOffs.push(...bodyResult.handOffs);
  if (stmt.orelse.length > 0) {
    const elseResult = compileConditionalBody(stmt.orelse, `not state.AgentScriptInternal_condition`, ctx);
    actions.push(...elseResult.actions);
    handOffs.push(...elseResult.handOffs);
  }
  return { actions, handOffs };
}
function compileConditionalBody(body, enabledCondition, ctx) {
  const actions = [];
  const handOffs = [];
  for (const stmt of body) {
    if (stmt instanceof TransitionStatement) {
      const result = compileTransitionInConditional(stmt, enabledCondition, ctx);
      if (result) {
        actions.push(result.action);
        handOffs.push(result.handOff);
      }
    } else if (stmt instanceof SetClause) {
      const varName = resolveAtReference(stmt.target, ["variables", "outputs"], ctx, "variable name");
      if (varName) {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'set' clause"
        });
        const setAction = {
          type: "action",
          target: "__state_update_action__",
          enabled: enabledCondition,
          state_updates: [{ [varName]: compiledValue }]
        };
        actions.push(setAction);
      }
    } else if (stmt instanceof RunStatement) {
      const postAction = compilePostToolAction(stmt, ctx);
      if (postAction) {
        const gatedAction = {
          ...postAction,
          enabled: enabledCondition
        };
        actions.push(gatedAction);
      }
    } else if (stmt instanceof IfStatement) {
      const nestedResult = compilePostActionConditional(stmt, ctx);
      const combinedActions = nestedResult.actions.map((action2) => ({
        ...action2,
        enabled: action2.enabled ? `(${enabledCondition}) and (${action2.enabled})` : enabledCondition
      }));
      actions.push(...combinedActions);
      handOffs.push(...nestedResult.handOffs);
    }
  }
  return { actions, handOffs };
}
function compileTransitionInConditional(stmt, enabledCondition, ctx) {
  for (const clause of stmt.clauses) {
    if (clause instanceof ToClause) {
      if (warnIfConnectedAgentTransition(clause.target, ctx))
        continue;
      const targetTopicName = resolveAtReference(clause.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
      if (!targetTopicName)
        continue;
      const action2 = {
        type: "action",
        target: "__state_update_action__",
        enabled: enabledCondition,
        state_updates: [
          {
            AgentScriptInternal_next_topic: `"${targetTopicName}"`
          }
        ]
      };
      const handOff = {
        type: "handoff",
        target: targetTopicName,
        enabled: `state.AgentScriptInternal_next_topic=="${targetTopicName}"`,
        state_updates: [
          {
            AgentScriptInternal_next_topic: '"__EMPTY__"'
          }
        ]
      };
      return { action: action2, handOff };
    }
  }
  return void 0;
}

// ../compiler/dist/nodes/compile-reasoning-actions.js
function compileReasoningActions(reasoning, options, ctx) {
  const { nodeType, topicName, topicDescriptions } = options;
  const tools = [];
  const postToolCalls = [];
  const handOffActions = [];
  const { instructionTemplate, instructionTemplateParts, isProcedural, proceduralStatements } = extractInstructionTemplate(reasoning, nodeType, ctx);
  const reasoningTools = reasoning?.actions;
  if (!reasoningTools) {
    return {
      tools,
      postToolCalls,
      handOffActions,
      instructionTemplate,
      instructionTemplateParts,
      isProcedural,
      proceduralStatements
    };
  }
  for (const [actionName, actionDef] of iterateNamedMap(reasoningTools)) {
    const def = actionDef;
    const body = def.statements ?? [];
    const actionType = resolveActionType(actionName, def);
    if (!isActionTypeAllowed(actionType, nodeType)) {
      emitDisallowedActionDiagnostic(actionType, actionName, nodeType, def, ctx);
      continue;
    }
    const result = compileAction(actionType, actionName, def, body, nodeType, topicName, topicDescriptions, ctx);
    const adaptedTools = adaptToolsForNodeType(result.tools, nodeType);
    tools.push(...adaptedTools);
    if (nodeType === "subagent") {
      postToolCalls.push(...result.postToolCalls);
      handOffActions.push(...result.handOffActions);
    }
  }
  return {
    tools,
    postToolCalls,
    handOffActions,
    instructionTemplate,
    instructionTemplateParts,
    isProcedural,
    proceduralStatements
  };
}
function extractInstructionTemplate(reasoning, nodeType, ctx) {
  let instructionTemplateParts;
  let isProcedural = false;
  let proceduralStatements;
  if (!reasoning) {
    return {
      instructionTemplate: void 0,
      instructionTemplateParts,
      isProcedural,
      proceduralStatements
    };
  }
  const instructions = reasoning.instructions;
  if (!instructions) {
    return {
      instructionTemplate: void 0,
      instructionTemplateParts,
      isProcedural,
      proceduralStatements
    };
  }
  if (instructions.statements) {
    const stmts = instructions.statements;
    const hasNonTemplate = stmts.some((s) => s.__kind !== "Template");
    if (hasNonTemplate) {
      isProcedural = true;
      proceduralStatements = stmts;
    }
    if (nodeType === "subagent" && !hasNonTemplate && stmts.length > 1) {
      instructionTemplateParts = stmts.map((stmt) => ({
        text: compileTemplateValue(stmt, ctx, {
          allowActionReferences: true
        }),
        range: stmt.__cst?.range
      })).filter((p) => p.text);
    }
  }
  const instructionTemplate = compileTemplateValue(instructions, ctx, {
    allowActionReferences: true
  });
  return {
    instructionTemplate,
    instructionTemplateParts,
    isProcedural,
    proceduralStatements
  };
}
function emitDisallowedActionDiagnostic(actionType, actionName, nodeType, def, ctx) {
  if (nodeType !== "router") {
    return;
  }
  let actionDescription = "";
  let allowedTypes = "";
  if (actionType === "supervise") {
    const decomposed = def.value ? decomposeAtMemberExpression(def.value) : null;
    let message2 = "";
    if (decomposed?.namespace === "connected_subagent") {
      message2 = `Router node cannot use connected agent handoff '${actionName}'. Router nodes use hyperclassifier models for simple routing and do not support handoffs to connected agents. Remove the hyper classifier config if you need to invoke connected agents.`;
    } else {
      message2 = `Router node cannot use handoff action '${actionName}'. Router nodes use hyperclassifier models for simple routing and do not support handoffs to subagents or topics. Use transitions (@utils.transition) for routing or remove the hyper classifier config if you need to use handoff.`;
    }
    ctx.error(message2, def.__cst?.range);
    return;
  }
  if (actionType === "tool") {
    const decomposed = def.value ? decomposeAtMemberExpression(def.value) : null;
    if (decomposed?.namespace === "actions") {
      actionDescription = `action reference '@actions.${decomposed.property}'`;
      const hasLLMInputs = hasLLMInputParameters(def);
      if (hasLLMInputs) {
        const message2 = `Router node cannot use action '${actionName}' with LLM inputs (param=...). Router nodes use hyperclassifier models and cannot fill action inputs via LLM. Either provide explicit values for all inputs or move this action to a subagent node.`;
        ctx.error(message2, def.__cst?.range);
        return;
      }
    } else {
      actionDescription = "action";
    }
  } else {
    actionDescription = `'@utils.${actionType}' action`;
  }
  allowedTypes = "transitions (@utils.transition) and connected-subagents (@connected_subagent.X)";
  const message = `Router nodes only support ${allowedTypes}. The ${actionDescription} '${actionName}' will be ignored. Consider moving it to a subagent node or removing it.`;
  ctx.error(message, def.__cst?.range);
}
function hasLLMInputParameters(def) {
  const body = def.statements ?? [];
  for (const stmt of body) {
    if (stmt instanceof WithClause) {
      if (stmt.value instanceof Ellipsis) {
        return true;
      }
    }
  }
  return false;
}
function isActionTypeAllowed(actionType, nodeType) {
  if (nodeType === "subagent") {
    return true;
  }
  if (actionType === "transition") {
    return true;
  }
  return false;
}
function compileRouterTransition(actionName, def, body, topicDescriptions, ctx) {
  let targetName;
  let enabledCondition;
  for (const stmt of body) {
    if (stmt instanceof ToClause) {
      if (warnIfConnectedAgentTransition(stmt.target, ctx))
        continue;
      const resolved = resolveAtReference(stmt.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
      if (resolved)
        targetName = resolved;
    } else if (stmt instanceof TransitionStatement) {
      for (const clause of stmt.clauses) {
        if (clause instanceof ToClause) {
          if (warnIfConnectedAgentTransition(clause.target, ctx))
            continue;
          const resolved = resolveAtReference(clause.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
          if (resolved)
            targetName = resolved;
        }
      }
    } else if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause"
      });
    }
  }
  const resolvedTarget = targetName ?? actionName;
  const alias = extractSourcedString(def.label);
  const description = extractSourcedDescription(def.description) ?? topicDescriptions[resolvedTarget] ?? "";
  const tool2 = {
    name: alias ?? actionName,
    target: resolvedTarget,
    description
  };
  if (enabledCondition) {
    tool2.enabled = enabledCondition;
  }
  return tool2;
}
function compileAction(actionType, actionName, def, body, nodeType, topicName, topicDescriptions, ctx) {
  switch (actionType) {
    case "transition": {
      if (nodeType === "router") {
        const tool2 = compileRouterTransition(actionName, def, body, topicDescriptions, ctx);
        return { tools: [tool2], postToolCalls: [], handOffActions: [] };
      }
      const result = compileTransition(actionName, def, body, topicName, topicDescriptions, ctx);
      return {
        tools: result.tools,
        postToolCalls: [],
        handOffActions: result.handOffActions
      };
    }
    case "setVariables": {
      const tool2 = compileSetVariables(actionName, def, body, ctx);
      return { tools: [tool2], postToolCalls: [], handOffActions: [] };
    }
    case "supervise": {
      const decomposed = def.value ? decomposeAtMemberExpression(def.value) : null;
      if (decomposed?.namespace === "connected_subagent") {
        const result2 = compileTool(actionName, def, body, ctx);
        return {
          tools: [result2.tool],
          postToolCalls: result2.postToolCall ? [result2.postToolCall] : [],
          handOffActions: result2.handOffActions
        };
      }
      const result = compileSupervision(actionName, def, body, topicDescriptions, ctx);
      return { tools: [result.tool], postToolCalls: [], handOffActions: [] };
    }
    case "escalate": {
      const result = compileEscalate(actionName, def, body, ctx);
      return {
        tools: [result.tool],
        postToolCalls: [],
        handOffActions: [result.handOffAction]
      };
    }
    default: {
      const result = compileTool(actionName, def, body, ctx);
      return {
        tools: [result.tool],
        postToolCalls: result.postToolCall ? [result.postToolCall] : [],
        handOffActions: result.handOffActions
      };
    }
  }
}
function adaptToolsForNodeType(tools, nodeType) {
  if (nodeType === "subagent") {
    return tools;
  }
  return tools.map((tool2) => {
    const routerTool = {
      name: tool2.name,
      target: tool2.target,
      description: tool2.description
    };
    if (tool2.enabled !== void 0) {
      routerTool.enabled = tool2.enabled;
    }
    if (tool2.state_updates && tool2.state_updates.length > 0) {
      routerTool.state_updates = tool2.state_updates;
    }
    return routerTool;
  });
}

// ../compiler/dist/nodes/compile-subagent-node.js
function compileSubAgentNode(topicName, topicBlock, systemBlock, topicDescriptions, globalModelConfig, ctx) {
  const description = extractSourcedDescription(topicBlock.description) ?? "";
  const label = extractSourcedString(topicBlock.label) ?? normalizeDeveloperName(topicName);
  const source = extractSourcedString(topicBlock.source) ?? void 0;
  const topicModelConfig = extractTopicModelConfiguration(topicBlock, ctx);
  const mergedModelConfig = mergeModelConfigurations(globalModelConfig, topicModelConfig);
  const actionDefinitions = compileActionDefinitions(topicBlock.tool_definitions ?? topicBlock.actions, ctx);
  const { tools, postToolCalls, afterAllToolCalls, instructionTemplate, instructionTemplateParts, isProcedural, proceduralStatements } = compileReasoningTools(topicName, topicBlock.reasoning, topicDescriptions, ctx);
  const systemInstructions = compileSystemInstructions(systemBlock, topicBlock, ctx);
  let focusPrompt;
  let beforeReasoningIteration;
  if (instructionTemplate !== void 0) {
    if (isProcedural && proceduralStatements) {
      const hasTemplateContent = statementsHaveTemplateContent(proceduralStatements);
      focusPrompt = hasTemplateContent ? `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}` : "";
      beforeReasoningIteration = compileBeforeReasoningIteration(proceduralStatements, ctx);
    } else {
      focusPrompt = `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`;
      const parts = instructionTemplateParts ?? [
        {
          text: instructionTemplate,
          range: topicBlock.reasoning?.instructions?.__cst?.range
        }
      ];
      beforeReasoningIteration = compileSimpleInstructionIteration(parts, ctx);
    }
  } else {
    focusPrompt = compileFocusPrompt(void 0, topicBlock.reasoning);
    beforeReasoningIteration = [];
  }
  const beforeReasoning = compileBeforeReasoning(extractStatements(topicBlock.before_reasoning), ctx);
  const afterReasoning = compileAfterReasoning(extractStatements(topicBlock.after_reasoning), ctx);
  const node = {
    type: "subagent",
    reasoning_type: DEFAULT_REASONING_TYPE,
    description,
    tools,
    developer_name: topicName,
    label,
    action_definitions: actionDefinitions
  };
  if (systemInstructions) {
    node.instructions = systemInstructions;
  }
  if (focusPrompt) {
    node.focus_prompt = focusPrompt;
  }
  if (beforeReasoningIteration.length > 0) {
    node.before_reasoning_iteration = beforeReasoningIteration;
  }
  if (beforeReasoning) {
    node.before_reasoning = beforeReasoning;
  }
  if (afterReasoning) {
    node.after_reasoning = afterReasoning;
  }
  if (afterAllToolCalls.length > 0) {
    node.after_all_tool_calls = afterAllToolCalls;
  }
  if (postToolCalls.length > 0) {
    node.post_tool_call = postToolCalls;
  }
  if (mergedModelConfig) {
    node.model_configuration = mergedModelConfig;
  }
  if (source !== void 0) {
    node.source = source;
  }
  ctx.setScriptPath(node, topicName);
  return node;
}
function compileReasoningTools(topicName, reasoning, topicDescriptions, ctx) {
  const tools = [];
  const postToolCalls = [];
  const allHandOffs = [];
  let instructionTemplate;
  let instructionTemplateParts;
  if (!reasoning) {
    return {
      tools,
      postToolCalls,
      afterAllToolCalls: allHandOffs,
      instructionTemplate,
      instructionTemplateParts,
      isProcedural: false,
      proceduralStatements: void 0
    };
  }
  const reasoningTools = reasoning.actions;
  ctx.actionReferenceMap.clear();
  if (reasoningTools) {
    for (const [actionKey, actionDef] of iterateNamedMap(reasoningTools)) {
      const def = actionDef;
      const actionType = resolveActionType(actionKey, def);
      if (actionType === "transition") {
        const body = def.statements ?? [];
        let foundTarget = false;
        for (const stmt of body) {
          if (stmt instanceof ToClause) {
            if (warnIfConnectedAgentTransition(stmt.target, ctx))
              continue;
            const targetName = resolveAtReference(stmt.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
            if (targetName) {
              ctx.actionReferenceMap.set(targetName, actionKey);
              foundTarget = true;
            }
          } else if (stmt instanceof TransitionStatement) {
            for (const clause of stmt.clauses) {
              if (clause instanceof ToClause) {
                if (warnIfConnectedAgentTransition(clause.target, ctx))
                  continue;
                const targetName = resolveAtReference(clause.target, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
                if (targetName) {
                  ctx.actionReferenceMap.set(targetName, actionKey);
                  foundTarget = true;
                }
              }
            }
          }
        }
        if (!foundTarget && def.value) {
          if (!warnIfConnectedAgentTransition(def.value, ctx)) {
            const targetName = resolveAtReference(def.value, TRANSITION_TARGET_NAMESPACES, ctx, "transition target");
            if (targetName) {
              ctx.actionReferenceMap.set(targetName, actionKey);
            }
          }
        }
      }
    }
  }
  const result = compileReasoningActions(reasoning, {
    nodeType: "subagent",
    topicName,
    topicDescriptions
  }, ctx);
  return {
    tools: result.tools,
    postToolCalls: result.postToolCalls,
    afterAllToolCalls: result.handOffActions,
    instructionTemplate: result.instructionTemplate,
    instructionTemplateParts: result.instructionTemplateParts,
    isProcedural: result.isProcedural,
    proceduralStatements: result.proceduralStatements
  };
}
function compileSystemInstructions(systemBlock, topicBlock, ctx) {
  const opts = { allowActionReferences: true };
  if (topicBlock.system) {
    const instructions = compileTemplateValue(topicBlock.system.instructions, ctx, opts);
    if (instructions)
      return dedent(instructions);
  }
  if (systemBlock) {
    const instructions = compileTemplateValue(systemBlock.instructions, ctx, opts);
    if (instructions)
      return dedent(instructions);
  }
  return "";
}
function compileBeforeReasoningIteration(statements, ctx) {
  if (statements.length === 0)
    return [];
  const resetAction = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    enabled: "True",
    state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }]
  };
  const result = [resetAction];
  const actions = compileDeterministicDirectives(statements, ctx, {
    addNextTopicResetAction: false,
    gateOnNextTopicEmpty: false,
    agentInstructionsVariable: AGENT_INSTRUCTIONS_VARIABLE
  });
  result.push(...actions);
  return result;
}
function compileSimpleInstructionIteration(templateParts, _ctx) {
  const resetAction = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    enabled: "True",
    state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }]
  };
  const result = [resetAction];
  for (const part of templateParts) {
    const appendAction = {
      type: "action",
      target: STATE_UPDATE_ACTION,
      state_updates: [
        {
          [AGENT_INSTRUCTIONS_VARIABLE]: `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}
${part.text}`
        }
      ]
    };
    result.push(appendAction);
  }
  return result;
}
function compileFocusPrompt(instructionTemplate, reasoning) {
  if (instructionTemplate) {
    return instructionTemplate.trim();
  }
  if (reasoning) {
    const focusPrompt = extractStringValue(reasoning["focus_prompt"]);
    if (focusPrompt)
      return focusPrompt;
  }
  return "";
}
function compileBeforeReasoning(directives, ctx) {
  if (!directives || directives.length === 0)
    return null;
  return compileDeterministicDirectives(directives, ctx, {
    addNextTopicResetAction: true,
    gateOnNextTopicEmpty: true
  });
}
function compileAfterReasoning(directives, ctx) {
  if (!directives || directives.length === 0)
    return null;
  return compileDeterministicDirectives(directives, ctx, {
    addNextTopicResetAction: true,
    gateOnNextTopicEmpty: true
  });
}
function statementsHaveTemplateContent(statements) {
  for (const stmt of statements) {
    if (stmt instanceof Template) {
      if (stmt.parts?.some((p) => p instanceof TemplateText && p.value?.trim() || p instanceof TemplateInterpolation)) {
        return true;
      }
    }
    if (stmt instanceof IfStatement) {
      if (statementsHaveTemplateContent(stmt.body))
        return true;
      if (stmt.orelse.length > 0 && statementsHaveTemplateContent(stmt.orelse))
        return true;
    } else if (stmt instanceof RunStatement) {
      if (statementsHaveTemplateContent(stmt.body))
        return true;
    }
  }
  return false;
}
function extractStatements(value) {
  if (!value)
    return void 0;
  if (Array.isArray(value))
    return value;
  if ("statements" in value) {
    return value.statements;
  }
  return void 0;
}

// ../compiler/dist/nodes/compile-router-node.js
function compileRouterNode(topicName, topicBlock, systemBlock, topicDescriptions, globalModelConfig, ctx) {
  const description = extractSourcedDescription(topicBlock.description) ?? "";
  const label = extractSourcedString(topicBlock.label) ?? normalizeDeveloperName(topicName);
  const source = extractSourcedString(topicBlock.source) ?? void 0;
  const topicModelConfig = extractTopicModelConfiguration(topicBlock, ctx);
  const modelConfig2 = mergeModelConfigurations(globalModelConfig, topicModelConfig);
  const systemInstructions = compileRouterSystemInstructions(systemBlock, topicBlock, ctx);
  const { tools, instructionTemplate, isProcedural, proceduralStatements } = compileRouterTools(topicBlock.reasoning, topicDescriptions, ctx);
  const actionDefinitions = compileActionDefinitions(topicBlock.actions, ctx);
  const beforeReasoningIteration = compileRouterBeforeReasoningIteration(instructionTemplate, isProcedural, proceduralStatements, ctx);
  const hasInstructions = isProcedural || instructionTemplate !== void 0 && instructionTemplate !== "";
  const instructions = hasInstructions ? `${systemInstructions}

{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}` : systemInstructions;
  const node = {
    model_configuration: modelConfig2,
    type: "router",
    description,
    instructions,
    tools,
    developer_name: topicName,
    label,
    action_definitions: actionDefinitions
  };
  if (beforeReasoningIteration.length > 0) {
    node.before_reasoning_iteration = beforeReasoningIteration;
  }
  if (source !== void 0) {
    node.source = source;
  }
  ctx.setScriptPath(node, topicName);
  return node;
}
function compileRouterSystemInstructions(systemBlock, topicBlock, _ctx) {
  if (topicBlock.system) {
    const instructions = extractStringValue(topicBlock.system.instructions);
    if (instructions)
      return dedent(instructions);
  }
  if (systemBlock) {
    const instructions = extractStringValue(systemBlock.instructions);
    if (instructions)
      return dedent(instructions);
  }
  return "";
}
function compileRouterTools(reasoning, topicDescriptions, ctx) {
  const tools = [];
  let instructionTemplate;
  if (!reasoning) {
    return {
      tools,
      instructionTemplate,
      isProcedural: false,
      proceduralStatements: void 0
    };
  }
  const result = compileReasoningActions(reasoning, {
    nodeType: "router",
    topicName: "",
    // Router nodes don't have a current topic name
    topicDescriptions
  }, ctx);
  return {
    tools: result.tools,
    // Type assertion safe due to adaptation
    instructionTemplate: result.instructionTemplate,
    isProcedural: result.isProcedural,
    proceduralStatements: result.proceduralStatements
  };
}
function compileRouterBeforeReasoningIteration(instructionTemplate, isProcedural, proceduralStatements, _ctx) {
  if (isProcedural && proceduralStatements) {
    const resetAction2 = {
      type: "action",
      target: STATE_UPDATE_ACTION,
      enabled: "True",
      state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }]
    };
    const actions = compileDeterministicDirectives(proceduralStatements, _ctx, {
      addNextTopicResetAction: false,
      gateOnNextTopicEmpty: false,
      agentInstructionsVariable: AGENT_INSTRUCTIONS_VARIABLE
    });
    return [resetAction2, ...actions];
  }
  if (!instructionTemplate)
    return [];
  const resetAction = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    enabled: "True",
    state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }]
  };
  const appendAction = {
    type: "action",
    target: STATE_UPDATE_ACTION,
    state_updates: [
      {
        [AGENT_INSTRUCTIONS_VARIABLE]: `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}
${instructionTemplate}`
      }
    ]
  };
  return [resetAction, appendAction];
}

// ../compiler/dist/nodes/compile-node.js
function compileNode(topicName, topicBlock, systemBlock, topicDescriptions, globalModelConfig, ctx) {
  if (isHyperclassifierNode(topicBlock)) {
    return compileRouterNode(topicName, topicBlock, systemBlock, topicDescriptions, globalModelConfig, ctx);
  }
  return compileSubAgentNode(topicName, topicBlock, systemBlock, topicDescriptions, globalModelConfig, ctx);
}
function isHyperclassifierNode(topicBlock) {
  if (!topicBlock.model_config)
    return false;
  const modelStr = extractStringValue(topicBlock.model_config.model);
  if (!modelStr)
    return false;
  return modelStr.includes(HYPERCLASSIFIER_MODEL_PREFIX);
}

// ../compiler/dist/nodes/compile-connected-agent-node.js
function compileConnectedAgentNode(name, block, ctx) {
  const label = extractSourcedString(block.label) ?? normalizeDeveloperName(name);
  const description = extractSourcedDescription(block.description) ?? "";
  const loadingText = extractSourcedString(block.loading_text) ?? void 0;
  const boundInputs = compileBoundInputs(block.inputs, ctx);
  const targetUri = extractStringValue(block.target);
  let invocationTargetType = "externalService";
  let invocationTargetName = name;
  if (targetUri) {
    const { scheme, path } = parseUri(targetUri);
    if (scheme)
      invocationTargetType = scheme;
    if (path)
      invocationTargetName = path;
  }
  const node = {
    type: "related_agent",
    developer_name: name,
    label,
    description,
    invocation_target_type: invocationTargetType,
    invocation_target_name: invocationTargetName
  };
  if (loadingText !== void 0) {
    node.loading_text = loadingText;
  }
  if (boundInputs !== void 0) {
    node.bound_inputs = boundInputs;
  }
  ctx.setScriptPath(node, name);
  return node;
}
function compileBoundInputs(inputs, ctx) {
  if (!inputs || inputs.size === 0)
    return void 0;
  const result = {};
  for (const [name, decl] of iterateNamedMap(inputs)) {
    if (decl.defaultValue) {
      result[name] = compileExpression(decl.defaultValue, ctx);
    }
  }
  return Object.keys(result).length > 0 ? result : void 0;
}

// ../compiler/dist/surfaces/compile-surfaces.js
var CONNECTION_TYPES = {
  messaging: "messaging",
  service_email: "service_email",
  slack: "slack",
  telephony: "telephony",
  voice: "voice"
};
function compileSurfaces(connections, agentType2, ctx) {
  if (!connections)
    return [];
  const result = [];
  for (const [name, def] of iterateNamedMap(connections)) {
    const surface2 = compileSurface(name, def, agentType2, ctx);
    if (surface2) {
      result.push(surface2);
    }
  }
  return result;
}
function compileSurface(name, def, agentType2, ctx) {
  const connectionType = getConnectionType(name);
  const adaptiveResponseAllowed = extractSourcedBoolean(def.adaptive_response_allowed) ?? void 0;
  const instructions = extractSourcedString(def.instructions) ?? void 0;
  const outboundRouteConfigs = compileOutboundRouteConfigs(def, ctx);
  const responseActions = compileResponseActions(def, ctx);
  validateConnection(name, connectionType, def, agentType2, ctx);
  const surface2 = {
    surface_type: connectionType
  };
  if (adaptiveResponseAllowed !== void 0) {
    surface2.adaptive_response_allowed = adaptiveResponseAllowed;
  }
  if (instructions !== void 0) {
    surface2.instructions = instructions;
  }
  surface2.outbound_route_configs = outboundRouteConfigs;
  if (responseActions.length > 0) {
    surface2.response_actions = responseActions;
  }
  return surface2;
}
function getConnectionType(name) {
  return CONNECTION_TYPES[name.toLowerCase()] ?? name;
}
function compileOutboundRouteConfigs(def, _ctx) {
  const routeType = extractSourcedString(def.outbound_route_type);
  const routeName = extractSourcedString(def.outbound_route_name);
  const escalationMessage = extractSourcedString(def.escalation_message);
  if (!routeType && !routeName && !escalationMessage) {
    return [];
  }
  if (routeName) {
    const config2 = {
      outbound_route_type: routeType ?? "OmniChannelFlow",
      outbound_route_name: routeName
    };
    if (escalationMessage !== void 0) {
      config2.escalation_message = escalationMessage;
    }
    return [config2];
  }
  return [];
}
function compileResponseActions(def, _ctx) {
  if (!def.response_actions)
    return [];
  const result = [];
  for (const [name, actionDef] of iterateNamedMap(def.response_actions)) {
    const description = extractSourcedString(actionDef.description) ?? "";
    const label = extractSourcedString(actionDef.label) ?? normalizeDeveloperName(name);
    const action2 = {
      developer_name: name,
      label,
      description
    };
    result.push(action2);
  }
  return result;
}
function validateConnection(_name, connectionType, def, agentType2, ctx) {
  switch (connectionType) {
    case "slack": {
      if (agentType2 && !agentType2.includes("Employee")) {
        ctx.warning(`Slack connection is only supported for Employee agent types`, def.__cst?.range);
      }
      break;
    }
    case "service_email": {
      const escalationMessage = extractStringValue(def.escalation_message);
      if (escalationMessage) {
        ctx.warning(`Service email connections do not support escalation_message`, def.__cst?.range);
      }
      break;
    }
  }
}

// ../compiler/dist/agent-version/compile-agent-version.js
function compileAgentVersion(parsed, contextVariables, additionalParameters, ctx) {
  const blocks = collectTopicBlocks(parsed);
  const stateVariables = compileStateVariables(parsed.variables, contextVariables, blocks.map((b) => b.block), ctx);
  ctx.stateVariables = stateVariables;
  const systemMessages = compileSystemMessages(parsed.system, ctx);
  const modalityParameters2 = compileModalityParameters(parsed.language, parsed.modality, ctx);
  const initialNode = getInitialNodeName(parsed, ctx);
  const topicDescriptions = createTopicDescriptions(blocks);
  const globalModelConfig = extractGlobalModelConfiguration(parsed, ctx);
  if (parsed.connected_subagent) {
    for (const [name, block] of iterateNamedMap(parsed.connected_subagent)) {
      populateConnectedAgentInputSignature(name, block, ctx);
    }
  }
  const nodes = [];
  for (const { name, block } of blocks) {
    const node = compileNode(name, block, parsed.system, topicDescriptions, globalModelConfig, ctx);
    nodes.push(node);
  }
  if (parsed.connected_subagent) {
    for (const [name, block] of iterateNamedMap(parsed.connected_subagent)) {
      const node = compileConnectedAgentNode(name, block, ctx);
      nodes.push(node);
    }
  }
  const agentType2 = extractStringValue(parsed.config?.agent_type);
  const surfaces = compileSurfaces(parsed.connection, agentType2 ?? void 0, ctx);
  const { company, role } = extractCompanyAndRole(parsed.config);
  const mergedAdditionalParams = mergeSystemMessagesIntoAdditionalParams(additionalParameters, systemMessages);
  const hasModalityParameters = modalityParameters2.language !== null || modalityParameters2.voice !== void 0;
  const version2 = {
    planner_type: DEFAULT_PLANNER_TYPE,
    system_messages: systemMessages,
    state_variables: stateVariables,
    initial_node: initialNode,
    nodes,
    surfaces,
    // Include modality_parameters if either language or voice is present
    modality_parameters: hasModalityParameters ? modalityParameters2 : {}
  };
  if (mergedAdditionalParams) {
    version2.additional_parameters = mergedAdditionalParams;
  }
  if (company !== null || role !== null) {
    version2.company = company;
    version2.role = role;
  }
  return version2;
}
function collectTopicBlocks(parsed) {
  const blocks = [];
  if (parsed.start_agent) {
    for (const [name, block] of iterateNamedMap(parsed.start_agent)) {
      blocks.push({
        name,
        block,
        isStartAgent: true
      });
    }
  }
  if (parsed.topic) {
    for (const [name, block] of iterateNamedMap(parsed.topic)) {
      blocks.push({
        name,
        block,
        isStartAgent: false
      });
    }
  }
  if (parsed.subagent) {
    for (const [name, block] of iterateNamedMap(parsed.subagent)) {
      blocks.push({
        name,
        block,
        isStartAgent: false
      });
    }
  }
  return blocks;
}
function getInitialNodeName(parsed, ctx) {
  if (!parsed.start_agent || parsed.start_agent.size === 0) {
    ctx.error("No start_agent block found");
    return "start_agent";
  }
  if (parsed.start_agent.size > 1) {
    ctx.error("Multiple start_agent blocks found; only one is allowed");
  }
  const [firstName] = parsed.start_agent.keys();
  return firstName;
}
function createTopicDescriptions(blocks) {
  const descriptions = {};
  for (const { name, block } of blocks) {
    const desc = extractDescriptionValue(block.description);
    if (desc) {
      descriptions[name] = desc;
    }
  }
  return descriptions;
}
function populateConnectedAgentInputSignature(name, block, ctx) {
  const allInputs = /* @__PURE__ */ new Set();
  const inputsWithDefaults = /* @__PURE__ */ new Set();
  if (block.inputs) {
    for (const [inputName, paramDef] of iterateNamedMap(block.inputs)) {
      allInputs.add(inputName);
      const decl = paramDef;
      if (decl.defaultValue) {
        inputsWithDefaults.add(inputName);
      }
    }
  }
  ctx.connectedAgentInputs.set(name, { allInputs, inputsWithDefaults });
}
function mergeSystemMessagesIntoAdditionalParams(additionalParameters, systemMessages) {
  const serialized = serializeSystemMessagesForAdditionalParams(systemMessages);
  const result = {
    reset_to_initial_node: true,
    ...additionalParameters
  };
  if (serialized) {
    result.system_messages = serialized;
  }
  return result;
}

// ../compiler/dist/context/compile-context.js
function compileContext(contextBlock, ctx) {
  if (!contextBlock) {
    return void 0;
  }
  const result = {};
  if (contextBlock.memory) {
    const enabled = extractBooleanValue(contextBlock.memory.enabled);
    if (enabled === null || enabled === void 0) {
      ctx.error('Context memory block requires an "enabled" field with a boolean value');
    } else {
      result.memory = { enabled };
    }
  }
  if (Object.keys(result).length === 0) {
    return void 0;
  }
  return result;
}

// ../compiler/dist/compile.js
function compile(ast) {
  const ctx = new CompilerContext();
  validateKnowledgeReferences(ast.knowledge, ctx);
  const contextVariables = compileContextVariables(ast.variables, ctx);
  if (ast.variables) {
    for (const [name, varDef] of ast.variables) {
      const def = varDef;
      if (def.modifier?.name !== "linked") {
        ctx.mutableVariableNames.add(name);
      }
    }
  }
  const globalConfiguration = compileAgentConfiguration(ast.config, contextVariables, ctx);
  const security = compileSecurity(ast.security, ctx);
  if (security) {
    globalConfiguration.security = security;
  }
  const additionalParameters = extractAdditionalParameters(ast.config, ast.knowledge);
  const agentVersion2 = compileAgentVersion(ast, contextVariables, additionalParameters, ctx);
  const context = compileContext(ast.context, ctx);
  const output = ctx.track({
    schema_version: SCHEMA_VERSION,
    global_configuration: globalConfiguration,
    agent_version: agentVersion2
  });
  validateOutput(output, agentDslAuthoring, ctx);
  if (context) {
    const contextValidation = contextConfiguration.safeParse(context);
    if (contextValidation.success) {
      const agentVersionOut = output.agent_version;
      if (Array.isArray(agentVersionOut)) {
        if (agentVersionOut.length > 0) {
          agentVersionOut[0].context = context;
        }
      } else {
        agentVersionOut.context = context;
      }
    } else {
      ctx.error(`Context validation failed: ${contextValidation.error.message}`);
    }
  }
  return {
    output,
    ranges: ctx.ranges,
    diagnostics: ctx.diagnostics
  };
}

// ../../node_modules/.pnpm/@jridgewell+sourcemap-codec@1.5.5/node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.mjs
var comma = ",".charCodeAt(0);
var semicolon = ";".charCodeAt(0);
var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var intToChar = new Uint8Array(64);
var charToInt = new Uint8Array(128);
for (let i = 0; i < chars.length; i++) {
  const c = chars.charCodeAt(i);
  intToChar[i] = c;
  charToInt[c] = i;
}
function encodeInteger(builder, num, relative) {
  let delta = num - relative;
  delta = delta < 0 ? -delta << 1 | 1 : delta << 1;
  do {
    let clamped = delta & 31;
    delta >>>= 5;
    if (delta > 0) clamped |= 32;
    builder.write(intToChar[clamped]);
  } while (delta > 0);
  return num;
}
var bufLength = 1024 * 16;
var td = typeof TextDecoder !== "undefined" ? /* @__PURE__ */ new TextDecoder() : typeof Buffer !== "undefined" ? {
  decode(buf) {
    const out = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    return out.toString();
  }
} : {
  decode(buf) {
    let out = "";
    for (let i = 0; i < buf.length; i++) {
      out += String.fromCharCode(buf[i]);
    }
    return out;
  }
};
var StringWriter = class {
  constructor() {
    this.pos = 0;
    this.out = "";
    this.buffer = new Uint8Array(bufLength);
  }
  write(v) {
    const { buffer } = this;
    buffer[this.pos++] = v;
    if (this.pos === bufLength) {
      this.out += td.decode(buffer);
      this.pos = 0;
    }
  }
  flush() {
    const { buffer, out, pos } = this;
    return pos > 0 ? out + td.decode(buffer.subarray(0, pos)) : out;
  }
};
function encode2(decoded) {
  const writer = new StringWriter();
  let sourcesIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let namesIndex = 0;
  for (let i = 0; i < decoded.length; i++) {
    const line = decoded[i];
    if (i > 0) writer.write(semicolon);
    if (line.length === 0) continue;
    let genColumn = 0;
    for (let j = 0; j < line.length; j++) {
      const segment = line[j];
      if (j > 0) writer.write(comma);
      genColumn = encodeInteger(writer, segment[0], genColumn);
      if (segment.length === 1) continue;
      sourcesIndex = encodeInteger(writer, segment[1], sourcesIndex);
      sourceLine = encodeInteger(writer, segment[2], sourceLine);
      sourceColumn = encodeInteger(writer, segment[3], sourceColumn);
      if (segment.length === 4) continue;
      namesIndex = encodeInteger(writer, segment[4], namesIndex);
    }
  }
  return writer.flush();
}

// ../../node_modules/.pnpm/@jridgewell+gen-mapping@0.3.13/node_modules/@jridgewell/gen-mapping/dist/gen-mapping.mjs
var SetArray = class {
  constructor() {
    this._indexes = { __proto__: null };
    this.array = [];
  }
};
function cast(set) {
  return set;
}
function get(setarr, key) {
  return cast(setarr)._indexes[key];
}
function put(setarr, key) {
  const index = get(setarr, key);
  if (index !== void 0) return index;
  const { array: array2, _indexes: indexes } = cast(setarr);
  const length = array2.push(key);
  return indexes[key] = length - 1;
}
var COLUMN = 0;
var SOURCES_INDEX = 1;
var SOURCE_LINE = 2;
var SOURCE_COLUMN = 3;
var NAMES_INDEX = 4;
var NO_NAME = -1;
var GenMapping = class {
  constructor({ file, sourceRoot } = {}) {
    this._names = new SetArray();
    this._sources = new SetArray();
    this._sourcesContent = [];
    this._mappings = [];
    this.file = file;
    this.sourceRoot = sourceRoot;
    this._ignoreList = new SetArray();
  }
};
function cast2(map) {
  return map;
}
function addMapping(map, mapping) {
  return addMappingInternal(false, map, mapping);
}
function setSourceContent(map, source, content) {
  const {
    _sources: sources,
    _sourcesContent: sourcesContent
    // _originalScopes: originalScopes,
  } = cast2(map);
  const index = put(sources, source);
  sourcesContent[index] = content;
}
function toDecodedMap(map) {
  const {
    _mappings: mappings,
    _sources: sources,
    _sourcesContent: sourcesContent,
    _names: names,
    _ignoreList: ignoreList
    // _originalScopes: originalScopes,
    // _generatedRanges: generatedRanges,
  } = cast2(map);
  removeEmptyFinalLines(mappings);
  return {
    version: 3,
    file: map.file || void 0,
    names: names.array,
    sourceRoot: map.sourceRoot || void 0,
    sources: sources.array,
    sourcesContent,
    mappings,
    // originalScopes,
    // generatedRanges,
    ignoreList: ignoreList.array
  };
}
function toEncodedMap(map) {
  const decoded = toDecodedMap(map);
  return Object.assign({}, decoded, {
    // originalScopes: decoded.originalScopes.map((os) => encodeOriginalScopes(os)),
    // generatedRanges: encodeGeneratedRanges(decoded.generatedRanges as GeneratedRange[]),
    mappings: encode2(decoded.mappings)
  });
}
function addSegmentInternal(skipable, map, genLine, genColumn, source, sourceLine, sourceColumn, name, content) {
  const {
    _mappings: mappings,
    _sources: sources,
    _sourcesContent: sourcesContent,
    _names: names
    // _originalScopes: originalScopes,
  } = cast2(map);
  const line = getIndex(mappings, genLine);
  const index = getColumnIndex(line, genColumn);
  if (!source) {
    if (skipable && skipSourceless(line, index)) return;
    return insert(line, index, [genColumn]);
  }
  assert2(sourceLine);
  assert2(sourceColumn);
  const sourcesIndex = put(sources, source);
  const namesIndex = name ? put(names, name) : NO_NAME;
  if (sourcesIndex === sourcesContent.length) sourcesContent[sourcesIndex] = content != null ? content : null;
  if (skipable && skipSource(line, index, sourcesIndex, sourceLine, sourceColumn, namesIndex)) {
    return;
  }
  return insert(
    line,
    index,
    name ? [genColumn, sourcesIndex, sourceLine, sourceColumn, namesIndex] : [genColumn, sourcesIndex, sourceLine, sourceColumn]
  );
}
function assert2(_val) {
}
function getIndex(arr, index) {
  for (let i = arr.length; i <= index; i++) {
    arr[i] = [];
  }
  return arr[index];
}
function getColumnIndex(line, genColumn) {
  let index = line.length;
  for (let i = index - 1; i >= 0; index = i--) {
    const current = line[i];
    if (genColumn >= current[COLUMN]) break;
  }
  return index;
}
function insert(array2, index, value) {
  for (let i = array2.length; i > index; i--) {
    array2[i] = array2[i - 1];
  }
  array2[index] = value;
}
function removeEmptyFinalLines(mappings) {
  const { length } = mappings;
  let len = length;
  for (let i = len - 1; i >= 0; len = i, i--) {
    if (mappings[i].length > 0) break;
  }
  if (len < length) mappings.length = len;
}
function skipSourceless(line, index) {
  if (index === 0) return true;
  const prev = line[index - 1];
  return prev.length === 1;
}
function skipSource(line, index, sourcesIndex, sourceLine, sourceColumn, namesIndex) {
  if (index === 0) return false;
  const prev = line[index - 1];
  if (prev.length === 1) return false;
  return sourcesIndex === prev[SOURCES_INDEX] && sourceLine === prev[SOURCE_LINE] && sourceColumn === prev[SOURCE_COLUMN] && namesIndex === (prev.length === 5 ? prev[NAMES_INDEX] : NO_NAME);
}
function addMappingInternal(skipable, map, mapping) {
  const { generated, source, original, name, content } = mapping;
  if (!source) {
    return addSegmentInternal(
      skipable,
      map,
      generated.line - 1,
      generated.column,
      null,
      null,
      null,
      null,
      null
    );
  }
  assert2(original);
  return addSegmentInternal(
    skipable,
    map,
    generated.line - 1,
    generated.column,
    source,
    original.line - 1,
    original.column,
    name,
    content
  );
}

// ../compiler/dist/source-map/source-map-serializer.js
function serializeWithSourceMap(output, ranges, options) {
  const { sourcePath, sourceContent, file, indent = 2 } = options;
  const map = new GenMapping({ file: file ?? "" });
  setSourceContent(map, sourcePath, sourceContent);
  let genLine = 1;
  let genCol = 0;
  const chunks = [];
  const pathSegments = [];
  function currentPath() {
    return pathSegments.join(".");
  }
  function write(str) {
    for (const ch of str) {
      if (ch === "\n") {
        genLine++;
        genCol = 0;
      } else {
        genCol++;
      }
    }
    chunks.push(str);
  }
  function emitMapping(originalLine, originalColumn, name) {
    if (name) {
      addMapping(map, {
        generated: { line: genLine, column: genCol },
        source: sourcePath,
        original: { line: originalLine + 1, column: originalColumn },
        name
      });
    } else {
      addMapping(map, {
        generated: { line: genLine, column: genCol },
        source: sourcePath,
        original: { line: originalLine + 1, column: originalColumn }
      });
    }
  }
  function serializeValue(value, currentIndent) {
    if (value === null || value === void 0) {
      write("null");
      return;
    }
    if (typeof value === "string") {
      write(JSON.stringify(value));
      return;
    }
    if (typeof value === "number") {
      write(JSON.stringify(value));
      return;
    }
    if (typeof value === "boolean") {
      write(value ? "true" : "false");
      return;
    }
    if (Array.isArray(value)) {
      serializeArray(value, currentIndent);
      return;
    }
    if (typeof value === "object") {
      serializeObject(value, currentIndent);
      return;
    }
    write(JSON.stringify(value));
  }
  function serializeArray(arr, currentIndent) {
    if (arr.length === 0) {
      write("[]");
      return;
    }
    write("[\n");
    const childIndent = currentIndent + indent;
    for (let i = 0; i < arr.length; i++) {
      pathSegments.push(`[${i}]`);
      write(" ".repeat(childIndent));
      serializeValue(arr[i], childIndent);
      pathSegments.pop();
      if (i < arr.length - 1)
        write(",");
      write("\n");
    }
    write(" ".repeat(currentIndent) + "]");
  }
  function serializeObject(obj, currentIndent) {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      write("{}");
      return;
    }
    write("{\n");
    const childIndent = currentIndent + indent;
    const objRanges = ranges.get(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const val = obj[key];
      pathSegments.push(key);
      write(" ".repeat(childIndent));
      const range = objRanges?.get(key);
      if (range) {
        emitMapping(range.start.line, range.start.character, currentPath());
      }
      write(JSON.stringify(key));
      write(": ");
      serializeValue(val, childIndent);
      pathSegments.pop();
      if (i < keys.length - 1)
        write(",");
      write("\n");
    }
    write(" ".repeat(currentIndent) + "}");
  }
  serializeValue(output, 0);
  return {
    json: chunks.join(""),
    sourceMap: toEncodedMap(map)
  };
}

// src/compile.ts
function compileSource(source) {
  const parser = getParser2();
  const tree = parser.parse(source);
  const parseResult2 = parseAndLint(tree.rootNode, agentforceDialect);
  const document = Document.create(
    parseResult2.ast,
    parseResult2.diagnostics,
    parseResult2.store,
    parser
  );
  const compileResult = compile(
    parseResult2.ast
  );
  const diagnostics = [
    ...parseResult2.diagnostics,
    ...compileResult.diagnostics
  ];
  diagnostics.sort(
    (a, b) => a.severity - b.severity || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
  );
  return {
    output: compileResult.output,
    ranges: compileResult.ranges,
    diagnostics,
    document
  };
}

// src/browser.ts
if (typeof globalThis !== "undefined" && "window" in globalThis) {
  window.AgentforceScriptSDK = index_exports;
}
export {
  AFActionsBlock,
  AGENTSCRIPT_PRIMITIVE_TYPES,
  ActionBlock,
  ActionsBlock,
  AgentforceKindToSchemaKey,
  AgentforceSchema,
  AgentforceSchemaAliases,
  AgentforceSchemaInfo,
  AstNodeBase,
  AtIdentifier,
  AvailableWhen,
  BUILTIN_FUNCTIONS,
  BinaryExpression,
  Block,
  BooleanLiteral,
  BooleanValue,
  CAPTURE_MAP,
  CallExpression,
  CollectionBlock,
  ComparisonExpression,
  ConnectionBlock,
  ConnectionsBlock,
  ContextBlock,
  DependencyResolutionError,
  DiagnosticSeverity,
  DiagnosticTag,
  Dialect,
  DictLiteral,
  Document,
  Ellipsis,
  ErrorBlock,
  ErrorValue,
  ExpressionSequence,
  ExpressionValue,
  FieldBuilder,
  FieldChild,
  Identifier,
  IfStatement,
  InboundKeywordsBlock,
  InputPropertiesBlock,
  InputsBlock,
  KnowledgeBlock,
  LINT_SOURCE,
  LintEngine,
  ListLiteral,
  MapEntryChild,
  MemberExpression,
  NamedBlock,
  NamedCollectionBlock,
  NamedMap,
  NoneLiteral,
  NumberLiteral,
  NumberValue,
  OutputPropertiesBlock,
  OutputsBlock,
  ParameterDeclarationNode,
  PassStore,
  ProcedureValue,
  PronunciationDictEntryBlock,
  ReasoningActionBlock,
  ReasoningActionsBlock,
  ReferenceValue,
  RunStatement,
  SUGGESTION_THRESHOLD,
  SecurityBlock,
  Sequence,
  SequenceItemChild,
  SequenceNode,
  SetClause,
  SpreadExpression,
  StatementChild,
  StringLiteral,
  StringValue,
  SubscriptExpression,
  SymbolKind,
  TEMPLATE_PART_KINDS,
  TOKEN_MODIFIERS,
  TOKEN_TYPES,
  Template,
  TemplateExpression,
  TemplateInterpolation,
  TemplateText,
  TernaryExpression,
  ToClause,
  TransitionStatement,
  TypedDeclarationBase,
  TypedMap,
  UnaryExpression,
  UnknownStatement,
  UntypedBlock,
  VARIABLE_MODIFIERS,
  ValueChild,
  VariableDeclarationNode,
  VariablePropertiesBlock,
  VariablesBlock,
  WithClause,
  addBuilderMethods,
  agentforceDialect,
  agentforceSchemaContext,
  attachDiagnostic,
  buildKindToSchemaKey,
  collectDiagnostics,
  collectionLabel,
  compile,
  compileSource,
  constraintValidationKey,
  constraintValidationPass,
  createDiagnostic,
  createLanguageService,
  createNode,
  createSchemaContext,
  decomposeAtMemberExpression,
  decomposeMemberExpression,
  decreaseIndentPattern,
  dedupeOverlappingTokens,
  defaultRules2 as defaultRules,
  defineFieldAccessors,
  defineRule,
  dispatchAstChildren,
  duplicateKeyPass,
  each,
  emitChildren,
  emitComponent,
  emitDocument,
  emitIndent,
  emitKeyName,
  emptyBlockPass,
  executeQuery2 as executeQuery,
  expressionValidationPass,
  extractChildren,
  extractOutputRef,
  extractVariableRef,
  findAllReferences,
  findDefinitionAtPosition,
  findEnclosingScope,
  findKeywordInfo,
  findReferencesAtPosition,
  findSuggestion,
  forEachExpressionChild,
  formatConstraints,
  formatKeywordHoverMarkdown,
  formatSchemaHoverMarkdown,
  formatSuggestionHint,
  generateFieldSnippet,
  generateSemanticTokens2 as generateSemanticTokens,
  getAvailableNamespaces,
  getCompletionCandidates,
  getComponentKindConfig,
  getComponentKindOptions,
  getDocumentSymbols,
  getFieldCompletions,
  getGlobalScopes,
  getKeyText,
  getParser2 as getParser,
  getSchemaNamespaces,
  getSymbolMembers,
  getValueCompletions,
  increaseIndentPattern,
  init,
  inlineComments,
  isAtIdentifier2 as isAtIdentifier,
  isBlockChild,
  isCollectionFieldType,
  isEmittable,
  isIdentifier,
  isIfStatement,
  isKeyNode,
  isMemberExpression2 as isMemberExpression,
  isNamedBlockValue,
  isNamedCollectionFieldType,
  isNamedMap,
  isSetClause,
  isSingularBlock,
  isStringLiteral,
  isSubscriptExpression,
  isTemplateInterpolation,
  isTemplatePartKind,
  isTemplateText,
  isToClause,
  isTransitionStatement,
  isWithClause,
  keywordNames,
  leadingComments,
  levenshtein,
  lintDiagnostic,
  mapCaptureToToken,
  mutateComponent,
  onEnterRules,
  parse3 as parse,
  parseAndLint,
  parseCommentNode,
  parseComponent,
  parseComponentDebug,
  parseDialectAnnotation,
  parseResult,
  parseTemplateParts,
  positionIndexKey,
  positionIndexPass,
  queryDefinitionAtPosition,
  queryExpressionAtPosition,
  queryScopeAtPosition,
  recurseAstChildren,
  requiredFieldPass,
  resolveColinearAction,
  resolveDialect,
  resolveHover,
  resolveNamespaceKeys,
  resolveReference,
  resolveSchemaField,
  schemaContextKey,
  serializeWithSourceMap as serialize,
  singularCollectionPass,
  spreadContextPass,
  storeKey,
  symbolTableAnalyzer,
  symbolTableKey,
  trailingComments,
  typeMismatchDiagnostic,
  undefinedReferenceDiagnostic,
  undefinedReferencePass,
  union,
  unreachableCodePass,
  unusedVariablePass,
  validateStrictSchema,
  walkAstExpressions,
  walkDefinitionKeys,
  withCst
};
//# sourceMappingURL=browser.js.map
