/**
 * Hermesの出力をEchoの音声読み上げ向けに整形する。
 * - Markdown記号を除去
 * - コードブロックを省略
 * - URLを除外
 * - 表を文章へ変換
 * - 空白・改行を整理
 * - maxLength超過時は文境界で丸める
 */

export const DEFAULT_MAX_SPEECH_LENGTH = 800;

export function formatForSpeech(
  input: string,
  maxLength: number = DEFAULT_MAX_SPEECH_LENGTH,
): string {
  let text = input;

  // フェンス付きコードブロックを除去
  text = text.replace(/```[\s\S]*?(```|$)/g, " ");
  // インラインコードのバッククォートを除去
  text = text.replace(/`([^`]*)`/g, "$1");

  // Markdownリンク [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // URLを除去
  text = text.replace(/https?:\/\/\S+/g, " ");

  // テーブルを文章へ変換
  text = text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!/^\|.*\|$/.test(trimmed)) return line;
      // 区切り行 (| --- | --- |) は除去
      if (/^\|[\s:|-]+\|$/.test(trimmed)) return "";
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      return cells.join("、");
    })
    .join("\n");

  // 見出し記号
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  // 箇条書き記号
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  // 強調記号
  text = text.replace(/\*\*([^*]*)\*\*/g, "$1");
  text = text.replace(/\*([^*]*)\*/g, "$1");
  text = text.replace(/__([^_]*)__/g, "$1");
  text = text.replace(/_([^_]*)_/g, "$1");
  // 水平線
  text = text.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, "");
  // 引用記号
  text = text.replace(/^\s*>\s?/gm, "");

  // 空白・改行を整理
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\s*\n\s*/g, " ");
  text = text.trim();

  if (text.length <= maxLength) return text;

  // 文境界（。！？）で丸める
  const window = text.slice(0, maxLength);
  const lastBoundary = Math.max(
    window.lastIndexOf("。"),
    window.lastIndexOf("！"),
    window.lastIndexOf("？"),
  );
  if (lastBoundary > 0) {
    return window.slice(0, lastBoundary + 1);
  }
  return window;
}
