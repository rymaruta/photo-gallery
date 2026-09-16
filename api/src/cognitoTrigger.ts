import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand, CreateGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { requireEnv } from "./env";

const USER_GROUP = "user";
const USERS_TABLE = requireEnv("USERS_TABLE");

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

type PostConfirmationEvent = {
    triggerSource: string;
    userPoolId: string;
    userName: string;
    region: string;
    request?: { userAttributes?: Record<string, string> };
};

/**
 * 登録完了と同時にプロフィール行を作る。
 *
 * これが無いと「プロフィールを一度も保存していない人」はテーブルに存在せず、
 * ユーザー検索に出てこないし、他の人からは既定名で表示される。
 *
 * 表示名は入れない。登録時にはメールアドレスしか受け取っておらず、
 * それを表示名に流用すると公開画面にメールの一部が出てしまうため。
 * 名前は本人にアプリ内で決めてもらう。
 *
 * 失敗しても登録自体は止めない（トリガーが例外を投げるとサインアップが失敗する）。
 */
async function createProfileIfMissing(userId: string): Promise<void> {
    try {
        await ddb.send(new PutItemCommand({
            TableName: USERS_TABLE,
            Item: marshall({ userId, createdAt: new Date().toISOString() }),
            // 既にあるプロフィールは絶対に上書きしない
            ConditionExpression: "attribute_not_exists(userId)",
        }));
    } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "ConditionalCheckFailedException") return; // 既にある = 正常
        console.error("createProfileIfMissing error:", e);
    }
}


/**
 * `user` グループへ入れる。**何があっても投げない。**
 *
 * **グループが無ければ作って入れ直す。** `AdminAddUserToGroup` は対象の
 * グループが無いと `ResourceNotFoundException` で落ちる。ここは握って先へ
 * 進む作りなので、**プールにグループが無いと、新規登録した人が全員
 * 「ログインできるのに投稿・編集・下書きだけ永久に開けない」**状態になる
 * ——しかも再ログインでは直らない（Cognito 側に無いため）。
 *
 * グループを作るのは `scripts/provision-env.js` だけで、**それより前に
 * 作られたプールには無い**。環境を手で増やしたときも同じ穴が開く。
 * 1人目の登録で作られるようにして、その穴を塞ぐ。
 *
 * 作るのは `user` だけ。`admin` は絶対に作らないし入れない。
 */
async function addToUserGroup(
    client: CognitoIdentityProviderClient,
    event: PostConfirmationEvent,
): Promise<void> {
    const add = () => client.send(new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: USER_GROUP,
    }));
    try {
        await add();
        return;
    } catch (e) {
        // **グループが無いときだけ作りにいく。** 権限不足（AccessDenied）で
        // 作りにいっても同じ理由で失敗するだけなので、無駄に叩かない
        if ((e as { name?: string }).name !== "ResourceNotFoundException") {
            console.error("postConfirmation: AdminAddUserToGroup failed:", e);
            return;
        }
        console.warn(`postConfirmation: ${USER_GROUP} グループが無いので作ります`);
    }
    try {
        await client.send(new CreateGroupCommand({
            UserPoolId: event.userPoolId,
            GroupName: USER_GROUP,
            Description: "写真の投稿・編集ができる利用者",
        }));
    } catch (e) {
        // 同時に登録した人が先に作った＝正常。そのまま入れ直す
        if ((e as { name?: string }).name !== "GroupExistsException") {
            console.error("postConfirmation: CreateGroup failed:", e);
            return;
        }
    }
    try {
        await add();
    } catch (e) {
        console.error("postConfirmation: AdminAddUserToGroup retry failed:", e);
    }
}

// Cognito PostConfirmation トリガー
// メール確認完了後に "user" グループへ追加し、プロフィール行を作る
export const postConfirmation = async (event: PostConfirmationEvent): Promise<PostConfirmationEvent> => {
    // confirmSignUp 以外のトリガー（admin確認など）は対象外
    if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
        return event;
    }

    // グループ追加もプロフィール作成も、失敗してもトリガーは成功させる。
    //
    // ここで投げると ConfirmSignUp ごと失敗するが、**Cognito は既に
    // ユーザーを CONFIRMED にしている**。ユーザーには「確認に失敗しました」と
    // 出て、コードを入れ直しても今度は「すでに確認済みです」で先へ進めない。
    // ログイン自体はできるのにグループもプロフィールも無いので、
    // アップロード・下書き・編集の全部が永久に開けない
    // （/user/upload → /login → プロフィールへ、と往復するだけ）。
    // 復旧手段がアプリのどこにも無い。落とすなら「トリガーが一部失敗した」
    // 方が軽い——グループは後から入れ直せる。
    const client = new CognitoIdentityProviderClient({ region: event.region });
    await addToUserGroup(client, event);

    // userId は Cognito の sub（アプリ全体で userId として使っている値）
    const sub = event.request?.userAttributes?.sub;
    if (sub) await createProfileIfMissing(sub);

    return event;
};
