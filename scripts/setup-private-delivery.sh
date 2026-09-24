#!/usr/bin/env bash
#
# 絞った写真だけを署名付き URL で配るための、**本番 CloudFront の設定**。
# 案A（`docs/restricted-image-delivery.md`）の 1〜3 を1コマンドにする。
#
#     bash scripts/setup-private-delivery.sh            # 下見（何も変えない）
#     bash scripts/setup-private-delivery.sh --apply    # 実行
#
# **owner が自分の資格情報で流す。** 開発環境からは流せない——
# `AWS_ACCESS_KEY_ID` は在るが AWS に通らず（`InvalidClientTokenId`）、
# `aws` コマンドも入っていない（2026-09-23 実測）。
#
# やること:
#   1. RSA 鍵を作る（既にあれば使う）
#   2. CloudFront に公開鍵と鍵グループを作る
#   3. `/private/*` の振る舞いを足し、そこにだけ署名必須を付ける
#
# 🔴 **`/uploads/*` には絶対に付けない。** 付けると公開写真も 403 になり、
# **サイト全体の画像が割れる**（静的サイトの URL には期限を載せられない）。
# 下の `assert_not_uploads` がそれを見張る。
set -euo pipefail

DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:-EYRLTGCPOS9E4}"
PATTERN="private/*"
KEY_NAME="journey-private"
PRIVATE_PEM="${PRIVATE_PEM:-cf-private.pem}"
PUBLIC_PEM="${PUBLIC_PEM:-cf-public.pem}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

say() { printf '%s\n' "$*"; }
run() {
    if [ "$APPLY" = "1" ]; then "$@"; else say "  （下見）$*"; fi
}

# 🔴 **この関数が最後の砦。** 経路に `uploads` が入っていたら即座に止める
assert_not_uploads() {
    case "$PATTERN" in
        *uploads*)
            say "🔴 中止: 経路が '$PATTERN'。/uploads/* に署名必須を付けると"
            say "   **公開写真も 403 になってサイト全体の画像が割れます**。"
            say '   案A は private/* にだけ付けるためにあります。'
            exit 2 ;;
    esac
}
assert_not_uploads

# **道具を見るのは、実行するときだけ。** 下見は手元でも流せるべき
# ——流せないと「安全装置が効くか」を誰も確かめられない
if [ "$APPLY" = "1" ]; then
    command -v aws >/dev/null 2>&1 || { say "aws コマンドが要ります"; exit 1; }
    command -v jq  >/dev/null 2>&1 || { say "jq コマンドが要ります"; exit 1; }
fi
say "対象のディストリビューション: $DIST_ID / 経路: $PATTERN"
[ "$APPLY" = "1" ] || say "※ 下見です。何も変えません（実行するには --apply）"

# ---- 1. 鍵 ------------------------------------------------------------------
if [ -f "$PRIVATE_PEM" ]; then
    say "1. 鍵: $PRIVATE_PEM が既にあるので使います"
else
    say "1. 鍵を作ります（$PRIVATE_PEM / $PUBLIC_PEM）"
    run openssl genrsa -out "$PRIVATE_PEM" 2048
    run openssl rsa -pubout -in "$PRIVATE_PEM" -out "$PUBLIC_PEM"
fi
say "   ⚠️ $PRIVATE_PEM は **commit しない**（.gitignore 済み）"

# ---- 2. 公開鍵と鍵グループ ---------------------------------------------------
say "2. CloudFront に公開鍵と鍵グループ"
if [ "$APPLY" = "1" ]; then
    KEY_ID=$(aws cloudfront list-public-keys \
        --query "PublicKeyList.Items[?Name=='$KEY_NAME'].Id | [0]" --output text 2>/dev/null || echo "None")
    if [ "$KEY_ID" = "None" ] || [ -z "$KEY_ID" ]; then
        KEY_ID=$(aws cloudfront create-public-key --public-key-config \
            "CallerReference=$KEY_NAME-$(date +%s),Name=$KEY_NAME,EncodedKey=$(cat "$PUBLIC_PEM")" \
            --query "PublicKey.Id" --output text)
        say "   公開鍵を作りました: $KEY_ID"
    else
        say "   公開鍵は既にあります: $KEY_ID"
    fi
    GROUP_ID=$(aws cloudfront list-key-groups \
        --query "KeyGroupList.Items[?KeyGroup.KeyGroupConfig.Name=='$KEY_NAME'].KeyGroup.Id | [0]" \
        --output text 2>/dev/null || echo "None")
    if [ "$GROUP_ID" = "None" ] || [ -z "$GROUP_ID" ]; then
        GROUP_ID=$(aws cloudfront create-key-group --key-group-config \
            "Name=$KEY_NAME,Items=$KEY_ID" --query "KeyGroup.Id" --output text)
        say "   鍵グループを作りました: $GROUP_ID"
    else
        say "   鍵グループは既にあります: $GROUP_ID"
    fi
else
    say "  （下見）aws cloudfront create-public-key / create-key-group"
    KEY_ID="<作られる公開鍵のId>"; GROUP_ID="<作られる鍵グループのId>"
fi

# ---- 3. `/private/*` の振る舞い ----------------------------------------------
say "3. $PATTERN の振る舞いを足す（$DIST_ID）"
assert_not_uploads      # **もう一度見る**（ここまでで書き換わっていないこと）
if [ "$APPLY" = "1" ]; then
    aws cloudfront get-distribution-config --id "$DIST_ID" > /tmp/dist.json
    ETAG=$(jq -r '.ETag' /tmp/dist.json)
    # 既に在れば触らない（冪等）
    if jq -e --arg p "$PATTERN" \
        '.DistributionConfig.CacheBehaviors.Items[]? | select(.PathPattern==$p)' \
        /tmp/dist.json >/dev/null; then
        say "   $PATTERN の振る舞いは既にあります（触りません）"
    else
        # 既存の `/uploads/*` の振る舞いを土台にして、署名必須だけ足す
        jq --arg p "$PATTERN" --arg g "$GROUP_ID" '
          .DistributionConfig as $c
          | ($c.CacheBehaviors.Items[]? | select(.PathPattern=="uploads/*")) as $base
          | $c
          | .CacheBehaviors.Items = (($c.CacheBehaviors.Items // []) + [
              ($base // $c.DefaultCacheBehavior)
              | .PathPattern = $p
              | .TrustedKeyGroups = { Enabled: true, Quantity: 1, Items: [$g] }
            ])
          | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
        ' /tmp/dist.json > /tmp/dist-new.json
        aws cloudfront update-distribution --id "$DIST_ID" \
            --if-match "$ETAG" --distribution-config file:///tmp/dist-new.json >/dev/null
        say "   足しました（反映に数分かかります）"
    fi
else
    say "  （下見）get-distribution-config → $PATTERN を足して update-distribution"
fi

# ---- 4. 次にやること ----------------------------------------------------------
say ""
say "次: GitHub の Secrets に登録してください（受け渡しの配線は入っています）"
say "    CLOUDFRONT_KEY_PAIR_ID = $KEY_ID"
say "    CLOUDFRONT_PRIVATE_KEY = $PRIVATE_PEM の中身"
say ""
say "登録して API を出し直すと署名が効きます。確かめ方:"
say "    PHOTO_ID=<絞った写真のid> npm run verify:visibility:live"
