import vue, {type Options as VueOptions} from "@vitejs/plugin-vue";
import type {Plugin, ResolvedConfig} from "vite";
import {tacetTags, type TagsOptions} from "./tags.js";
import {tacetFiles, type FilesOptions} from "./files.js";
import {Checker, formatDiagnostic, type CheckOptions} from "./check.js";

export interface TacetOptions extends TagsOptions, FilesOptions {
    /** Passed on to `@vitejs/plugin-vue` for the `.tacet` files. */
    vue?: Omit<VueOptions, "include">;
    /** The build check of getters and templates: on by default, off with `false`. */
    check?: boolean | CheckOptions;
}

/** Runs the check when a build starts and when a file changes in dev. A build with an error fails. */
export function tacetCheck(options: CheckOptions = {}): Plugin {
    let config: ResolvedConfig;
    let checker: Checker;
    const runCheck = (fail: (message: string) => never): void => {
        checker ??= new Checker({...options, root: options.root ?? config.root});
        const started = performance.now();
        const diagnostics = checker.check();
        if (config.command === "serve") config.logger.info(`[tacet] checked in ${Math.round(performance.now() - started)} ms`);
        const errors = diagnostics.filter(d => d.level === "error").map(d => formatDiagnostic(d, config.root));
        const hints = diagnostics.filter(d => d.level === "hint").map(d => formatDiagnostic(d, config.root));
        for (const hint of hints) config.logger.warn(`[tacet] ${hint}`);
        if (errors.length > 0) {
            const message = `Tacet found ${errors.length} ${errors.length === 1 ? "read" : "reads"} the screen could not follow:\n${errors.join("\n")}`;
            if (config.command === "build") fail(message);
            config.logger.error(`[tacet] ${message}`);
        }
    };
    return {
        name: "tacet:check",
        configResolved(resolved) { config = resolved; },
        buildStart() {
            if (config.mode === "test" || process.env.VITEST !== undefined) return;
            runCheck(message => this.error(message));
        },
        handleHotUpdate({file}) {
            if (/\.(?:[cm]?[jt]sx?|tacet)$/.test(file)) runCheck(message => { throw new Error(message); });
        },
    };
}

export function tacet(options: TacetOptions = {}): Plugin[] {
    return [
        tacetTags(options),
        tacetFiles(options),
        ...(options.check === false ? [] : [tacetCheck(typeof options.check === "object" ? options.check : {})]),
        vue({...options.vue, include: /\.tacet$/}),
    ];
}

export {tacetTags, tacetFiles, type TagsOptions, type FilesOptions};
export {Checker, checkProject, formatDiagnostic, type CheckOptions, type Diagnostic} from "./check.js";
