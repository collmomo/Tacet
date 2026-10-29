/**
 * A `.tacet` file is a `.vue` file with two things done for it: the script is
 * a `<script setup>` so the template sees its names, and `ref="view.box"`
 * hands the element to a field of the view.
 */
import {parse} from "vue/compiler-sfc";
import MagicString, {type SourceMap} from "magic-string";
import type {Plugin} from "vite";

export interface FilesOptions {
    /** The module `setRef` is imported from. Default: "tacet". */
    runtime?: string;
}

export interface FilesResult {
    code: string;
    map: SourceMap;
    warnings: string[];
}

const REF_ATTRIBUTE = /(^|\s)ref\s*=\s*(["'])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\2/g;

/** Rewrites one `.tacet` file; `null` when nothing needed doing. */
export function transformTacetFile(code: string, id: string, options: FilesOptions = {}): FilesResult | null {
    const runtime = options.runtime ?? "tacet";
    const {descriptor, errors} = parse(code, {filename: id});
    if (errors.length > 0) return null;
    const edit = new MagicString(code);
    const warnings: string[] = [];
    let touched = false;
    let refs = 0;

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
    }

    const script = descriptor.scriptSetup ?? descriptor.script;
    if (script !== null) {
        if (descriptor.scriptSetup === null) {
            const open = code.lastIndexOf("<script", script.loc.start.offset);
            if (open >= 0) {
                edit.appendLeft(open + "<script".length, " setup");
                touched = true;
            }
        }
        if (refs > 0) edit.appendLeft(script.loc.start.offset, `\nimport {setRef as __tacetRef} from ${JSON.stringify(runtime)};\n`);
    } else if (refs > 0) {
        warnings.push(`${id}: ref="view.box" needs a <script> block that holds \`view\`.`);
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
            const result = transformTacetFile(code, id, options);
            if (result === null) return null;
            for (const warning of result.warnings) this.warn(warning);
            return {code: result.code, map: result.map};
        },
    };
}
