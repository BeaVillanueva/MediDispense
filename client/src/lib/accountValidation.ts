export const NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
export const NAME_PARTIAL_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*(?: )?$/;
export const CONTACT_PATTERN = /^\d{11}$/;
export const CONTACT_PARTIAL_PATTERN = /^\d{0,11}$/;
export const EMPLOYEE_ID_PATTERN = /^EMP-[A-Z0-9]{1,19}$/;
export const EMPLOYEE_ID_PARTIAL_PATTERN = /^(?:E(?:M(?:P(?:-[A-Z0-9]{0,19})?)?)?)?$/;
export const RESTRICTED_TEXT_PATTERN = /['"`;\\/<>]/;
export const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const EMAIL_PARTIAL_PATTERN = /^(?:[A-Za-z0-9.!#$%&'*+^_`{|}~-]+(?:@[A-Za-z0-9-]*(?:\.[A-Za-z0-9-]*)*)?)?$/;

export function acceptNameInput(value: string): string | null { return NAME_PARTIAL_PATTERN.test(value) ? value : null; }
export function acceptContactInput(value: string): string | null { return CONTACT_PARTIAL_PATTERN.test(value) ? value : null; }
export function acceptEmployeeIdInput(value: string): string | null { const normalized = value.toUpperCase(); return EMPLOYEE_ID_PARTIAL_PATTERN.test(normalized) ? normalized : null; }
export function acceptRegularTextInput(value: string): string | null {
  if (RESTRICTED_TEXT_PATTERN.test(value) || value.startsWith(" ") || / {2}/.test(value)) return null;
  return value;
}
export function acceptEmailInput(value: string): string | null {
  // Email addresses may contain normal RFC-safe punctuation, but never the
  // application's reserved characters or whitespace.
  return !hasRestrictedCharacters(value) && !/\s/.test(value) && EMAIL_PARTIAL_PATTERN.test(value) ? value : null;
}
export function hasRestrictedCharacters(value: string) { return RESTRICTED_TEXT_PATTERN.test(value); }
export function validateEmail(value: string) { if (!EMAIL_PATTERN.test(value.trim())) throw new Error("Enter a valid email address."); }

export function validateRegularText(value: string, label: string) {
  if (value !== value.trim() || RESTRICTED_TEXT_PATTERN.test(value)) throw new Error(`${label} contains invalid characters or leading/trailing spaces.`);
}

export function validateAccountFields(name: string, contact: string, employeeId?: string) {
  if (name !== name.trim() || !NAME_PATTERN.test(name)) throw new Error("Name can only contain letters and single spaces between words, with no leading or trailing spaces.");
  if (contact !== "" && !CONTACT_PATTERN.test(contact)) throw new Error("Contact number must contain exactly 11 digits with no spaces or symbols.");
  if (employeeId !== undefined && !EMPLOYEE_ID_PATTERN.test(employeeId.trim().toUpperCase())) throw new Error("Employee ID contains invalid characters.");
}
