grammar TaskList

// A simple task list DSL that works identically with both Chevrotain and Lezer backends.
// Demonstrates keywords, lists, and optional fields.

entry TaskList:
    'project' name=ID
    tasks+=Task*;

Task:
    'task' name=ID
    (':' priority=Priority)?
    ';';

Priority:
    'low' | 'medium' | 'high' | 'critical';

hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
