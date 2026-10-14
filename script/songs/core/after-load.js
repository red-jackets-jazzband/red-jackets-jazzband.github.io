/*
  Resolves once the page has finished loading (`load`: images, fonts and all)
  and the browser is next idle — for work the visitor didn't come for, so it
  doesn't compete with the song they did: the tour's copy, the service
  worker's install-time download. Safari has no requestIdleCallback; a
  timeout stands in.
*/
export function afterPageLoad() {
  return new Promise((resolve) => {
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 2000 });
      else setTimeout(resolve, 0);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
  });
}
