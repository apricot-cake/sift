// ページの断片を、ブラウザが本物を解析するのと同じやり方で解析したもの。
//
// アダプターはセレクタでしかないので、それを試せる入力はマークアップだけ。
// アダプター自身のセレクタの表に答える代役は、その表が自分と等しいことを確かめる
// だけで、`closest` が正しい先祖まで届くか、属性のセレクタが当たるか、節点が
// アダプターの探す場所にあるかについては何も言わない。
export function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
