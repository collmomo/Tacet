// The build check: every read of a `@live` getter or a `.tacet` template is followed hop by hop through the types, and a read the screen could not follow is an error naming it.
import ts from "typescript";
import path from "node:path";
import {compileScript, compileTemplate, parse as parseSfc} from "vue/compiler-sfc";
import type {DirectiveNode, ElementNode, ExpressionNode, RootNode, TemplateChildNode} from "@vue/compiler-core";
import {promoteScriptToSetup, readMark} from "./marks.js";

export interface Diagnostic {
    file: string;
    line: number;
    column: number;
    level: "error" | "hint";
    message: string;
}

export interface CheckOptions {
    /** The folder holding the tsconfig. Default: the current directory. */
    root?: string;
    /** The tsconfig file name. Default: tsconfig.json. */
    tsconfig?: string;
}

/** Where a value came from, which says what reads into it the screen can follow. */
type Source =
    | "deep"      // plain data under @deep: everything inside is followed
    | "fresh"     // a value made in this computation, or a const the script never writes: nobody else changes it
    | "tracked"   // a marked field's value or a live getter's result: the value, not what is inside it
    | "fixed"     // an identity that cannot change: `this`, a readonly field, a global; its inside by its type
    | "leaf";     // a value the check does not look into: a primitive, a value under a followed base, `any`

type Position = {file: string; line: number; column: number};
type Locate = (file: ts.SourceFile, position: number) => Position;

function mergeSources(a: Source, b: Source): Source {
    if (a === b || b === "leaf") return a;
    if (a === "leaf") return b;
    return isFollowed(a) && isFollowed(b) ? a : "fixed";
}

function isFollowed(source: Source): boolean {
    return source === "deep" || source === "fresh";
}

const CONTAINERS = new Set(["Array", "ReadonlyArray", "Map", "ReadonlyMap", "Set", "ReadonlySet", "WeakMap", "WeakSet", "Iterable", "IterableIterator", "ArrayIterator", "MapIterator", "SetIterator"]);
const READONLY_CONTAINERS = new Set(["ReadonlyArray", "ReadonlyMap", "ReadonlySet", "Iterable", "IterableIterator", "ArrayIterator", "MapIterator", "SetIterator"]);
/** Container methods whose result is made of the container's elements. */
const ELEMENT_RESULTS = new Set(["filter", "map", "find", "findLast", "slice", "concat", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "with", "at", "values", "entries", "keys", "get", "sort", "reverse", "splice", "pop", "shift", Symbol.iterator.description!]);
/** Which callback parameters receive an element: by method name. */
const CALLBACK_ELEMENTS: Record<string, number[]> = {
    forEach: [0, 1], map: [0], filter: [0], find: [0], findIndex: [0], findLast: [0], findLastIndex: [0],
    some: [0], every: [0], flatMap: [0], sort: [0, 1], toSorted: [0, 1], reduce: [1], reduceRight: [1],
};
/** Library functions that read everything inside their argument. */
const WALKERS = new Set(["Object.keys", "Object.values", "Object.entries", "Object.assign", "Object.freeze", "JSON.stringify", "Array.from", "structuredClone"]);
/** The walkers whose result is made of their argument. */
const WALKER_RESULTS = new Set(["Object.values", "Object.entries", "Object.assign", "Object.freeze", "Array.from"]);
/** The global namespaces whose members never change, so a read on one stays a leaf; every other global object can. */
const PURE_GLOBALS = new Set(["Math", "JSON", "Object", "Array", "Number", "String", "Boolean", "BigInt", "Symbol", "Reflect", "Intl"]);
/** The methods that write into an array, a Map or a Set: a const they are called on is written. */
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "add", "delete", "clear"]);
/** The template prelude's helpers, which only read their argument. */
const PRELUDE_HELPERS = new Set(["__each", "__event", "__ref"]);

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind);
}

function isClassMember(node: ts.Node): boolean {
    return node.parent !== undefined && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent));
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** A member of an object, as against a binding that never changes: an enum, a namespace, a class, a function, a const. */
function isObjectMember(node: ts.Node): boolean {
    return ts.isPropertySignature(node) || ts.isMethodSignature(node) || ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isAccessor(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isCountOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.PlusPlusToken || kind === ts.SyntaxKind.MinusMinusToken;
}

/** Whether `node` sits in a slot of an array or object literal, a spread or a property's value. */
function isLiteralSlot(parent: ts.Node, node: ts.Node): boolean {
    return ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent) || ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent) || (ts.isPropertyAssignment(parent) && parent.initializer === node);
}

/** The outermost literal `node` sits in, through parentheses, or `node` itself. */
function climbLiteral(node: ts.Node): ts.Node {
    let literal = node;
    while (isLiteralSlot(literal.parent, literal) || ts.isParenthesizedExpression(literal.parent)) literal = literal.parent;
    return literal;
}

/** A property of a literal under `as const` is readonly without a modifier on it. */
function isUnderConstAssertion(declaration: ts.Node): boolean {
    const literal = climbLiteral(declaration);
    return ts.isAsExpression(literal.parent) && ts.isConstTypeReference(literal.parent.type);
}

/** A node that hands its operand's value on unchanged: parentheses, `!`, `as`, `satisfies`, `<T>`. */
function isValueWrapper(node: ts.Node): node is ts.ParenthesizedExpression | ts.NonNullExpression | ts.AsExpression | ts.SatisfiesExpression | ts.TypeAssertion {
    return ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node);
}

/** Whether `parent` carries `node`'s own value on: a wrapper, a branch of `?:`, `||`, `??`, `&&`, the right side of a comma. */
function carriesValue(parent: ts.Node, node: ts.Node): boolean {
    if (isValueWrapper(parent)) return true;
    if (ts.isConditionalExpression(parent)) return parent.condition !== node;
    if (!ts.isBinaryExpression(parent)) return false;
    const kind = parent.operatorToken.kind;
    return kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.AmpersandAmpersandToken || (kind === ts.SyntaxKind.CommaToken && parent.right === node);
}

/** The outermost expression that still holds `node`'s own value. */
function climbValue(node: ts.Node): ts.Node {
    let current = node;
    while (carriesValue(current.parent, current)) current = current.parent;
    return current;
}

const PRIMITIVE_FLAGS = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.EnumLike | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never;

function unwrapParenthesesOf(node: ts.Node): ts.Node {
    let inner = node;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    return inner;
}

/** A call on the path: it writes, its result cannot be the field's data, or its result may be and the walk goes on. */
type CallEffect = "mutates" | "ends" | "passes";

function worstEffect(...effects: CallEffect[]): CallEffect {
    return effects.includes("mutates") ? "mutates" : effects.includes("passes") ? "passes" : "ends";
}

/** Whether `target` is the left of an assignment, the operand of a count or of a delete. */
function isDirectWrite(target: ts.Node): boolean {
    const parent = target.parent;
    if (ts.isBinaryExpression(parent)) return parent.left === target && isAssignmentOperator(parent.operatorToken.kind);
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) return isCountOperator(parent.operator);
    return ts.isDeleteExpression(parent);
}

/** Whether `node` is the name a `typeof a.b` type query starts with: a read of its type, never of its value. */
function isTypeQueryName(node: ts.Node): boolean {
    let name = node;
    while (ts.isQualifiedName(name.parent)) name = name.parent;
    return ts.isTypeQueryNode(name.parent);
}

function findEnclosingFunction(node: ts.Node): ts.Node | undefined {
    for (let parent = node.parent; parent !== undefined; parent = parent.parent) if (ts.isFunctionLike(parent)) return parent;
    return undefined;
}

interface Frame {
    locals: Map<ts.Symbol, Source>;
    thisSource: Source;
}

