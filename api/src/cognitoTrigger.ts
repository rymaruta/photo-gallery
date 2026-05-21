import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";

const USER_GROUP = "user";

// Cognito PostConfirmation トリガー
// メール確認完了後に自動的に "user" グループへ追加する
export const postConfirmation = async (event: {
    triggerSource: string;
    userPoolId: string;
    userName: string;
    region: string;
}): Promise<typeof event> => {
    // confirmSignUp 以外のトリガー（admin確認など）は対象外
    if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
        return event;
    }

    const client = new CognitoIdentityProviderClient({ region: event.region });
    await client.send(new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: USER_GROUP,
    }));

    return event;
};
