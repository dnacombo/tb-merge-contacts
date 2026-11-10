/* global messenger */
"use strict";

// Selection handed over to the merge window, keyed by window id.
let pending = null;

messenger.abContextMenu.onMergeRequested.addListener(async cards => {
  if (!cards || cards.length < 2) {
    return;
  }
  pending = cards;
  await messenger.windows.create({
    type: "popup",
    url: "ui/merge.html",
    width: 900,
    height: 720,
  });
});

messenger.runtime.onMessage.addListener(msg => {
  if (msg?.type == "getPendingCards") {
    const cards = pending;
    pending = null;
    return Promise.resolve(cards);
  }
  return false;
});

messenger.abContextMenu.init("Merge contacts…");
