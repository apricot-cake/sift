export const POST_CARD_SELECTOR = 'article[data-testid="tweet"]';
export const POST_CELL_SELECTOR = '[data-testid="cellInnerDiv"]';

export function getPostCards(root) {
  return Array.from(root.querySelectorAll(POST_CARD_SELECTOR));
}

export function hasPostCards(root) {
  return Boolean(root.querySelector(POST_CARD_SELECTOR));
}

export function findPostCell(postCard) {
  return postCard.closest(POST_CELL_SELECTOR) || postCard;
}
