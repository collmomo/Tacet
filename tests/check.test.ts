import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {ErrorCodes, errorMessages} from "@vue/compiler-core";
import {Checker, checkSources, type Diagnostic} from "../src/check";

const here = path.resolve(__dirname, "check");
const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, useDefineForClassFields: true, skipLibCheck: true, lib: ["lib.es2023.d.ts", "lib.dom.d.ts"], types: [],
};
const findFixture = (name: string): string => path.join(here, name);
const readTacet = (name: string): Record<string, string> => ({[findFixture(name)]: readFileSync(findFixture(name), "utf8")});
const collectLines = (diagnostics: Diagnostic[], name: string): number[] => diagnostics.filter(d => d.file === findFixture(name)).map(d => d.line).sort((a, b) => a - b);
const checked = new Map<string, Diagnostic[]>();
const checkFixture = (name: string): Diagnostic[] => {
    const known = checked.get(name) ?? checkSources([findFixture(name)], {}, options);
    checked.set(name, known);
    return known;
};

describe("the getter check", () => {
    it("passes a getter that reads only what can be followed", () => {
        expect(checkFixture("Good.ts")).toEqual([]);
    });

    it("follows a library object through the marked field that holds it, and a constructor", () => {
        const errors = checkFixture("Good.ts").filter(d => d.level === "error");
        expect(errors.filter(d => d.message.includes("this.date") || d.message.includes("new Date"))).toEqual([]);
    });

    it("names every read a getter could not follow", () => {
        const diagnostics = checkFixture("Bad.ts");
        const errors = diagnostics.filter(d => d.level === "error");
        expect(collectLines(errors, "Bad.ts")).toEqual([26, 27, 28, 29, 30, 31, 32, 33, 34, 36, 37, 38, 39, 40, 41]);
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

    it("refuses a read into a library object held in place: a Date, a DOM element through a readonly field", () => {
        const messages = checkFixture("Bad.ts").filter(d => d.line === 37 || d.line === 38).map(d => d.message);
        expect(messages).toEqual([
            `"this.date.getTime()": a read into Date, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`,
            `"this.box.clientWidth": a read into HTMLDivElement, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`,
        ]);
    });

    it("refuses a read on a global library object: localStorage, Date.now, document", () => {
        const messages = checkFixture("Bad.ts").filter(d => d.line >= 39 && d.line <= 41).map(d => d.message);
        expect(messages).toEqual([
            `"localStorage.getItem()": a read into Storage, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`,
            `"Date.now()": a read into DateConstructor, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`,
            `"document.title": a read into Document, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`,
        ]);
    });

    it("follows a local arrow or function with the getter's locals and this", () => {
        const errors = checkFixture("Locals.ts").filter(d => d.level === "error");
        expect(errors.map(d => [d.line, d.message])).toEqual([
            [9, `"this.plain": "plain" is a plain field of LocalsView that can change, and the getter would not follow it. Mark it @live or @deep, or make it readonly.`],
            [9, `"this.rows.map": "map" reads an array that can change by mutation, and @live follows the field's value, not what is inside it. Mark the field @deep, or type it ReadonlyArray.`],
            [15, `"rows.map": "map" reads an array that can change by mutation, and @live follows the field's value, not what is inside it. Mark the field @deep, or type it ReadonlyArray.`],
            [21, `"rows.length": "length" of Array can change by mutation, and @live follows the field's value, not what is inside it. Mark the field @deep, or type it ReadonlyArray.`],
        ]);
    });

    it("reads a destructured property by the rules of the dotted read: a container under @live, under @deep, a library object", () => {
        const errors = checkFixture("Patterns.ts").filter(d => d.level === "error");
        expect(errors.map(d => [d.line, d.message])).toEqual([
            [8, `"this.rows.length": "length" of Array can change by mutation, and @live follows the field's value, not what is inside it. Mark the field @deep, or type it ReadonlyArray.`],
            [9, `"length": "length" of Array can change by mutation, and @live follows the field's value, not what is inside it. Mark the field @deep, or type it ReadonlyArray.`],
            [12, `"clientWidth": a read into HTMLDivElement, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property \`as live\` if the owner opens it.`],
        ]);
    });

    it("treats a const as a value only when nothing can write it: not exported, not held by another name", () => {
        const written = `"shared.x": "x" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare "x" readonly.`;
        const exported = checkSources([findFixture("Shared.ts"), findFixture("SharedWriter.ts")], {}, options);
        expect(exported.map(d => [d.file, d.line, d.message])).toEqual([[findFixture("Shared.ts"), 6, written]]);
        expect(checkFixture("Alias.ts").map(d => [d.line, d.message])).toEqual([[8, written]]);
    });

    it("keeps a const a value through a for...of, a for...in, a typeof type and a copy into a literal, and loses it to a destructuring, a destructuring declaration, a loop target and every write through parentheses, a cast, a comma, a fallback, a branch, a mutator under any wrapper or on any branch, a library object's own method, or any call whose result may be the field's data, while a primitive's or a branded primitive's method, a call that yields a primitive, a function held in a property or a slot, `call` or `bind` on one, an arrow in the const's own literal even under an interface or through a holder, a signature bound to `this: void` in a project's own types, a literal with a stray read inside, held or not, a getter of a literal followed into its body, a nested literal slot by slot, what the default library built of its own, a literal's own slots read through `this` in any block, a library call spelled across lines, `this` inside a callback of a literal's accessor, a for...in or a for...of of primitives over a slot, an own arrow of a const with an escaped slot, a symbol key, a library global reached through `globalThis`, Object's own methods and a brand are not, a method of an object or an interface, a function that may bind `this` however it is held, a project's augmentation of Object or Array, a class's arrow field, a spread that may replace a method, a replaced arrow, a library collection held in a const, in another const's literal or behind an alias, what the default library only wrapped, a snapshot of a deep field, a slot that escaped to another holder, through a loop, a found row or the literal's own accessor even under `satisfies`, a string key, a project object typed like a library global, a `function` callback given `this`, a `.call(this)`, a literal that hands itself out through its own accessor, by name or by key, a const handed on as `this`, an argument or a return value, a project object typed as `globalThis`, a bound mutator and a write through what a slot's function returns are, and an `any` or `unknown` result may be anything", () => {
        const written = (name: string): string => `"${name}.x": "x" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare "x" readonly.`;
        expect(checkSources([findFixture("Consts.ts"), findFixture("globals.d.ts")], {}, options).filter(d => d.file === findFixture("Consts.ts")).map(d => [d.line, d.message])).toEqual([[359, written("spread")], [360, written("target")], [361, written("pattern")], [362, written("paren")], [364, written("counted")], [365, written("added")], [366, written("deleted")], [367, written("pushed")], [368, written("pathed")], [369, written("asserted")], [370, written("satisfied")], [371, written("sequenced")], [372, written("found")], [373, written("ored")], [374, written("chosen")], [375, written("wrapped")], [376, written("copied")], [379, written("dated")], [380, written("applied")], [381, written("mapped")], [383, written("unknowns")], [389, "\"slots.n\": \"n\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"n\" readonly."], [391, written("bag")], [392, written("sack")], [393, written("callable")], [395, written("boundPush")], [402, written("bumping")], [403, written("shorthandBump")], [404, written("accessed")], [405, written("satisfied2")], [406, written("augmented")], [407, written("indexedBrand")], [409, "\"fielded.b\": \"b\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"b\" readonly."], [410, written("augmentedArray")], [411, written("spreadOver")], [415, "\"kids.length\": a read into HTMLCollection, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property `as live` if the owner opens it."], [417, written("replaced")], [421, "\"heldKids.inner.length\": a read into HTMLCollection, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property `as live` if the owner opens it."], [423, "\"kidsAlias.length\": a read into HTMLCollection, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property `as live` if the owner opens it."], [424, "\"doc.body\": a read into Document, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property `as live` if the owner opens it."], [425, written("destructured")], [248, "\"document.body\": a read into Document, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property `as live` if the owner opens it."], [429, "\"nestedKids.inner.list.length\": a read into HTMLCollection, a library object that can change under the getter with nothing to mark. Hold it in a @live field and replace it when it changes, or read that one property `as live` if the owner opens it."], [433, written("sealed")], [435, "\"snap.list\": \"list\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"list\" readonly."], [436, "\"escaping.inner.x\": \"x\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"x\" readonly."], [438, "\"looped2.list\": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly."], [439, "\"picked.list\": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly."], [279, "\"this.items.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [442, "\"quoted.y.x\": \"x\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"x\" readonly."], [297, "\"this.items.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [449, written("parsedLike")], [311, "\"this.items.map\": \"map\" reads an array that can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [311, "\"this.other.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [451, "\"selfish.n\": \"n\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"n\" readonly."], [319, "\"this.items.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [454, "\"this.list.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [455, "\"a.list\": \"list\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"list\" readonly."], [456, "\"this.list.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [457, "\"selfKeyed.n\": \"n\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"n\" readonly."], [458, "\"fakeKeys.length\": \"length\" of Array can change by mutation, and it is not followed. Mark the field @deep, or type it ReadonlyArray."], [460, "\"handOver().list\": \"list\" is a plain property that can change by mutation, and the object is not followed. Hold the object in a @deep field, or declare \"list\" readonly."], [461, written("branched")], [463, written("element")], [464, written("casted")], [465, written("asserted2")], [466, written("keyed2")], [467, written("named")]]);
    });
});

describe("the template check", () => {
    it("passes a template that reads marks, getters, methods, a ref into a plain field and a const the script never writes, and hints at a mark no template reads", () => {
        const diagnostics = checkSources([findFixture("Good.ts")], readTacet("Good.tacet"), options);
        expect(diagnostics.filter(d => d.level === "error")).toEqual([]);
        const hints = diagnostics.filter(d => d.level === "hint");
        // The template reads `text`, `isDone`, `filter`, `date` and `box`; `tags`, `config`, `bounds`, `settings`, `now` and `layout` through `summary`; `todos` through `shown`. `unused` is not read.
        expect(hints.map(h => [h.line, h.message])).toEqual([
            [21, `"unused" of Manager is marked @live, and no template reads it. The mark costs a little on every write; drop it if nothing on the screen needs it.`],
        ]);
    });

    it("names a plain field a template reads, a v-model, a write in a handler, a ref into a missing, marked, readonly or getter member, and a const the script writes", () => {
        const diagnostics = checkSources([findFixture("Bad.ts")], readTacet("Bad.tacet"), options);
        const errors = diagnostics.filter(d => d.level === "error" && d.file === findFixture("Bad.tacet"));
        expect(errors.map(d => [d.line, d.column, d.message])).toEqual([
            [3, 10, `A template never writes a field: v-model writes "view.unread". Bind :value and handle the event through a method of the view.`],
            [2, 9, `"view.plain": "plain" is a plain field of BadView that can change, and the screen would not follow it. Mark it @live or @deep, or make it readonly.`],
            [4, 19, `A template never writes a field: "view.plain". Go through a method of the view.`],
            [5, 19, `A template never writes a field: "view.plain". Go through a method of the view.`],
            [6, 20, `"view.rows": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly.`],
            [7, 8, `ref="view.bx": BadView has no field "bx". The element goes into a plain field of the view; declare it.`],
            [8, 8, `ref="view.unread": "unread" is marked @live. The element goes into a plain field of the view, never a marked one.`],
            [9, 8, `ref="view.counter": "counter" is readonly, and the element is written into it when it is drawn and removed. Make it a plain field.`],
            [10, 8, `ref="view.a": "a" is not a field. The element goes into a plain field of the view, never a getter or a method.`],
            [11, 18, `"pushed": what is inside it can change and is not followed. Hold it in a @deep field, or type it readonly.`],
        ]);
    });

    it("names a directive with no expression in Vue's words, and goes on", () => {
        const diagnostics = checkSources([], readTacet("Missing.tacet"), options);
        expect(diagnostics.map(d => [d.file, d.line, d.column, d.level, d.message])).toEqual([
            [findFixture("Missing.tacet"), 2, 6, "error", errorMessages[ErrorCodes.X_V_IF_NO_EXPRESSION]],
            [findFixture("Missing.tacet"), 4, 6, "error", errorMessages[ErrorCodes.X_V_IF_NO_EXPRESSION]],
            [findFixture("Missing.tacet"), 5, 6, "error", errorMessages[ErrorCodes.X_V_FOR_NO_EXPRESSION]],
            [findFixture("Missing.tacet"), 6, 6, "error", errorMessages[ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION]],
        ]);
    });

    it("keeps the chain after a v-if with no expression: every v-else-if condition and every branch is still checked", () => {
        const diagnostics = checkSources([findFixture("Bad.ts")], readTacet("Chain.tacet"), options);
        const plain = `"view.plain": "plain" is a plain field of BadView that can change, and the screen would not follow it. Mark it @live or @deep, or make it readonly.`;
        expect(diagnostics.filter(d => d.file === findFixture("Chain.tacet")).map(d => [d.line, d.column, d.message])).toEqual([
            [2, 6, errorMessages[ErrorCodes.X_V_IF_NO_EXPRESSION]],
            [3, 17, plain],
            [4, 16, plain],
        ]);
    });
});

describe("the checker in dev", () => {
    it("reads the tsconfig, finds the .tacet files, and keeps its program between runs", () => {
        const checker = new Checker({root: here});
        const first = performance.now();
        const once = checker.check();
        const firstTook = performance.now() - first;
        const second = performance.now();
        const twice = checker.check();
        const secondTook = performance.now() - second;
        expect(once.map(d => d.message)).toEqual(twice.map(d => d.message));
        expect(once.filter(d => d.level === "error")).toEqual([]);
        expect(once.map(d => d.message)).toEqual([`"unused" of Manager is marked @live, and no template reads it. The mark costs a little on every write; drop it if nothing on the screen needs it.`]);
        expect(secondTook).toBeLessThan(firstTook);
    });
});
