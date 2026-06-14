# life-admin-autopilot-ai-stories

# Life Admin Autopilot — AI Engineering Spec

## User Stories, Tech Steps & Reference Tables

---

## Table of Contents

1. [Feature 1 — Voice-First AI Agent](about:blank#feature-1--voice-first-ai-agent)
2. [Feature 2 — AI Copilot Chat](about:blank#feature-2--ai-copilot-chat)
3. [Feature 3 — Document-to-Task Chain](about:blank#feature-3--document-to-task-chain)
4. [Feature 4 — AI Workspace Assignment](about:blank#feature-4--ai-workspace-assignment)
5. [Feature 5 — AI Notification Timing](about:blank#feature-5--ai-notification-timing)
6. [Feature 6 — Task Conflict Detection](about:blank#feature-6--task-conflict-detection)
7. [Feature 7 — Proactive Daily Briefing](about:blank#feature-7--proactive-daily-briefing)
8. [Feature 8 — Natural Language Automations](about:blank#feature-8--natural-language-automations)
9. [Feature 9 — Google Calendar Sync](about:blank#feature-9--google-calendar-sync)
10. [Reference Tables](about:blank#reference-tables)

---

## Feature 1 — Voice-First AI Agent

### User Stories

**US-01 · Simple Voice Task**
> As a user, I can tap the mic and say “pay my electricity bill before the 20th” so that the AI creates a task with the correct deadline, workspace, and reminder — without me typing anything.

**US-02 · Compound Voice Command**
> As a user, I can say “renew my car insurance before the 15th and compare 3 quotes first” so that the AI creates multiple linked sub-tasks in the correct order (compare → choose → renew), each with its own reminder.

**US-03 · Ambiguous Date Handling**
> As a user, when I say “renew my car registration next month,” the AI asks me to confirm the exact date if the extracted date is ambiguous, rather than guessing and creating a wrong reminder.

**US-04 · Low-Confidence Confirmation**
> As a user, when the AI is not confident about a value it extracted from my voice (e.g., which car I mean when I have two), it asks me a single clarifying question before saving the task.

**US-05 · Voice Command Review**
> As a user, after a voice command is processed, I can see a summary card showing all tasks created, so I can confirm, edit, or reject them before they are saved.

---

### Tech Steps

1. **Speech-to-Text (STT)** — Stream microphone audio to a STT service (e.g., Google Speech-to-Text / Whisper). Return raw transcript string.
2. **Intent Classification** — Pass transcript + user context to Gemini 2.5 Flash with a structured prompt. Classify into one of: `CREATE_TASK`, `CREATE_COMPOUND_TASK`, `QUERY`, `AUTOMATION`, `AMBIGUOUS`.
3. **Entity Extraction** — For `CREATE_TASK` / `CREATE_COMPOUND_TASK`, extract entities: `task_title`, `workspace`, `due_date`, `reminder_schedule`, `linked_documents`, `sub_tasks[]`, `confidence_score`.
4. **Confidence Gate** — If any required field has `confidence_score < 0.75`, route to the Clarification Flow: generate a single follow-up question, wait for user reply, re-run extraction on the merged input.
5. **Task Graph Construction** — For compound tasks, build a dependency graph: sub-tasks ordered by logical sequence, with `blocked_by` references between them.
6. **Persistence** — Write task graph to Supabase `tasks` table. Attach `source: "voice"`, raw transcript, and extracted entity trace for auditability.
7. **Confirmation Card** — Return structured task list to the frontend for user review before final commit.

---

## Feature 2 — AI Copilot Chat

### User Stories

**US-06 · Life Admin Q&A**
> As a user, I can ask “when does my car warranty expire?” and the AI answers using my uploaded documents, not generic information.

**US-07 · Task Status Query**
> As a user, I can ask “what’s due this week?” and the AI returns a prioritized summary of my pending tasks with their deadlines.

**US-08 · Document-Grounded Answer**
> As a user, when the AI answers a question using one of my documents, it shows me which document it referenced so I can verify.

**US-09 · Unsupported Query Fallback**
> As a user, when the AI cannot find the answer in my data, it tells me “I don’t have this information in your documents” instead of making something up.

**US-10 · Follow-up Context**
> As a user, I can ask follow-up questions in the same conversation (“and what about my home insurance?”) and the AI maintains context across multiple turns.

---

### Tech Steps

1. **RAG Retrieval** — On each user message, embed the query using a text embedding model. Run vector similarity search against the user’s personal knowledge base in Supabase `pgvector`. Retrieve top-K chunks (K=5 default).
2. **Context Assembly** — Combine retrieved chunks + last N turns of conversation history into a single context block. Inject into Gemini system prompt with strict grounding instruction: “Answer only from the provided context. If not found, say so.”
3. **Citation Tracking** — Tag each context chunk with its source document ID and page/field reference. Map model output back to source tags for citation display.
4. **Hallucination Guard** — Post-process the model response: if it references a date or value not present in retrieved chunks, flag and strip the claim, returning “I could not verify this in your documents.”
5. **Multi-turn State** — Persist conversation turns in session memory (Redis or Supabase). Append assistant + user turns after each exchange. Cap context window at token limit with a sliding window.
6. **Task Query Path** — Detect task-status intents separately (rule-based or classifier). Fetch directly from `tasks` table filtered by `user_id` + `due_date` range — do not go through RAG.

---

## Feature 3 — Document-to-Task Chain

### User Stories

**US-11 · Photo Scan to Task**
> As a user, I can photograph a paper bill and the AI reads it, identifies the due date and amount, and creates a “Pay [bill name]” task automatically — without me typing.

**US-12 · Insurance Card Scan**
> As a user, I can scan my car insurance card and the AI extracts the policy expiry date and creates a “Renew car insurance” task with a reminder 30 days before expiry.

**US-13 · Document Type Detection**
> As a user, when I upload any document image, the AI identifies its type (bill, insurance, ID, warranty, etc.) and applies the correct extraction rules — without me selecting the document type.

**US-14 · Multi-field Extraction**
> As a user, when I scan a medical prescription, the AI extracts the medication name, dosage, and refill date, and creates a “Refill prescription” task with the right reminder.

**US-15 · Low-Confidence Document Field**
> As a user, when the AI cannot read a value clearly (e.g., a blurry date), it highlights the uncertain field and asks me to confirm the value rather than saving a wrong date silently.

**US-16 · Document Attachment to Task**
> As a user, when a task is created from a document scan, the source document is automatically attached to the task so I can open it later for reference.

---

### Tech Steps

1. **Image Ingestion** — Accept image (JPEG/PNG/PDF-page) from camera or file picker. Store in Supabase Storage. Return `document_id`.
2. **OCR** — Run Google Vision OCR (or Tesseract fallback) on the image. Return raw text + bounding boxes.
3. **Document Type Classification** — Pass OCR text to Gemini with a classification prompt. Return `document_type` from the canonical list (see Reference Tables). Confidence score required.
4. **Schema-Driven Entity Extraction** — Load the extraction schema for the detected `document_type` (e.g., insurance schema: `policy_number`, `insured_name`, `expiry_date`, `vehicle`, `insurer`). Prompt Gemini to fill the schema from OCR text. Return structured JSON with per-field confidence scores.
5. **Task Generation Rules** — Apply the task-generation rule set for the `document_type`:
    - `expiry_date` → create task with `due_date = expiry_date - lead_days[document_type]`
    - `payment_due_date` → create payment task
    - `appointment_date` → create appointment reminder
6. **Confidence Gate** — Fields with `confidence < 0.80` are flagged. Frontend shows highlighted fields for user confirmation before task creation.
7. **RAG Indexing** — Chunk extracted text, embed, and upsert into `pgvector` under `user_id` + `document_id` for future Copilot Chat queries.
8. **Document Link** — Save `document_id` reference in the created task record for attachment retrieval.

---

## Feature 4 — AI Workspace Assignment

### User Stories

**US-17 · Auto-Categorization**
> As a user, when a task is created (by voice or document scan), the AI automatically assigns it to the correct workspace (Health, Home, Car, Finance, Family, Pets) without me selecting it.

**US-18 · Manual Override**
> As a user, I can change the workspace the AI assigned to a task, and the AI learns my preference for similar tasks in the future.

**US-19 · Ambiguous Assignment**
> As a user, when a task could belong to more than one workspace (e.g., “vet checkup for family dog”), the AI picks the most specific workspace (Pets) and shows me which workspace it chose.

**US-20 · Multi-Workspace Task**
> As a user, when a task spans two workspaces (e.g., “home improvement loan” belongs to both Home and Finance), the AI assigns it to the primary workspace and adds a secondary tag.

---

### Tech Steps

1. **Classification Prompt** — Pass `task_title + task_description + source_document_type` to Gemini. Return `primary_workspace`, `secondary_workspace?`, and `confidence`.
2. **Rule-Based Pre-filter** — Before calling the LLM, apply keyword rules (e.g., “insurance” → Car or Health; “school fee” → Family). If rule matches with high confidence, skip the LLM call to save cost.
3. **Preference Learning** — Store user override events in `workspace_overrides` table (`original_workspace`, `corrected_workspace`, `task_context`). Fine-tune the classification prompt with the last 20 user corrections as few-shot examples.
4. **Tie-breaking Logic** — If two workspaces have equal confidence, pick the more specific one (Pets > Family > General).

---

## Feature 5 — AI Notification Timing

### User Stories

**US-21 · Smart Reminder Lead Time**
> As a user, when a task is created from a car insurance document with an expiry of June 30, the AI automatically sets a reminder for June 1 (30 days before) — not just the day before — because it knows insurance renewals need preparation time.

**US-22 · Recurring Reminder**
> As a user, for a task like “pay monthly mortgage,” the AI sets the reminder to repeat every month on the correct date, so I never have to re-enter it.

**US-23 · One-Time Reminder**
> As a user, for a task like “call the school about enrollment,” the AI sets a single reminder at the appropriate time (e.g., morning of the due date) — not a recurring one.

**US-24 · Reminder Snooze Learning**
> As a user, if I consistently snooze reminders of a certain type (e.g., always snooze bill reminders by 2 days), the AI adjusts the default lead time for that task type going forward.

**US-25 · Time-of-Day Preference**
> As a user, the AI sends reminders at the time of day I am most responsive (learned from my interaction patterns), not at an arbitrary default time.

---

### Tech Steps

1. **Reminder Schedule Extraction** — During task creation, classify `reminder_type` as `ONE_TIME` or `RECURRING` (see Reference Tables). Extract `recurrence_rule` (RRULE format) for recurring tasks.
2. **Lead-Time Lookup** — Load `lead_time_rules[document_type][task_category]` from a config table (e.g., `insurance → 30 days`, `bill_payment → 5 days`, `registration → 45 days`).
3. **Computed Trigger Date** — `trigger_date = due_date - lead_time`. Store as `reminder_trigger_at` (ISO 8601 UTC).
4. **Notification Dispatch** — Push `reminder_trigger_at` to a job queue (e.g., Supabase Edge Functions + pg_cron or an external scheduler). Fire FCM/APNs push notification at trigger time.
5. **Snooze Tracking** — Log each snooze event: `user_id`, `task_category`, `original_trigger_at`, `snoozed_to`, `delta_days`. After 3+ snooze events of the same `task_category`, recalculate default lead time as `median(delta_days)` for that user.
6. **Time-of-Day Model** — Track notification open times. Compute user’s most responsive hour window. Apply as `preferred_hour_offset` to all future reminder dispatch times.

---

## Feature 6 — Task Conflict Detection

### User Stories

**US-26 · Date Overlap Detection**
> As a user, when two tasks have conflicting deadlines on the same day that would be difficult to complete together (e.g., “renew passport” and “attend school registration” both requiring in-person visits), the AI warns me of the conflict.

**US-27 · Logical Contradiction Detection**
> As a user, when I have a task “cancel gym membership” and later create a task “pay gym membership fee,” the AI flags these as contradicting and asks which one I actually want.

**US-28 · Duplicate Task Detection**
> As a user, when I try to create a task that is very similar to an existing open task (e.g., “renew car insurance” already exists), the AI warns me it might be a duplicate before saving.

**US-29 · Prerequisite Conflict**
> As a user, when I have a task “submit visa application” due on the 10th but a prerequisite task “get medical certificate” is due on the 12th, the AI detects the ordering problem and reorders or flags it.

---

### Tech Steps

1. **Conflict Scan Trigger** — Run conflict detection after every task creation or update event (async background job, not blocking the user).
2. **Date Overlap Check** — Query all open tasks in the same workspace where `due_date` falls within ±1 day. Check if combined estimated effort exceeds a threshold. Flag as `SCHEDULING_CONFLICT`.
3. **Semantic Contradiction Check** — Embed the new task title. Compare against all open tasks using cosine similarity. For high-similarity pairs (similarity > 0.85), pass both to Gemini: “Do these tasks contradict each other? Answer YES/NO and explain.” Flag as `LOGICAL_CONFLICT` if YES.
4. **Duplicate Check** — Same embedding comparison. If similarity > 0.92 and same workspace, flag as `DUPLICATE`.
5. **Prerequisite Ordering** — For tasks with `blocked_by` relationships, check that `blocker.due_date < blocked.due_date`. Flag as `ORDERING_CONFLICT` when violated.
6. **Conflict Notification** — Write conflict records to `task_conflicts` table with `conflict_type`, `task_ids[]`, and `suggested_resolution`. Push a non-intrusive in-app notification to the user with the suggested fix.

---

## Feature 7 — Proactive Daily Briefing

### User Stories

**US-30 · Morning Briefing Generation**
> As a user, every morning at my preferred time, I receive an AI-generated briefing that lists today’s tasks, this week’s upcoming deadlines, and any conflicts or at-risk items — without me opening the app.

**US-31 · Briefing Personalization**
> As a user, my morning briefing is ordered by my personal priorities (e.g., Finance tasks always appear first), not just by due date.

**US-32 · Briefing Action Shortcuts**
> As a user, within the briefing notification, I can mark a task complete or snooze a reminder directly — without opening the app.

**US-33 · Briefing Content Freshness**
> As a user, if nothing notable is due today or this week, my briefing says so in one line rather than generating a long empty report.

---

### Tech Steps

1. **Scheduled Trigger** — pg_cron job fires daily at 6:00 AM per-user local time. Triggers a Supabase Edge Function per user.
2. **Data Aggregation** — Fetch: today’s tasks, next 7 days tasks, open conflicts, recently completed tasks, overdue tasks. Sort by `priority_score = (urgency_weight × days_until_due) + (importance_weight × workspace_rank)`.
3. **Briefing Generation** — Pass aggregated data to Gemini 2.5 Flash with a briefing prompt. Instruct: write in second-person conversational tone, 150 words max, lead with most urgent item, end with one actionable suggestion.
4. **Empty State Guard** — If `tasks_due_today == 0 AND tasks_due_week <= 1 AND conflicts == 0`, use a template short message instead of calling the LLM (saves cost).
5. **Push Delivery** — Send via FCM/APNs as a rich notification with action buttons: “Mark Done”, “Snooze”, “Open App”.
6. **Action Handling** — Notification action callbacks hit a lightweight API endpoint that writes the action directly to the `tasks` table without requiring app launch.

---

## Feature 8 — Natural Language Automations

### User Stories

**US-34 · Recurring Automation Creation**
> As a user, I can say or type “every month on the 5th, remind me to check my bank statement” and the AI creates a recurring automation that fires every month — without me touching any settings.

**US-35 · Conditional Automation**
> As a user, I can create an automation like “when my car registration is within 60 days of expiry, create a renewal task” that runs automatically each time the condition becomes true.

**US-36 · Automation Review**
> As a user, I can see a plain-English summary of all my active automations (e.g., “Every 1st of the month: remind me to pay the mortgage”) so I can understand, edit, or delete them easily.

**US-37 · Automation Conflict**
> As a user, when a new automation I create would produce tasks that conflict with an existing automation, the AI warns me before saving.

---

### Tech Steps

1. **Automation Parsing** — Pass natural language automation string to Gemini. Extract: `trigger_type` (`RECURRING` or `CONDITIONAL`), `recurrence_rule` (RRULE), `condition_expression` (for conditional), `action_type` (`CREATE_TASK`, `SEND_REMINDER`), `action_payload`.
2. **RRULE Generation** — Convert extracted recurrence into a valid RRULE string (e.g., `FREQ=MONTHLY;BYMONTHDAY=5`). Validate with an RRULE library before saving.
3. **Plain-English Preview** — Before saving, call Gemini to convert the RRULE + action back to a human-readable sentence. Display to user for confirmation.
4. **Automation Storage** — Save to `automations` table: `user_id`, `trigger_type`, `rrule`, `condition_json`, `action_type`, `action_payload`, `is_active`.
5. **Automation Runner** — pg_cron job runs hourly. Evaluates all active automations: checks RRULE next occurrence OR evaluates condition. Fires the action if triggered. Logs to `automation_runs` table.
6. **Conflict Pre-check** — Before saving a new automation, simulate its next 3 executions and run them through the conflict detection engine (Feature 6). Warn the user if conflicts are found.

---

## Feature 9 — Google Calendar Sync

### User Stories

**US-38 · Task to Calendar**
> As a user, when I create a task with a due date in Life Admin Autopilot, it automatically appears as an event in my Google Calendar — so I have one unified view.

**US-39 · Calendar to Task**
> As a user, when I add a life-admin event in Google Calendar (e.g., “car service appointment”), it automatically appears as a task in the correct workspace in Life Admin Autopilot.

**US-40 · Two-Way Sync**
> As a user, when I change a task’s due date in Life Admin Autopilot, the change is reflected in Google Calendar within seconds, and vice versa.

**US-41 · Sync Conflict Resolution**
> As a user, when the same event is edited in both places simultaneously, I am notified of the conflict and can choose which version to keep.

---

### Tech Steps

1. **OAuth 2.0 Setup** — Implement Google OAuth flow. Store `access_token` + `refresh_token` per user in `user_integrations` table (encrypted at rest).
2. **Task → Calendar Push** — On task create/update, call Google Calendar API `events.insert` / `events.patch`. Map: `task.title → event.summary`, `task.due_date → event.start/end`, `task.workspace → event.colorId`, `task.description → event.description`.
3. **Calendar → Task Pull (Webhook)** — Register a Google Calendar push notification channel (`watch` API). On webhook event, fetch changed events, classify intent via Gemini (is this a life-admin task?), and create/update the task in Supabase if yes.
4. **Sync State Tracking** — Maintain `calendar_sync` table: `task_id`, `google_event_id`, `last_synced_at`, `sync_direction`, `etag`. Use `etag` for change detection to avoid redundant API calls.
5. **Conflict Resolution** — Compare `updated_at` timestamps. If both sides changed since `last_synced_at`, push a conflict notification to the user with a “Keep App Version / Keep Calendar Version” choice.
6. **Token Refresh** — Wrap all Calendar API calls with a token refresh interceptor. On 401, use `refresh_token` to get a new `access_token` and retry.

---

---

## Reference Tables

### Table 1 — Supported Input Document Types

| Document Type ID | Display Name | Key Fields Extracted | Default Task Generated | Lead Time Before Expiry |
| --- | --- | --- | --- | --- |
| `insurance_car` | Car Insurance Card | policy_number, insurer, expiry_date, vehicle_make, vehicle_plate | Renew Car Insurance | 30 days |
| `insurance_health` | Health Insurance Card | policy_number, insurer, expiry_date, member_name, coverage_type | Renew Health Insurance | 30 days |
| `insurance_home` | Home Insurance Policy | policy_number, insurer, expiry_date, property_address, premium_amount | Renew Home Insurance | 30 days |
| `insurance_life` | Life Insurance Policy | policy_number, insurer, premium_due_date, coverage_amount | Pay Life Insurance Premium | 7 days |
| `vehicle_registration` | Vehicle Registration | registration_number, expiry_date, vehicle_make, plate_number | Renew Vehicle Registration | 45 days |
| `driving_license` | Driving License | license_number, expiry_date, holder_name, license_class | Renew Driving License | 60 days |
| `passport` | Passport | passport_number, expiry_date, holder_name, nationality | Renew Passport | 180 days |
| `national_id` | National ID / Emirates ID | id_number, expiry_date, holder_name | Renew National ID | 60 days |
| `bill_utility` | Utility Bill (Electricity/Gas/Water) | provider, account_number, amount_due, payment_due_date, billing_period | Pay Utility Bill | 5 days |
| `bill_telecom` | Telecom Bill (Mobile/Internet) | provider, account_number, amount_due, payment_due_date | Pay Telecom Bill | 5 days |
| `bill_rent` | Rent Bill / Cheque | landlord_name, amount, due_date, property_address | Pay Rent | 7 days |
| `bill_school` | School Fee Invoice | school_name, student_name, amount_due, payment_due_date, term | Pay School Fees | 7 days |
| `warranty_card` | Warranty Card / Certificate | product_name, purchase_date, warranty_expiry, serial_number, retailer | Warranty Expiry Reminder | 30 days |
| `medical_prescription` | Medical Prescription | medication_name, dosage, prescribing_doctor, refill_date, pharmacy | Refill Prescription | 7 days |
| `medical_report` | Medical Test / Lab Report | test_type, date, doctor_name, follow_up_date | Doctor Follow-up Reminder | 3 days |
| `appointment_card` | Appointment Card / Slip | provider_name, appointment_date, appointment_time, location | Appointment Reminder | 1 day |
| `contract_service` | Service Contract | service_provider, contract_expiry, renewal_terms, monthly_amount | Renew Service Contract | 30 days |
| `tax_document` | Tax Filing Document | tax_year, filing_deadline, authority_name, amount_owed | File Tax Return | 14 days |
| `bank_statement` | Bank Statement | bank_name, account_number, statement_period, closing_balance | Review Bank Statement | 0 days (immediate) |
| `mortgage_statement` | Mortgage Statement | lender_name, account_number, next_payment_date, payment_amount | Pay Mortgage | 5 days |
| `pet_vaccination` | Pet Vaccination Record | pet_name, vaccine_type, last_date, next_due_date, vet_clinic | Renew Pet Vaccination | 14 days |
| `pet_license` | Pet License | pet_name, license_number, expiry_date, issued_by | Renew Pet License | 30 days |
| `unknown` | Unknown Document | raw_text (best-effort) | Generic Reminder (user confirms) | — |

---

### Table 2 — Task Workspace Categories

| Workspace ID | Display Name | Color Code | Example Task Types |
| --- | --- | --- | --- |
| `health` | Health | 🟢 Green | Doctor appointments, prescriptions, health insurance, medical tests, gym membership |
| `home` | Home | 🟠 Orange | Utility bills, rent, home insurance, repairs, service contracts, cleaning |
| `car` | Car | 🔵 Blue | Car insurance, vehicle registration, service, driving license, fuel card |
| `finance` | Finance | 🟡 Yellow | Bank statements, tax filing, mortgage, investments, loan payments, credit cards |
| `family` | Family | 🟣 Purple | School fees, school enrollment, family documents, passports, kid appointments |
| `pets` | Pets | 🟤 Brown | Pet vaccinations, vet appointments, pet license, pet food subscriptions |

---

### Table 3 — Reminder / Schedule Types

| Type ID | Display Name | Description | RRULE Example | Typical Use Cases |
| --- | --- | --- | --- | --- |
| `one_time` | One-Time | Fires once at a specific date/time | *(no RRULE — single trigger)* | Appointment, passport renewal, one-off bill |
| `recurring_daily` | Daily | Fires every day | `FREQ=DAILY` | Daily medication reminders |
| `recurring_weekly` | Weekly | Fires every N weeks on a specific day | `FREQ=WEEKLY;BYDAY=MO` | Weekly chores, weekly check-ins |
| `recurring_biweekly` | Every 2 Weeks | Fires every two weeks | `FREQ=WEEKLY;INTERVAL=2` | Bi-weekly payments, bi-weekly services |
| `recurring_monthly` | Monthly | Fires every month on a specific day | `FREQ=MONTHLY;BYMONTHDAY=5` | Monthly bills, monthly rent, mortgage |
| `recurring_quarterly` | Quarterly | Fires every 3 months | `FREQ=MONTHLY;INTERVAL=3` | Quarterly tax payments, quarterly reviews |
| `recurring_biannual` | Every 6 Months | Fires every 6 months | `FREQ=MONTHLY;INTERVAL=6` | Semi-annual checkups, bi-annual services |
| `recurring_annual` | Yearly | Fires once per year | `FREQ=YEARLY` | Annual renewals: insurance, registration, passport |
| `countdown_relative` | Days Before Due Date | Fires N days before the task due date | *(computed: `due_date - N days`)* | Insurance renewal (30 days before), registration (45 days before) |
| `countdown_morning` | Day-of Morning | Fires on the morning of the due date | *(computed: `due_date at preferred_hour`)* | Appointment day, payment day |

---

### Table 4 — AI Agent Types & Responsibilities

| Agent ID | Agent Name | Trigger | Core Responsibilities | Output |
| --- | --- | --- | --- | --- |
| `planning_agent` | Planning Agent | Voice command, text input, automation runner | Intent classification, entity extraction, task graph construction, compound task decomposition | Task records with dependency graph |
| `document_agent` | Document Agent | File/image upload | OCR, document type classification, schema-driven field extraction, RAG indexing, task generation from document | Extracted data JSON, task records, vector embeddings |
| `adaptation_agent` | Adaptation Agent | User action events (snooze, override, complete) | Learn workspace preferences, adjust reminder lead times, update time-of-day model, fine-tune few-shot examples | Updated user preference profile |

---

### Table 5 — Conflict Types

| Conflict Type ID | Display Name | Detection Method | Example | Suggested Resolution |
| --- | --- | --- | --- | --- |
| `scheduling_conflict` | Scheduling Conflict | Date overlap + effort heuristic | Two tasks requiring in-person visits on the same day | Reschedule one task to adjacent day |
| `logical_conflict` | Logical Contradiction | Semantic similarity + Gemini contradiction check | “Cancel gym membership” + “Pay gym fee” | Ask user which intent is current |
| `duplicate_task` | Duplicate Task | Embedding similarity > 0.92 | “Renew car insurance” created twice | Merge into one task or discard new one |
| `ordering_conflict` | Wrong Order / Prerequisite | `blocker.due_date >= blocked.due_date` check | “Submit application” due before “Get medical cert” | Swap due dates or flag for user action |
| `automation_conflict` | Automation Output Conflict | Simulate next N automation runs through conflict engine | Two automations creating overlapping monthly tasks | Deactivate one or adjust schedule |

---

### Table 6 — Task Intent Classification (for Voice / NLP)

| Intent ID | Intent Name | Example Voice Input | Output Action |
| --- | --- | --- | --- |
| `create_simple` | Create Single Task | “Remind me to pay the water bill on the 20th” | 1 task created |
| `create_compound` | Create Compound Task | “Renew car insurance before the 15th, compare 3 quotes first” | Multiple linked tasks with dependency graph |
| `create_recurring` | Create Recurring Task | “Every month remind me to check my credit card statement” | 1 task + RRULE |
| `create_automation` | Create Automation Rule | “Whenever my registration is about to expire, alert me 45 days before” | Automation record |
| `query_status` | Query Task Status | “What’s due this week?” | Fetch + summarize from tasks DB |
| `query_document` | Query Document Data | “When does my health insurance expire?” | RAG retrieval + answer |
| `update_task` | Update Existing Task | “Move the school fee deadline to the 25th” | Patch task record |
| `complete_task` | Mark Task Complete | “I already paid the electricity bill” | Mark task `status = done` |
| `delete_task` | Delete Task | “Remove the gym membership reminder” | Soft delete task |
| `ambiguous` | Ambiguous Input | “Do the thing I mentioned yesterday” | Trigger clarification flow |

---

### Table 7 — Confidence Thresholds & Actions

| Confidence Level | Score Range | Action |
| --- | --- | --- |
| High | ≥ 0.90 | Auto-save without user confirmation |
| Medium | 0.75 – 0.89 | Save but show summary card for user review |
| Low | 0.50 – 0.74 | Ask one clarifying question before saving |
| Very Low | < 0.50 | Do not auto-create; show raw extraction and ask user to fill in manually |

---

### Table 8 — Document-to-Task Lead Time Config

| Workspace | Task Category | Default Lead Time (Days Before Due) |
| --- | --- | --- |
| Car | Insurance Renewal | 30 |
| Car | Vehicle Registration | 45 |
| Car | Driving License Renewal | 60 |
| Car | Car Service | 7 |
| Health | Health Insurance Renewal | 30 |
| Health | Medical Appointment | 1 |
| Health | Prescription Refill | 7 |
| Finance | Bill Payment (Utility) | 5 |
| Finance | Bill Payment (Rent/Mortgage) | 5 |
| Finance | Tax Filing | 14 |
| Finance | Credit Card Payment | 5 |
| Family | School Fee Payment | 7 |
| Family | Passport Renewal | 180 |
| Family | National ID Renewal | 60 |
| Home | Home Insurance Renewal | 30 |
| Home | Service Contract Renewal | 30 |
| Pets | Vaccination Due | 14 |
| Pets | Pet License Renewal | 30 |