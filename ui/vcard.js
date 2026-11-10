"use strict";

// Minimal vCard line handling, enough to merge Thunderbird contacts without
// losing data: properties are kept as raw lines, only grouping/dedup logic
// looks inside them.

const VCard = (() => {
  // Never copied from a source card.
  const SKIP = new Set(["BEGIN", "END", "VERSION", "PRODID", "UID", "REV"]);
  // Only one allowed/meaningful: keep the master's, fill from others if missing.
  const SINGLE = new Set([
    "FN", "N", "BDAY", "ANNIVERSARY", "GENDER", "KIND", "TZ", "GEO",
    "PHOTO", "LOGO", "SOUND", "ORG", "TITLE", "ROLE", "NICKNAME",
  ]);
  // Free text: concatenated when different.
  const CONCAT = new Set(["NOTE"]);

  function unfold(text) {
    return text.replace(/\r?\n[ \t]/g, "");
  }

  // Split "group.NAME;P=1;Q=2:value" at the first colon outside quotes.
  function parseLine(line) {
    let inQuote = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch == '"') {
        inQuote = !inQuote;
      } else if (ch == ":" && !inQuote) {
        colon = i;
        break;
      }
    }
    if (colon < 0) {
      return null;
    }
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = head.indexOf(";");
    let nameWithGroup = semi < 0 ? head : head.slice(0, semi);
    const params = semi < 0 ? "" : head.slice(semi); // includes leading ';'
    let group = "";
    const dot = nameWithGroup.lastIndexOf(".");
    if (dot >= 0) {
      group = nameWithGroup.slice(0, dot);
      nameWithGroup = nameWithGroup.slice(dot + 1);
    }
    return { group, name: nameWithGroup.toUpperCase(), params, value };
  }

  function parse(text) {
    const props = [];
    for (const line of unfold(text || "").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const p = parseLine(line);
      if (p) {
        props.push(p);
      }
    }
    return props;
  }

  function serializeProp(p) {
    return `${p.group ? p.group + "." : ""}${p.name}${p.params}:${p.value}`;
  }

  function serialize(props) {
    const body = props.filter(p => p.name != "BEGIN" && p.name != "END");
    const hasVersion = body.some(p => p.name == "VERSION");
    const lines = ["BEGIN:VCARD"];
    if (!hasVersion) {
      lines.push("VERSION:4.0");
    }
    for (const p of body) {
      lines.push(serializeProp(p));
    }
    lines.push("END:VCARD");
    return lines.join("\r\n") + "\r\n";
  }

  function unescape(v) {
    return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  }

  function hasPref(params) {
    return /;PREF=\d+/i.test(params) || /TYPE=[^;:]*\bpref\b/i.test(params);
  }
  function stripPref(params) {
    return params
      .replace(/;PREF=\d+/gi, "")
      .replace(/(TYPE=)([^;:]*)/gi, (m, a, list) => {
        const kept = list
          .replace(/"/g, "")
          .split(",")
          .filter(t => t.toLowerCase() != "pref");
        return kept.length ? a + kept.join(",") : "";
      })
      .replace(/;;+/g, ";")
      .replace(/;$/, "");
  }

  // Key used to decide whether two values are the "same".
  function dedupKey(p) {
    let v = unescape(p.value).trim();
    switch (p.name) {
      case "EMAIL":
        v = v.toLowerCase();
        break;
      case "TEL": {
        const digits = v.replace(/^tel:/i, "").replace(/[^\d]/g, "");
        v = digits.length >= 9 ? digits.slice(-9) : digits;
        break;
      }
      case "URL":
        v = v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
        break;
      case "IMPP":
        v = v.toLowerCase();
        break;
      default:
        v = v.toLowerCase().replace(/[\s;,]+/g, " ").trim();
    }
    return `${p.name}\u0000${v}`;
  }

  function isEmptyValue(p) {
    return unescape(p.value).replace(/[;,\s]/g, "") == "";
  }

  /**
   * Merge vCards. `master` wins for single-valued properties; everything else
   * is unioned. Returns a list of { prop, from } where `from` is the index
   * of the card the line comes from (0 = master).
   */
  function merge(masterText, otherTexts) {
    const master = parse(masterText).filter(p => p.name != "BEGIN" && p.name != "END");
    const out = master.map(prop => ({ prop, from: 0 }));
    const seen = new Set(master.map(dedupKey));
    const singlesPresent = new Set(
      master.filter(p => SINGLE.has(p.name) && !isEmptyValue(p)).map(p => p.name)
    );
    const prefPresent = new Set(master.filter(p => hasPref(p.params)).map(p => p.name));
    let groupCounter = 0;

    otherTexts.forEach((text, i) => {
      const from = i + 1;
      const groupMap = new Map();
      for (const p0 of parse(text)) {
        if (SKIP.has(p0.name) || isEmptyValue(p0)) {
          continue;
        }
        const p = { ...p0 };
        if (p.group) {
          if (!groupMap.has(p.group)) {
            groupMap.set(p.group, `merged${from}x${++groupCounter}`);
          }
          p.group = groupMap.get(p.group);
        }
        if (SINGLE.has(p.name)) {
          if (singlesPresent.has(p.name)) {
            continue;
          }
          // Replace an empty master value, if any.
          const emptyIdx = out.findIndex(o => o.prop.name == p.name);
          if (emptyIdx >= 0) {
            out.splice(emptyIdx, 1);
          }
          singlesPresent.add(p.name);
          out.push({ prop: p, from });
          continue;
        }
        if (CONCAT.has(p.name)) {
          const existing = out.find(o => o.prop.name == p.name);
          if (!existing) {
            out.push({ prop: p, from });
          } else if (!existing.prop.value.includes(p.value)) {
            existing.prop = { ...existing.prop, value: existing.prop.value + "\\n\\n" + p.value };
          }
          continue;
        }
        // Grouped X- lines (e.g. Apple's item1.X-ABLabel) belong to their group.
        const key = p.group && p.name.startsWith("X-")
          ? `${p.group}\u0000${serializeProp(p)}`
          : dedupKey(p);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (hasPref(p.params)) {
          if (prefPresent.has(p.name)) {
            p.params = stripPref(p.params);
          } else {
            prefPresent.add(p.name);
          }
        }
        out.push({ prop: p, from });
      }
    });
    return out;
  }

  // Short human-readable rendering of a property.
  function display(p) {
    if (["PHOTO", "LOGO", "SOUND"].includes(p.name)) {
      return "[image/data]";
    }
    let v = unescape(p.value);
    if (p.name == "N" || p.name == "ADR") {
      v = v.split(";").filter(Boolean).join(", ");
    }
    const type = /TYPE=("?)([^;:"]*)\1/i.exec(p.params);
    return (type ? `(${type[2]}) ` : "") + v;
  }

  return { parse, serialize, merge, display, unescape, SKIP };
})();

if (typeof module != "undefined") {
  module.exports = VCard;
}
