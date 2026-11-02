/**
 * Filler words removed from dictated text before it lands in an entry
 * (record-in-daily-log seed, 2026-10-23): um, uh, er, ah, hmm and their
 * stretched forms. Nothing else -- not "like", "you know" or "so", which
 * can carry meaning. Plain JS because `server.js` (outside the Vite build)
 * runs it; the tests import it directly.
 *
 * "er" is matched as `er`, `erm` or with three or more r's, never `err`,
 * which is a word.
 */
const FILLER = /^(?:u+m+|u+h+|e+r|e+r{3,}|e+r+m+|a+h+|h+m+|m+h*m{2,})$/i;

/** A word with an optional trailing comma or ellipsis, which goes with it. */
const WORD = /^([A-Za-z]+)(?:,|…|\.\.\.)?$/;

export function isFiller(word) {
  return FILLER.test(word);
}

/**
 * Removes filler words from `text`, keeping every other character as it
 * was. `before` is the text already written ahead of it, so a sentence
 * that started with a filler gets its first letter back as a capital
 * ("Um, so we" -> "So we") even when the filler opened a new chunk.
 */
export function removeFillers(text, before = "") {
  const out = [];
  let capitalizeNext = false;
  let skipSpace = false;
  for (const part of text.split(/(\s+)/)) {
    if (part === "") continue;
    if (/^\s+$/.test(part)) {
      if (skipSpace) {
        skipSpace = false;
        continue;
      }
      out.push(part);
      continue;
    }
    skipSpace = false;
    const m = WORD.exec(part);
    if (m && isFiller(m[1])) {
      const written = before + out.join("");
      if (atSentenceStart(written)) capitalizeNext = true;
      if (out.some((p) => !/^\s+$/.test(p))) {
        // Mid-text: the space before it goes ("we, um, went" -> "we, went").
        if (/^\s+$/.test(out[out.length - 1] ?? "")) out.pop();
      } else {
        // Nothing of this chunk written yet: keep its leading space, drop
        // the one after the filler instead.
        skipSpace = true;
      }
      continue;
    }
    if (capitalizeNext) {
      out.push(part.charAt(0).toUpperCase() + part.slice(1));
      capitalizeNext = false;
    } else {
      out.push(part);
    }
  }
  return out.join("");
}

function atSentenceStart(written) {
  const trimmed = written.trimEnd();
  return trimmed === "" || /[.!?]["')\]]?$/.test(trimmed);
}

/**
 * Final text arrives from the engine in pieces that can split a word
 * ("u" then "m"). This holds back the trailing partial word until
 * whitespace follows it, so a filler is always judged whole. `flush` at
 * the end of a stream releases whatever is held.
 */
export function createFinalTextBuffer() {
  let held = "";
  let written = "";
  const release = (ready) => {
    const cleaned = removeFillers(ready, written);
    written = (written + cleaned).slice(-200);
    return cleaned;
  };
  return {
    push(text) {
      held += text;
      const cut = held.search(/\s\S*$/) + 1;
      if (cut <= 0) return "";
      const ready = held.slice(0, cut);
      held = held.slice(cut);
      return release(ready);
    },
    flush() {
      const ready = held;
      held = "";
      return ready ? release(ready) : "";
    },
  };
}
