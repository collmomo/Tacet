/**
 * The build check. A `@live` getter keeps its result until something it read
 * changes, so every read it makes must be one the screen can follow: a marked
 * field, a readonly hop, plain data under `@deep`, a call the build can see
 * through. A template is checked the same way. A plain field that can change
 * is an error naming the hop; a marked field no template reads is a hint.
 */
import ts from "typescript";
import path from "node:path";
import {compileScript, parse as parseSfc} from "vue/compiler-sfc";
import type {DirectiveNode, ElementNode, ExpressionNode, RootNode, TemplateChildNode} from "@vue/compiler-core";

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
    | "fresh"     // a literal made in this computation: nobody else holds it
    | "tracked"   // a marked field's value or a live getter's result: the value, not its inside
    | "fixed"     // an identity that cannot change: `this`, a readonly field, a const; its inside by its type
    | "leaf";     // a value the check does not look into: a primitive, a library object, `any`

const STRICTNESS: Record<Source, number> = {leaf: 0, fresh: 1, deep: 1, tracked: 2, fixed: 3};

function merge(a: Source, b: Source): Source {
    if (a === b) return a;
    if (a === "leaf") return b;
    if (b === "leaf") return a;
    const [strict] = [a, b].sort((x, y) => STRICTNESS[y] - STRICTNESS[x]);
    return strict === "tracked" ? "fixed" : strict;
}

function followed(source: Source): boolean {
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

export function markOf(member: ts.Node): "live" | "deep" | undefined {
    if (ts.canHaveDecorators(member)) {
        for (const decorator of ts.getDecorators(member) ?? []) {
            const expression = decorator.expression;
            const name = ts.isIdentifier(expression) ? expression.text : ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : "";
            if (name === "live" || name === "deep") return name;
        }
    }
    for (const tag of ts.getJSDocTags(member)) {
        const name = tag.tagName.text;
        if (name === "live" || name === "deep") return name;
    }
    return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind);
}

function isClassMember(node: ts.Node): boolean {
    return node.parent !== undefined && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent));
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

// ---------------------------------------------------------------------------

interface Frame {
    locals: Map<ts.Symbol, Source>;
    thisSource: Source;
}

class Analysis {
    private readonly checker: ts.TypeChecker;
    private readonly stack = new Set<ts.Node>();
    public readonly diagnostics: Diagnostic[] = [];
    /** The marked members the templates read, directly or through what they call: by declaration. */
    public readonly reads = new Set<ts.Declaration>();
    /** What each live getter reads, so a template that reads the getter reads those too. */
    public readonly getterReads = new Map<ts.Declaration, Set<ts.Declaration>>();
    /** What each live getter returns, so a read into its result is judged by its body. */
    private readonly getterResults = new Map<ts.GetAccessorDeclaration, Source>();
    private current: Set<ts.Declaration> | undefined;
    public template = false;
    /** Maps a position in a virtual file back to its .tacet file. */
    public locate: (file: ts.SourceFile, position: number) => {file: string; line: number; column: number};

    constructor(checker: ts.TypeChecker) {
        this.checker = checker;
        this.locate = (file, position) => {
            const {line, character} = file.getLineAndCharacterOfPosition(position);
            return {file: file.fileName, line: line + 1, column: character + 1};
        };
    }

    /** A marked member or a live getter was read. TypeScript hands out copies of a symbol, so the declaration is the key. */
    private note(declaration: ts.Declaration): void {
        (this.template ? this.reads : this.current)?.add(declaration);
    }

    private report(node: ts.Node, message: string): void {
        const file = node.getSourceFile();
        const at = this.locate(file, node.getStart(file));
        this.diagnostics.push({...at, level: "error", message});
    }

    private text(node: ts.Node): string {
        return node.getText().replace(/\s+/g, " ");
    }

