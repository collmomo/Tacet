import ts from "typescript";
import MagicString, {type SourceMap} from "magic-string";
import type {Plugin} from "vite";
import {MARK_NAMES, readDecoratorMark, readMarkName} from "./marks.js";

export interface TagsOptions {
    /** The module the inserted calls import from. Default: "tacet/runtime". */
    runtime?: string;
}

export interface TagsResult {
    code: string;
    map: SourceMap;
    warnings: string[];
    errors: string[];
}

const QUICK = new RegExp(`@(?:${MARK_NAMES.join("|")})\\b|/\\*\\*\\s*@[a-z]+\\s*\\*/|\\bas\\s+live\\b`);

function readScriptKind(id: string): ts.ScriptKind {
    if (/\.[cm]?tsx$/.test(id)) return ts.ScriptKind.TSX;
    if (/\.[cm]?ts$/.test(id)) return ts.ScriptKind.TS;
    if (/\.[cm]?jsx$/.test(id)) return ts.ScriptKind.JSX;
    return ts.ScriptKind.JS;
}

function measureEditDistance(a: string, b: string): number {
    const row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
}

function readMemberName(member: ts.ClassElement): string | undefined {
    const name = member.name;
    if (name === undefined) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return undefined;
}

// A field written without a semicolon needs one before the element inserted on its line; a body's `}` does not, but a field's `x = () => {}` still does.
function readSeparator(code: string, member: ts.ClassElement): string {
    const last = code[member.end - 1];
    if (last === ";" || (last === "}" && !ts.isPropertyDeclaration(member))) return "";
    return ";";
}

/** Rewrites the tagged fields and getters of `code`; `null` when it holds no tag. */
export function rewriteTags(code: string, id: string, options: TagsOptions = {}): TagsResult | null {
    if (!QUICK.test(code)) return null;
    const runtime = options.runtime ?? "tacet/runtime";
    const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, readScriptKind(id));
    const edit = new MagicString(code);
    const warnings: string[] = [];
    const errors: string[] = [];
    let touched = false;

    const formatPosition = (node: ts.Node): string => {
        const {line} = source.getLineAndCharacterOfPosition(node.getStart(source));
        return `${id}:${line + 1}`;
    };

    const visitClass = (node: ts.ClassLikeDeclaration): void => {
        let fields = 0;
        const getters: string[] = [];
        for (const member of node.members) {
            let mark: string | undefined;
            for (const tag of ts.getJSDocTags(member)) {
                const name = tag.tagName.text;
                const known = readMarkName(name);
                if (known !== undefined) mark = known;
                else if (name.length >= 3 && Math.min(measureEditDistance(name, "live"), measureEditDistance(name, "deep")) <= 2) {
                    warnings.push(`${formatPosition(member)}: "@${name}" is not a Tacet mark. Did you mean @live or @deep? The field stays plain.`);
                }
            }
            if (mark === undefined) continue;
            if (readDecoratorMark(member) !== undefined) continue;
            const name = readMemberName(member);
            const isStatic = ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some(m => m.kind === ts.SyntaxKind.StaticKeyword);
            if (ts.isMethodDeclaration(member)) {
                errors.push(`${formatPosition(member)}: a method never needs a mark ("${name ?? "?"}").`);
            } else if (ts.isPropertyDeclaration(member)) {
                if (name === undefined) errors.push(`${formatPosition(member)}: @${mark} needs a field with a plain name.`);
                else if (isStatic) errors.push(`${formatPosition(member)}: a static field cannot be marked ("${name}").`);
                else {
                    edit.appendRight(member.end, `${readSeparator(code, member)} #__tacet${fields++} = __tacet.installField(this, ${JSON.stringify(name)}, ${JSON.stringify(mark)});`);
                    touched = true;
                }
            } else if (ts.isGetAccessorDeclaration(member)) {
                if (mark === "deep") errors.push(`${formatPosition(member)}: a getter takes @live, not @deep ("${name ?? "?"}").`);
                else if (name === undefined) errors.push(`${formatPosition(member)}: @live needs a getter with a plain name.`);
                else if (isStatic) errors.push(`${formatPosition(member)}: a static getter cannot be marked ("${name}").`);
                else getters.push(name);
            } else if (ts.isSetAccessorDeclaration(member)) {
                errors.push(`${formatPosition(member)}: the mark goes on the getter, not the setter ("${name ?? "?"}").`);
            }
        }
        if (getters.length > 0) {
            const calls = getters.map(name => `__tacet.installGetter(this.prototype, ${JSON.stringify(name)});`).join(" ");
            const last = node.members[node.members.length - 1];
            edit.appendRight(last.end, `${readSeparator(code, last)} static { ${calls} }`);
            touched = true;
        }
    };

    const visitCast = (node: ts.AsExpression): void => {
        if (!ts.isTypeReferenceNode(node.type) || !ts.isIdentifier(node.type.typeName) || node.type.typeName.text !== "live") return;
        const inner = node.expression;
        if (!ts.isPropertyAccessExpression(inner) || ts.isPrivateIdentifier(inner.name)) {
            errors.push(`${formatPosition(node)}: \`as live\` goes on a property read, \`object.property as live\`.`);
            return;
        }
        edit.overwrite(node.getStart(source), node.end, `__tacet.watchProperty(${inner.expression.getText(source)}, ${JSON.stringify(inner.name.text)})`);
        touched = true;
    };

    const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) visitClass(node);
        else if (ts.isAsExpression(node)) visitCast(node);
        ts.forEachChild(node, visit);
    };
    visit(source);

    if (!touched && errors.length === 0 && warnings.length === 0) return null;
    if (touched) edit.prepend(`import * as __tacet from ${JSON.stringify(runtime)};\n`);
    return {code: edit.toString(), map: edit.generateMap({source: id, hires: true, includeContent: true}), warnings, errors};
}

const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

/** The Vite plugin: runs before every other step, on every script file outside node_modules. */
export function tacetTags(options: TagsOptions = {}): Plugin {
    return {
        name: "tacet:tags",
        enforce: "pre",
        transform(code, id) {
            const file = id.split("?")[0];
            if (!SCRIPT_FILE.test(file) || file.includes("/node_modules/")) return null;
            const result = rewriteTags(code, file, options);
            if (result === null) return null;
            for (const warning of result.warnings) this.warn(warning);
            if (result.errors.length > 0) this.error(result.errors.join("\n"));
            return {code: result.code, map: result.map};
        },
    };
}
