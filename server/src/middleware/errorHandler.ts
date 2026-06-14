import type { ErrorRequestHandler } from 'express'
import mongoose from 'mongoose'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors'
import { logger } from '../logger'

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // A Mongoose CastError on an ObjectId means a malformed `:id` param reached a
  // query — that's a "no such resource", not a server fault. Map it to 404 here
  // so every route gets the right status without each handler hand-validating.
  if (err instanceof mongoose.Error.CastError && err.kind === 'ObjectId') {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Not found',
      },
    })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    })
    return
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error({ err, path: req.path }, 'request:error')
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    })
    return
  }

  logger.error({ err, path: req.path }, 'request:unhandled')
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Internal server error',
    },
  })
}
