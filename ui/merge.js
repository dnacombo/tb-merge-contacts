/* global messenger, VCard */
"use strict";

const $ = id => document.getElementById(id);
const FIELD_NAMES = {
  FN: "Display name", N: "Name", EMAIL: "Email", TEL: "Phone", ADR: "Address",
  URL: "Website", ORG: "Organization", TITLE: "Title", ROLE: "Role",
  NOTE: "Notes", BDAY: "Birthday", ANNIVERSARY: "Anniversary", NICKNAME: "Nickname",
  IMPP: "Chat", PHOTO: "Photo", TZ: "Time zone", CATEGORIES: "Categories",
  GENDER: "Gender", LANG: "Language", "X-CUSTOM1": "Custom 1",
  "X-CUSTOM2": "Custom 2", "X-CUSTOM3": "Custom 3", "X-CUSTOM4": "Custom 4",
};

let cards = []; // { node, book, vCard, props }
let masterIdx = 0;
let merged = []; // { prop, from, include }

function displayName(c) {
  const p = c.node.properties;
  const fn = c.props.find(x => x.name == "FN");
  return (fn && VCard.unescape(fn.value)) ||
    [p.FirstName, p.LastName].filter(Boolean).join(" ") ||
    p.PrimaryEmail || "(no name)";
}
function values(c, name) {
  return c.props.filter(x => x.name == name).map(x => VCard.unescape(x.value).replace(/^(mailto|tel):/i, ""));
}

function renderCards() {
  const tbody = $("cards").querySelector("tbody");
  tbody.replaceChildren();
  cards.forEach((c, i) => {
    const tr = document.createElement("tr");
    if (i == masterIdx) tr.classList.add("master");
    if (c.node.readOnly) tr.classList.add("readonly");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "master";
    radio.checked = i == masterIdx;
    radio.disabled = c.node.readOnly;
    radio.title = c.node.readOnly ? "Read-only address book" : "";
    radio.addEventListener("change", () => { masterIdx = i; recompute(); });
    const cells = [radio, displayName(c), c.book.name + (c.node.readOnly ? " (read-only)" : ""),
      values(c, "EMAIL").join("\n"), values(c, "TEL").join("\n")];
    for (const v of cells) {
      const td = document.createElement("td");
      if (typeof v == "string") { td.textContent = v; td.className = "value"; } else td.append(v);
      tr.append(td);
    }
    tbody.append(tr);
  });
}

function recompute() {
  const order = [masterIdx, ...cards.map((_, i) => i).filter(i => i != masterIdx)];
  merged = VCard.merge(cards[masterIdx].vCard, order.slice(1).map(i => cards[i].vCard))
    .map(m => ({ ...m, cardIdx: order[m.from], include: true }));
  renderCards();
  renderPreview();
  renderWarnings();
}

function renderPreview() {
  const tbody = $("preview").querySelector("tbody");
  tbody.replaceChildren();
  for (const m of merged) {
    if (VCard.SKIP.has(m.prop.name) || (m.prop.group && m.prop.name.startsWith("X-AB"))) {
      continue; // technical lines: always kept, not shown
    }
    const tr = document.createElement("tr");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = m.include;
    cb.addEventListener("change", () => { m.include = cb.checked; tr.classList.toggle("excluded", !cb.checked); });
    const td0 = document.createElement("td"); td0.append(cb);
    const td1 = document.createElement("td"); td1.className = "field";
    td1.textContent = FIELD_NAMES[m.prop.name] || m.prop.name;
    const td2 = document.createElement("td"); td2.className = "value";
    td2.textContent = VCard.display(m.prop);
    const td3 = document.createElement("td"); td3.className = "from";
    td3.textContent = m.from == 0 ? "kept card" : `${displayName(cards[m.cardIdx])} · ${cards[m.cardIdx].book.name}`;
    tr.append(td0, td1, td2, td3);
    tbody.append(tr);
  }
}

