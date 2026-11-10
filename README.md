# Merge Contacts (Thunderbird add-on)

Adds **"Merge contacts…"** to the right-click menu of the Thunderbird Address Book.
Select two or more contacts (from *All Address Books* to merge across books), right-click, merge.

- Pick the card to keep; its single-valued fields (name, photo, org…) win.
- Emails, phones, addresses, URLs, chat addresses from the other cards are added (deduplicated: case-insensitive emails, format-insensitive phones). Notes are concatenated.
- Every resulting line can be unticked before merging.
- Other cards are deleted (optional); mailing-list memberships in the kept card's book are carried over. Read-only books are never modified.

Requires Thunderbird 128+. Uses an Experiment API (the `menus` API has no address-book context), so the add-on is unsigned and installed from file.

## Build & install

```sh
zip -r merge-contacts.xpi manifest.json background.js api ui
```

Thunderbird → Add-ons and Themes → ⚙ → *Install Add-on From File…* → `merge-contacts.xpi`.

## Layout

- `api/abContextMenu/` – Experiment injecting the menu item into `about:addressbook`'s `#cardContext`.
- `background.js` – opens the merge window with the selected cards.
- `ui/vcard.js` – vCard parsing/merging (pure, testable with node).
- `ui/merge.*` – merge window.

## License

MIT — see [LICENSE](LICENSE).