class Analysis {
    public readonly diagnostics: Diagnostic[] = [];
    /** The marked members the templates read, directly or through what they call: by declaration, since TypeScript hands out copies of a symbol. */
    public readonly reads = new Set<ts.Declaration>();
    /** What each live getter reads, so a template that reads the getter reads those too. */
    public readonly getterReads = new Map<ts.Declaration, Set<ts.Declaration>>();
    private readonly checker: ts.TypeChecker;
    private readonly locate: Locate;
    private readonly stack = new Set<ts.Node>();
    private readonly getterResults = new Map<ts.GetAccessorDeclaration, Source>();
    /** Every module-level const of a file, classified in one walk of the file: written, or never. */
    private readonly writtenConsts = new Map<ts.SourceFile, Map<ts.VariableDeclaration, boolean>>();
    private current: Set<ts.Declaration> | undefined;
    private template = false;

    constructor(checker: ts.TypeChecker, locate: Locate) {
        this.checker = checker;
        this.locate = locate;
    }

    private noteRead(declaration: ts.Declaration): void {
        (this.template ? this.reads : this.current)?.add(declaration);
    }

    private reportError(node: ts.Node, message: string): void {
        const file = node.getSourceFile();
        this.diagnostics.push({...this.locate(file, node.getStart(file)), level: "error", message});
    }

    private readText(node: ts.Node): string {
        return node.getText().replace(/\s+/g, " ");
    }

    private nameReader(): string {
        return this.template ? "the screen" : "the getter";
    }

