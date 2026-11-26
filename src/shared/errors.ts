export class VivaError extends Error {
  constructor(public code: string, message = code) {
    super(message);
    this.name = "VivaError";
  }
}
