// Fake tasks for the eval suites — the "MY TASKS" data block a case runs against.
//
// Ids are 24 hex chars because that is what a real ObjectId citation looks like
// in the block; a model that invents an id produces something structurally
// different and the matcher catches it.

import type { FakeTask } from './types'

export const TASK_A: FakeTask = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Old gym membership',
  domain: 'health',
  status: 'open',
  priority: 'normal',
}

export const TASK_B: FakeTask = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  title: 'Pay water bill',
  domain: 'home',
  status: 'open',
  priority: 'normal',
}

export const TASK_C: FakeTask = {
  id: 'cccccccccccccccccccccccc',
  title: 'Renew passport',
  domain: 'family',
  status: 'open',
  priority: 'normal',
  subtasks: [
    { id: 'sub111111111111111111111a', text: 'gather birth certificate', done: false },
    { id: 'sub222222222222222222222b', text: 'take new photo', done: false },
  ],
}

// ── Referent-ambiguity fixtures ────────────────────────────────────────────
// TWO plausible matches for one underspecified phrase ("the insurance thing").
// The whole point is that no single taskId is derivable, so any delete/complete
// naming one of these is a wrong guess on a destructive verb.

export const TASK_CAR_INSURANCE: FakeTask = {
  id: 'd1d1d1d1d1d1d1d1d1d1d1d1',
  title: 'Car insurance renewal',
  domain: 'car',
  status: 'open',
  priority: 'normal',
}

export const TASK_HEALTH_INSURANCE: FakeTask = {
  id: 'd2d2d2d2d2d2d2d2d2d2d2d2',
  title: 'Health insurance renewal',
  domain: 'health',
  status: 'open',
  priority: 'normal',
}

export const TASK_DENTIST: FakeTask = {
  id: 'e1e1e1e1e1e1e1e1e1e1e1e1',
  title: 'Dentist checkup',
  domain: 'health',
  status: 'open',
  priority: 'normal',
}

export const TASK_LANDLORD: FakeTask = {
  id: 'e2e2e2e2e2e2e2e2e2e2e2e2',
  title: 'Call the landlord about the lease',
  domain: 'home',
  status: 'open',
  priority: 'normal',
}

export const TASK_CAR_SERVICE: FakeTask = {
  id: 'e3e3e3e3e3e3e3e3e3e3e3e3',
  title: 'Car service at the garage',
  domain: 'car',
  status: 'open',
  priority: 'normal',
}

// Already has steps — "what else do I need" must ADD to this, not re-list it.
export const TASK_MOVE: FakeTask = {
  id: 'f1f1f1f1f1f1f1f1f1f1f1f1',
  title: 'Move to the new flat',
  domain: 'home',
  status: 'open',
  priority: 'high',
  subtasks: [
    { id: 'sub333333333333333333333c', text: 'book the van', done: false },
    { id: 'sub444444444444444444444d', text: 'change the address on file', done: false },
  ],
}