    /** Readonly by a modifier, an `as const` around the literal, or a `Readonly<>` owner; the containers have their own rule. */
    private isReadonlyProperty(property: ts.Symbol, owner: ts.Type): boolean {
        if (owner.getNonNullableType().aliasSymbol?.getName() === "Readonly") return true;
        return (property.declarations ?? []).some(declaration => hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword) || isUnderConstAssertion(declaration));
    }

    /** A type the check does not look into: a primitive, `any`, `unknown`, a bare function. */
    private isLeafType(type: ts.Type): boolean {
        if (type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
        if (this.isPrimitiveType(type)) return true;
        if (type.isUnion()) return type.types.every(part => this.isLeafType(part));
        return type.getCallSignatures().length > 0 && type.getProperties().length === 0;
    }

    /** A type that holds nothing of anyone's: a primitive, a branded one, void, null, undefined, never. `any` and `unknown` are not. */
    private isPrimitiveType(type: ts.Type): boolean {
        if (type.getFlags() & PRIMITIVE_FLAGS) return true;
        if (type.isUnion()) return type.types.every(part => this.isPrimitiveType(part));
        // A brand is a primitive crossed with phantom parts, objects that hold no data down to their leaves.
        return type.isIntersection() && type.types.some(part => part.getFlags() & PRIMITIVE_FLAGS) && this.holdsNoData(type, new Set());
    }

    /** Whether a type carries no data at all: primitives, and objects whose every property carries none; a cycle carries none. */
    private holdsNoData(type: ts.Type, seen: Set<ts.Type>): boolean {
        if (type.getFlags() & PRIMITIVE_FLAGS) return true;
        if (type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
        if (seen.has(type)) return true;
        seen.add(type);
        if (type.isUnion() || type.isIntersection()) return type.types.every(part => this.holdsNoData(part, seen));
        return type.getCallSignatures().length === 0 && this.nameContainer(type) === undefined && type.getProperties().every(property => this.holdsNoData(this.checker.getTypeOfSymbol(property), seen));
    }

    /** What a project declaration of a callee may do to what holds it: a method can reach it through `this`, a held arrow cannot. */
    private readProjectCalleeEffect(declaration: ts.Declaration): CallEffect {
        if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration) || isClassMember(declaration)) return "mutates";
        if (ts.isPropertyAssignment(declaration) && ts.isFunctionExpression(unwrapParenthesesOf(declaration.initializer))) return "mutates";
        return "passes";
    }

    /** What a library declaration of a callee may do: a container's mutator writes, Object's and Function's members never, any other library object's may. */
    private readLibraryCalleeEffect(declarations: ts.Declaration[], receiver: ts.Node, baseType: ts.Type, name: string): CallEffect {
        if (baseType.getCallSignatures().length > 0) {
            // `f.call(...)`, `f.apply(...)` run the receiver; `f.bind(...)` hands it on to be run; what it would do, called itself.
            return name === "call" || name === "apply" || name === "bind" ? this.readCalleeEffect(receiver) : "passes";
        }
        if (declarations.every(declaration => ts.isInterfaceDeclaration(declaration.parent) && (declaration.parent.name.text === "Object" || declaration.parent.name.text === "Function"))) return "passes";
        if (this.nameContainer(baseType) === undefined) return "mutates";
        return MUTATORS.has(name) ? "mutates" : "passes";
    }

    /** What a callee does to the data it is reached through, by its declaration: on a branched callee, the worst branch. */
    private readCalleeEffect(callee: ts.Node): CallEffect {
        if (isValueWrapper(callee)) return this.readCalleeEffect(callee.expression);
        if (ts.isConditionalExpression(callee)) return worstEffect(this.readCalleeEffect(callee.whenTrue), this.readCalleeEffect(callee.whenFalse));
        if (ts.isBinaryExpression(callee)) {
            const kind = callee.operatorToken.kind;
            // `a && b` and `a, b` call b; `a || b` and `a ?? b` call either.
            if (kind === ts.SyntaxKind.AmpersandAmpersandToken || kind === ts.SyntaxKind.CommaToken) return this.readCalleeEffect(callee.right);
            return worstEffect(this.readCalleeEffect(callee.left), this.readCalleeEffect(callee.right));
        }
        if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return "passes";
        const baseType = this.checker.getTypeAtLocation(callee.expression);
        if (this.isPrimitiveType(baseType)) return "ends";
        if (baseType.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return "mutates";
        let name: string | undefined;
        if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
        else {
            const keyType = this.checker.getTypeAtLocation(callee.argumentExpression);
            if (keyType.isStringLiteral()) name = keyType.value;
            else if (keyType.getFlags() & ts.TypeFlags.NumberLike) return "passes";
            else return "mutates";
        }
        const declarations = this.checker.getPropertyOfType(baseType.getNonNullableType(), name)?.declarations ?? [];
        if (declarations.length === 0) return "mutates";
        // A union's property has one declaration per part; the worst decides, the library's judged once.
        const library = declarations.filter(declaration => declaration.getSourceFile().isDeclarationFile);
        const effects = declarations.filter(declaration => !declaration.getSourceFile().isDeclarationFile).map(declaration => this.readProjectCalleeEffect(declaration));
        if (library.length > 0) effects.push(this.readLibraryCalleeEffect(library, callee.expression, baseType, name));
        return worstEffect(...effects);
    }

    /** What a call on the path does: its callee's effect, and when that hands the result on, whether the result can hold the field's data. */
    private readCallEffect(call: ts.CallExpression): CallEffect {
        const effect = this.readCalleeEffect(call.expression);
        if (effect !== "passes") return effect;
        return this.isPrimitiveType(this.checker.getTypeAtLocation(call)) ? "ends" : "passes";
    }

    /** Whether `node` is assigned, counted, deleted or mutated through a method, itself or through a path into it. */
    private isWriteTarget(node: ts.Node): boolean {
        let target = climbValue(node);
        for (;;) {
            const parent = target.parent;
            if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === target) {
                target = climbValue(parent);
            } else if (ts.isCallExpression(parent) && parent.expression === target) {
                // A result that may be the field's own data (an element, a copy of elements) carries the walk on; a primitive ends it.
                const effect = this.readCallEffect(parent);
                if (effect !== "passes") return effect === "mutates";
                target = climbValue(parent);
            } else {
                if (ts.isBinaryExpression(parent) || ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent) || ts.isDeleteExpression(parent)) return isDirectWrite(target);
                if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) return parent.initializer === target;
                if (!isLiteralSlot(parent, target)) return false;
                // A destructuring pattern is a literal on the left of `=` or in a loop head.
                const literal = climbLiteral(target);
                const holder = literal.parent;
                if (ts.isBinaryExpression(holder)) return holder.left === literal && holder.operatorToken.kind === ts.SyntaxKind.EqualsToken;
                return (ts.isForOfStatement(holder) || ts.isForInStatement(holder)) && holder.initializer === literal;
            }
        }
    }

    /** Whether `reference` only reads the name in place: the value neither reaches another holder nor is written through it. */
    private isPlainRead(reference: ts.Node): boolean {
        const node = climbValue(reference);
        const parent = node.parent;
        if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) return !this.isWriteTarget(reference);
        if (ts.isCallExpression(parent)) return parent.expression === node || (ts.isIdentifier(parent.expression) && PRELUDE_HELPERS.has(parent.expression.text));
        if (ts.isNewExpression(parent)) return parent.expression === node;
        if (ts.isTaggedTemplateExpression(parent)) return parent.tag === node;
        if (ts.isTemplateSpan(parent)) return !ts.isTaggedTemplateExpression(parent.parent.parent);
        if (ts.isVoidExpression(parent) || ts.isTypeOfExpression(parent) || ts.isExpressionStatement(parent)) return true;
        if (ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) return isTypeQueryName(node);
        if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) return !isCountOperator(parent.operator);
        if (ts.isBinaryExpression(parent)) return !isAssignmentOperator(parent.operatorToken.kind);
        if (ts.isConditionalExpression(parent) || ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isSwitchStatement(parent) || ts.isCaseClause(parent)) return true;
        if (ts.isForStatement(parent)) return parent.initializer !== node;
        if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) return parent.expression === node;
        return false;
    }

    private nameContainer(type: ts.Type): string | undefined {
        const base = type.getNonNullableType();
        if (base.isUnion()) {
            // The primitive parts hold nothing and end a walk on their own; the rest must all be containers.
            const names: string[] = [];
            for (const part of base.types.filter(part => !this.isPrimitiveType(part))) {
                const name = this.nameContainer(part);
                if (name === undefined) return undefined;
                names.push(name);
            }
            return names.find(name => !READONLY_CONTAINERS.has(name)) ?? names[0];
        }
        if (this.checker.isTupleType(base)) return (base as ts.TupleTypeReference).target.readonly ? "ReadonlyArray" : "Array";
        const symbol = base.getSymbol();
        if (symbol === undefined) return undefined;
        const name = symbol.getName();
        if (!CONTAINERS.has(name)) return undefined;
        return (symbol.declarations ?? []).some(d => d.getSourceFile().isDeclarationFile) ? name : undefined;
    }

    /** A read into a library object, which has nothing to mark: followed only through a field that is replaced when it changes. */
    private checkLibraryRead(node: ts.Node, text: string, source: Source, type: ts.Type): boolean {
        if (source !== "fixed") return true;
        this.reportError(node, `"${text}": a read into ${this.checker.typeToString(type.getNonNullableType())}, a library object that can change under ${this.nameReader()} with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`);
        return false;
    }

    /** What an element of a container holds, given what the container holds. */
    private readElementSource(container: ts.Expression, source: Source): Source {
        if (source === "leaf" || isFollowed(source)) return source;
        const type = this.checker.getTypeAtLocation(container);
        if (this.isLeafType(type)) return "leaf";
        const name = this.nameContainer(type);
        if (name !== undefined && READONLY_CONTAINERS.has(name)) return "fixed";
        if (name !== undefined) {
            this.reportError(container, `"${this.readText(container)}": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly.`);
            return "leaf";
        }
        return this.readWholeValue(container, source) ? "fixed" : "leaf";
    }

    /** Everything inside `node` is read at once (a spread, Object.keys, JSON.stringify): whether that can be followed. */
    private readWholeValue(node: ts.Expression, source: Source): boolean {
        if (source === "leaf" || isFollowed(source)) return true;
        const type = this.checker.getTypeAtLocation(node).getNonNullableType();
        if (this.isLeafType(type)) return true;
        const container = this.nameContainer(type);
        if (container !== undefined) {
            if (READONLY_CONTAINERS.has(container)) return true;
        } else {
            const declaration = type.getSymbol()?.declarations?.[0];
            if (declaration !== undefined && declaration.getSourceFile().isDeclarationFile) return this.checkLibraryRead(node, this.readText(node), source, type);
            if (declaration !== undefined && ts.isClassLike(declaration)) return true;
            if (type.getProperties().every(property => this.isReadonlyProperty(property, type))) return true;
        }
        this.reportError(node, `"${this.readText(node)}": everything inside it is read, and it can change by mutation. Hold it in a @deep field, or type it readonly.`);
        return false;
    }

    public evaluateExpression(node: ts.Expression, frame: Frame): Source {
        if (node.kind === ts.SyntaxKind.ThisKeyword) return frame.thisSource;
        if (ts.isIdentifier(node)) return this.readIdentifier(node, frame);
        if (ts.isPropertyAccessExpression(node)) return this.readAccess(node, node.expression, node.name.text, frame);
        if (ts.isElementAccessExpression(node)) {
            const key = node.argumentExpression;
            if (ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)) return this.readAccess(node, node.expression, key.text, frame);
            this.evaluateExpression(key, frame);
            return this.readElementSource(node.expression, this.evaluateExpression(node.expression, frame));
        }
        if (ts.isCallExpression(node)) return this.evaluateCall(node, frame);
        if (ts.isNewExpression(node)) {
            for (const argument of node.arguments ?? []) this.evaluateExpression(argument, frame);
            return "fresh";
        }
        if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node)) {
            return this.evaluateExpression(node.expression, frame);
        }
        if (ts.isAsExpression(node)) {
            if (ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "live" && ts.isPropertyAccessExpression(node.expression)) {
                this.evaluateExpression(node.expression.expression, frame);
                return "tracked";
            }
            return this.evaluateExpression(node.expression, frame);
        }
        if (ts.isConditionalExpression(node)) {
            this.evaluateExpression(node.condition, frame);
            return mergeSources(this.evaluateExpression(node.whenTrue, frame), this.evaluateExpression(node.whenFalse, frame));
        }
        if (ts.isBinaryExpression(node)) {
            const operator = node.operatorToken.kind;
            if (isAssignmentOperator(operator)) {
                this.noteWrite(node.left);
                const right = this.evaluateExpression(node.right, frame);
                if (ts.isIdentifier(node.left)) {
                    const symbol = this.checker.getSymbolAtLocation(node.left);
                    if (symbol !== undefined && frame.locals.has(symbol)) frame.locals.set(symbol, right);
                }
                return right;
            }
            const left = this.evaluateExpression(node.left, frame);
            const right = this.evaluateExpression(node.right, frame);
            if (operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.AmpersandAmpersandToken) return mergeSources(left, right);
            if (operator === ts.SyntaxKind.CommaToken) return right;
            return "leaf";
        }
        if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
            if (isCountOperator(node.operator)) this.noteWrite(node.operand);
            else this.evaluateExpression(node.operand, frame);
            return "leaf";
        }
        if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node) || ts.isDeleteExpression(node)) {
            if (!ts.isDeleteExpression(node)) this.evaluateExpression(node.expression, frame);
            return "leaf";
        }
        if (ts.isTemplateExpression(node)) {
            for (const span of node.templateSpans) this.evaluateExpression(span.expression, frame);
            return "leaf";
        }
        if (ts.isObjectLiteralExpression(node)) {
            for (const property of node.properties) {
                if (ts.isPropertyAssignment(property)) {
                    if (ts.isComputedPropertyName(property.name)) this.evaluateExpression(property.name.expression, frame);
                    this.evaluateExpression(property.initializer, frame);
                } else if (ts.isShorthandPropertyAssignment(property)) this.evaluateExpression(property.name, frame);
                else if (ts.isSpreadAssignment(property)) this.readWholeValue(property.expression, this.evaluateExpression(property.expression, frame));
            }
            return "fresh";
        }
        if (ts.isArrayLiteralExpression(node)) {
            for (const element of node.elements) {
                if (ts.isSpreadElement(element)) this.readElementSource(element.expression, this.evaluateExpression(element.expression, frame));
                else if (!ts.isOmittedExpression(element)) this.evaluateExpression(element, frame);
            }
            return "fresh";
        }
        if (isFunctionLike(node)) return "fixed";
        if (ts.isSpreadElement(node)) return this.readElementSource(node.expression, this.evaluateExpression(node.expression, frame));
        if (ts.isTaggedTemplateExpression(node)) {
            for (const span of ts.isTemplateExpression(node.template) ? node.template.templateSpans : []) this.evaluateExpression(span.expression, frame);
            return "leaf";
        }
        if (ts.isYieldExpression(node) && node.expression !== undefined) return this.evaluateExpression(node.expression, frame);
        return "leaf";
    }

    /** The target of an assignment is written, not read; in a template a write is an error. */
    private noteWrite(target: ts.Expression): void {
        if (this.template) this.reportError(target, `A template never writes a field: "${this.readText(target)}". Go through a method of the view.`);
    }

    private findDeclaration(symbol: ts.Symbol | undefined): ts.Declaration | undefined {
        if (symbol === undefined) return undefined;
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
        return symbol.valueDeclaration ?? symbol.declarations?.[0];
    }

    private readIdentifier(node: ts.Identifier, frame: Frame): Source {
        const symbol = this.checker.getSymbolAtLocation(node);
        if (symbol === undefined) return "leaf";
        const local = frame.locals.get(symbol);
        if (local !== undefined) return local;
        const declaration = this.findDeclaration(symbol);
        if (declaration === undefined) return "leaf";
        if (declaration.getSourceFile().isDeclarationFile) return PURE_GLOBALS.has(node.text) ? "leaf" : "fixed";
        if (!ts.isVariableDeclaration(declaration)) return "fixed";
        const list = declaration.parent;
        if (ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) === 0 && !ts.isForOfStatement(list.parent) && !ts.isForInStatement(list.parent)) {
            this.reportError(node, `"${node.text}" is a \`let\` that can change, and ${this.nameReader()} would not follow it. Make it a const, or a marked field.`);
            return "leaf";
        }
        if (declaration.initializer === undefined || this.stack.has(declaration)) return "fixed";
        this.stack.add(declaration);
        const source = this.evaluateExpression(declaration.initializer, {locals: frame.locals, thisSource: "leaf"});
        this.stack.delete(declaration);
        if (ts.isVariableDeclarationList(list) && ts.isVariableStatement(list.parent) && ts.isSourceFile(list.parent.parent) && !this.isWrittenConst(declaration)) return "fresh";
        return source === "fresh" ? "fixed" : source;
    }

    /** A module-level const anyone may write is not a value: one exported, or referenced in its file other than as a plain read. */
    private isWrittenConst(declaration: ts.VariableDeclaration): boolean {
        const file = declaration.getSourceFile();
        let consts = this.writtenConsts.get(file);
        if (consts === undefined) {
            consts = this.classifyConsts(file);
            this.writtenConsts.set(file, consts);
        }
        return consts.get(declaration) ?? true;
    }

    /** One walk of the file settles every module-level const of it at once. */
    private classifyConsts(file: ts.SourceFile): Map<ts.VariableDeclaration, boolean> {
        const written = new Map<ts.VariableDeclaration, boolean>();
        for (const statement of file.statements) {
            if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
            const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
            for (const declaration of statement.declarationList.declarations) written.set(declaration, exported);
        }
        const visitNode = (node: ts.Node): void => {
            if (ts.isExportSpecifier(node)) {
                const target = this.checker.getExportSpecifierLocalTargetSymbol(node)?.valueDeclaration;
                if (target !== undefined && ts.isVariableDeclaration(target) && written.has(target)) written.set(target, true);
            } else if (ts.isIdentifier(node)) {
                const target = this.findReferencedDeclaration(node);
                if (target !== undefined && ts.isVariableDeclaration(target) && written.has(target) && target.name !== node && !this.isPlainRead(node)) written.set(target, true);
            } else ts.forEachChild(node, visitNode);
        };
        visitNode(file);
        return written;
    }

    private findReferencedDeclaration(node: ts.Identifier): ts.Declaration | undefined {
        const shorthand = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node;
        const symbol = shorthand ? this.checker.getShorthandAssignmentValueSymbol(node.parent) : this.checker.getSymbolAtLocation(node);
        return symbol?.valueDeclaration;
    }

    /** A read of `base.name`. */
    private readAccess(node: ts.Expression, base: ts.Expression, name: string, frame: Frame): Source {
        const baseSource = this.evaluateExpression(base, frame);
        if (baseSource === "leaf") return "leaf";
        const baseType = this.checker.getTypeAtLocation(base);
        if (this.isLeafType(baseType)) return "leaf";
        const property = ts.isPropertyAccessExpression(node) ? this.checker.getSymbolAtLocation(node.name) : this.checker.getPropertyOfType(baseType.getNonNullableType(), name);
        return this.readMember(node, base, baseSource, baseType, name, property);
    }

    private readMember(node: ts.Node, base: ts.Expression, baseSource: Source, baseType: ts.Type, name: string, property: ts.Symbol | undefined): Source {
        const declaration = this.findDeclaration(property);
        if (property === undefined || declaration === undefined) return this.readElementSource(base, baseSource);
        return this.readProperty(node, baseSource, baseType, name, property, declaration);
    }

    /** A declared property of `baseType`, read by a dot or by a destructuring: the same rules either way. */
    private readProperty(node: ts.Node, baseSource: Source, baseType: ts.Type, name: string, property: ts.Symbol, declaration: ts.Declaration): Source {
        const text = this.readText(node);
        if (declaration.getSourceFile().isDeclarationFile) {
            const container = this.nameContainer(baseType);
            if (container === undefined) {
                if ((property.declarations ?? []).some(isObjectMember)) this.checkLibraryRead(node, text, baseSource, baseType);
                return "leaf";
            }
            if (isFollowed(baseSource) || READONLY_CONTAINERS.has(container)) {
                const type = this.checker.getTypeOfSymbolAtLocation(property, node);
                if (type.getCallSignatures().length > 0) return "fixed";
                return isFollowed(baseSource) ? baseSource : "fixed";
            }
            this.reportError(node, `"${text}": "${name}" of ${container} can change by mutation, and ${baseSource === "tracked" ? "@live follows the field's value, not what is inside it" : "it is not followed"}. Mark the field @deep, or type it Readonly${container}.`);
            return "leaf";
        }
        if (isClassMember(declaration)) {
            const owner = (declaration.parent as ts.ClassLikeDeclaration).name?.text ?? "the class";
            if (ts.isPropertyDeclaration(declaration)) {
                const mark = readMark(declaration);
                if (mark === "live") { this.noteRead(declaration); return "tracked"; }
                if (mark === "deep") { this.noteRead(declaration); return "deep"; }
                if (hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword)) return "fixed";
                this.reportError(node, `"${text}": "${name}" is a plain field of ${owner} that can change, and ${this.nameReader()} would not follow it. Mark it @live or @deep, or make it readonly.`);
                return "leaf";
            }
            if (ts.isGetAccessorDeclaration(declaration)) {
                if (readMark(declaration) === "live") {
                    this.noteRead(declaration);
                    return this.evaluateGetter(declaration);
                }
                if (declaration.body === undefined) {
                    this.reportError(node, `"${text}": a getter the build cannot see into.`);
                    return "leaf";
                }
                return this.followBody(declaration, declaration.body, [], {locals: new Map(), thisSource: "fixed"});
            }
            return "fixed";
        }
        if (isFollowed(baseSource)) return baseSource;
        if (ts.isMethodSignature(declaration) || (ts.isPropertySignature(declaration) && declaration.type !== undefined && ts.isFunctionTypeNode(declaration.type))) return "fixed";
        if (this.isReadonlyProperty(property, baseType)) return "fixed";
        const why = baseSource === "tracked" ? "@live follows the field's value, not what is inside it" : "the object is not followed";
        this.reportError(node, `"${text}": "${name}" is a plain property that can change by mutation, and ${why}. Hold the object in a @deep field, or declare "${name}" readonly.`);
        return "leaf";
    }

    private evaluateCall(node: ts.CallExpression, frame: Frame): Source {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) {
            if (callee.text === "__each") return this.readElementSource(node.arguments[0], this.evaluateExpression(node.arguments[0], frame));
            if (callee.text === "__event" && isFunctionLike(node.arguments[0])) {
                this.checkHandlerWrites(node.arguments[0].body);
                return "leaf";
            }
            if (callee.text === "__ref") {
                this.checkRefTarget(node.arguments[0], frame);
                return "leaf";
            }
            const declaration = this.findDeclaration(this.checker.getSymbolAtLocation(callee));
            if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return this.evaluateLibraryCall(node, frame);
            const sources = this.evaluateArguments(node, frame);
            if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) return this.followBody(declaration, declaration.body, sources, this.buildCalleeFrame(declaration, frame, "leaf"), declaration.parameters);
            if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isFunctionLike(declaration.initializer)) {
                const fn = declaration.initializer;
                return this.followBody(fn, fn.body, sources, this.buildCalleeFrame(declaration, frame, ts.isArrowFunction(fn) ? frame.thisSource : "leaf"), fn.parameters);
            }
            this.reportError(node, `"${this.readText(callee)}()": a call the build cannot see through (a function passed by reference). Call a function of this module or a method of the class instead.`);
            return "leaf";
        }
        if (isFunctionLike(callee) || (ts.isParenthesizedExpression(callee) && isFunctionLike(callee.expression))) {
            const fn = isFunctionLike(callee) ? callee : callee.expression as ts.ArrowFunction | ts.FunctionExpression;
            return this.followBody(fn, fn.body, this.evaluateArguments(node, frame), frame, fn.parameters);
        }
        if (ts.isPropertyAccessExpression(callee) || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression))) {
            const base = callee.expression;
            const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : (callee.argumentExpression as ts.StringLiteralLike).text;
            const baseSource = this.evaluateExpression(base, frame);
            const baseType = this.checker.getTypeAtLocation(base);
            const property = ts.isPropertyAccessExpression(callee) ? this.checker.getSymbolAtLocation(callee.name) : this.checker.getPropertyOfType(baseType.getNonNullableType(), name);
            const declaration = this.findDeclaration(property);
            if (baseSource === "leaf" || this.isLeafType(baseType) || property === undefined || declaration === undefined) return this.evaluateLibraryCall(node, frame);
            if (declaration.getSourceFile().isDeclarationFile) {
                const container = this.nameContainer(baseType);
                if (container !== undefined) return this.evaluateContainerCall(node, base, baseSource, name, container, frame);
                if ((property.declarations ?? []).some(isObjectMember)) this.checkLibraryRead(callee, `${this.readText(callee)}()`, baseSource, baseType);
                return this.evaluateLibraryCall(node, frame);
            }
            const sources = this.evaluateArguments(node, frame);
            if (isClassMember(declaration)) {
                if (ts.isMethodDeclaration(declaration) && declaration.body !== undefined) {
                    return this.followBody(declaration, declaration.body, sources, {locals: new Map(), thisSource: "fixed"}, declaration.parameters);
                }
                if (ts.isPropertyDeclaration(declaration) && declaration.initializer !== undefined && isFunctionLike(declaration.initializer)) {
                    const fn = declaration.initializer;
                    return this.followBody(fn, fn.body, sources, {locals: new Map(), thisSource: "fixed"}, fn.parameters);
                }
                if (ts.isGetAccessorDeclaration(declaration)) return this.readMember(callee, base, baseSource, baseType, name, property);
                this.reportError(node, `"${this.readText(callee)}()": a call the build cannot see through (${ts.isMethodDeclaration(declaration) ? "a method with no body" : "a function held in a field"}). Give the class a method with a body, or read the fields directly.`);
                return "leaf";
            }
            this.reportError(node, `"${this.readText(callee)}()": a call the build cannot see through (a method on an interface). Give it a class with the method's body, or read the fields directly.`);
            return "leaf";
        }
        this.evaluateExpression(callee, frame);
        this.evaluateArguments(node, frame);
        this.reportError(node, `"${this.readText(callee)}()": a call the build cannot see through.`);
        return "leaf";
    }

    /** A function declared inside a body being followed closes over that body's locals; a module's function sees none, and only an arrow keeps the caller's `this`. */
    private buildCalleeFrame(declaration: ts.Declaration, caller: Frame, thisSource: Source): Frame {
        const enclosing = findEnclosingFunction(declaration);
        return enclosing !== undefined && this.stack.has(enclosing) ? {locals: caller.locals, thisSource} : {locals: new Map(), thisSource: "leaf"};
    }

    private evaluateArguments(node: ts.CallExpression, frame: Frame): Source[] {
        return node.arguments.map(argument => isFunctionLike(argument) ? "fixed" : this.evaluateExpression(argument, frame));
    }

    /** A call into a library: a leaf, its arguments read, its callbacks followed with nothing bound, a walker's argument read whole. */
    private evaluateLibraryCall(node: ts.CallExpression, frame: Frame): Source {
        const sources = this.evaluateArguments(node, frame);
        for (const argument of node.arguments) if (isFunctionLike(argument)) this.followCallback(argument, [], frame);
        const name = this.readText(node.expression);
        if (!WALKERS.has(name) || node.arguments.length === 0) return "leaf";
        this.readWholeValue(node.arguments[0], sources[0]);
        return WALKER_RESULTS.has(name) ? sources[0] : "leaf";
    }

    /** A method of an array, a Map or a Set. */
    private evaluateContainerCall(node: ts.CallExpression, base: ts.Expression, baseSource: Source, name: string, container: string, frame: Frame): Source {
        const ok = baseSource === "leaf" || isFollowed(baseSource) || READONLY_CONTAINERS.has(container);
        if (!ok) {
            this.reportError(node.expression, `"${this.readText(node.expression)}": "${name}" reads ${container === "Array" ? "an array" : "a " + container} that can change by mutation, and ${baseSource === "tracked" ? "@live follows the field's value, not what is inside it" : "it is not followed"}. Mark the field @deep, or type it Readonly${container}.`);
        }
        const element = ok ? this.readElementSource(base, baseSource) : "leaf";
        const slots = CALLBACK_ELEMENTS[name] ?? [];
        for (const argument of node.arguments) {
            if (isFunctionLike(argument)) this.followCallback(argument, slots.map(() => element), frame, slots);
            else this.evaluateExpression(argument, frame);
        }
        if (!ok) return "leaf";
        return ELEMENT_RESULTS.has(name) ? element : "leaf";
    }

    private followCallback(fn: ts.ArrowFunction | ts.FunctionExpression, elements: Source[], frame: Frame, slots: number[] = []): void {
        const sources: Source[] = fn.parameters.map((_, index) => slots.includes(index) ? elements[slots.indexOf(index)] : "leaf");
        this.followBody(fn, fn.body, sources, frame, fn.parameters);
    }

    /** Follows a body with its parameters bound; returns what it returns. */
    private followBody(key: ts.Node, body: ts.ConciseBody, sources: Source[], outer: Frame, parameters: readonly ts.ParameterDeclaration[] = []): Source {
        if (this.stack.has(key)) return "fixed";
        this.stack.add(key);
        const frame: Frame = {locals: new Map(outer.locals), thisSource: outer.thisSource};
        parameters.forEach((parameter, index) => {
            const source = parameter.dotDotDotToken ? "fresh" : sources[index] ?? (parameter.initializer !== undefined ? this.evaluateExpression(parameter.initializer, frame) : "leaf");
            this.bindPattern(parameter.name, source, frame);
        });
        let result: Source;
        if (ts.isBlock(body)) {
            const returns: Source[] = [];
            this.checkStatements(body.statements, frame, returns);
            result = returns.length === 0 ? "leaf" : returns.reduce(mergeSources);
        } else {
            result = this.evaluateExpression(body, frame);
        }
        this.stack.delete(key);
        return result;
    }

    private bindPattern(name: ts.BindingName, source: Source, frame: Frame): void {
        if (ts.isIdentifier(name)) {
            const symbol = this.checker.getSymbolAtLocation(name);
            if (symbol !== undefined) frame.locals.set(symbol, source);
            return;
        }
        const type = this.checker.getTypeAtLocation(name);
        for (const element of name.elements) {
            if (ts.isOmittedExpression(element)) continue;
            let inner: Source;
            if (ts.isObjectBindingPattern(name)) {
                const key = element.propertyName ?? element.name;
                const keyText = ts.isIdentifier(key) ? key.text : ts.isStringLiteral(key) ? key.text : undefined;
                if (element.dotDotDotToken || keyText === undefined || source === "leaf" || this.isLeafType(type)) inner = source === "leaf" ? "leaf" : "fixed";
                else inner = this.readPatternMember(element, source, type, keyText);
            } else {
                inner = source === "leaf" || isFollowed(source) ? source : "fixed";
            }
            if (element.initializer !== undefined) inner = mergeSources(inner, this.evaluateExpression(element.initializer, frame));
            this.bindPattern(element.name, inner, frame);
        }
    }

    private readPatternMember(element: ts.BindingElement, source: Source, type: ts.Type, name: string): Source {
        const property = this.checker.getPropertyOfType(type.getNonNullableType(), name);
        const declaration = this.findDeclaration(property);
        if (property === undefined || declaration === undefined) return isFollowed(source) ? source : "fixed";
        return this.readProperty(element, source, type, name, property, declaration);
    }

    private checkStatements(list: readonly ts.Statement[], frame: Frame, returns: Source[]): void {
        for (const statement of list) this.checkStatement(statement, frame, returns);
    }

    private checkStatement(node: ts.Statement, frame: Frame, returns: Source[]): void {
        if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) {
                const source = declaration.initializer === undefined ? "leaf" : this.evaluateExpression(declaration.initializer, frame);
                this.bindPattern(declaration.name, source, frame);
            }
        } else if (ts.isExpressionStatement(node)) this.evaluateExpression(node.expression, frame);
        else if (ts.isReturnStatement(node)) returns.push(node.expression === undefined ? "leaf" : this.evaluateExpression(node.expression, frame));
        else if (ts.isBlock(node)) this.checkStatements(node.statements, {locals: new Map(frame.locals), thisSource: frame.thisSource}, returns);
        else if (ts.isIfStatement(node)) {
            this.evaluateExpression(node.expression, frame);
            this.checkStatement(node.thenStatement, frame, returns);
            if (node.elseStatement !== undefined) this.checkStatement(node.elseStatement, frame, returns);
        } else if (ts.isForOfStatement(node)) {
            const each = ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "__each" ? node.expression.arguments[0] : node.expression;
            const element = this.readElementSource(each, this.evaluateExpression(each, frame));
            const inner: Frame = {locals: new Map(frame.locals), thisSource: frame.thisSource};
            if (ts.isVariableDeclarationList(node.initializer)) this.bindPattern(node.initializer.declarations[0].name, element, inner);
            this.checkStatement(node.statement, inner, returns);
        } else if (ts.isForInStatement(node)) {
            this.readWholeValue(node.expression, this.evaluateExpression(node.expression, frame));
            const inner: Frame = {locals: new Map(frame.locals), thisSource: frame.thisSource};
            if (ts.isVariableDeclarationList(node.initializer)) this.bindPattern(node.initializer.declarations[0].name, "leaf", inner);
            this.checkStatement(node.statement, inner, returns);
        } else if (ts.isForStatement(node)) {
            const inner: Frame = {locals: new Map(frame.locals), thisSource: frame.thisSource};
            if (node.initializer !== undefined) {
                if (ts.isVariableDeclarationList(node.initializer)) {
                    for (const declaration of node.initializer.declarations) this.bindPattern(declaration.name, declaration.initializer === undefined ? "leaf" : this.evaluateExpression(declaration.initializer, inner), inner);
                } else this.evaluateExpression(node.initializer, inner);
            }
            if (node.condition !== undefined) this.evaluateExpression(node.condition, inner);
            if (node.incrementor !== undefined) this.evaluateExpression(node.incrementor, inner);
            this.checkStatement(node.statement, inner, returns);
        } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
            this.evaluateExpression(node.expression, frame);
            this.checkStatement(node.statement, frame, returns);
        } else if (ts.isSwitchStatement(node)) {
            this.evaluateExpression(node.expression, frame);
            for (const clause of node.caseBlock.clauses) {
                if (ts.isCaseClause(clause)) this.evaluateExpression(clause.expression, frame);
                this.checkStatements(clause.statements, frame, returns);
            }
        } else if (ts.isTryStatement(node)) {
            this.checkStatement(node.tryBlock, frame, returns);
            if (node.catchClause !== undefined) this.checkStatement(node.catchClause.block, frame, returns);
            if (node.finallyBlock !== undefined) this.checkStatement(node.finallyBlock, frame, returns);
        } else if (ts.isThrowStatement(node)) this.evaluateExpression(node.expression, frame);
        else if (ts.isLabeledStatement(node)) this.checkStatement(node.statement, frame, returns);
    }

    /** In a template's event handler only the writes matter: the handler runs on an event, not on a redraw. */
    private checkHandlerWrites(node: ts.Node): void {
        const visitNode = (child: ts.Node): void => {
            if (ts.isBinaryExpression(child) && isAssignmentOperator(child.operatorToken.kind)) this.noteWrite(child.left);
            else if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) && isCountOperator(child.operator)) this.noteWrite(child.operand);
            ts.forEachChild(child, visitNode);
        };
        visitNode(node);
    }

    /** `ref="view.box"` hands the element to a field of the view, which must exist and be plain: unmarked, writable, no getter. */
    private checkRefTarget(target: ts.Expression, frame: Frame): void {
        if (!ts.isPropertyAccessExpression(target)) return;
        this.evaluateExpression(target.expression, frame);
        const attribute = `ref="${this.readText(target)}"`;
        const name = target.name.text;
        const ownerType = this.checker.getTypeAtLocation(target.expression).getNonNullableType();
        const declaration = this.findDeclaration(this.checker.getPropertyOfType(ownerType, name));
        if (declaration === undefined) this.reportError(target, `${attribute}: ${this.checker.typeToString(ownerType)} has no field "${name}". The element goes into a plain field of the view; declare it.`);
        else if (!isClassMember(declaration) || !ts.isPropertyDeclaration(declaration)) this.reportError(target, `${attribute}: "${name}" is not a field. The element goes into a plain field of the view, never a getter or a method.`);
        else if (readMark(declaration) !== undefined) this.reportError(target, `${attribute}: "${name}" is marked @${readMark(declaration)}. The element goes into a plain field of the view, never a marked one.`);
        else if (hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword)) this.reportError(target, `${attribute}: "${name}" is readonly, and the element is written into it when it is drawn and removed. Make it a plain field.`);
    }

    /** Checks a live getter once; returns what it returns. */
    public evaluateGetter(getter: ts.GetAccessorDeclaration): Source {
        const known = this.getterResults.get(getter);
        if (known !== undefined) return known;
        if (getter.body === undefined || this.stack.has(getter)) return "fixed";
        const outer = {template: this.template, current: this.current};
        this.template = false;
        this.stack.add(getter);
        this.current = new Set();
        this.getterReads.set(getter, this.current);
        const returns: Source[] = [];
        this.checkStatements(getter.body.statements, {locals: new Map(), thisSource: "fixed"}, returns);
        const result = returns.length === 0 ? "leaf" : returns.reduce(mergeSources);
        this.stack.delete(getter);
        this.template = outer.template;
        this.current = outer.current;
        this.getterResults.set(getter, result);
        return result;
    }

    /** Everything the templates read, through the live getters they read. */
    public collectReads(): Set<ts.Declaration> {
        const all = new Set<ts.Declaration>();
        const visitDeclaration = (declaration: ts.Declaration): void => {
            if (all.has(declaration)) return;
            all.add(declaration);
            for (const inner of this.getterReads.get(declaration) ?? []) visitDeclaration(inner);
        };
        for (const declaration of this.reads) visitDeclaration(declaration);
        return all;
    }

    public checkTemplate(block: ts.Block): void {
        this.template = true;
        this.checkStatements(block.statements, {locals: new Map(), thisSource: "leaf"}, []);
        this.template = false;
    }
}

