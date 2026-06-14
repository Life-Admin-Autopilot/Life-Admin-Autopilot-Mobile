import { Router } from 'express'
import type { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { logger } from '../logger'
import { verifyPassword } from '../lib/password'
import { revokeAllUserSessions } from '../lib/sessions'
import { getVoiceNoteStorage } from '../lib/voiceNoteStorage'
import { requireAuth } from '../middleware/auth'
import { AiConversation } from '../models/AiConversation'
import { AiUsageCounter } from '../models/AiUsageCounter'
import { RefreshToken } from '../models/RefreshToken'
import { Task } from '../models/Task'
import { DOMAINS, MIC_QUALITIES, TEXT_SIZES, THEMES, User } from '../models/User'
import { VerificationToken } from '../models/VerificationToken'
import { VoiceNote } from '../models/VoiceNote'

export const meRouter = Router()

const UpdateMeSchema = z.object({
  displayName: z.string().min(1).max(80).trim().optional(),
  preferredDomains: z.array(z.enum(DOMAINS)).optional(),
  hasOnboarded: z.boolean().optional(),
  // Onboarding Q&A captured as AI personalization memory. Replaced as a whole
  // array (not a nested merge) — see buildSet.
  onboardingAnswers: z
    .array(
      z.object({
        id: z.string().max(100),
        question: z.string().max(200),
        answer: z.string().max(500),
      }),
    )
    .max(20)
    .optional(),
  theme: z.enum(THEMES).optional(),
  textSize: z.enum(TEXT_SIZES).optional(),
  mic: z.object({ quality: z.enum(MIC_QUALITIES) }).partial().optional(),
  notifications: z
    .object({ push: z.boolean(), emailDigest: z.boolean(), marketing: z.boolean() })
    .partial()
    .optional(),
  privacy: z
    .object({ analytics: z.boolean(), crashReports: z.boolean() })
    .partial()
    .optional(),
})

type UpdateMe = z.infer<typeof UpdateMeSchema>

const NESTED_KEYS = ['mic', 'notifications', 'privacy'] as const

// Flatten nested preference patches into dot-notation `$set` keys so updating
// one field (e.g. notifications.push) doesn't overwrite its siblings.
function buildSet(patch: UpdateMe): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if ((NESTED_KEYS as readonly string[]).includes(key) && value && typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (subValue !== undefined) set[`${key}.${subKey}`] = subValue
      }
    } else {
      set[key] = value
    }
  }
  return set
}

meRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = UpdateMeSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Some of those settings looked off.', parsed.error.flatten())
    }
    const set = buildSet(parsed.data)
    const user = await User.findByIdAndUpdate(
      auth.sub,
      { $set: set },
      { new: true, runValidators: true },
    )
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    res.status(200).json({ user: user.toJSON() })
  }),
)

const DeleteMeSchema = z.object({
  // Optional: password-auth accounts must confirm with their password.
  // Passwordless (magic-link only) accounts may delete without one.
  password: z.string().min(1).optional(),
})

// Remove the user and every doc that references them. We can't use a Mongo
// transaction here (the deployment + the in-memory test DB are standalone, not
// a replica set — sessions would throw), so we delete strictly dependents-first
// and only remove the User row last, once the dependent collections are gone.
// That ordering means a mid-cascade failure leaves the still-authenticated User
// behind (re-runnable) rather than a logged-out account with orphaned data.
async function deleteUserAndDependents(userId: string, userObjectId: Types.ObjectId): Promise<void> {
  // Best-effort audio cleanup before the VoiceNote rows vanish — storage misses
  // (already-gone files) must not abort the account deletion.
  const notes = await VoiceNote.find({ userId: userObjectId }, { storageKey: 1 }).lean()
  if (notes.length > 0) {
    const storage = getVoiceNoteStorage()
    await Promise.all(
      notes.map((note) =>
        storage.remove(note.storageKey).catch((err: unknown) => {
          logger.warn({ err, userId, storageKey: note.storageKey }, 'me:delete:audio-remove-failed')
        }),
      ),
    )
  }

  await revokeAllUserSessions(userId)
  await RefreshToken.deleteMany({ userId: userObjectId })
  await Task.deleteMany({ userId: userObjectId })
  await VoiceNote.deleteMany({ userId: userObjectId })
  await AiConversation.deleteMany({ userId: userObjectId })
  await AiUsageCounter.deleteMany({ userId: userObjectId })
  await VerificationToken.deleteMany({ userId: userObjectId })

  // Dependents are gone — now retire the account itself.
  await User.deleteOne({ _id: userObjectId })
}

meRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = DeleteMeSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_body', "That delete request didn't look right.", parsed.error.flatten())
    }
    const { password } = parsed.data

    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')

    if (user.passwordHash) {
      if (!password) {
        throw BadRequest('password_required', 'Enter your password to delete your account.')
      }
      const ok = await verifyPassword(user.passwordHash, password)
      if (!ok) throw Unauthorized('invalid_credentials', 'That password is incorrect.')
    }

    await deleteUserAndDependents(user.id, user._id)

    res.status(204).end()
  }),
)
