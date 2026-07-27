import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

// The in-app notification feed. Producers: the reminder worker (a reminder
// fired) and the uncertainty nudge (held items went stale). The dashboard bell
// reads unread ones. This collection is ALSO the push-ready queue — when web /
// Capacitor push lands, a dispatcher sends each new doc and there's nothing else
// to change here.

export const NOTIFICATION_KINDS = ['reminder', 'uncertainty', 'document_scan'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface NotificationAttrs {
  userId: Types.ObjectId
  kind: NotificationKind
  title: string
  body?: string
  taskId?: Types.ObjectId
  clarificationId?: Types.ObjectId
  documentId?: Types.ObjectId
  readAt?: Date
}

function toIdJSON(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  ret.id = String(ret._id)
  delete ret._id
  delete ret.__v
  return ret
}

const NotificationSchema = new Schema<NotificationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    title: { type: String, required: true },
    body: { type: String },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    clarificationId: { type: Schema.Types.ObjectId, ref: 'Clarification' },
    documentId: { type: Schema.Types.ObjectId, ref: 'ScannedDocument' },
    readAt: { type: Date },
  },
  { timestamps: true, toJSON: { transform: toIdJSON } },
)

// Feed + unread-count query.
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 })

export type NotificationDoc = HydratedDocument<NotificationAttrs>

export const Notification: Model<NotificationAttrs> =
  (mongoose.models.Notification as Model<NotificationAttrs> | undefined) ??
  mongoose.model<NotificationAttrs>('Notification', NotificationSchema)
