// キャッシュ済み画像の取りこぼしを救うための ref コールバック。
//
// 画像は onLoad でしか表示に切り替えていないが、<img> は静的HTMLに含まれるため、
// 再訪（キャッシュ有り）ではハイドレーションより先に読み込みが終わることがある。
// React は取り逃した load を再発火しないので、そのままだと画像が
// 透明のまま残る（ハードリロードで直るため「たまに起きる」ように見える）。
//
// ref が付いた時点で complete を確認し、既に読み込み済みなら表示に切り替える。

/** その <img> が既に読み込み終わっているか（デコード可能な実体があるか） */
export function isImageReady(img: HTMLImageElement | null): boolean {
    return !!img && img.complete && img.naturalWidth > 0;
}
