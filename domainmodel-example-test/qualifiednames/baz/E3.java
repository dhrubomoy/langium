package qualifiednames.baz;

class E3 {
    private E4 that;
    private foo.bar.E2 other;
    private nested.E5 nested;
    
    public void setThat(E4 that) {
        this.that = that;
    }

    public E4 getThat() {
        return that;
    }

    public void setOther(foo.bar.E2 other) {
        this.other = other;
    }

    public foo.bar.E2 getOther() {
        return other;
    }

    public void setNested(nested.E5 nested) {
        this.nested = nested;
    }

    public nested.E5 getNested() {
        return nested;
    }
}
