import {describe, expect, it} from "vitest";
import {isReactive, reactive, toRaw} from "vue";
import {deep, live} from "../src";
import {follow} from "./helpers";

class Todo {
    public readonly id: string;
    @live public text: string;
    @live public isDone = false;

    constructor(text: string, id = String(Math.random())) {
        this.id = id;
        this.text = text;
    }

    public toggle(): void {
        this.isDone = !this.isDone;
    }
}

class TodoManager {
    @deep public todos: Todo[] = [];

    public add(text: string): Todo {
        const todo = new Todo(text);
        this.todos.push(todo);
        return todo;
    }

    public remove(id: string): void {
        this.todos = this.todos.filter(todo => todo.id !== id);
    }
}

type Filter = "all" | "open" | "done";

class TodoView {
    @live public draft = "";
    @live public filter: Filter = "all";
    public readonly manager: TodoManager;
    public plainLayout = {rows: 0};
    public getterRuns = 0;

    constructor(manager: TodoManager) {
        this.manager = manager;
    }

    @live public get shownTodos(): Todo[] {
        this.getterRuns++;
        if (this.filter === "all") return this.manager.todos;
        return this.manager.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    public get openCount(): number {
        return this.manager.todos.filter(todo => !todo.isDone).length;
    }

    public typeDraft(text: string): void { this.draft = text; }

    public addDraft(): void {
        const text = this.draft.trim();
        if (text === "") return;
        this.manager.add(text);
        this.draft = "";
    }

    public setFilter(filter: Filter): void { this.filter = filter; }
}

describe("the todo view with decorators", () => {
    it("is driven by its methods with no browser", () => {
        const view = new TodoView(new TodoManager());
        view.typeDraft("milk");
        view.addDraft();
        expect(view.shownTodos.map(todo => todo.text)).toEqual(["milk"]);
        view.setFilter("done");
        expect(view.shownTodos).toEqual([]);
        expect(view.draft).toBe("");
    });

    it("a @live field notifies on assignment and not on the same value", () => {
        const view = new TodoView(new TodoManager());
        const watcher = follow(() => view.draft);
        expect(watcher.runs).toBe(1);
        view.typeDraft("a");
        expect(watcher.runs).toBe(2);
        view.typeDraft("a");
        expect(watcher.runs).toBe(2);
    });

    it("a @live getter re-runs only when a marked field it read changed", () => {
        const view = new TodoView(new TodoManager());
        const watcher = follow(() => view.shownTodos.length);
        expect(view.getterRuns).toBe(1);
        view.shownTodos;
        view.shownTodos;
        expect(view.getterRuns).toBe(1);
        view.plainLayout.rows = 5;
        view.plainLayout = {rows: 6};
        expect(view.shownTodos).toBeDefined();
        expect(view.getterRuns).toBe(1);
        // Under "all" the getter read the list holder, not the list: a push leaves
        // its result alone, and the result is the live list, so the effect still sees it.
        view.manager.add("x");
        expect(watcher.runs).toBe(2);
        expect(view.getterRuns).toBe(1);
        view.setFilter("done");
        expect(view.getterRuns).toBe(2);
        expect(view.shownTodos).toEqual([]);
        view.manager.todos[0].toggle();
        expect(view.shownTodos.length).toBe(1);
        expect(view.getterRuns).toBe(3);
    });

    it("a getter with no mark runs on every read and is never stale", () => {
        const view = new TodoView(new TodoManager());
        expect(view.openCount).toBe(0);
        view.manager.add("x");
        expect(view.openCount).toBe(1);
        view.manager.todos[0].toggle();
        expect(view.openCount).toBe(0);
    });

    it("@deep tracks mutation: a push and a toggle inside the list", () => {
        const manager = new TodoManager();
        const watcher = follow(() => manager.todos.filter(todo => todo.isDone).length);
        const todo = manager.add("x");
        expect(watcher.runs).toBe(2);
        todo.toggle();
        expect(watcher.runs).toBe(3);
        expect(watcher.last).toBe(1);
        manager.remove(todo.id);
        expect(watcher.runs).toBe(4);
        expect(watcher.last).toBe(0);
    });

    it("@deep stops at a class: the class instance is never wrapped", () => {
        const manager = new TodoManager();
        const todo = manager.add("x");
        expect(manager.todos[0]).toBe(todo);
        expect(isReactive(manager.todos[0])).toBe(false);
        expect(isReactive(manager.todos)).toBe(true);
    });

    it("the instance is raw: reactive(view) returns the view itself", () => {
        const view = new TodoView(new TodoManager());
        expect(reactive(view)).toBe(view);
        const box = reactive({view});
        expect(box.view).toBe(view);
        expect(toRaw(view)).toBe(view);
    });

    it("a write in the constructor goes through the setter", () => {
        const todo = new Todo("milk");
        const watcher = follow(() => todo.text);
        todo.text = "bread";
        expect(watcher.runs).toBe(2);
        expect(JSON.parse(JSON.stringify(todo))).toEqual({id: todo.id, text: "bread", isDone: false});
    });

    it("a subclass adds its own marks", () => {
        class Dated extends Todo {
            @live public due = "";
        }
        const todo = new Dated("x");
        const watcher = follow(() => todo.due + todo.text);
        todo.due = "tomorrow";
        todo.text = "y";
        expect(watcher.runs).toBe(3);
    });

    it("an array under @live: a push is silent, a replacement notifies", () => {
        class Bag {
            @live public items: number[] = [];
        }
        const bag = new Bag();
        const watcher = follow(() => bag.items.length);
        bag.items.push(1);
        expect(watcher.runs).toBe(1);
        bag.items = [...bag.items, 2];
        expect(watcher.runs).toBe(2);
        expect(watcher.last).toBe(2);
    });

    it("a method takes no mark", () => {
        expect(() => {
            class Wrong {
                // @ts-expect-error a method never needs a mark
                @live public go(): void {}
            }
            return new Wrong();
        }).toThrow(/never needs a mark/);
    });

    it("the accessor keyword takes no mark", () => {
        expect(() => {
            class Wrong {
                // @ts-expect-error two marks, on a field or a getter
                @live public accessor count = 0;
            }
            return new Wrong();
        }).toThrow(/not an accessor \("count"\)/);
    });
});
