grammar Arithmetics

entry Module:
    'module' name=ID
    (statements+=Statement)*;

Statement: Definition;

Definition:
    'def' name=ID '=' expr=Expression ';';

FieldName:
    name=ID;

Expression:
    BinaryExpression;

infix BinaryExpression on PrimaryExpression:
    '%'
    > '^'
    > '*' | '/'
    > '+' | '-';

PrimaryExpression infers Expression:
    {infer FieldExpression} fieldName=FieldName |
    {infer NumberLiteral} value=NUMBER |
    { infer FunctionCall} FunctionCall;

FunctionCall: Acosh_Func | Acos_Func | Asinh_Func | Asin_Func | Atanh_Func | Atan2_Func | Atan_Func;

Acos_Func: 'acos' '(' x=Expression ')';
Acosh_Func: 'acosh' '(' x=Expression ')';
Asin_Func:
    'asin' '(' x=Expression ')';
Asinh_Func:
    'asinh' '(' x=Expression ')';
Atan_Func:
    'atan' '(' x=Expression ')';
Atan2_Func:
    'atan2' '(' y=Expression ',' x=Expression ')';
Atanh_Func:
    'atanh' '(' x=Expression ')';

hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]*)?/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
