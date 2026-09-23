# 絞った写真の画像を、URL だけで取れないようにする

**状態: コードは完成（#136）。本番の設定だけが残っている（owner の作業）**
最終更新 2026-09-22

## いまどうなっているか

公開範囲（`audience`）を守っているのは **API だけ**で、`/uploads/**` の
画像そのものには権限の判定がありません。

    GET /feed/restricted   → 誰に見せるかをサーバーが判定して返す   ✅
    https://<cdn>/uploads/<uid>/<id>.jpg  → **誰でも取れる**        🔴

つまり `restrictedFeed.ts` が正しく判定しても、**配った URL が永久に
有効**なら、判定は「初回だけ」効いていることになります。

- フォローを外されても、ブロックされても、**控えた URL で取り続けられる**
- 公開 →「フォロワーのみ」に変えても、**画像の実体は動かない**
  （再ビルドが作り直すのは HTML だけ）

## 実測（2026-09-22・本番・未認証）

    GET /photos                     39枚・audience 付き 0枚
    GET /photos/<公開写真のid>       200
    GET /photos/does-not-exist       404

**いま本番に絞った写真は1枚もありません**（機能が未リリースのため）。
＝ **いま漏れているものはありません。** 出す前に塞ぐ話です。

## 何を入れたか（PR #136・コードだけ）

CloudFront の署名付き URL（canned policy）。`api-user/src/signedUrl.ts`。

- 期限 **10分**。長いと「外したのに見える」窓が伸びる
- **その URL だけ**に効く（前方一致にしない）
- **派生も全部署名**（`thumbSrc`・`srcAvif`・`src256` …）。`src` だけだと
  鍵をかけた玄関の横に窓が開いている形
- **鍵が無い環境では何もしない**（いまの本番がこれ）

## 🔴 ここから先が設計判断（owner に決めてほしいこと）

### なぜ「振る舞いに署名必須を付ける」だけでは駄目か

CloudFront の「ビューワーアクセスを制限する」は**振る舞い（behavior）単位**
です。`/uploads/*` の振る舞いに付けると:

    絞った写真        署名あり → 見える      ✅
    **公開写真**      署名なし → **403**     🔴 サイト全体の画像が割れる

公開写真の URL を書いているのは**静的サイト**（`photos.json` → 個別ページ・
一覧・OGP）で、そこに署名は載せられません——静的なので**期限を持てない**。

### 案A: 絞った写真だけ別のプレフィックスへ（推奨）

    uploads/<uid>/<id>.jpg           公開      署名なしで配る（今までどおり）
    private/<uid>/<id>.jpg           絞った    **署名必須の振る舞い**

CloudFront には振る舞いを **2つ**置きます。`/private/*` にだけ鍵グループを
付けるので、**公開写真は1枚も影響を受けません**。

移行:

1. CloudFront に `/private/*` の振る舞いを足す（鍵グループ付き）
2. `deploy-api.yml` で `CLOUDFRONT_KEY_PAIR_ID` / `CLOUDFRONT_PRIVATE_KEY` を渡す
3. 公開範囲を絞ったとき、S3 のオブジェクトを `uploads/` → `private/` へ**移す**
   （`CopyObject` ＋ `DeleteObject`）。行の `src` も書き換える
4. 解除したら逆へ戻す

**3 が本体の作業**です。移す間に落ちると「行は `private/` を指すのに実体が
`uploads/` に在る」＝**写真が割れる**ので、**先にコピー・行を書き換え・
最後に元を消す**順にします（`photoUpdate.ts` の差し替えが同じ順序で、
同じ理由が書いてあります）。

⚠️ **既に配られた URL は、移した瞬間に 404 になります。** これは
**狙いどおり**（それが「取り続けられる」を止める唯一の方法）ですが、
**絞る前に開いていた人の画面がその場で割れます**。

### 案B: `/uploads/*` 全体を署名必須にし、静的サイトも署名する

静的サイトが書く URL に署名を載せることになりますが、**静的なので期限を
持てません**。期限を年単位にすると署名の意味が消えます。**採りません。**

### 案C: 何もしない（いまのまま）

「フォロワーのみ」は**画面の上での約束**で、URL を知っている人には効かない、
と割り切る。**owner がそう決めるなら、それも1つの答え**です——ただし
**その場合は「フォロワーのみ」という言葉を画面から変えるべき**です。
守れない約束を UI に書かない方がいい。

## 費用と手間（案A）

- CloudFront の振る舞い追加: 無料
- 鍵グループ: 無料
- S3 の移動: 1枚あたり `CopyObject` + `DeleteObject`。**絞る操作のたび**に
  派生を含めて 7〜8 オブジェクト動く
- 署名の計算: Lambda の中で RSA-SHA1 1回/画像。実測で 1ms 未満

## 本番に入れる手順（owner の作業）

**私はここを実行できない。** 推測ではなく実測:

    $ aws sts get-caller-identity
    NG InvalidClientTokenId — The security token included in the request is invalid.

環境に `AWS_ACCESS_KEY_ID` は在るが、**AWS に通らない**（開発用の
置き石）。だから「承認をもらえば私がやる」ではなく、**owner の手でしか
できない**。以下は3つとも数分で終わる。

### 1. 鍵を作る（手元で1回）

```bash
openssl genrsa -out cf-private.pem 2048
openssl rsa -pubout -in cf-private.pem -out cf-public.pem
```

`cf-private.pem` は**どこにも commit しない**。

### 2. CloudFront に公開鍵と鍵グループ（コンソールでも CLI でも）

```bash
aws cloudfront create-public-key --public-key-config \
  "CallerReference=journey-private-$(date +%s),Name=journey-private,EncodedKey=$(cat cf-public.pem)"
# 返った Id を使って
aws cloudfront create-key-group --key-group-config \
  "Name=journey-private,Items=<公開鍵のId>"
```

### 3. `/private/*` の振る舞いを足す（ディストリビューション `EYRLTGCPOS9E4`）

**`/uploads/*` は触らない。** `/private/*` を**新しい振る舞い**として足し、
そこにだけ「ビューワーアクセスを制限する（署名付き URL）」＋ 2 の鍵グループ。

⚠️ **ここを `/uploads/*` に付けると、公開写真まで 403 になってサイト全体の
画像が割れる。** 案A の全部はこの1点を避けるためにある。

### 4. Secrets とデプロイのパラメータ

GitHub の Secrets に:

    CLOUDFRONT_KEY_PAIR_ID   … 1 で作った公開鍵の Id
    CLOUDFRONT_PRIVATE_KEY   … cf-private.pem の中身（そのまま貼る）

`deploy-api.yml` から Lambda へ渡す（**この1行は私が入れられる**ので、
言ってもらえれば PR に足す）。

### 効いたかの確かめ方

    PHOTO_ID=<絞った写真のid> npm run verify:visibility:live

`isConfigured()` が true になっていれば署名が付き、鍵の無い URL は
CloudFront が 403 を返す。

**3 を入れるまで、この機能は完全に不活性**（署名は付かず、移動だけが
起きる）。移動しただけなら今の CloudFront でも正しく配信される
——`/private/*` も同じディストリビューションから配られるため。

## 決まっていないこと

~~案A／B／C のどれにするか~~ → **案A に決定**（2026-09-23）
~~既に配られた URL が 404 になることを許容するか~~ → **許容する**（同上）
~~派生も移すか~~ → **移す**（同上。`MEDIA_FIELDS` と `extraImages` 全部）

残るのは**上の 1〜4 だけ**（owner の作業）。

---

本番の CloudFront は1つも触っていません（**触れません**——上の実測のとおり）。