/** A .tacet template written as TypeScript statements after its script, with each expression's place in the .tacet file. */
interface VirtualFile {
    name: string;
    tacet: string;
    /** The .tacet file's text, read once, for placing a diagnostic. */
    source: string;
    code: string;
    ranges: {from: number; to: number; offset: number}[];
    templateStart: number;
    /** An error from Vue's parser or a v-model, reported as it is. */
    diagnostics: Diagnostic[];
}

const PRELUDE = `
type __Item<T> = T extends readonly (infer U)[] ? U : T extends number ? number : T extends string ? string : T extends Iterable<infer U> ? U : T extends object ? T[keyof T] : never;
type __Key<T> = T extends readonly unknown[] | number | string | Iterable<unknown> ? number : T extends object ? keyof T : never;
declare function __each<T>(items: T): readonly (readonly [__Item<T>, __Key<T>, number])[];
declare function __event(handler: ($event: any) => unknown): void;
declare function __ref(field: unknown): void;
declare const $event: any, $attrs: any, $slots: any, $refs: any, $el: any, $props: any, $emit: any, $nextTick: any;
`;
/** Vue's own words for a directive its transform refuses, asked of the host's compiler at the first template checked. */
function readDirectiveError(template: string, fallback: string): string {
    const error = compileTemplate({source: template, filename: "tacet-probe.vue", id: "tacet-probe"}).errors[0];
    return error === undefined ? fallback : typeof error === "string" ? error : error.message;
}

