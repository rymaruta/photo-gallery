// 触覚フィードバック。対応端末（主にAndroid）でだけ短く振動し、
// 非対応（iOS Safari 等）では静かに何もしない。
export function hapticTap(ms = 12): void {
    try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(ms);
        }
    } catch { /* noop */ }
}
