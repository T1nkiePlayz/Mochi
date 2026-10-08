/** Helpers for driving real form controls from a controller. */

export type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);

export function isTextField(element: Element | null): element is TextField {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  return element instanceof HTMLInputElement && TEXT_TYPES.has(element.type) && !element.readOnly && !element.disabled;
}

/** Sets a value so React's onChange fires, exactly as if the user had typed it. */
export function setFieldValue(field: TextField, value: string): void {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
