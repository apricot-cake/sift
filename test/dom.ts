// A page fragment, parsed the way a browser parses the real one.
//
// The adapters are selectors and nothing else, so markup is the only input that
// tests them. A stub answering the adapter's own selector table would confirm
// that the table equals itself and would say nothing about whether `closest`
// reaches the right ancestor, whether an attribute selector matches, or whether
// a node is where the adapter looks for it.
export function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