function renderWarnings() {
  const w = [];
  const ro = cards.filter((c, i) => i != masterIdx && c.node.readOnly);
  if (ro.length) {
    w.push(`${ro.length} card(s) are in read-only address books and will not be deleted.`);
  }
  const books = new Set(cards.map(c => c.node.parentId));
  if (books.size > 1) {
    w.push(`Cards come from ${books.size} address books; the result stays in "${cards[masterIdx].book.name}".`);
  }
  $("warnings").textContent = w.join("\n");
}

function status(text, error = false) {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
}

async function doMerge() {
  $("merge").disabled = $("cancel").disabled = true;
  const master = cards[masterIdx];
  const log = [];
  try {
    const props = merged.filter(m => m.include).map(m => m.prop);
    status("Updating kept card…");
    await messenger.contacts.update(master.node.id, { vCard: VCard.serialize(props) });

    if ($("deleteOthers").checked) {
      const others = cards.filter((c, i) => i != masterIdx && !c.node.readOnly);
      // Carry mailing-list memberships over to the kept card where possible.
      const listsByBook = new Map();
      for (const c of others) {
        if (!listsByBook.has(c.node.parentId)) {
          listsByBook.set(c.node.parentId, await messenger.mailingLists.list(c.node.parentId).catch(() => []));
        }
        for (const list of listsByBook.get(c.node.parentId)) {
          const members = await messenger.mailingLists.listMembers(list.id).catch(() => []);
          if (!members.some(m => m.id == c.node.id)) continue;
          if (list.parentId == master.node.parentId) {
            if (!members.some(m => m.id == master.node.id)) {
              await messenger.mailingLists.addMember(list.id, master.node.id);
              log.push(`Added kept card to list "${list.name}".`);
            }
          } else {
            log.push(`"${displayName(c)}" was in list "${list.name}" (${c.book.name}); lists can't hold cards from another book, so it was not carried over.`);
          }
        }
      }
      for (const c of others) {
        status(`Deleting ${displayName(c)} from ${c.book.name}…`);
        await messenger.contacts.delete(c.node.id);
      }
      log.unshift(`Merged ${cards.length} cards into "${displayName(master)}" (${master.book.name}); deleted ${others.length}.`);
    } else {
      log.unshift(`Updated "${displayName(master)}"; other cards were kept.`);
    }
    status(log.join("\n"));
    $("cancel").textContent = "Close";
    $("cancel").disabled = false;
    if (log.length == 1) setTimeout(() => window.close(), 1500);
  } catch (e) {
    console.error(e);
    status(`Error: ${e.message || e}\n${log.join("\n")}`, true);
    $("cancel").disabled = false;
  }
}

async function init() {
  $("cancel").addEventListener("click", () => window.close());
  $("merge").addEventListener("click", doMerge);
  const sel = await messenger.runtime.sendMessage({ type: "getPendingCards" });
  if (!sel || sel.length < 2) {
    status("Nothing to merge (select at least two contacts).", true);
    $("merge").disabled = true;
    return;
  }
  const bookCache = new Map();
  for (const s of sel) {
    const node = await messenger.contacts.get(s.id);
    if (!node) continue;
    if (!bookCache.has(node.parentId)) {
      bookCache.set(node.parentId, await messenger.addressBooks.get(node.parentId));
    }
    const vCard = node.properties.vCard || "";
    cards.push({ node, book: bookCache.get(node.parentId), vCard, props: VCard.parse(vCard) });
  }
  const writable = cards.map((c, i) => i).filter(i => !cards[i].node.readOnly);
  if (!writable.length) {
    status("All selected cards are read-only; nothing can be merged.", true);
    $("merge").disabled = true;
    renderCards();
    return;
  }
  // Default master: the writable card with the most information.
  masterIdx = writable.reduce((best, i) => (cards[i].props.length > cards[best].props.length ? i : best), writable[0]);
  recompute();
}

init().catch(e => status(`Error: ${e.message || e}`, true));
