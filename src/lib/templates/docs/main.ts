if (window.WebComponents === undefined) {
  console.error(new Error('WebComponents not defined.'));
} else {
  window.WebComponents.waitFor(async () => import('@polymer/iron-component-page'));
}
