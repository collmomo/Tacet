import {describe, expect, it} from "vitest";
import {isReactive, reactive} from "vue";
import {transformTags} from "../src/tags";
import {follow} from "./helpers";
import * as js from "./fixtures/TodoViewTags.js";
import * as ts from "./fixtures/TodoViewTags";

describe("the comment tags, rewritten", () => {
    it("inserts the field call right after the tagged field and a static block for the getter", () => {
        const result = transformTags(`class V {\n  /** @live */ draft = "";\n  /** @deep */ rows = [];\n  plain = 1;\n  /** @live */ get total() { return 1; }\n}`, "/v.js");
        expect(result?.errors).toEqual([]);
        expect(result?.code).toBe(
            `import * as __tacet from "tacet";\nclass V {\n  /** @live */ draft = ""; #__tacet0 = __tacet.installField(this, "draft", "live");\n  /** @deep */ rows = []; #__tacet1 = __tacet.installField(this, "rows", "deep");\n  plain = 1;\n  /** @live */ get total() { return 1; } static { __tacet.installGetter(this.prototype, "total"); }\n}`,
        );
    });

    it("leaves a file with no tag alone, fast", () => {
        expect(transformTags(`class V { draft = ""; }`, "/v.ts")).toBeNull();
        expect(transformTags(`/** The view. */ class V { /** The draft. */ draft = ""; }`, "/v.ts")).toBeNull();
    });

    it("warns on a mistyped tag", () => {
        const result = transformTags(`class V {\n  /** @lvie */ draft = "";\n  /** @deeep */ rows = [];\n  /** @live */ ok = 1;\n}`, "/v.ts");
        expect(result?.warnings).toEqual([
            `/v.ts:2: "@lvie" is not a Tacet mark. Did you mean @live or @deep? The field stays plain.`,
            `/v.ts:3: "@deeep" is not a Tacet mark. Did you mean @live or @deep? The field stays plain.`,
        ]);
    });

    it("refuses a mark on a method, a setter, a static field and a @deep getter", () => {
        const result = transformTags(`class V {\n  /** @live */ go() {}\n  /** @live */ set x(v) {}\n  /** @live */ static n = 1;\n  /** @deep */ get rows() { return []; }\n}`, "/v.ts");
        expect(result?.errors).toEqual([
            `/v.ts:2: a method never needs a mark ("go").`,
            `/v.ts:3: the mark goes on the getter, not the setter ("x").`,
            `/v.ts:4: a static field cannot be marked ("n").`,
            `/v.ts:5: a getter takes @live, not @deep ("rows").`,
        ]);
    });

    it("lets a decorator win over a tag on the same field", () => {
        const result = transformTags(`class V {\n  /** @live */ @live draft = "";\n  /** @deep */ rows = [];\n}`, "/v.ts");
        expect(result?.code).not.toContain(`"draft"`);
        expect(result?.code).toContain(`"rows"`);
    });

    it("handles a class expression and a string-named field", () => {
        const result = transformTags(`const V = class {\n  /** @live */ "my-field" = 1;\n};`, "/v.js");
        expect(result?.code).toContain(`__tacet.installField(this, "my-field", "live")`);
    });
});

for (const [name, mod] of [["plain JavaScript", js], ["TypeScript", ts]] as const) {
    describe(`the todo view with comment tags, in ${name}`, () => {
        it("is driven by its methods with no browser", () => {
            const view = new mod.TodoView(new mod.TodoManager());
            view.typeDraft("milk");
            view.addDraft();
            expect(view.shownTodos.map(todo => todo.text)).toEqual(["milk"]);
            view.setFilter("done");
            expect(view.shownTodos).toEqual([]);
        });

        it("the marks are live, compare first, and keep the getter", () => {
            const view = new mod.TodoView(new mod.TodoManager());
            const draft = follow(() => view.draft);
            const shown = follow(() => view.shownTodos.map(todo => todo.isDone).join());
            view.typeDraft("a");
            view.typeDraft("a");
            expect(draft.runs).toBe(2);
            expect(view.getterRuns).toBe(1);
            view.manager.add("x");
            expect(shown.runs).toBe(2);
            view.manager.todos[0].toggle();
            expect(shown.last).toBe("true");
            view.setFilter("open");
            expect(view.getterRuns).toBe(2);
            expect(view.shownTodos).toEqual([]);
            expect(reactive(view)).toBe(view);
            expect(isReactive(view.manager.todos)).toBe(true);
            expect(isReactive(view.manager.todos[0])).toBe(false);
        });
    });
}
