import { describe, expect, it } from "vitest";
import { formatForSpeech } from "../src/speech/formatter.js";

describe("formatForSpeech", () => {
  it("removes markdown emphasis and headings", () => {
    const input = "## 結論\n**重要**: これは`テスト`です";
    expect(formatForSpeech(input)).toBe("結論 重要: これはテストです");
  });

  it("omits fenced code blocks entirely", () => {
    const input = "前の文です。\n```ts\nconst a = 1;\n```\n後の文です。";
    expect(formatForSpeech(input)).toBe("前の文です。 後の文です。");
  });

  it("removes URLs", () => {
    const input = "詳しくは https://example.com/path?q=1 を参照してください。";
    expect(formatForSpeech(input)).toBe("詳しくは を参照してください。");
  });

  it("converts markdown links to their link text", () => {
    const input = "[こちら](https://example.com)を見てください";
    expect(formatForSpeech(input)).toBe("こちらを見てください");
  });

  it("converts tables into sentences", () => {
    const input = "| 名前 | 値 |\n| --- | --- |\n| りんご | 100円 |\n| みかん | 80円 |";
    const out = formatForSpeech(input);
    expect(out).toContain("名前、値");
    expect(out).toContain("りんご、100円");
    expect(out).not.toContain("|");
    expect(out).not.toContain("---");
  });

  it("normalizes bullet lists and collapses whitespace/newlines", () => {
    const input = "- 一つ目\n- 二つ目\n\n\n次の段落。   続き。";
    expect(formatForSpeech(input)).toBe("一つ目 二つ目 次の段落。 続き。");
  });

  it("truncates at a sentence boundary when exceeding maxLength", () => {
    const sentence = "あ".repeat(100) + "。";
    const input = sentence.repeat(10); // 1010 chars
    const out = formatForSpeech(input, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("。")).toBe(true);
  });

  it("hard-truncates when no sentence boundary exists within maxLength", () => {
    const input = "あ".repeat(1000);
    const out = formatForSpeech(input, 300);
    expect(out.length).toBe(300);
  });

  it("returns empty string for empty input", () => {
    expect(formatForSpeech("")).toBe("");
    expect(formatForSpeech("   \n ")).toBe("");
  });
});
