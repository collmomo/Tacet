export class Todo {
    public readonly id: string;
    /** @live */ public text: string;
    /** @live */ public isDone = false;

    constructor(text: string, id = String(Math.random())) {
        this.id = id;
        this.text = text;
    }

    public toggle(): void {
        this.isDone = !this.isDone;
    }
}

export class TodoManager {
    /** @deep */ public todos: Todo[] = [];

    public add(text: string): void {
        this.todos.push(new Todo(text));
    }
}

export class TodoView {
    /** @live */ public draft = "";
    /** @live */ public filter: "all" | "open" | "done" = "all";
    public readonly manager: TodoManager;
    public getterRuns = 0;

    constructor(manager: TodoManager) {
        this.manager = manager;
    }

    /** @live */
    public get shownTodos(): Todo[] {
        this.getterRuns++;
        if (this.filter === "all") return this.manager.todos;
        return this.manager.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    public typeDraft(text: string): void { this.draft = text; }

    public addDraft(): void {
        const text = this.draft.trim();
        if (text === "") return;
        this.manager.add(text);
        this.draft = "";
    }

    public setFilter(filter: "all" | "open" | "done"): void { this.filter = filter; }
}
