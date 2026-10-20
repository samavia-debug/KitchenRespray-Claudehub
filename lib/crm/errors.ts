/**
 * A failure whose cause is the database or another service. `message` keeps the full detail for the server log;
 * `publicMessage` is all a person is shown, because the detail names tables and constraints that are no use to them.
 */
export class PublicError extends Error {
  constructor(readonly publicMessage: string, detail: string) {
    super(`${publicMessage}: ${detail}`);
  }
}
