import showdown from "showdown";
import { useMemo } from "react";

/**
 * Merges runs of standalone-image paragraphs into a single <p> so the
 * CSS grid rules in project.css can apply:
 *   1 img  → full width   (p:has(> img:only-child))
 *   2 imgs → side by side (flex, equal columns)
 *   3+     → grid         (flex-wrap with square crop)
 */
function groupConsecutiveImages(html: string): string {
  return html.replace(/(<p>(?:\s*<img[^>]+>\s*)<\/p>\s*)+/g, (block) => {
    const imgs = block.match(/<img[^>]+>/g) ?? [];
    if (imgs.length < 2) return block;
    return `<p>${imgs.join("\n")}</p>\n`;
  });
}

showdown.extension("nopal", () => {
  return [
    {
      type: "lang",
      // Regex that matches strikethrough markdown with [] after the closing ~~
      // e.g. ~~strikethrough~~[text] becomes <del>strikethrough<span>text</span</del>
      regex: /~~(.*?)~~\[(.*?)\]/g,
      replace: "<del class='uncooked-thought'>$1<span>$2</span></del>",
    },
    {
      type: "lang",
      // Regex that matches a carot (^) followed by words in square brackets
      // e.g. ^[text] becomes <span class='uncooked-thought'>^<span>text</span></span>
      regex: /\^\[(.*?)\]/g,
      replace: "<span class='uncooked-added-thought'>^<span>$1</span></span>",
    },
  ];
});

export function useMarkdown(body: string) {
  const bodyHtml = useMemo(() => {
    const converter = new showdown.Converter({
      extensions: ["nopal"],
      strikethrough: true,
    });
    return groupConsecutiveImages(converter.makeHtml(body));
  }, [body]);
  return (
    <div
      className="uncooked-markdown"
      dangerouslySetInnerHTML={{ __html: bodyHtml }}
    />
  );
}
