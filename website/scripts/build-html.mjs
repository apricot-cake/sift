import { parse } from "parse5";

export function parseHtmlElements(html) {
  const elements = [];
  function visit(node) {
    if (node.tagName) elements.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return elements;
}

export function attribute(element, name) {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

export function hasClass(element, name) {
  return (attribute(element, "class") ?? "").split(/\s+/).includes(name);
}
