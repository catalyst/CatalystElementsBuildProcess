if (window.WebComponents === undefined) {
  console.error(new Error('WebComponents not defined.'));
} else {
  window.WebComponents.waitFor(async () => {
    return import('@polymer/iron-component-page');
  });
}
