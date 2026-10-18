export type ModelErrorCode =
  | "not_found"
  | "invalid_argument"
  | "invalid_parent"
  | "invalid_tree"
  | "cycle"
  | "root_node"
  | "last_page"
  | "duplicate_name"
  | "alias_cycle"
  | "in_transaction"
  | "invalid_format"
  | "unsupported_version"
  | "instance_structure";

/** Thrown by every model operation on invalid input. `code` is stable; `message` is for humans. */
export class ModelError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, message: string) {
    super(message);
    this.name = "ModelError";
    this.code = code;
  }
}

export function isModelError(err: unknown): err is ModelError {
  return err instanceof ModelError;
}
