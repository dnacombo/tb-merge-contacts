/* global ExtensionAPI, ExtensionCommon, Services */
"use strict";

// Adds a "Merge contacts…" item to the contact context menu (#cardContext)
// of every about:addressbook document. When clicked, the selected cards
// (UID + directoryUID) are sent to the background page. Selections made in
// "All Address Books" can span several books.

const ITEM_ID = "mergeContactsExt-cardContextMerge";
const SEP_ID = "mergeContactsExt-cardContextSep";

this.abContextMenu = class extends ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    if (this._observer) {
      Services.obs.removeObserver(this._observer, "document-element-inserted");
      this._observer = null;
    }
    for (const doc of this._docs || []) {
      try {
        doc.getElementById(ITEM_ID)?.remove();
        doc.getElementById(SEP_ID)?.remove();
        const popup = doc.getElementById("cardContext");
        if (popup && popup._mergeContactsExtHandler) {
          popup.removeEventListener("popupshowing", popup._mergeContactsExtHandler);
          delete popup._mergeContactsExtHandler;
        }
      } catch (e) {
        // Document may be dead already.
      }
    }
    this._docs?.clear();
  }

  _inject(doc) {
    if (!doc || doc.documentURI?.split("?")[0] != "about:addressbook") {
      return;
    }
    const popup = doc.getElementById("cardContext");
    if (!popup || doc.getElementById(ITEM_ID)) {
      return;
    }
    const win = doc.defaultView;

    const sep = doc.createXULElement("menuseparator");
    sep.id = SEP_ID;
    const item = doc.createXULElement("menuitem");
    item.id = ITEM_ID;
    item.setAttribute("label", this._label);

    item.addEventListener("command", () => {
      const cards = (win.cardsPane?.selectedCards || [])
        .filter(c => !c.isMailList)
        .map(c => ({ id: c.UID, parentId: c.directoryUID }));
      for (const fire of this._listeners) {
        fire(cards);
      }
    });

    const handler = () => {
      const sel = (win.cardsPane?.selectedCards || []).filter(c => !c.isMailList);
      const show = sel.length >= 2;
      item.hidden = sep.hidden = !show;
      if (show) {
        const books = new Set(sel.map(c => c.directoryUID)).size;
        item.setAttribute(
          "label",
          books > 1
            ? `${this._label} (${sel.length} cards, ${books} books)`
            : `${this._label} (${sel.length} cards)`
        );
      }
    };
    popup._mergeContactsExtHandler = handler;
    popup.addEventListener("popupshowing", handler);

    const anchor = doc.getElementById("cardContextDelete");
    popup.insertBefore(sep, anchor || null);
    popup.insertBefore(item, anchor || null);
    this._docs.add(doc);
    win.addEventListener("unload", () => this._docs.delete(doc), { once: true });
  }

  _injectExisting() {
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      const tabmail = win.document.getElementById("tabmail");
      for (const tab of tabmail?.tabInfo || []) {
        const doc = tab.browser?.contentDocument;
        if (doc && doc.readyState == "complete") {
          this._inject(doc);
        }
      }
    }
  }

  getAPI(context) {
    const self = this;
    this._docs ??= new Set();
    this._listeners ??= new Set();
    this._label ??= "Merge contacts…";
    return {
      abContextMenu: {
        async init(label) {
          if (label) {
            self._label = label;
          }
          if (!self._observer) {
            self._observer = {
              observe(subject) {
                const doc = subject;
                if (doc.documentURI?.split("?")[0] != "about:addressbook") {
                  return;
                }
                doc.defaultView?.addEventListener(
                  "load",
                  () => self._inject(doc),
                  { once: true }
                );
              },
            };
            Services.obs.addObserver(self._observer, "document-element-inserted");
          }
          self._injectExisting();
        },

        onMergeRequested: new ExtensionCommon.EventManager({
          context,
          name: "abContextMenu.onMergeRequested",
          register(fire) {
            const listener = cards => fire.async(cards);
            self._listeners.add(listener);
            return () => self._listeners.delete(listener);
          },
        }).api(),
      },
    };
  }
};