    private readonlyProperty(symbol: ts.Symbol): boolean {
        // A property made readonly by `as const` or `Readonly<T>` carries TypeScript's Readonly check flag.
        const transient = symbol as unknown as {links?: {checkFlags?: number}; checkFlags?: number};
        const checkFlags = transient.links?.checkFlags ?? transient.checkFlags ?? 0;
        if (checkFlags & 8 /* CheckFlags.Readonly */) return true;
        return (symbol.declarations ?? []).some(declaration => hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword));
    }

    private isLeafType(type: ts.Type): boolean {
        const flags = type.getFlags();
        if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null)) return true;
        if (flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.EnumLike)) return true;
        if (type.isUnion()) return type.types.every(part => this.isLeafType(part));
        return type.getCallSignatures().length > 0 && type.getProperties().length === 0;
    }

    private containerName(type: ts.Type): string | undefined {
        const base = type.getNonNullableType();
        if (base.isUnion()) {
            const names = base.types.map(part => this.containerName(part));
            return names.every(name => name !== undefined) ? names.sort((a, b) => READONLY_CONTAINERS.has(a!) ? 1 : -1)[0] : undefined;
        }
        if (this.checker.isTupleType(base)) return (base as ts.TypeReference).target.getFlags() && (base as ts.TupleTypeReference).target.readonly ? "ReadonlyArray" : "Array";
        const symbol = base.getSymbol();
        if (symbol === undefined) return undefined;
        const name = symbol.getName();
        if (!CONTAINERS.has(name)) return undefined;
        return (symbol.declarations ?? []).some(d => d.getSourceFile().isDeclarationFile) ? name : undefined;
    }

    /** What an element of a container holds, given what the container holds. */
    private elementSource(container: ts.Expression, source: Source): Source {
        if (source === "leaf" || followed(source)) return source;
        const type = this.checker.getTypeAtLocation(container);
        if (this.isLeafType(type)) return "leaf";
        const name = this.containerName(type);
        if (name !== undefined && READONLY_CONTAINERS.has(name)) return "fixed";
        if (name !== undefined) {
            this.report(container, `"${this.text(container)}": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly.`);
            return "leaf";
        }
        // An object walked by key: its properties are read; the walk rule.
        return this.walkAll(container, source) ? "fixed" : "leaf";
    }

    /** Everything inside `node` is read at once (a spread, Object.keys, JSON.stringify). */
    private walkAll(node: ts.Expression, source: Source): boolean {
        if (source === "leaf" || followed(source)) return true;
        const type = this.checker.getTypeAtLocation(node).getNonNullableType();
        if (this.isLeafType(type)) return true;
        const container = this.containerName(type);
        if (container !== undefined) {
            if (READONLY_CONTAINERS.has(container)) return true;
        } else {
            const symbol = type.getSymbol();
            const declaration = symbol?.declarations?.[0];
            if (declaration !== undefined && (declaration.getSourceFile().isDeclarationFile || ts.isClassLike(declaration))) return true;
            if (type.getProperties().every(property => this.readonlyProperty(property))) return true;
        }
        this.report(node, `"${this.text(node)}": everything inside it is read, and it can change by mutation. Hold it in a @deep field, or type it readonly.`);
        return false;
    }

    // -- expressions ---------------------------------------------------------

    public evaluate(node: ts.Expression, frame: Frame): Source {
        if (node.kind === ts.SyntaxKind.ThisKeyword) return frame.thisSource;
        if (ts.isIdentifier(node)) return this.identifier(node, frame);
        if (ts.isPropertyAccessExpression(node)) return this.access(node, node.expression, node.name.text, frame);
        if (ts.isElementAccessExpression(node)) {
            const key = node.argumentExpression;
            if (ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)) return this.access(node, node.expression, key.text, frame);
            this.evaluate(key, frame);
            return this.elementSource(node.expression, this.evaluate(node.expression, frame));
        }
        if (ts.isCallExpression(node)) return this.call(node, frame);
        if (ts.isNewExpression(node)) {
            for (const argument of node.arguments ?? []) this.evaluate(argument, frame);
            return "fixed";
        }
        if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node)) {
            return this.evaluate(node.expression, frame);
        }
        if (ts.isAsExpression(node)) {
            if (ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "live" && ts.isPropertyAccessExpression(node.expression)) {
                // `x.y as live`: Tacet watches that one property on that one object.
                this.evaluate(node.expression.expression, frame);
                return "tracked";
            }
            return this.evaluate(node.expression, frame);
        }
        if (ts.isConditionalExpression(node)) {
            this.evaluate(node.condition, frame);
            return merge(this.evaluate(node.whenTrue, frame), this.evaluate(node.whenFalse, frame));
        }
        if (ts.isBinaryExpression(node)) {
            const operator = node.operatorToken.kind;
            if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) {
                this.write(node.left);
                const right = this.evaluate(node.right, frame);
                if (ts.isIdentifier(node.left)) {
                    const symbol = this.checker.getSymbolAtLocation(node.left);
                    if (symbol !== undefined && frame.locals.has(symbol)) frame.locals.set(symbol, right);
                }
                return right;
            }
            const left = this.evaluate(node.left, frame);
            const right = this.evaluate(node.right, frame);
            if (operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.AmpersandAmpersandToken) return merge(left, right);
            if (operator === ts.SyntaxKind.CommaToken) return right;
            return "leaf";
        }
        if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
            const operator = node.operator;
            if (operator === ts.SyntaxKind.PlusPlusToken || operator === ts.SyntaxKind.MinusMinusToken) this.write(node.operand);
            else this.evaluate(node.operand, frame);
            return "leaf";
        }
        if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node) || ts.isDeleteExpression(node)) {
            if (!ts.isDeleteExpression(node)) this.evaluate(node.expression, frame);
            return "leaf";
        }
        if (ts.isTemplateExpression(node)) {
            for (const span of node.templateSpans) this.evaluate(span.expression, frame);
            return "leaf";
        }
        if (ts.isObjectLiteralExpression(node)) {
            for (const property of node.properties) {
                if (ts.isPropertyAssignment(property)) {
                    if (ts.isComputedPropertyName(property.name)) this.evaluate(property.name.expression, frame);
                    this.evaluate(property.initializer, frame);
                } else if (ts.isShorthandPropertyAssignment(property)) this.evaluate(property.name, frame);
                else if (ts.isSpreadAssignment(property)) this.walkAll(property.expression, this.evaluate(property.expression, frame));
            }
            return "fresh";
        }
        if (ts.isArrayLiteralExpression(node)) {
            for (const element of node.elements) {
                if (ts.isSpreadElement(element)) this.elementSource(element.expression, this.evaluate(element.expression, frame));
                else if (!ts.isOmittedExpression(element)) this.evaluate(element, frame);
            }
            return "fresh";
        }
        if (isFunctionLike(node)) return "fixed";
        if (ts.isSpreadElement(node)) return this.elementSource(node.expression, this.evaluate(node.expression, frame));
        if (ts.isTaggedTemplateExpression(node)) {
            for (const span of ts.isTemplateExpression(node.template) ? node.template.templateSpans : []) this.evaluate(span.expression, frame);
            return "leaf";
        }
        if (ts.isYieldExpression(node) && node.expression !== undefined) return this.evaluate(node.expression, frame);
        return "leaf";
    }

    /** The target of an assignment is written, not read. In a template, a write is an error. */
    private write(target: ts.Expression): void {
        if (this.template) this.report(target, `A template never writes a field: "${this.text(target)}". Go through a method of the view.`);
    }

    private declarationOf(symbol: ts.Symbol | undefined): ts.Declaration | undefined {
        if (symbol === undefined) return undefined;
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
        return symbol.valueDeclaration ?? symbol.declarations?.[0];
    }

    private identifier(node: ts.Identifier, frame: Frame): Source {
        const symbol = this.checker.getSymbolAtLocation(node);
        if (symbol === undefined) return "leaf";
        const local = frame.locals.get(symbol);
        if (local !== undefined) return local;
        const declaration = this.declarationOf(symbol);
        if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return "leaf";
        if (ts.isVariableDeclaration(declaration)) {
            const list = declaration.parent;
            if (ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) === 0 && !ts.isForOfStatement(list.parent) && !ts.isForInStatement(list.parent)) {
                this.report(node, `"${node.text}" is a \`let\` that can change, and the getter would not follow it. Make it a const, or a marked field.`);
                return "leaf";
            }
            if (declaration.initializer === undefined || this.stack.has(declaration)) return "fixed";
            this.stack.add(declaration);
            const source = this.evaluate(declaration.initializer, {locals: frame.locals, thisSource: "leaf"});
            this.stack.delete(declaration);
            return source === "fresh" ? "fixed" : source;
        }
        if (ts.isParameter(declaration)) return "fixed";
        if (ts.isBindingElement(declaration)) return "fixed";
        return "fixed";
    }

    /** A read of `base.name`. */
    private access(node: ts.Expression, base: ts.Expression, name: string, frame: Frame): Source {
        const baseSource = this.evaluate(base, frame);
        if (baseSource === "leaf") return "leaf";
        const baseType = this.checker.getTypeAtLocation(base);
        if (this.isLeafType(baseType)) return "leaf";
        const property = ts.isPropertyAccessExpression(node) ? this.checker.getSymbolAtLocation(node.name) : this.checker.getPropertyOfType(baseType.getNonNullableType(), name);
        return this.member(node, base, baseSource, baseType, name, property, frame);
    }

    private member(node: ts.Node, base: ts.Expression, baseSource: Source, baseType: ts.Type, name: string, property: ts.Symbol | undefined, frame: Frame): Source {
        const declaration = this.declarationOf(property);
        const text = this.text(node);
        if (declaration === undefined) {
            // An index signature, or a name the type does not know: an element.
            return this.elementSource(base, baseSource);
        }
        if (declaration.getSourceFile().isDeclarationFile) {
            const container = this.containerName(baseType);
            if (container === undefined) return "leaf";   // a library's object: a value
            if (followed(baseSource) || READONLY_CONTAINERS.has(container)) {
                const type = this.checker.getTypeOfSymbolAtLocation(property!, node);
                if (type.getCallSignatures().length > 0) return "fixed";   // a method, to be called
                return followed(baseSource) ? baseSource : "fixed";
            }
            this.report(node, `"${text}": "${name}" of ${container} can change by mutation, and ${baseSource === "tracked" ? "@live follows the field's value, not what is inside it" : "it is not followed"}. Mark the field @deep, or type it Readonly${container}.`);
            return "leaf";
        }
        if (isClassClassMember(declaration)) {
            const owner = (declaration.parent as ts.ClassLikeDeclaration).name?.text ?? "the class";
            if (ts.isPropertyDeclaration(declaration)) {
                const mark = markOf(declaration);
                if (mark === "live") { this.note(declaration); return "tracked"; }
                if (mark === "deep") { this.note(declaration); return "deep"; }
                if (hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword)) return "fixed";
                this.report(node, `"${text}": "${name}" is a plain field of ${owner} that can change, and ${this.template ? "the screen" : "the getter"} would not follow it. Mark it @live or @deep, or make it readonly.`);
                return "leaf";
            }
            if (ts.isGetAccessorDeclaration(declaration)) {
                if (markOf(declaration) === "live") {
                    this.note(declaration);
                    const result = this.getterResult(declaration);
                    return followed(result) || result === "leaf" ? result : "tracked";
                }
                if (declaration.body === undefined) {
                    this.report(node, `"${text}": a getter the build cannot see into.`);
                    return "leaf";
                }
                return this.follow(declaration, declaration.body, [], {locals: new Map(), thisSource: "fixed"}, node);
            }
            if (ts.isMethodDeclaration(declaration)) return "fixed";
            return "fixed";
        }
        // A property of a plain object type: an interface, a type literal, an object literal.
        if (followed(baseSource)) return baseSource;
        if (ts.isMethodSignature(declaration) || (ts.isPropertySignature(declaration) && declaration.type !== undefined && ts.isFunctionTypeNode(declaration.type))) return "fixed";
        if (property !== undefined && this.readonlyProperty(property)) return "fixed";
        const why = baseSource === "tracked" ? "@live follows the field's value, not what is inside it" : "the object is not followed";
        this.report(node, `"${text}": "${name}" is a plain property that can change by mutation, and ${why}. Hold the object in a @deep field, or declare "${name}" readonly.`);
        return "leaf";
    }

    // -- calls ---------------------------------------------------------------

    private call(node: ts.CallExpression, frame: Frame): Source {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) {
            if (callee.text === "__each") return this.elementSource(node.arguments[0], this.evaluate(node.arguments[0], frame));
            if (callee.text === "__event" && isFunctionLike(node.arguments[0])) {
                this.walkWrites(node.arguments[0].body);
                return "leaf";
            }
            const local = this.checker.getSymbolAtLocation(callee);
            const declaration = this.declarationOf(local);
            const arguments_ = this.argumentSources(node, frame);
            if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return this.libraryCall(node, arguments_, frame);
            if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) return this.follow(declaration, declaration.body, arguments_, {locals: new Map(), thisSource: "leaf"}, node, declaration.parameters);
            if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isFunctionLike(declaration.initializer)) {
                const fn = declaration.initializer;
                return this.follow(fn, fn.body, arguments_, {locals: new Map(), thisSource: "leaf"}, node, fn.parameters);
            }
            if (ts.isClassLike(declaration)) return "fixed";
            this.report(node, `"${this.text(callee)}()": a call the build cannot see through (a function passed by reference). Call a function of this module or a method of the class instead.`);
            return "leaf";
        }
        if (isFunctionLike(callee) || (ts.isParenthesizedExpression(callee) && isFunctionLike(callee.expression))) {
            const fn = isFunctionLike(callee) ? callee : callee.expression as ts.ArrowFunction | ts.FunctionExpression;
            return this.follow(fn, fn.body, this.argumentSources(node, frame), frame, node, fn.parameters);
        }
        if (ts.isPropertyAccessExpression(callee) || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression))) {
            const base = callee.expression;
            const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : (callee.argumentExpression as ts.StringLiteralLike).text;
            const baseSource = this.evaluate(base, frame);
            const baseType = this.checker.getTypeAtLocation(base);
            const property = ts.isPropertyAccessExpression(callee) ? this.checker.getSymbolAtLocation(callee.name) : this.checker.getPropertyOfType(baseType.getNonNullableType(), name);
            const declaration = this.declarationOf(property);
            const container = this.containerName(baseType);
            if (container !== undefined && declaration?.getSourceFile().isDeclarationFile) return this.containerCall(node, base, baseSource, name, container, frame);
            if (baseSource === "leaf" || this.isLeafType(baseType) || declaration === undefined || declaration.getSourceFile().isDeclarationFile) {
                const qualified = `${this.text(base)}.${name}`;
                const arguments_ = this.argumentSources(node, frame);
                if (WALKERS.has(qualified) && node.arguments.length > 0) {
                    this.walkAll(node.arguments[0], arguments_[0]);
                    return name === "keys" || name === "stringify" ? "leaf" : arguments_[0];
                }
                return "leaf";
            }
            const arguments_ = this.argumentSources(node, frame);
            if (isClassClassMember(declaration)) {
                if (ts.isMethodDeclaration(declaration) && declaration.body !== undefined) {
                    return this.follow(declaration, declaration.body, arguments_, {locals: new Map(), thisSource: "fixed"}, node, declaration.parameters);
                }
                if (ts.isPropertyDeclaration(declaration) && declaration.initializer !== undefined && isFunctionLike(declaration.initializer)) {
                    const fn = declaration.initializer;
                    return this.follow(fn, fn.body, arguments_, {locals: new Map(), thisSource: "fixed"}, node, fn.parameters);
                }
                if (ts.isGetAccessorDeclaration(declaration)) {
                    const result = this.member(callee, base, baseSource, baseType, name, property, frame);
                    return result;
                }
                this.report(node, `"${this.text(callee)}()": a call the build cannot see through (${ts.isMethodDeclaration(declaration) ? "a method with no body" : "a function held in a field"}). Give the class a method with a body, or read the fields directly.`);
                return "leaf";
            }
            this.report(node, `"${this.text(callee)}()": a call the build cannot see through (a method on an interface). Give it a class with the method's body, or read the fields directly.`);
            return "leaf";
        }
        this.evaluate(callee, frame);
        this.argumentSources(node, frame);
        this.report(node, `"${this.text(callee)}()": a call the build cannot see through.`);
        return "leaf";
    }

    private argumentSources(node: ts.CallExpression, frame: Frame): Source[] {
        return node.arguments.map(argument => isFunctionLike(argument) ? "fixed" : this.evaluate(argument, frame));
    }

    private libraryCall(node: ts.CallExpression, arguments_: Source[], frame: Frame): Source {
        // A global function (String, Number, parseInt, structuredClone): a leaf, its arguments checked.
        const name = this.text(node.expression);
        if (WALKERS.has(name) && node.arguments.length > 0) this.walkAll(node.arguments[0], arguments_[0]);
        for (const argument of node.arguments) if (isFunctionLike(argument)) this.callback(argument, [], frame);
        return "leaf";
    }

    /** A method of an array, a Map or a Set. */
    private containerCall(node: ts.CallExpression, base: ts.Expression, baseSource: Source, name: string, container: string, frame: Frame): Source {
        const ok = baseSource === "leaf" || followed(baseSource) || READONLY_CONTAINERS.has(container);
        if (!ok) {
            this.report(node.expression, `"${this.text(node.expression)}": "${name}" reads ${container === "Array" ? "an array" : "a " + container} that can change by mutation, and ${baseSource === "tracked" ? "@live follows the field's value, not what is inside it" : "it is not followed"}. Mark the field @deep, or type it Readonly${container}.`);
        }
        const element = ok ? this.elementSource(base, baseSource) : "leaf";
        const slots = CALLBACK_ELEMENTS[name] ?? [];
        for (const argument of node.arguments) {
            if (isFunctionLike(argument)) this.callback(argument, slots.map(() => element), frame, slots);
            else this.evaluate(argument, frame);
        }
        if (!ok) return "leaf";
        return ELEMENT_RESULTS.has(name) ? element : "leaf";
    }

    private callback(fn: ts.ArrowFunction | ts.FunctionExpression, elements: Source[], frame: Frame, slots: number[] = []): void {
        const sources: Source[] = fn.parameters.map((_, index) => slots.includes(index) ? elements[slots.indexOf(index)] : "leaf");
        this.follow(fn, fn.body, sources, frame, fn, fn.parameters);
    }

    /** Follows a body with its parameters bound; returns what it returns. */
    private follow(key: ts.Node, body: ts.ConciseBody, arguments_: Source[], outer: Frame, at: ts.Node, parameters: readonly ts.ParameterDeclaration[] = []): Source {
        if (this.stack.has(key)) return "fixed";
        this.stack.add(key);
        const frame: Frame = {locals: new Map(outer.locals), thisSource: outer.thisSource};
        parameters.forEach((parameter, index) => {
            const source = parameter.dotDotDotToken ? "fresh" : arguments_[index] ?? (parameter.initializer !== undefined ? this.evaluate(parameter.initializer, frame) : "leaf");
            this.bind(parameter.name, source, frame, parameter);
        });
        let result: Source;
        if (ts.isBlock(body)) {
            const returns: Source[] = [];
            this.statements(body.statements, frame, returns);
            result = returns.length === 0 ? "leaf" : returns.reduce(merge);
        } else {
            result = this.evaluate(body, frame);
        }
        this.stack.delete(key);
        return result === "fresh" ? "fresh" : result;
    }

    private bind(name: ts.BindingName, source: Source, frame: Frame, at: ts.Node): void {
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
                else {
                    const property = this.checker.getPropertyOfType(type.getNonNullableType(), keyText);
                    inner = this.memberFromPattern(element, source, type, keyText, property, frame);
                }
            } else {
                inner = source === "leaf" || followed(source) ? source : "fixed";
            }
            if (element.initializer !== undefined) inner = merge(inner, this.evaluate(element.initializer, frame));
            this.bind(element.name, inner, frame, element);
        }
    }

    private memberFromPattern(element: ts.BindingElement, source: Source, type: ts.Type, name: string, property: ts.Symbol | undefined, frame: Frame): Source {
        const declaration = this.declarationOf(property);
        if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return followed(source) ? source : "fixed";
        if (isClassClassMember(declaration) && ts.isPropertyDeclaration(declaration)) {
            const mark = markOf(declaration);
            if (mark === "live") { this.note(declaration); return "tracked"; }
            if (mark === "deep") { this.note(declaration); return "deep"; }
            if (hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword)) return "fixed";
            this.report(element, `"${name}" is a plain field that can change, and ${this.template ? "the screen" : "the getter"} would not follow it. Mark it @live or @deep, or make it readonly.`);
            return "leaf";
        }
        if (followed(source) || (property !== undefined && this.readonlyProperty(property))) return followed(source) ? source : "fixed";
        this.report(element, `"${name}" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare "${name}" readonly.`);
        return "leaf";
    }

    // -- statements ----------------------------------------------------------

    private statements(list: readonly ts.Statement[], frame: Frame, returns: Source[]): void {
        for (const statement of list) this.statement(statement, frame, returns);
    }

    private statement(node: ts.Statement, frame: Frame, returns: Source[]): void {
        if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) {
                const source = declaration.initializer === undefined ? "leaf" : this.evaluate(declaration.initializer, frame);
                this.bind(declaration.name, source, frame, declaration);
            }
        } else if (ts.isExpressionStatement(node)) this.evaluate(node.expression, frame);
        else if (ts.isReturnStatement(node)) returns.push(node.expression === undefined ? "leaf" : this.evaluate(node.expression, frame));
        else if (ts.isBlock(node)) this.statements(node.statements, {locals: new Map(frame.locals), thisSource: frame.thisSource}, returns);
        else if (ts.isIfStatement(node)) {
            this.evaluate(node.expression, frame);
            this.statement(node.thenStatement, frame, returns);
            if (node.elseStatement !== undefined) this.statement(node.elseStatement, frame, returns);
        } else if (ts.isForOfStatement(node)) {
            const each = ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "__each" ? node.expression.arguments[0] : node.expression;
            const element = this.elementSource(each, this.evaluate(each, frame));
            const inner: Frame = {locals: new Map(frame.locals), thisSource: frame.thisSource};
            if (ts.isVariableDeclarationList(node.initializer)) this.bind(node.initializer.declarations[0].name, element, inner, node.initializer);
            this.statement(node.statement, inner, returns);
        } else if (ts.isForInStatement(node)) {
            this.walkAll(node.expression, this.evaluate(node.expression, frame));
            const inner: Frame = {locals: new Map(frame.locals), thisSource: frame.thisSource};
            if (ts.isVariableDeclarationList(node.initializer)) this.bind(node.initializer.declarations[0].name, "leaf", inner, node.initializer);
            this.statement(node.statement, inner, returns);
        } else if (ts.isForStatement(node)) {
            const inner: Frame = {locals: new Map(frame.locals), thisSource: frame.thisSource};
            if (node.initializer !== undefined) {
                if (ts.isVariableDeclarationList(node.initializer)) {
                    for (const declaration of node.initializer.declarations) this.bind(declaration.name, declaration.initializer === undefined ? "leaf" : this.evaluate(declaration.initializer, inner), inner, declaration);
                } else this.evaluate(node.initializer, inner);
            }
            if (node.condition !== undefined) this.evaluate(node.condition, inner);
            if (node.incrementor !== undefined) this.evaluate(node.incrementor, inner);
            this.statement(node.statement, inner, returns);
        } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
            this.evaluate(node.expression, frame);
            this.statement(node.statement, frame, returns);
        } else if (ts.isSwitchStatement(node)) {
            this.evaluate(node.expression, frame);
            for (const clause of node.caseBlock.clauses) {
                if (ts.isCaseClause(clause)) this.evaluate(clause.expression, frame);
                this.statements(clause.statements, frame, returns);
            }
        } else if (ts.isTryStatement(node)) {
            this.statement(node.tryBlock, frame, returns);
            if (node.catchClause !== undefined) this.statement(node.catchClause.block, frame, returns);
            if (node.finallyBlock !== undefined) this.statement(node.finallyBlock, frame, returns);
        } else if (ts.isThrowStatement(node)) this.evaluate(node.expression, frame);
        else if (ts.isLabeledStatement(node)) this.statement(node.statement, frame, returns);
    }

    /** In a template's event handler only the writes matter: the handler runs on an event, not on a redraw. */
    private walkWrites(node: ts.Node): void {
        const visit = (child: ts.Node): void => {
            if (ts.isBinaryExpression(child) && child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && child.operatorToken.kind <= ts.SyntaxKind.LastAssignment) this.write(child.left);
            else if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child)) && (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken)) this.write(child.operand);
            ts.forEachChild(child, visit);
        };
        visit(node);
    }

    // -- entry points --------------------------------------------------------

    /** Checks a live getter once; returns what it returns. */
    public getterResult(getter: ts.GetAccessorDeclaration): Source {
        const known = this.getterResults.get(getter);
        if (known !== undefined) return known;
        if (getter.body === undefined || this.stack.has(getter)) return "fixed";
        const outer = {template: this.template, current: this.current};
        this.template = false;
        this.stack.add(getter);
        this.current = new Set();
        this.getterReads.set(getter, this.current);
        const returns: Source[] = [];
        this.statements(getter.body.statements, {locals: new Map(), thisSource: "fixed"}, returns);
        const result = returns.length === 0 ? "leaf" : returns.reduce(merge);
        this.stack.delete(getter);
        this.template = outer.template;
        this.current = outer.current;
        this.getterResults.set(getter, result);
        return result;
    }

    /** Everything the templates read, through the live getters they read. */
    public allReads(): Set<ts.Declaration> {
        const all = new Set<ts.Declaration>();
        const visit = (declaration: ts.Declaration): void => {
            if (all.has(declaration)) return;
            all.add(declaration);
            for (const inner of this.getterReads.get(declaration) ?? []) visit(inner);
        };
        for (const declaration of this.reads) visit(declaration);
        return all;
    }

    public checkTemplate(block: ts.Block): void {
        this.template = true;
        this.statements(block.statements, {locals: new Map(), thisSource: "leaf"}, []);
        this.template = false;
    }
}

