/**
 * Describes how to turn `oldValue` into `newValue` given that the Mac's caret
 * is always at the end of its text: backspace to the first changed character,
 * then retype everything after it. Only the common prefix is trimmed, because
 * backspaces cannot remove characters from the middle. An autocorrect such as
 * "macbook " -> "MacBook " must therefore retype the whole word.
 */
export function diffEdit(oldValue, newValue) {
  const max = Math.min(oldValue.length, newValue.length);
  let prefix = 0;
  while (prefix < max && oldValue[prefix] === newValue[prefix]) prefix++;
  return { deleted: oldValue.length - prefix, inserted: newValue.slice(prefix) };
}
