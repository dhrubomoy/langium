grammar SimpleSQL

// ──────────────────────────────────────────────────────────────────────────────
// A SQL-like DSL demonstrating Langium-X with the Lezer parser backend.
//
// Features demonstrated:
//   - infix rules         → WHERE clause binary expressions
//   - @precMarker          → type-position disambiguation in CREATE TABLE
//   - @dynamicPrecedence   → prefer FunctionCall over bare ColumnRef
//   - conflicts            → FunctionCall vs ColumnRef intentional ambiguity
//   - precedence block     → named precedence levels
// ──────────────────────────────────────────────────────────────────────────────

entry Program: statements+=Statement*;

Statement: SelectStmt | CreateTableStmt | InsertStmt;

// ── SELECT ──────────────────────────────────────────────────────────────────

SelectStmt:
    'select' (star?='*' | columns+=ColumnExpr (',' columns+=ColumnExpr)*)
    'from' table=[CreateTableStmt:ID]
    ('where' condition=Expr)?
    ';';

ColumnExpr: expression=Expr ('as' alias=ID)?;

// ── CREATE TABLE ────────────────────────────────────────────────────────────

CreateTableStmt:
    'create' 'table' name=ID '('
        columns+=ColumnDef (',' columns+=ColumnDef)*
    ')' ';';

// @precMarker=TypeAnnotation resolves the shift/reduce ambiguity at the type
// position: after reading the column name (ID), the parser needs the !tag
// to know the next token is the type, not the start of something else.
ColumnDef: name=ID type=DataType @precMarker=TypeAnnotation;

DataType returns string: 'int' | 'text' | 'float' | 'bool';

// ── INSERT ──────────────────────────────────────────────────────────────────

InsertStmt:
    'insert' 'into' table=[CreateTableStmt:ID]
    'values' '(' values+=Expr (',' values+=Expr)* ')'
    ';';

// ── Expression tower (infix) ────────────────────────────────────────────────
//
// The infix rule generates Lezer @precedence levels + !tag markers for each
// operator precedence level.  Lowest precedence listed first.

infix Expr on PrimaryExpr: 'or' > 'and' > '=' | '!=' | '<' | '>' | '<=' | '>=' > '+' | '-' > '*' | '/';

PrimaryExpr:
    NumberLit | StringLit | BoolLit | NullLit
  | FunctionCall | ColumnRef | ParenExpr | NotExpr;

ParenExpr: '(' inner=Expr ')';

NotExpr: 'not' operand=PrimaryExpr;

// FunctionCall vs ColumnRef: both start with ID.
// @dynamicPrecedence(2) on FunctionCall makes Lezer prefer it when the next
// token is '(' — e.g. `count(*)` parses as FunctionCall, not ColumnRef.
// The conflicts declaration tells Lezer this ambiguity is intentional (GLR).
FunctionCall: name=ID @dynamicPrecedence(2) '(' (args+=Expr (',' args+=Expr)*)? ')';

ColumnRef: name=ID;

NumberLit: value=NUMBER;
StringLit: value=STRING;
BoolLit: value=('true' | 'false');
NullLit: {infer NullLit} 'null';

// ── Lezer-specific grammar extensions ───────────────────────────────────────

// Named precedence level used by @precMarker on ColumnDef.
precedence {
    TypeAnnotation left assoc;
}

// Declare that FunctionCall and ColumnRef may conflict (both start with ID).
conflicts {
    [FunctionCall, ColumnRef];
}

// Token-level precedence: SL_COMMENT ('--') takes priority over '-' (minus operator).
token precedence {
    SL_COMMENT, '-'
}

// ── Terminals ───────────────────────────────────────────────────────────────

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /--[^\r\n]*/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal NUMBER: /[0-9]+(\.[0-9]+)?/;
terminal STRING: /'[^']*'/;
