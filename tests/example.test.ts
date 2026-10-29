import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {TodoView} from "../example/views/TodoView";
import {TodoManager} from "../example/managers/TodoManager";
import Todos from "../example/components/Todos.tacet";

describe("the todo app from the README", () => {
    it("a test, no browser", () => {
        localStorage.clear();
        const view = new TodoView(new TodoManager());
        view.typeDraft("milk");
        view.addDraft();
        expect(view.shownTodos.map(todo => todo.text)).toEqual(["milk"]);
        view.setFilter("done");
        expect(view.shownTodos).toEqual([]);
        expect(JSON.parse(localStorage.getItem("todos")!)).toMatchObject([{text: "milk", isDone: false}]);
    });

    it("the component, mounted, driven through its events", async () => {
        localStorage.clear();
        const wrapper = mount(Todos);
        const input = wrapper.find("input");
        await input.setValue("bread");
        await input.trigger("keydown.enter");
        expect(wrapper.findAll("li").map(li => li.text())).toEqual(["bread ×"]);
        await wrapper.find("li input").setValue(true);
        expect(wrapper.find("li").classes()).toContain("done");
        await wrapper.findAll("button").find(b => b.text() === "open")!.trigger("click");
        expect(wrapper.findAll("li")).toHaveLength(0);
        await wrapper.findAll("button").find(b => b.text() === "done")!.trigger("click");
        expect(wrapper.findAll("li")).toHaveLength(1);
        await wrapper.find("li button").trigger("click");
        await nextTick();
        expect(wrapper.findAll("li")).toHaveLength(0);
        expect(input.element.value).toBe("");
    });
});