interface DirectiveErrors { missingCondition: string; missingItems: string; brokenItems: string; }

let directiveErrors: DirectiveErrors | undefined;

function readDirectiveErrors(): DirectiveErrors {
    directiveErrors ??= {
        missingCondition: readDirectiveError("<p v-if></p>", "v-if/v-else-if is missing expression."),
        missingItems: readDirectiveError("<p v-for></p>", "v-for is missing expression."),
        brokenItems: readDirectiveError('<p v-for="x"></p>', "v-for has invalid expression."),
    };
    return directiveErrors;
}
/** A static `ref` whose value is a path into an object, the form `src/files.ts` rewrites into an assignment. */
const REF_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function findLineColumn(source: string, offset: number): {line: number; column: number} {
    const before = source.slice(0, offset);
    return {line: before.split("\n").length, column: offset - before.lastIndexOf("\n")};
}

function buildVirtualFile(tacet: string, source: string): VirtualFile {
    const {descriptor, errors} = parseSfc(source, {filename: tacet});
    const diagnostics: Diagnostic[] = [];
    const virtual: VirtualFile = {name: tacet + ".ts", tacet, source, code: "", ranges: [], templateStart: 0, diagnostics};
    for (const error of errors) {
        const at = "loc" in error && error.loc !== undefined ? findLineColumn(source, error.loc.start.offset) : {line: 1, column: 1};
        diagnostics.push({file: tacet, ...at, level: "error", message: error.message});
    }
    const script = descriptor.scriptSetup ?? descriptor.script;
    const parts: string[] = [`import type {} from "vue";`, PRELUDE];
    let propNames: string[] = [];
    let propsType = "any";
    if (script !== null) {
        parts.push(script.content);
        const promoted = descriptor.scriptSetup === null ? promoteScriptToSetup(source, script.loc.start.offset, tacet) : undefined;
        try {
            const setup = promoted === undefined ? descriptor : parseSfc(promoted, {filename: tacet}).descriptor;
            const compiled = compileScript(setup, {id: tacet});
            propNames = Object.entries(compiled.bindings ?? {}).filter(([, kind]) => kind === "props").map(([name]) => name);
            const typeArgument = /defineProps\s*<([^]*?)>\s*\(/.exec(script.content);
            if (typeArgument !== null) propsType = typeArgument[1];
        } catch {
            propNames = [];
        }
    }
    if (propNames.length > 0) {
        parts.push(`type __Props = ${propsType};`);
        for (const name of propNames) parts.push(`declare const ${name}: __Props[${JSON.stringify(name)}];`);
    }
    const code = parts.join("\n") + "\n";
    virtual.templateStart = code.length;
    const out: string[] = [];
    let length = code.length;
    const emitText = (text: string): void => { out.push(text); length += text.length; };
    const emitRead = (content: string, offset: number, prefix: string, suffix: string): void => {
        emitText(prefix);
        virtual.ranges.push({from: length, to: length + content.length, offset});
        emitText(content);
        emitText(suffix);
    };
    const emitExpression = (expression: ExpressionNode, prefix: string, suffix: string): void => {
        if (expression.type === 4 /* SIMPLE_EXPRESSION */) emitRead(expression.content, expression.loc.start.offset, prefix, suffix);
    };
    /** A condition the directive lacks is `false as boolean`, not `false`: a literal would make the rest of the chain unreachable to TypeScript. */
    const emitCondition = (expression: ExpressionNode | undefined, prefix: string, suffix: string): void => {
        if (expression?.type === 4 /* SIMPLE_EXPRESSION */) emitExpression(expression, prefix, suffix);
        else emitText(`${prefix}false as boolean${suffix}`);
    };

    const emitChildren = (children: TemplateChildNode[]): void => {
        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            if (child.type === 5 /* INTERPOLATION */) emitExpression(child.content, "void (", ");\n");
            else if (child.type === 1 /* ELEMENT */) index = emitElement(child, children, index);
        }
    };

    const reportDirective = (directive: DirectiveNode, message: string): void => {
        virtual.diagnostics.push({file: tacet, ...findLineColumn(source, directive.loc.start.offset), level: "error", message});
    };

    const emitElement = (node: ElementNode, siblings: TemplateChildNode[], index: number): number => {
        const directives = node.props.filter((prop): prop is DirectiveNode => prop.type === 7);
        for (const directive of directives) {
            if ((directive.name === "if" || directive.name === "else-if") && directive.exp === undefined) reportDirective(directive, readDirectiveErrors().missingCondition);
            if (directive.name === "for" && directive.forParseResult === undefined) reportDirective(directive, directive.exp === undefined ? readDirectiveErrors().missingItems : readDirectiveErrors().brokenItems);
        }
        const vFor = directives.find(d => d.name === "for");
        const vIf = directives.find(d => d.name === "if");
        let closers = "";
        if (vFor?.forParseResult !== undefined) {
            const {source: items, value, key, index: position} = vFor.forParseResult;
            const names = [value, key, position].map(part => part !== undefined && part.type === 4 ? part.content : "_");
            while (names.length > 1 && names[names.length - 1] === "_") names.pop();
            emitText(`for (const [${names.join(", ")}] of __each(`);
            emitExpression(items, "", ")) {\n");
            closers += "}\n";
        }
        if (vIf !== undefined) {
            emitCondition(vIf.exp, "if (", ") {\n");
            closers += "}\n";
        }
        for (const prop of node.props) {
            if (prop.type === 6 /* ATTRIBUTE */) {
                if (prop.name === "ref" && prop.value !== undefined && REF_PATH.test(prop.value.content)) emitRead(prop.value.content, prop.loc.start.offset, "__ref(", ");\n");
                continue;
            }
            if (prop === vFor || prop === vIf) continue;
            const name = prop.name;
            if (name === "else-if" || name === "else") continue;
            if (name === "slot") {
                if (prop.exp?.type === 4) emitText(`const ${prop.exp.content}: any = $slots;\n`);
                continue;
            }
            if (prop.arg?.type === 4 && !prop.arg.isStatic) emitExpression(prop.arg, "void (", ");\n");
            if (prop.exp === undefined || prop.exp.type !== 4) continue;
            if (name === "on") {
                emitExpression(prop.exp, "__event(($event: any) => { ", " });\n");
            } else if (name === "model") {
                virtual.diagnostics.push({file: tacet, ...findLineColumn(source, prop.loc.start.offset), level: "error", message: `A template never writes a field: v-model writes "${prop.exp.content}". Bind :value and handle the event through a method of the view.`});
                emitExpression(prop.exp, "void (", ");\n");
            } else if (name === "bind" && prop.arg === undefined) {
                emitExpression(prop.exp, "void ({...", "});\n");
            } else if (name === "bind" && prop.arg?.type === 4 && prop.arg.content === "ref") {
                continue;   // a dynamic ref is Vue's own: the element reaching the view is not a read
            } else {
                emitExpression(prop.exp, "void (", ");\n");
            }
        }
        emitChildren(node.children);
        let last = index;
        if (vIf !== undefined) {
            for (let next = index + 1; next < siblings.length; next++) {
                const sibling = siblings[next];
                if (sibling.type === 2 /* TEXT */ && sibling.content.trim() === "") continue;
                if (sibling.type === 3 /* COMMENT */) continue;
                if (sibling.type !== 1) break;
                const chain = sibling.props.find((p): p is DirectiveNode => p.type === 7 && (p.name === "else-if" || p.name === "else"));
                if (chain === undefined) break;
                closers = closers.slice(0, -2);
                if (chain.name === "else-if") emitCondition(chain.exp, "} else if (", ") {\n");
                else emitText("} else {\n");
                closers += "}\n";
                emitElement(sibling, [], 0);
                last = next;
            }
        }
        emitText(closers);
        return last;
    };

    if (descriptor.template?.ast !== undefined) {
        emitText("{\n");
        emitChildren((descriptor.template.ast as RootNode).children);
        emitText("}\n");
    }
    virtual.code = code + out.join("");
    return virtual;
}

