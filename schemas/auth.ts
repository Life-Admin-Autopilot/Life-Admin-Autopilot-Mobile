import { z } from 'zod'

// Auth form schemas. `z.infer` is the form type (AGENTS.md → State/forms).
// Mirrors the backend rules: email + password (min 8, max 128 on signup).

export const signInSchema = z.object({
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(1, 'Enter your password.'),
})

export const signUpSchema = z.object({
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(8, 'At least 8 characters.').max(128, 'That password is too long.'),
})

export type SignInValues = z.infer<typeof signInSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