function isClassClassMember(node: ts.Node): boolean {
    return isClassMember(node);
}

// ---------------------------------------------------------------------------
// A .tacet template, written as TypeScript statements after its script.
// ---------------------------------------------------------------------------

interface Virtual {
    name: string;
    tacet: string;
    code: string;
    /** Each emitted expression: where it sits in the virtual file, and in the .tacet file. */
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
declare const $event: any, $attrs: any, $slots: any, $refs: any, $el: any, $props: any, $emit: any, $nextTick: any;
`;

function lineColumn(source: string, offset: number): {line: number; column: number} {
    const before = source.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    return {line, column};
}

function virtualFor(tacet: string, source: string): Virtual {
    const {descriptor, errors} = parseSfc(source, {filename: tacet});
    const diagnostics: Diagnostic[] = [];
    const virtual: Virtual = {name: tacet + ".ts", tacet, code: "", ranges: [], templateStart: 0, diagnostics};
    for (const error of errors) {
        const at = "loc" in error && error.loc !== undefined ? lineColumn(source, error.loc.start.offset) : {line: 1, column: 1};
        diagnostics.push({file: tacet, ...at, level: "error", message: error.message});
    }
    const script = descriptor.scriptSetup ?? descriptor.script;
    const parts: string[] = [`import type {} from "vue";`, PRELUDE];
    let propNames: string[] = [];
    let propsType = "any";
    if (script !== null) {
        parts.push(script.content);
        try {
            // The build makes every script a `<script setup>`; Vue reads the props only from one.
            let setup = descriptor;
            if (descriptor.scriptSetup === null) {
                const open = source.lastIndexOf("<script", script.loc.start.offset);
                const withSetup = source.slice(0, open + "<script".length) + " setup" + source.slice(open + "<script".length);
                setup = parseSfc(withSetup, {filename: tacet}).descriptor;
            }
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
    let code = parts.join("\n") + "\n";
    virtual.templateStart = code.length;
    const out: string[] = [];
    let length = code.length;
    const emit = (text: string): void => { out.push(text); length += text.length; };
    const emitExpression = (expression: ExpressionNode, prefix: string, suffix: string): void => {
        if (expression.type !== 4 /* SIMPLE_EXPRESSION */) return;
        emit(prefix);
        virtual.ranges.push({from: length, to: length + expression.content.length, offset: expression.loc.start.offset});
        emit(expression.content);
        emit(suffix);
    };

    const walk = (children: TemplateChildNode[]): void => {
        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            if (child.type === 5 /* INTERPOLATION */) emitExpression(child.content, "void (", ");\n");
            else if (child.type === 1 /* ELEMENT */) index = element(child, children, index);
        }
    };

    const element = (node: ElementNode, siblings: TemplateChildNode[], index: number): number => {
        const directives = node.props.filter((prop): prop is DirectiveNode => prop.type === 7);
        const vFor = directives.find(d => d.name === "for");
        const vIf = directives.find(d => d.name === "if");
        let closers = "";
        if (vFor?.forParseResult !== undefined) {
            const {source: items, value, key, index: position} = vFor.forParseResult;
            const names = [value, key, position].map(part => part !== undefined && part.type === 4 ? part.content : "_");
            while (names.length > 1 && names[names.length - 1] === "_") names.pop();
            emit(`for (const [${names.join(", ")}] of __each(`);
            emitExpression(items, "", ")) {\n");
            closers += "}\n";
        }
        if (vIf !== undefined) {
            emitExpression(vIf.exp!, "if (", ") {\n");
            closers += "}\n";
        }
        for (const prop of node.props) {
            if (prop.type !== 7 || prop === vFor || prop === vIf) continue;
            const name = prop.name;
            if (name === "else-if" || name === "else") continue;
            if (name === "slot") {
                if (prop.exp?.type === 4) emit(`const ${prop.exp.content}: any = $slots;\n`);
                continue;
            }
            if (prop.arg?.type === 4 && !prop.arg.isStatic) emitExpression(prop.arg, "void (", ");\n");
            if (prop.exp === undefined || prop.exp.type !== 4) continue;
            if (name === "on") {
                emitExpression(prop.exp, "__event(($event: any) => { ", " });\n");
            } else if (name === "model") {
                virtual.diagnostics.push({file: tacet, ...lineColumn(source, prop.loc.start.offset), level: "error", message: `A template never writes a field: v-model writes "${prop.exp.content}". Bind :value and handle the event through a method of the view.`});
                emitExpression(prop.exp, "void (", ");\n");
            } else if (name === "bind" && prop.arg === undefined) {
                emitExpression(prop.exp, "void ({...", "});\n");
            } else if (name === "bind" && prop.arg?.type === 4 && prop.arg.content === "ref") {
                continue;   // the element reaching the view is not a read
            } else {
                emitExpression(prop.exp, "void (", ");\n");
            }
        }
        walk(node.children);
        // v-else-if and v-else chain on the next element siblings.
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
                if (chain.name === "else-if" && chain.exp?.type === 4) emitExpression(chain.exp, "} else if (", ") {\n");
                else emit("} else {\n");
                closers += "}\n";
                element(sibling, [], 0);
                last = next;
            }
        }
        emit(closers);
        return last;
    };

    if (descriptor.template?.ast !== undefined) {
        emit("{\n");
        walk((descriptor.template.ast as RootNode).children);
        emit("}\n");
    }
    virtual.code = code + out.join("");
    return virtual;
}

// ---------------------------------------------------------------------------

/** Checks a project: its `@live` getters and its `.tacet` templates. */
export function checkProject(options: CheckOptions = {}): Diagnostic[] {
    const root = path.resolve(options.root ?? process.cwd());
    const configPath = ts.findConfigFile(root, ts.sys.fileExists, options.tsconfig ?? "tsconfig.json");
    if (configPath === undefined) throw new Error(`Tacet: no tsconfig found from ${root}.`);
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath, undefined, [
        {extension: "tacet", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred},
    ]);
    const tacetFiles = parsed.fileNames.filter(name => name.endsWith(".tacet"));
    const virtuals = new Map<string, Virtual>();
    for (const file of tacetFiles) {
        const source = ts.sys.readFile(file);
        if (source === undefined) continue;
        const virtual = virtualFor(file, source);
        virtuals.set(virtual.name, virtual);
    }
    return checkFiles(parsed.fileNames.filter(name => !name.endsWith(".tacet")), parsed.options, virtuals);
}

/** The check over explicit files; the `.tacet` sources are handed in, for tests. */
export function checkSources(files: string[], tacets: Record<string, string>, compilerOptions: ts.CompilerOptions): Diagnostic[] {
    const virtuals = new Map<string, Virtual>();
    for (const [file, source] of Object.entries(tacets)) {
        const virtual = virtualFor(path.resolve(file), source);
        virtuals.set(virtual.name, virtual);
    }
    return checkFiles(files.map(file => path.resolve(file)), compilerOptions, virtuals);
}

function checkFiles(files: string[], compilerOptions: ts.CompilerOptions, virtuals: Map<string, Virtual>): Diagnostic[] {
    const host = ts.createCompilerHost(compilerOptions, true);
    const {fileExists, readFile, getSourceFile} = host;
    host.fileExists = name => virtuals.has(name) || fileExists.call(host, name);
    host.readFile = name => virtuals.get(name)?.code ?? readFile.call(host, name);
    host.getSourceFile = (name, language, onError, shouldCreate) => {
        const virtual = virtuals.get(name);
        if (virtual !== undefined) return ts.createSourceFile(name, virtual.code, language, true, ts.ScriptKind.TS);
        return getSourceFile.call(host, name, language, onError, shouldCreate);
    };
    const program = ts.createProgram([...files, ...virtuals.keys()], {...compilerOptions, noEmit: true}, host);
    const checker = program.getTypeChecker();
    const analysis = new Analysis(checker);
    analysis.locate = (file, position) => {
        const virtual = virtuals.get(file.fileName);
        if (virtual !== undefined) {
            const source = ts.sys.readFile(virtual.tacet) ?? "";
            const range = virtual.ranges.find(r => position >= r.from && position <= r.to);
            if (range !== undefined) return {file: virtual.tacet, ...lineColumn(source, range.offset + (position - range.from))};
            if (position < virtual.templateStart) {
                const script = position - virtual.code.indexOf("\n", virtual.code.indexOf(PRELUDE) + PRELUDE.length);
                return {file: virtual.tacet, ...lineColumn(source, Math.max(0, source.indexOf("<script") + script))};
            }
            return {file: virtual.tacet, line: 1, column: 1};
        }
        const {line, character} = file.getLineAndCharacterOfPosition(position);
        return {file: file.fileName, line: line + 1, column: character + 1};
    };

    const marked: {node: ts.PropertyDeclaration; file: ts.SourceFile}[] = [];
    for (const file of program.getSourceFiles()) {
        if (file.isDeclarationFile || file.fileName.includes("/node_modules/") || virtuals.has(file.fileName)) continue;
        const visit = (node: ts.Node): void => {
            if (ts.isClassLike(node)) {
                for (const member of node.members) {
                    if (ts.isGetAccessorDeclaration(member) && markOf(member) === "live") analysis.getterResult(member);
                    if (ts.isPropertyDeclaration(member) && markOf(member) !== undefined && !hasModifier(member, ts.SyntaxKind.StaticKeyword)) marked.push({node: member, file});
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(file);
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
        const reads = analysis.allReads();
        for (const {node, file} of marked) {
            if (reads.has(node)) continue;
            const {line, character} = file.getLineAndCharacterOfPosition(node.name.getStart(file));
            const owner = (node.parent as ts.ClassLikeDeclaration).name?.text ?? "the class";
            diagnostics.push({file: file.fileName, line: line + 1, column: character + 1, level: "hint", message: `"${(node.name as ts.Identifier).text}" of ${owner} is marked @${markOf(node)}, and no template reads it. The mark costs a little on every write; drop it if nothing on the screen needs it.`});
        }
    }
    return diagnostics;
}

export function formatDiagnostic(diagnostic: Diagnostic, root = process.cwd()): string {
    const file = path.relative(root, diagnostic.file);
    return `${file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.level === "error" ? "error" : "hint"}: ${diagnostic.message}`;
}