/** A checker that keeps its TypeScript program between runs, so a change in dev costs a fraction of the first run. */
export class Checker {
    private readonly options: CheckOptions;
    /** Parsed files by name, kept while their text does not change, so TypeScript reuses them. */
    private readonly cache = new Map<string, {text: string; file: ts.SourceFile}>();
    private previous: ts.Program | undefined;

    constructor(options: CheckOptions = {}) {
        this.options = options;
    }

    /** Checks the project: its `@live` getters and its `.tacet` templates. */
    public check(): Diagnostic[] {
        const root = path.resolve(this.options.root ?? process.cwd());
        const configPath = ts.findConfigFile(root, ts.sys.fileExists, this.options.tsconfig ?? "tsconfig.json");
        if (configPath === undefined) throw new Error(`Tacet: no tsconfig found from ${root}.`);
        const config = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath, undefined, [
            {extension: "tacet", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred},
        ]);
        const virtuals = new Map<string, VirtualFile>();
        for (const file of parsed.fileNames.filter(name => name.endsWith(".tacet"))) {
            const source = ts.sys.readFile(file);
            if (source === undefined) continue;
            const virtual = buildVirtualFile(file, source);
            virtuals.set(virtual.name, virtual);
        }
        const result = checkFiles(parsed.fileNames.filter(name => !name.endsWith(".tacet")), parsed.options, virtuals, this.previous, this.cache);
        this.previous = result.program;
        return result.diagnostics;
    }
}

