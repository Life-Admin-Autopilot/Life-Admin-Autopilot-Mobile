import type { NextFunction, Request, Response } from 'express'

export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const BadRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details)

export const Unauthorized = (code = 'unauthorized', message = 'Unauthorized'): AppError =>
  new AppError(401, code, message)

export const Forbidden = (code = 'forbidden', message = 'Forbidden'): AppError =>
  new AppError(403, code, message)

export const NotFound = (code = 'not_found', message = 'Not found'): AppError =>
  new AppError(404, code, message)

export const Conflict = (code: string, message: string): AppError =>
  new AppError(409, code, message)

export const Internal = (message = 'Internal server error'): AppError =>
  new AppError(500, 'internal_error', message)

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

export const asyncHandler =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next)
  }
