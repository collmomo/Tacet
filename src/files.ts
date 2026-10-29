import {parse} from "vue/compiler-sfc";
import type {ElementNode, RootNode} from "@vue/compiler-core";
import MagicString, {type SourceMap} from "magic-string";
import type {Plugin} from "vite";
import {findScriptOpening} from "./marks.js";

export interface FilesOptions {
    /** The module `assignElement` and `readItems` are imported from. Default: "tacet/runtime". */
    runtime?: string;
}

export interface FilesResult {
    code: string;
    map: SourceMap;
    warnings: string[];
}

interface TemplateEdit {
    start: number;
    end: number;
    text: string;
    found: string;
}

interface RefEdit extends TemplateEdit {
    target: string;
}

const REF_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function walkElements(parent: RootNode | ElementNode, visitElement: (element: ElementNode) => void): void {
    for (const child of parent.children) {
        if (child.type !== 1) continue;
        visitElement(child);
        walkElements(child, visitElement);
    }
}

// The node types are `NodeTypes` of @vue/compiler-core, which is not a dependency of the library: 6 an attribute, 7 a directive.
function collectTemplateEdits(root: RootNode, code: string): {refs: RefEdit[]; loops: TemplateEdit[]} {
    const refs: RefEdit[] = [];
    const loops: TemplateEdit[] = [];
    walkElements(root, element => {
        for (const prop of element.props) {
            const found = code.slice(prop.loc.start.offset, prop.loc.end.offset);
            if (prop.type === 6 && prop.name === "ref" && prop.value !== undefined && REF_PATH.test(prop.value.content)) {
                const quote = prop.value.loc.source[0];
                if (quote !== '"' && quote !== "'") continue;
                const path = prop.value.content;
                const dot = path.lastIndexOf(".");
                const target = path.slice(0, dot);
                const inner = quote === '"' ? "'" : '"';
                const text = `:ref=${quote}__tacetRef(${target}, ${inner}${path.slice(dot + 1)}${inner})${quote}`;
                refs.push({start: prop.loc.start.offset, end: prop.loc.end.offset, text, found, target});
            } else if (prop.type === 7 && prop.name === "for" && prop.forParseResult !== undefined) {
                const {start, end} = prop.forParseResult.source.loc;
                const source = code.slice(start.offset, end.offset);
                loops.push({start: start.offset, end: end.offset, text: `__tacetEach(${source})`, found});
            }
        }
    });
    return {refs, loops};
}

/** Rewrites one `.tacet` file; `null` when nothing needed doing. */
export function rewriteTacetFile(code: string, id: string, options: FilesOptions = {}): FilesResult | null {
    const runtime = options.runtime ?? "tacet/runtime";
    const {descriptor, errors} = parse(code, {filename: id});
    if (errors.length > 0) return null;
    const edit = new MagicString(code);
    const warnings: string[] = [];
    let touched = false;

    const root = descriptor.template?.ast;
    const {refs, loops} = root === undefined ? {refs: [], loops: []} : collectTemplateEdits(root, code);
    const script = descriptor.scriptSetup ?? descriptor.script;
    if (script === null) {
        for (const ref of refs) warnings.push(`${id}: ${ref.found} needs a <script> block that holds \`${ref.target}\`; the template was left as written.`);
        for (const loop of loops) warnings.push(`${id}: ${loop.found} needs a <script> block, where Tacet puts its import; the template was left as written.`);
    } else {
        for (const change of [...refs, ...loops]) {
            edit.overwrite(change.start, change.end, change.text);
            touched = true;
        }
        if (descriptor.scriptSetup === null) {
            const open = findScriptOpening(code, script.loc.start.offset);
            if (open >= 0) {
                edit.appendLeft(open + "<script".length, " setup");
                touched = true;
            }
        }
        const imports = [...(refs.length > 0 ? ["assignElement as __tacetRef"] : []), ...(loops.length > 0 ? ["readItems as __tacetEach"] : [])];
        if (imports.length > 0) edit.appendLeft(script.loc.start.offset, `\nimport {${imports.join(", ")}} from ${JSON.stringify(runtime)};\n`);
    }

    if (!touched && warnings.length === 0) return null;
    return {code: edit.toString(), map: edit.generateMap({source: id, hires: true, includeContent: true}), warnings};
}

/** The Vite plugin: runs on the `.tacet` file before Vue's own plugin reads it. */
export function tacetFiles(options: FilesOptions = {}): Plugin {
    return {
        name: "tacet:files",
        enforce: "pre",
        transform(code, id) {
            if (!/\.tacet$/.test(id)) return null;
            const result = rewriteTacetFile(code, id, options);
            if (result === null) return null;
            for (const warning of result.warnings) this.warn(warning);
            if (result.code === code) return null;
            return {code: result.code, map: result.map};
        },
    };
}
