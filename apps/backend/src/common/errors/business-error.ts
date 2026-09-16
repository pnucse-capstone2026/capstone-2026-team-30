import type { HttpStatus } from "@nestjs/common";

export type BusinessErrorDefinition = {
  readonly code: string;
  readonly message: string;
  readonly status?: HttpStatus | number;
};
