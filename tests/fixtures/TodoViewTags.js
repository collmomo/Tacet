export class Todo {
    id;
    /** @live */ text;
    /** @live */ isDone = false;

    constructor(text, id = String(Math.random())) {
        this.id = id;
        this.text = text;
    }

    toggle() {
        this.isDone = !this.isDone;
    }
}

export class TodoManager {
    /** @deep */ todos = [];

    add(text) {
        this.todos.push(new Todo(text));
    }

    toggle(id) {
        this.todos.find(todo => todo.id === id)?.toggle();
    }

    remove(id) {
        this.todos = this.todos.filter(todo => todo.id !== id);
    }
}

export class TodoView {
    /** @live */ draft = "";
    /** @live */ filter = "all";
    manager;
    getterRuns = 0;

    constructor(manager) {
        this.manager = manager;
    }

    /**
     * The rows the filter keeps.
     * @live
     */
    get shownTodos() {
        this.getterRuns++;
        if (this.filter === "all") return this.manager.todos;
        return this.manager.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    typeDraft(text) { this.draft = text; }

    addDraft() {
        const text = this.draft.trim();
        if (text === "") return;
        this.manager.add(text);
        this.draft = "";
    }

    setFilter(filter) { this.filter = filter; }
}
