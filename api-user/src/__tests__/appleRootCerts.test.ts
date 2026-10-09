import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { X509Certificate, createHash } from "node:crypto";
import { APPLE_ROOT_CA_G2_BASE64, APPLE_ROOT_CA_G3_BASE64, appleRootCertificates } from "../appleRootCerts";

// Apple のルート証明書（`appleRootCerts.ts`）が、取ってきたファイル（`api-user/certs/`）と
// 1バイトも違わず、Apple が公開している指紋と同じこと。
// 書き換えられた根を信じると、誰の署名でも「Apple の署名」として通ってしまう。

const CERTS = join(__dirname, "..", "..", "certs");
const fingerprint = (der: Buffer) => createHash("sha256").update(der).digest("hex").toUpperCase().match(/../g)!.join(":");

describe("Apple のルート証明書", () => {
    it.each([
        ["AppleRootCA-G3.cer", APPLE_ROOT_CA_G3_BASE64, "63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79", "Apple Root CA - G3"],
        ["AppleRootCA-G2.cer", APPLE_ROOT_CA_G2_BASE64, "C2:B9:B0:42:DD:57:83:0E:7D:11:7D:AC:55:AC:8A:E1:94:07:D3:8E:41:D8:8F:32:15:BC:3A:89:04:44:A0:50", "Apple Root CA - G2"],
    ])("%s: ファイルと同じ・指紋が Apple の公開値", (file, b64, fp, cn) => {
        const der = readFileSync(join(CERTS, file));
        expect(Buffer.from(b64, "base64").equals(der)).toBe(true);
        expect(fingerprint(der)).toBe(fp);
        const cert = new X509Certificate(der);
        expect(cert.subject).toContain(`CN=${cn}`);
        expect(cert.subject).toContain("O=Apple Inc.");
        expect(cert.ca).toBe(true);
        // 自己署名の根
        expect(cert.verify(cert.publicKey)).toBe(true);
    });

    it("確かめ役に渡すのは G3 と G2 の2枚（DER）", () => {
        const roots = appleRootCertificates();
        expect(roots).toHaveLength(2);
        expect(new X509Certificate(roots[0]).subject).toContain("Apple Root CA - G3");
    });
});
