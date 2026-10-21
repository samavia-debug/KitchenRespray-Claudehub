/**
 * A failure whose cause is the database or another service. `message` keeps the full detail for the server log;
 * `publicMessage` is all a person is shown, because the detail names tables and constraints that are no use to them.
 */
export class PublicError extends Error {
  constructor(readonly publicMessage: string, detail: string) {
    super(`${publicMessage}: ${detail}`);
  }
}

/** True when a database message says a table has not been created yet (its migration has not been run). */
export const tableMissing = (message: string | undefined | null) => !!message && /does not exist|could not find the table|schema cache/i.test(message);
