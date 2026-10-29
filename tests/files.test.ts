import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {rewriteTacetFile} from "../src/files";
import Box from "./fixtures/Box.tacet";
import {BoxView} from "./fixtures/BoxView";
import Rows from "./fixtures/Rows.tacet";
import {RowsView} from "./fixtures/RowsView";

// `box` stays a plain field, as the check asks, so a proxy counts the writes into it.
function countBoxWrites(view: BoxView): BoxView {
    return new Proxy(view, {set: (target, key, value) => { if (key === "box") target.boxWrites++; return Reflect.set(target, key, value); }});
}

describe("a .tacet file, rewritten", () => {
    it("adds setup to the script and turns ref into a call on the view's field", () => {
        const result = rewriteTacetFile(`<template>\n  <div ref="view.box"></div>\n  <canvas ref='view.manager.canvas'></canvas>\n  <p ref="plain"></p>\n</template>\n<script lang="ts">\nimport {V} from "./V";\nconst view = new V();\n</script>`, "/a.tacet");
        expect(result?.code).toBe(`<template>\n  <div :ref="__tacetRef(view, 'box')"></div>\n  <canvas :ref='__tacetRef(view.manager, "canvas")'></canvas>\n  <p ref="plain"></p>\n</template>\n<script setup lang="ts">\nimport {assignElement as __tacetRef} from "tacet/runtime";\n\nimport {V} from "./V";\nconst view = new V();\n</script>`);
    });

    it("hands every v-for source to the runtime, so the rows come wrapped", () => {
        const result = rewriteTacetFile(`<template>\n  <li v-for="(todo, i) in view.shownTodos" :key="i"></li>\n  <p v-for='row of view.rows'></p>\n  <b ref="view.box"></b>\n</template>\n<script setup lang="ts">\nconst view = {};\n</script>`, "/a.tacet");
        expect(result?.code).toBe(`<template>\n  <li v-for="(todo, i) in __tacetEach(view.shownTodos)" :key="i"></li>\n  <p v-for='row of __tacetEach(view.rows)'></p>\n  <b :ref="__tacetRef(view, 'box')"></b>\n</template>\n<script setup lang="ts">\nimport {assignElement as __tacetRef, readItems as __tacetEach} from "tacet/runtime";\n\nconst view = {};\n</script>`);
    });

    it("leaves a script that already has setup, and a file with nothing to do", () => {
        expect(rewriteTacetFile(`<template><p ref="x"></p></template>\n<script setup>\nconst a = 1;\n</script>`, "/a.tacet")).toBeNull();
        const result = rewriteTacetFile(`<template><p ref="view.x"></p></template>\n<script setup>\nconst view = {};\n</script>`, "/a.tacet");
        expect(result?.code).toContain(`<script setup>\nimport {assignElement as __tacetRef} from "tacet/runtime";`);
    });

    it("warns, naming what it found, and leaves the template alone when there is no script", () => {
        const code = `<template>\n  <p ref="view.x"></p>\n  <b ref='view.manager.y'></b>\n  <li v-for="row in view.rows"></li>\n</template>`;
        const result = rewriteTacetFile(code, "/a.tacet");
        expect(result?.warnings).toEqual([
            `/a.tacet: ref="view.x" needs a <script> block that holds \`view\`; the template was left as written.`,
            `/a.tacet: ref='view.manager.y' needs a <script> block that holds \`view.manager\`; the template was left as written.`,
            `/a.tacet: v-for="row in view.rows" needs a <script> block, where Tacet puts its import; the template was left as written.`,
        ]);
        expect(result?.code).toBe(code);
    });

    it("leaves a comment, a text and a <pre> alone, and rewrites the attribute next to them", () => {
        const result = rewriteTacetFile(`<template>\n  <!-- ref="a.b" -->\n  <code>ref="view.box"</code>\n  <pre>v-for="x in y"</pre>\n  <template v-if="view.on"><div ref="view.box" v-for="x in view.rows"></div></template>\n</template>\n<script setup>\nconst view = {};\n</script>`, "/a.tacet");
        expect(result?.code).toBe(`<template>\n  <!-- ref="a.b" -->\n  <code>ref="view.box"</code>\n  <pre>v-for="x in y"</pre>\n  <template v-if="view.on"><div :ref="__tacetRef(view, 'box')" v-for="x in __tacetEach(view.rows)"></div></template>\n</template>\n<script setup>\nimport {assignElement as __tacetRef, readItems as __tacetEach} from "tacet/runtime";\n\nconst view = {};\n</script>`);
        expect(result?.warnings).toEqual([]);
    });
});

describe("a .tacet component, mounted", () => {
    it("reads the view, follows its marks and hands the element to the field", async () => {
        const view = new BoxView();
        const wrapper = mount(Box, {props: {view}});
        expect(wrapper.find(".box").text()).toBe("hello");
        expect(view.box).toBe(wrapper.find(".box").element);
        expect(wrapper.find(".shown").exists()).toBe(false);

        view.setLabel("bye");
        await nextTick();
        expect(wrapper.find(".box").text()).toBe("bye");

        await wrapper.find("button").trigger("click");
        expect(wrapper.find(".shown").exists()).toBe(true);
        expect(view.box).toBe(wrapper.find(".box").element);

        wrapper.unmount();
        expect(view.box).toBeNull();
    });

    it("writes the element only when it differs: once on mount, once on unmount", async () => {
        const view = new BoxView();
        const wrapper = mount(Box, {props: {view: countBoxWrites(view)}});
        expect(view.box).toBe(wrapper.find(".box").element);
        expect(view.boxWrites).toBe(1);

        await wrapper.find("button").trigger("click");
        expect(wrapper.find(".shown").exists()).toBe(true);
        expect(view.boxWrites).toBe(1);

        view.setLabel("bye");
        await nextTick();
        expect(wrapper.find(".box").text()).toBe("bye");
        expect(view.boxWrites).toBe(1);

        wrapper.unmount();
        expect(view.box).toBeNull();
        expect(view.boxWrites).toBe(2);
    });

    it("follows a plain row under @deep that v-for walks, and a push", async () => {
        const view = new RowsView();
        const wrapper = mount(Rows, {props: {view}});
        expect(wrapper.findAll("li").map(li => li.text())).toEqual(["1", "2"]);

        view.bump(0);
        await nextTick();
        expect(wrapper.findAll("li").map(li => li.text())).toEqual(["2", "2"]);

        view.add(9);
        await nextTick();
        expect(wrapper.findAll("li").map(li => li.text())).toEqual(["2", "2", "9"]);
    });
});
