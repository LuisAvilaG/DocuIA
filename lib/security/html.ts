import sanitizeHtml from "sanitize-html";

/** The contract editor accepts formatting, never active content or remote assets. */
export function sanitizeContractHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["h1", "h2", "h3", "p", "div", "span", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "img", "font"],
    allowedAttributes: { "*": ["style"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], font: ["color", "size", "face"] },
    allowedSchemes: [],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/],
        "background-color": [/^#[0-9a-f]{3,8}$/i],
        "text-align": [/^(left|right|center|justify)$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-style": [/^(normal|italic)$/],
        "font-size": [/^\d{1,2}(px|pt)$/],
        "text-decoration": [/^(none|underline|line-through)$/],
      },
    },
    exclusiveFilter: frame => frame.tag === "img" && !/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(frame.attribs.src ?? ""),
    nestingLimit: 50,
  });
}
