import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {checkSources, type Diagnostic} from "../src/check";

const here = path.resolve(__dirname, "check");
const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, useDefineForClassFields: true, skipLibCheck: true, lib: ["lib.es2023.d.ts", "lib.dom.d.ts"], types: [],
};
const file = (name: string): string => path.join(here, name);
const tacet = (name: string): Record<string, string> => ({[file(name)]: readFileSync(file(name), "utf8")});
const lines = (diagnostics: Diagnostic[], name: string): number[] => diagnostics.filter(d => d.file === file(name)).map(d => d.line).sort((a, b) => a - b);

describe("the getter check", () => {
    it("passes a getter that reads only what can be followed", () => {
        const diagnostics = checkSources([file("Good.ts")], {}, options);
        expect(diagnostics).toEqual([]);
    });

    it("names every read a getter could not follow", () => {
        const diagnostics = checkSources([file("Bad.ts")], {}, options);
        const errors = diagnostics.filter(d => d.level === "error");
        expect(lines(errors, "Bad.ts")).toEqual([24, 25, 26, 27, 28, 29, 30, 31, 32, 34]);
        const messages = errors.map(d => d.message);
        expect(messages[0]).toBe(`"this.plain": "plain" is a plain field of BadView that can change, and the getter would not follow it. Mark it @live or @deep, or make it readonly.`);
        expect(messages[1]).toContain(`"this.rows.length": "length" of Array can change by mutation, and @live follows the field's value, not what is inside it. Mark the field @deep, or type it ReadonlyArray.`);
        expect(messages[2]).toContain(`"size" is a plain property that can change by mutation, and @live follows the field's value`);
        expect(messages[3]).toContain(`"value" is a plain field of Thing`);
        expect(messages[4]).toContain(`"this.counter.count()": a call the build cannot see through (a method on an interface)`);
        expect(messages[5]).toContain(`"this.onChange()": a call the build cannot see through (a function held in a field)`);
        expect(messages[6]).toContain(`"moduleLet" is a \`let\` that can change`);
        expect(messages[7]).toContain(`"this.rows.map": "map" reads an array that can change by mutation`);
        expect(messages[8]).toContain(`"this.config": everything inside it is read`);
        expect(messages[9]).toContain(`"this.plain": "plain" is a plain field of BadView`);
        expect(diagnostics.filter(d => d.level === "hint")).toEqual([]);
    });
});

describe("the template check", () => {
    it("passes a template that reads marked fields, getters and methods, and hints at a mark no template reads", () => {
        const diagnostics = checkSources([file("Good.ts")], tacet("Good.tacet"), options);
        expect(diagnostics.filter(d => d.level === "error")).toEqual([]);
        const hints = diagnostics.filter(d => d.level === "hint");
        // `text`, `isDone` and `filter` are read by the template; `tags`, `config`, `now` and
        // `layout` through the `summary` getter it reads; `todos` through `shown`. `unused` is not.
        expect(hints.map(h => [h.line, h.message])).toEqual([
            [17, `"unused" of Manager is marked @live, and no template reads it. The mark costs a little on every write; drop it if nothing on the screen needs it.`],
        ]);
    });

    it("names a plain field a template reads, a v-model and a write in a handler", () => {
        const diagnostics = checkSources([file("Bad.ts")], tacet("Bad.tacet"), options);
        const errors = diagnostics.filter(d => d.level === "error" && d.file === file("Bad.tacet"));
        expect(errors.map(d => [d.line, d.column, d.message])).toEqual([
            [3, 10, `A template never writes a field: v-model writes "view.unread". Bind :value and handle the event through a method of the view.`],
            [2, 9, `"view.plain": "plain" is a plain field of BadView that can change, and the screen would not follow it. Mark it @live or @deep, or make it readonly.`],
            [4, 19, `A template never writes a field: "view.plain". Go through a method of the view.`],
            [5, 19, `A template never writes a field: "view.plain". Go through a method of the view.`],
            [6, 20, `"view.rows": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly.`],
        ]);
    });
});