/** Checks a project once. */
export function checkProject(options: CheckOptions = {}): Diagnostic[] {
    return new Checker(options).check();
}

/** The check over explicit files; the `.tacet` sources are handed in, for tests. */
export function checkSources(files: string[], tacets: Record<string, string>, compilerOptions: ts.CompilerOptions): Diagnostic[] {
    const virtuals = new Map<string, VirtualFile>();
    for (const [file, source] of Object.entries(tacets)) {
        const virtual = buildVirtualFile(path.resolve(file), source);
        virtuals.set(virtual.name, virtual);
    }
    return checkFiles(files.map(file => path.resolve(file)), compilerOptions, virtuals).diagnostics;
}

/** The files a `.tacet` file reaches through its imports: the only ones whose marks a template can read. */
function collectReachableFiles(checker: ts.TypeChecker, roots: ts.SourceFile[]): Set<ts.SourceFile> {
    const seen = new Set<ts.SourceFile>();
    const queue = [...roots];
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const statement of file.statements) {
            const specifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier : undefined;
            if (specifier === undefined) continue;
            const symbol = checker.getSymbolAtLocation(specifier);
            const target = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
            if (target !== undefined && ts.isSourceFile(target)) queue.push(target);
        }
    }
    return seen;
}

function checkFiles(files: string[], compilerOptions: ts.CompilerOptions, virtuals: Map<string, VirtualFile>, previous?: ts.Program, cache?: Map<string, {text: string; file: ts.SourceFile}>): {diagnostics: Diagnostic[]; program: ts.Program} {
    const host = ts.createCompilerHost(compilerOptions, true);
    const {fileExists, readFile} = host;
    host.fileExists = name => virtuals.has(name) || fileExists.call(host, name);
    host.readFile = name => virtuals.get(name)?.code ?? readFile.call(host, name);
    host.getSourceFile = (name, language) => {
        const text = virtuals.get(name)?.code ?? readFile.call(host, name);
        if (text === undefined) return undefined;
        const known = cache?.get(name);
        if (known !== undefined && known.text === text) return known.file;
        const file = ts.createSourceFile(name, text, language, true, virtuals.has(name) ? ts.ScriptKind.TS : undefined);
        cache?.set(name, {text, file});
        return file;
    };
    const program = ts.createProgram([...files, ...virtuals.keys()], {...compilerOptions, noEmit: true}, host, previous);
    const checker = program.getTypeChecker();
    const locatePosition: Locate = (file, position) => {
        const virtual = virtuals.get(file.fileName);
        if (virtual !== undefined) {
            const {source} = virtual;
            const range = virtual.ranges.find(r => position >= r.from && position <= r.to);
            if (range !== undefined) return {file: virtual.tacet, ...findLineColumn(source, range.offset + (position - range.from))};
            if (position < virtual.templateStart) {
                const script = position - virtual.code.indexOf("\n", virtual.code.indexOf(PRELUDE) + PRELUDE.length);
                return {file: virtual.tacet, ...findLineColumn(source, Math.max(0, source.indexOf("<script") + script))};
            }
            return {file: virtual.tacet, line: 1, column: 1};
        }
        const {line, character} = file.getLineAndCharacterOfPosition(position);
        return {file: file.fileName, line: line + 1, column: character + 1};
    };
    const analysis = new Analysis(checker, locatePosition);

    const marked: {node: ts.PropertyDeclaration; file: ts.SourceFile}[] = [];
    for (const file of program.getSourceFiles()) {
        if (file.isDeclarationFile || file.fileName.includes("/node_modules/") || virtuals.has(file.fileName)) continue;
        const visitNode = (node: ts.Node): void => {
            if (ts.isClassLike(node)) {
                for (const member of node.members) {
                    if (ts.isGetAccessorDeclaration(member) && readMark(member) === "live") analysis.evaluateGetter(member);
                    if (ts.isPropertyDeclaration(member) && readMark(member) !== undefined && !hasModifier(member, ts.SyntaxKind.StaticKeyword)) marked.push({node: member, file});
                }
            }
            ts.forEachChild(node, visitNode);
        };
        visitNode(file);
    }

    const diagnostics = [...analysis.diagnostics];
    for (const virtual of virtuals.values()) {
        diagnostics.push(...virtual.diagnostics);
        const file = program.getSourceFile(virtual.name);
        if (file === undefined) continue;
        const block = file.statements[file.statements.length - 1];
        if (block !== undefined && ts.isBlock(block)) {
            const before = analysis.diagnostics.length;
            analysis.checkTemplate(block);
            diagnostics.push(...analysis.diagnostics.slice(before));
        }
    }

    if (virtuals.size > 0) {
        const reads = analysis.collectReads();
        const roots = [...virtuals.keys()].map(name => program.getSourceFile(name)).filter((file): file is ts.SourceFile => file !== undefined);
        const reachable = collectReachableFiles(checker, roots);
        for (const {node, file} of marked) {
            if (reads.has(node) || !reachable.has(file)) continue;
            const {line, character} = file.getLineAndCharacterOfPosition(node.name.getStart(file));
            const owner = (node.parent as ts.ClassLikeDeclaration).name?.text ?? "the class";
            diagnostics.push({file: file.fileName, line: line + 1, column: character + 1, level: "hint", message: `"${(node.name as ts.Identifier).text}" of ${owner} is marked @${readMark(node)}, and no template reads it. The mark costs a little on every write; drop it if nothing on the screen needs it.`});
        }
    }
    return {diagnostics, program};
}

export function formatDiagnostic(diagnostic: Diagnostic, root = process.cwd()): string {
    const file = path.relative(root, diagnostic.file);
    return `${file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.level === "error" ? "error" : "hint"}: ${diagnostic.message}`;
}
