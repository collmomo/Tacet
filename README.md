# Tacet

A way to build a screen with plain classes.

Nothing moves unless you marked it.

## The idea

The screen is a picture of your objects. It reads them and calls them. It owns nothing.

Your logic lives in classes you write the way you always did: fields at the top, one public method per thing a user can do. No store, no hooks, no special object to extend, no function to call to make it work.

You mark the few fields the screen reads. Everything else is plain: never watched, never walked, never wrapped. A class can hold a million-row table in a plain field and the framework will never know it is there.

Two marks. That is the whole surface on a class.

## The marks

`@live` on a field: the screen follows it. Shallow: the value, not what is inside it. A write that does not change the value does nothing.

`@deep` on a field: the screen follows it and everything inside it. For a tree the template really walks: a list of rows, a set of options. Rare, and on purpose.

No mark: plain. The framework never touches it.

A getter that reads marked fields is cached, and refreshed only when one of them changes.

In plain JavaScript the marks are comment tags that the build reads, and the build already exists because the one-file components need it:

```js
/** @live */ draft = "";
/** @deep */ todos = [];
```

## The shape of an app

- **entities**: a thing with its fields and what it can do to itself. A `Todo`.
- **managers**: holds many of them, keeps and reads them, the rules across them. A `TodoStorage`.
- **views**: what one screen needs. One public method per user action. The marked fields. A `TodoView`.
- **components**: the one-file pages and pieces. Template, script, style together. The script is one line.

A view can hold another view, an entity or a manager, and read its marked fields through it. Where shared state lives is your design: a third view, composition, inheritance. The framework stays out of it.

## The rules

- The template is a projection. It reads a view and calls it. It never owns state.
- A view is a plain class. One public method per user action. No base class.
- Nothing is walked unless it is marked.
- A value that has not changed is never written. A marked setter compares first.
- Entities and managers never know the screen exists. A test drives a view with no browser.
- No stores. State lives on the object that owns it.

## A todo app

Three files.

**The entity and the manager** (`entities/Todo.js`, `managers/TodoStorage.js`):

```js
export class Todo {
    id;
    text;
    isDone = false;

    constructor(text) {
        this.id = crypto.randomUUID();
        this.text = text;
    }

    toggle() {
        this.isDone = !this.isDone;
    }
}
```

```js
export class TodoStorage {
    readTodos() {
        return JSON.parse(localStorage.getItem("todos") ?? "[]").map(row => Object.assign(new Todo(row.text), row));
    }

    writeTodos(todos) {
        localStorage.setItem("todos", JSON.stringify(todos));
    }
}
```

**The view** (`views/TodoView.js`):

```js
export class TodoView {
    @live draft = "";
    @live filter = "all";
    @deep todos = [];
    storage;

    constructor(storage) {
        this.storage = storage;
        this.todos = storage.readTodos();
    }

    /** The rows the filter keeps */
    get shownTodos() {
        if (this.filter === "all") return this.todos;
        return this.todos.filter(todo => todo.isDone === (this.filter === "done"));
    }

    addTodo() {
        const text = this.draft.trim();
        if (text === "") return;
        this.todos.push(new Todo(text));
        this.draft = "";
        this.storage.writeTodos(this.todos);
    }

    toggleTodo(id) {
        this.todos.find(todo => todo.id === id).toggle();
        this.storage.writeTodos(this.todos);
    }

    removeTodo(id) {
        this.todos = this.todos.filter(todo => todo.id !== id);
        this.storage.writeTodos(this.todos);
    }

    setFilter(filter) {
        this.filter = filter;
    }
}
```

**The component** (`components/Todos.vue`):

```html
<template>
  <input :value="view.draft" @input="view.draft = $event.target.value" @keydown.enter="view.addTodo()" placeholder="What needs doing?">
  <ul>
    <li v-for="todo in view.shownTodos" :key="todo.id" :class="{done: todo.isDone}">
      <input type="checkbox" :checked="todo.isDone" @change="view.toggleTodo(todo.id)">
      {{ todo.text }}
      <button @click="view.removeTodo(todo.id)">×</button>
    </li>
  </ul>
  <button v-for="f in ['all', 'open', 'done']" :key="f" :class="{picked: view.filter === f}" @click="view.setFilter(f)">{{ f }}</button>
</template>

<script>
  const view = app.todo;
</script>

<style>
  .done { text-decoration: line-through; }
  .picked { font-weight: bold; }
</style>
```

**Starting it** (`main.js`):

```js
const app = {todo: new TodoView(new TodoStorage())};
mount(Todos, "#app");
```

**A test, no browser:**

```js
const view = new TodoView(new FakeStorage());
view.draft = "milk";
view.addTodo();
expect(view.shownTodos.map(todo => todo.text)).toEqual(["milk"]);
view.setFilter("done");
expect(view.shownTodos).toEqual([]);
```

What is not there: refs, computed, watch, stores, props drilling, emits, a base class, a call to make things live. The template reads the view and calls it. The view is a class you can use from a test, from a script, or from anything else.

## What Tacet is, and is not

Tacet mounts a component and keeps the marked fields live. That is its whole job.

It borrows a renderer first. The one-file layout and the template syntax stay what they are, because they are the good part. Its own words are the marks and the rules above. What draws the DOM underneath can change later without the user noticing.

It is not a store, not a state manager, not a way to organise components. The shape of your app is yours.

## Why

Deep reactivity by default is the mistake. A framework that watches everything reachable will one day walk something enormous and you will not know why the screen stopped moving. Marking the few fields a screen reads is cheaper to write, cheaper to run, and says what you meant.

Classes with one method per action are the second half. A screen built that way can be driven by a test, by a script, or by a model, with the same calls a person makes through the buttons. Nothing has to be added later to make that possible. It is already the shape.
