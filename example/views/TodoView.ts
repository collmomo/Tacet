import {live} from "tacet";
import type {Todo} from "../entities/Todo";
import type {TodoManager} from "../managers/TodoManager";
import {TodoEvents} from "../events/TodoEvents";

export type TodoFilter = "all" | "open" | "done";

/** What the screen needs: its state, its marked fields, its manager. One public method per user action. */
export class TodoView {
    @live public draft = "";
    @live public filter: TodoFilter = "all";
    public readonly manager: TodoManager;
    public readonly events: TodoEvents;

    constructor(manager: TodoManager) {
        this.manager = manager;
        this.events = new TodoEvents(this);
    }

    /** The rows the filter keeps */
    @live public get shownTodos(): Todo[] {
        if (this.filter === "all") return this.manager.todos;
        return this.manager.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    public typeDraft(text: string): void {
        this.draft = text;
    }

    public addDraft(): void {
        const text = this.draft.trim();
        if (text === "") return;
        this.manager.add(text);
        this.draft = "";
    }

    public setFilter(filter: TodoFilter): void {
        this.filter = filter;
    }
}
