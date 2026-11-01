export const INSTITUTIONAL_PASSWORD_MIN_LENGTH = 8;

export function isValidInstitutionalPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= INSTITUTIONAL_PASSWORD_MIN_LENGTH;
}

export function institutionalPasswordsMatch(password: string, confirmation: string): boolean {
  return password === confirmation;
}
