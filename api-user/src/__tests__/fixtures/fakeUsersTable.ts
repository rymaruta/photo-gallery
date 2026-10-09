/**
 * テスト用の小さな users テーブル（Get / Put / Delete と、このリポジトリが使う形の条件式だけ）。
 *
 * 条件式は `AND` でつないだ原子と、括弧の中の `OR` を読む:
 *   attribute_exists(x) / attribute_not_exists(x) / x = :v（`#名前` も可）
 * 読めない形が来たら投げる（黙って通さない）。
 *
 * `send` は1回ごとに `await` を挟むので、並べて走らせると本物と同じく
 * 「読む → 書く」の間に他の書き込みが割り込む。
 */
type Item = Record<string, unknown>;

export function condFail(): Error {
    return Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
}

function evalAtom(atom: string, item: Item | undefined, names: Record<string, string>, values: Record<string, unknown>): boolean {
    const a = atom.trim();
    const attr = (n: string) => (n.startsWith("#") ? names[n] : n);
    let m = /^attribute_exists\((#?\w+)\)$/.exec(a);
    if (m) return !!item && item[attr(m[1])] !== undefined;
    m = /^attribute_not_exists\((#?\w+)\)$/.exec(a);
    if (m) return !item || item[attr(m[1])] === undefined;
    m = /^(#?\w+) = (:\w+)$/.exec(a);
    if (m) return !!item && item[attr(m[1])] === values[m[2]];
    throw new Error(`fake: 読めない条件 ${a}`);
}

function evalCondition(expr: string, item: Item | undefined, names: Record<string, string> = {}, values: Record<string, unknown> = {}): boolean {
    // 括弧の外の AND で分ける
    const parts: string[] = [];
    let depth = 0, cur = "";
    const tokens = expr.split(/(\(|\)| AND )/);
    for (const t of tokens) {
        if (t === "(") depth++;
        if (t === ")") depth--;
        if (t === " AND " && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += t;
    }
    parts.push(cur);
    return parts.every((p) => {
        const s = p.trim();
        if (s.startsWith("(") && s.endsWith(")") && / OR /.test(s)) {
            return s.slice(1, -1).split(" OR ").some((x) => evalAtom(x, item, names, values));
        }
        return evalAtom(s, item, names, values);
    });
}

export class FakeUsersTable {
    rows = new Map<string, Item>();
    calls: { name: string; input: Record<string, unknown> }[] = [];

    get(userId: string): Item | undefined {
        const r = this.rows.get(userId);
        return r ? structuredClone(r) : undefined;
    }

    set(item: Item): void {
        this.rows.set(item.userId as string, structuredClone(item));
    }

    send = async (cmd: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        await Promise.resolve();
        const name = cmd.constructor.name;
        const input = cmd.input;
        this.calls.push({ name, input: structuredClone(input) });
        const key = (input.Key as Item | undefined)?.userId ?? (input.Item as Item | undefined)?.userId;
        if (typeof key !== "string") throw new Error(`fake: userId の無い ${name}`);
        const cur = this.rows.get(key);
        const check = () => {
            if (typeof input.ConditionExpression !== "string") return;
            const ok = evalCondition(
                input.ConditionExpression,
                cur,
                (input.ExpressionAttributeNames ?? {}) as Record<string, string>,
                (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>,
            );
            if (!ok) throw condFail();
        };
        if (name === "GetCommand") return { Item: cur ? structuredClone(cur) : undefined };
        if (name === "PutCommand") {
            check();
            this.rows.set(key, structuredClone(input.Item as Item));
            return {};
        }
        if (name === "DeleteCommand") {
            check();
            this.rows.delete(key);
            return {};
        }
        throw new Error(`fake: 扱えない命令 ${name}`);
    };
}
