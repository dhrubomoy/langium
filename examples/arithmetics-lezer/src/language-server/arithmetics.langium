grammar Arithmetics

entry Module:
    'module' name=ID
    (statements+=Statement)*;

Statement:
    Definition | Evaluation;

Definition:
    'def' name=ID ('(' args+=DeclaredParameter (',' args+=DeclaredParameter)* ')')?
    ':' expr=Expression ';';

DeclaredParameter:
    name=ID;

type AbstractDefinition = Definition | DeclaredParameter;

Evaluation:
    expression=Expression ';';

infix Expression on PrimaryExpression infers BinaryExpression:
    '%'
    > '^'
    > '*' | '/'
    > '+' | '-';

PrimaryExpression infers Expression:
    '(' Expression ')' |
    {infer NumberLiteral} value=NUMBER |
    {infer FunctionCall} func=[AbstractDefinition] ('(' args+=Expression (',' args+=Expression)* ')')?;

// Token-level precedence: SL_COMMENT ('//') takes priority over '/' (division operator).
token precedence {
    SL_COMMENT, '/'
}

hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]*)?/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
