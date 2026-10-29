import {parse} from "vue/compiler-sfc";
import MagicString, {type SourceMap} from "magic-string";
import type {Plugin} from "vite";

export interface FilesOptions {
    /** The module `assignElement` and `readItems` are imported from. Default: "tacet/runtime". */
    runtime?: string;
}

export interface FilesResult {
    code: string;
    map: SourceMap;
    warnings: string[];
}

const REF_ATTRIBUTE = /(^|\s)ref\s*=\s*(["'])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\2/g;
const FOR_ATTRIBUTE = /(^|\s)v-for\s*=\s*(["'])\s*(.+?)\s+(in|of)\s+(.+?)\s*\2/g;

/** Rewrites one `.tacet` file; `null` when nothing needed doing. */
export function rewriteTacetFile(code: string, id: string, options: FilesOptions = {}): FilesResult | null {
    const runtime = options.runtime ?? "tacet/runtime";
    const {descriptor, errors} = parse(code, {filename: id});
    if (errors.length > 0) return null;
    const edit = new MagicString(code);
    const warnings: string[] = [];
    let touched = false;
    let refs = 0;
    let loops = 0;

    if (descriptor.template !== null) {
        const {start, end} = descriptor.template.loc;
        const template = code.slice(start.offset, end.offset);
        for (const match of template.matchAll(REF_ATTRIBUTE)) {
            const [whole, lead, quote, path] = match;
            const at = start.offset + match.index + lead.length;
            const dot = path.lastIndexOf(".");
            const target = path.slice(0, dot);
            const key = path.slice(dot + 1);
            const inner = quote === '"' ? "'" : '"';
            edit.overwrite(at, start.offset + match.index + whole.length, `:ref=${quote}__tacetRef(${target}, ${inner}${key}${inner})${quote}`);
            refs++;
            touched = true;
        }
        for (const match of template.matchAll(FOR_ATTRIBUTE)) {
            const source = match[5];
            const at = start.offset + match.index + match[0].lastIndexOf(source);
            edit.overwrite(at, at + source.length, `__tacetEach(${source})`);
            loops++;
            touched = true;
        }
    }
    const imports = [...(refs > 0 ? ["assignElement as __tacetRef"] : []), ...(loops > 0 ? ["readItems as __tacetEach"] : [])];

    const script = descriptor.scriptSetup ?? descriptor.script;
    if (script !== null) {
        if (descriptor.scriptSetup === null) {
            const open = code.lastIndexOf("<script", script.loc.start.offset);
            if (open >= 0) {
                edit.appendLeft(open + "<script".length, " setup");
                touched = true;
            }
        }
        if (imports.length > 0) edit.appendLeft(script.loc.start.offset, `\nimport {${imports.join(", ")}} from ${JSON.stringify(runtime)};\n`);
    } else if (refs > 0) {
        warnings.push(`${id}: ref="view.box" needs a <script> block that holds \`view\`.`);
    } else if (loops > 0) {
        warnings.push(`${id}: v-for needs a <script> block, where Tacet puts its import.`);
    }

    if (!touched) return null;
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
            return {code: result.code, map: result.map};
        },
    };
}
