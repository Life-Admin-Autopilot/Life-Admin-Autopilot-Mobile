import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

// Hard cap on persisted turns. `$slice: -MAX` on every $push keeps the doc
// bounded under heavy use without a background sweep. Wiscord cap is 50;
// we mirror that — 25 user/assistant pairs is enough thread context.
export const AI_CONVERSATION_MAX_TURNS = 50

export const AI_TOOL_CALL_STATUSES = [
  'pending_confirmation',
  'executed',
  'failed',
  'declined',
] as const
export type AiToolCallStatus = (typeof AI_TOOL_CALL_STATUSES)[number]

export const AI_SOURCE_KINDS = ['task', 'voice'] as const
export type AiSourceKind = (typeof AI_SOURCE_KINDS)[number]

export interface AiConversationSource {
  kind: AiSourceKind
  id: string
  title: string
}

export interface AiConversationToolCall {
  callId: string
  // Optional Gemini-emitted id — required when present so the matching
  // functionResponse part echoes it back across multi-turn exchanges
  // (Gemini 3 returns a protocol error on unpaired calls).
  modelCallId?: string
  name: string
  args: Record<string, unknown>
  status: AiToolCallStatus
  result?: Record<string, unknown> | null
  error?: string | null
}

export interface AiConversationMessage {
  role: 'user' | 'assistant'
  text: string
  sources?: AiConversationSource[]
  toolCalls?: AiConversationToolCall[]
  createdAt: Date
}

export const AI_CONVERSATION_SCOPES = ['personal'] as const
export type AiConversationScope = (typeof AI_CONVERSATION_SCOPES)[number]

export interface AiConversationAttrs {
  userId: Types.ObjectId
  scope: AiConversationScope
  scopeId: string | null
  messages: AiConversationMessage[]
}

const SourceSchema = new Schema<AiConversationSource>(
  {
    kind: { type: String, enum: AI_SOURCE_KINDS, required: true },
    id: { type: String, required: true },
    title: { type: String, required: true },
  },
  { _id: false },
)

const ToolCallSchema = new Schema<AiConversationToolCall>(
  {
    callId: { type: String, required: true },
    modelCallId: { type: String },
    name: { type: String, required: true },
    args: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: AI_TOOL_CALL_STATUSES, required: true },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
)

const MessageSchema = new Schema<AiConversationMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    // Assistant turns can be tool-only (empty text), so `text` is allowed
    // to be the empty string. `required` would block that path.
    text: { type: String, default: '' },
    sources: { type: [SourceSchema], default: undefined },
    toolCalls: { type: [ToolCallSchema], default: undefined },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
)

const AiConversationSchema = new Schema<AiConversationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scope: { type: String, enum: AI_CONVERSATION_SCOPES, required: true, default: 'personal' },
    scopeId: { type: String, default: null },
    messages: { type: [MessageSchema], default: [] },
  },
  { timestamps: true },
)

// One doc per (userId, scope, scopeId). Lookups always go through this key.
AiConversationSchema.index(
  { userId: 1, scope: 1, scopeId: 1 },
  { unique: true },
)

export type AiConversationDoc = HydratedDocument<AiConversationAttrs>
type AiConversationModel = Model<AiConversationAttrs>

export const AiConversation: AiConversationModel =
  (mongoose.models.AiConversation as AiConversationModel | undefined) ??
  mongoose.model<AiConversationAttrs>('AiConversation', AiConversationSchema)
